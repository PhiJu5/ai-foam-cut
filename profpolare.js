/* profpolare.js — Profilpolaren im Profilvergleich (Heißdraht-Rippen und Formenbau-Glättung).
 * Gehört zur Funktion „aero" (braucht neuralfoil.js bzw. XFOIL über App.aeroXfoil) und fehlt daher in der freien
 * Fassung; die Vergleichsfenster rufen es nur geschützt auf (if (App.profPolarAttach) …).
 *
 * Rechnet für jede gezeigte Kurve (Original-.dat, geglättete/geschnittene Kontur, Vergleich) die
 * Polare und zeigt cl(α), cl(cd) und eine Tabelle mit den Differenzen zur Original-.dat — damit
 * sichtbar wird, was die Glättung aerodynamisch ausmacht.
 *   NeuralFoil (Standard): schnell und stabil, rechnet intern aber über eine CST-Form (8+8
 *     Parameter) — sehr feine Unterschiede (Hundertstel mm, Welligkeit) sieht es kaum.
 *   XFOIL (echtes xfoil.exe über den lokalen Server, App.aeroXfoil): rechnet mit den Punkten
 *     selbst und reagiert auf Details; braucht einige Sekunden, daher erst auf Knopfdruck.
 *
 * App.profPolarAttach({ host, curves, onChange }) -> { controls(side), refresh(), redraw(), shown() }
 *   host:  Element, in das Diagramm + Tabelle kommen (wird ein-/ausgeblendet)
 *   controls(side): Bedienung (Gruppe „Polaren") in ein Element zeichnen (bei jedem Neuaufbau)
 *   curves(): [{ key, name, color, pts }] — pts in beliebiger Lage/Größe (mm, verdreht);
 *             die erste Kurve ist die Referenz (Original-.dat).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const LS = 'hw_profpolar';
  const loadCfg = () => { try { return Object.assign({ on: false, re: 150000, ncrit: 9, calc: 'nf', a0: -4, a1: 14 }, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { return { on: false, re: 150000, ncrit: 9, calc: 'nf', a0: -4, a1: 14 }; } };
  const fixCfg = c => { if (c.calc !== 'xfoil') c.calc = 'nf'; return c; };   // alt 'wind' → NeuralFoil
  const saveCfg = c => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch (e) {} };
  const CACHE = new Map();   // Schlüssel: Verfahren|Re|ncrit|Bereich|Form-Hash -> Polare

  // Kontur -> normiert (Nase 0,0, Endleistenmitte 1,0), Reihenfolge Endleiste oben -> Nase -> unten.
  function normalize(P) {
    if (!P || P.length < 8) return null;
    const PF = window.ProfilFit, iLE = PF.noseIndex(P), fr = PF.chordFrame(P, iLE);
    const n = P.length, te = fr.to({ x: (P[0].x + P[n - 1].x) / 2, y: (P[0].y + P[n - 1].y) / 2 }), c = te.x || 1;
    let Q = P.map(p => { const q = fr.to(p); return { x: q.x / c, y: q.y / c }; });
    // Oberseite zuerst (Selig): erster Punkt muss über der Sehne liegen
    if (Q[Math.max(1, Math.round(iLE / 2))].y < Q[Math.min(n - 2, iLE + Math.round((n - iLE) / 2))].y) Q = Q.reverse();
    return Q;
  }
  function hash(Q) { let h = 0; for (let i = 0; i < Q.length; i += 3) h = (h * 31 + Math.round(Q[i].x * 1e6) * 7 + Math.round(Q[i].y * 1e6)) | 0; return Q.length + ':' + h; }
  const XF = () => (App.aeroXfoil && App.aeroXfoil.ready()) ? App.aeroXfoil : null;
  function solverOk(calc) { return calc === 'xfoil' ? !!XF() : !!(window.NeuralFoil && NeuralFoil.ready && NeuralFoil.ready()); }
  const keyOf = (Q, cfg) => [cfg.calc, cfg.re, cfg.ncrit, cfg.a0, cfg.a1, hash(Q)].join('|');
  function polarOf(Q, cfg) {
    const key = keyOf(Q, cfg);
    if (CACHE.has(key)) return CACHE.get(key);
    if (cfg.calc === 'xfoil') return null;          // kommt asynchron (xfoilFill)
    let r = null;
    try {
      const m = NeuralFoil.build(Q);
      r = m ? m.polar({ Re: cfg.re, a0: cfg.a0, a1: cfg.a1, da: 0.5, ncrit: cfg.ncrit }) : null;
    } catch (e) { r = null; }
    if (CACHE.size > 200) CACHE.clear();
    CACHE.set(key, r);
    return r;
  }
  // XFOIL: alle fehlenden Kurven in EINEM Aufruf (parallel auf den eingestellten Kernen)
  async function xfoilFill(QS, cfg) {
    const X = XF(); if (!X) return;
    const miss = QS.filter(Q => !CACHE.has(keyOf(Q, cfg)));
    if (!miss.length) return;
    const r = await X.run(miss.map(Q => ({ prof: Q, name: 'Profil', Re: cfg.re, ncrit: cfg.ncrit, a0: cfg.a0, a1: cfg.a1, da: 0.5 })));
    if (CACHE.size > 200) CACHE.clear();
    miss.forEach((Q, i) => {
      const P = r && r[i] ? X.polarOf(r[i]) : null;
      if (P) { let am = NaN, cm = -Infinity; P.pts.forEach(q => { if (q.cl > cm) { cm = q.cl; am = q.alpha; } }); P.alphaMax = am; }
      CACHE.set(keyOf(Q, cfg), P);
    });
  }
  // Wert einer Polare an Stelle x (lineare Interpolation über ein Feld)
  function at(pts, fx, fy, x) {
    const P = pts.filter(p => isFinite(fx(p)) && isFinite(fy(p))).sort((a, b) => fx(a) - fx(b));
    for (let i = 0; i < P.length - 1; i++) { const a = fx(P[i]), b = fx(P[i + 1]); if (x >= a && x <= b && b > a) return fy(P[i]) + (fy(P[i + 1]) - fy(P[i])) * (x - a) / (b - a); }
    return NaN;
  }
  // cd bei gegebenem cl (nur der Ast unterhalb cl_max)
  function cdAtCl(pol, cl) {
    const pts = pol.pts.filter(p => p.alpha <= pol.alphaMax + 1e-9);
    return at(pts, p => p.cl, p => p.cd, cl);
  }

  function attach(o) {
    const cfg = fixCfg(loadCfg());
    let res = null, busy = false;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:2 1 0;min-height:200px;display:none;gap:8px;min-width:0';
    wrap.innerHTML = '<div style="position:relative;flex:1 1 0;min-width:0;background:var(--panel2,#0e1520);border-radius:8px"><canvas style="width:100%;height:100%;display:block"></canvas></div>'
      + '<div class="pp-tab hint" style="flex:0 0 250px;overflow:auto;font-size:11px;line-height:1.3"></div>';
    o.host.appendChild(wrap);
    const cvs = wrap.querySelector('canvas'), tab = wrap.querySelector('.pp-tab');
    const show = () => { wrap.style.display = cfg.on ? 'flex' : 'none'; };
    // Zoom/Verschieben je Diagramm: views[i] = { x:[a,b], y:[a,b] } oder null (automatisch)
    const views = [null, null];
    let layout = [], drag = null;
    cvs.style.cursor = 'grab';
    const plotAt = (mx, my) => layout.findIndex(L => mx >= L.px0 - 30 && mx <= L.px1 + 8 && my >= L.py0 - 8 && my <= L.py1 + 20);
    const toData = (L, mx, my) => ({ x: L.xr[0] + (mx - L.px0) / (L.px1 - L.px0) * (L.xr[1] - L.xr[0]), y: L.yr[1] - (my - L.py0) / (L.py1 - L.py0) * (L.yr[1] - L.yr[0]) });
    const mpos = e => { const r = cvs.getBoundingClientRect(); return { mx: e.clientX - r.left, my: e.clientY - r.top }; };
    cvs.addEventListener('wheel', e => {
      const { mx, my } = mpos(e), i = plotAt(mx, my); if (i < 0) return;
      e.preventDefault();
      const L = layout[i], d = toData(L, mx, my), f = e.deltaY < 0 ? 0.8 : 1.25;
      const xr = e.altKey ? L.xr : [d.x - (d.x - L.xr[0]) * f, d.x + (L.xr[1] - d.x) * f];   // Alt = nur cl-Achse
      const yr = e.shiftKey ? L.yr : [d.y - (d.y - L.yr[0]) * f, d.y + (L.yr[1] - d.y) * f]; // Shift = nur waagrecht
      views[i] = { x: xr, y: yr }; draw();
    }, { passive: false });
    cvs.addEventListener('mousedown', e => {
      const { mx, my } = mpos(e), i = plotAt(mx, my); if (i < 0) return;
      const L = layout[i]; drag = { i, mx, my, xr: L.xr.slice(), yr: L.yr.slice(), L }; cvs.style.cursor = 'grabbing'; e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const { mx, my } = mpos(e), L = drag.L;
      const dx = (mx - drag.mx) / (L.px1 - L.px0) * (drag.xr[1] - drag.xr[0]), dy = (my - drag.my) / (L.py1 - L.py0) * (drag.yr[1] - drag.yr[0]);
      views[drag.i] = { x: [drag.xr[0] - dx, drag.xr[1] - dx], y: [drag.yr[0] + dy, drag.yr[1] + dy] }; draw();
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; cvs.style.cursor = 'grab'; } });
    cvs.addEventListener('dblclick', e => { const { mx, my } = mpos(e), i = plotAt(mx, my); if (i >= 0) { views[i] = null; draw(); } });
    // Achsbeschriftung: Schritt und Nachkommastellen passend zum sichtbaren Bereich
    const niceStep = span => { const r = span / 5, p = Math.pow(10, Math.floor(Math.log10(r || 1))), m = r / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
    const decs = step => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));

    async function compute() {
      if (!cfg.on) return;
      if (!solverOk(cfg.calc)) { res = { err: cfg.calc === 'xfoil' ? (App.aeroXfoil ? App.aeroXfoil.why() : T('XFOIL braucht die Funktion „Aerodynamik“.')) : T('Rechenverfahren nicht verfügbar.') }; draw(); return; }
      const C = (o.curves() || []).map(c => Object.assign({}, c, { Q: normalize(c.pts) })).filter(c => c.Q);
      if (cfg.calc === 'xfoil') { tab.textContent = T('XFOIL rechnet …'); await xfoilFill(C.map(c => c.Q), cfg); }
      res = { curves: C.map(c => Object.assign(c, { pol: polarOf(c.Q, cfg) })) };
      // Vergleich NeuralFoil ↔ XFOIL: jede Kurve zusätzlich mit der anderen Methode (gestrichelt, gleiche Farbe)
      if (cfg.cmp && XF() && window.NeuralFoil) {
        const c2 = Object.assign({}, cfg, { calc: cfg.calc === 'xfoil' ? 'nf' : 'xfoil' }), nm2 = c2.calc === 'xfoil' ? 'XFOIL' : 'NF';
        if (c2.calc === 'xfoil') { tab.textContent = T('XFOIL rechnet (Vergleich) …'); await xfoilFill(C.map(c => c.Q), c2); }
        res.curves = res.curves.concat(C.map(c => Object.assign({}, c, { name: c.name + ' · ' + nm2, dash: true, ref: false, pol: polarOf(c.Q, c2) })));
      }
      draw();
    }
    function run() {   // XFOIL: kurz „rechnet …" zeigen, dann rechnen
      if (busy) return; busy = true;
      tab.textContent = T('Polaren werden gerechnet …');
      setTimeout(() => { compute().finally(() => { busy = false; }); }, 30);
    }

    function draw() {
      show(); if (!cfg.on) return;
      const dpr = window.devicePixelRatio || 1, rc = cvs.getBoundingClientRect();
      cvs.width = Math.max(1, Math.round(rc.width * dpr)); cvs.height = Math.max(1, Math.round(rc.height * dpr));
      const g = cvs.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = rc.width, H = rc.height;
      g.fillStyle = '#0e1520'; g.fillRect(0, 0, W, H);
      if (!res) { tab.textContent = cfg.calc === 'xfoil' || cfg.cmp ? T('„Polaren rechnen" drücken (XFOIL braucht einige Sekunden).') : ''; return; }
      if (res.err) { tab.textContent = res.err; return; }
      const C = res.curves.filter(c => c.pol && c.pol.pts && c.pol.pts.length);
      if (!C.length) { tab.textContent = T('Keine Polare berechenbar.'); return; }
      // zwei Diagramme: cl(α) links, cl(cd) rechts
      const pad = { l: 40, r: 10, t: 14, b: 26 }, gap = 16, w2 = (W - gap) / 2;
      let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity, d1 = 0;
      for (const c of C) for (const p of c.pol.pts) { a0 = Math.min(a0, p.alpha); a1 = Math.max(a1, p.alpha); c0 = Math.min(c0, p.cl); c1 = Math.max(c1, p.cl); d1 = Math.max(d1, p.cd); }
      d1 = Math.min(d1, 0.06);
      layout = [];
      const plot = (idx, x0, fx, xrAuto, xl, xScale) => {
        const vw = views[idx], xr = vw ? vw.x : xrAuto, yr = vw ? vw.y : [c0, c1];
        const px0 = x0 + pad.l, px1 = x0 + w2 - pad.r, py0 = pad.t, py1 = H - pad.b;
        layout[idx] = { px0, px1, py0, py1, xr, yr };
        const X = v => px0 + (v - xr[0]) / ((xr[1] - xr[0]) || 1) * (px1 - px0);
        const Y = v => py0 + (yr[1] - v) / ((yr[1] - yr[0]) || 1) * (py1 - py0);
        g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.font = '10px system-ui'; g.fillStyle = '#9aa';
        const sy = niceStep(yr[1] - yr[0]), dy = decs(sy);
        for (let v = Math.ceil(yr[0] / sy) * sy; v <= yr[1] + 1e-12; v += sy) { const y = Y(v); g.beginPath(); g.moveTo(px0, y); g.lineTo(px1, y); g.stroke(); g.fillText(v.toFixed(dy), x0 + 2, y + 3); }
        const sx = niceStep((xr[1] - xr[0]) * xScale) / xScale, dx = decs(sx * xScale);
        for (let v = Math.ceil(xr[0] / sx) * sx; v <= xr[1] + 1e-12; v += sx) { const x = X(v); g.beginPath(); g.moveTo(x, py0); g.lineTo(x, py1); g.stroke(); g.fillText((v * xScale).toFixed(dx), x - 10, py1 + 12); }
        g.fillStyle = '#ccc'; { const t = T(xl); g.fillText(t, px1 - g.measureText(t).width, H - 4); } g.fillText('cl', x0 + 4, pad.t - 3);
        if (vw) { g.fillStyle = 'rgba(255,200,120,.8)'; g.fillText(T('Zoom'), px1 - 30, py0 + 10); }
        g.save(); g.beginPath(); g.rect(px0, py0, px1 - px0, py1 - py0); g.clip();
        for (const c of C.slice(1).concat(C.slice(0, 1))) {   // Referenz (.dat) zuletzt, dünn obenauf
          const pts = c.pol.pts.slice().sort((a, b) => a.alpha - b.alpha);
          g.strokeStyle = c.color; g.lineWidth = c.ref ? 1.1 : 2.2; g.setLineDash(c.dash ? [5, 4] : []);
          g.beginPath(); pts.forEach((p, i) => { const x = X(fx(p)), y = Y(p.cl); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
          if (vw) { g.fillStyle = c.color; for (const p of pts) { const x = X(fx(p)), y = Y(p.cl); g.fillRect(x - 1.5, y - 1.5, 3, 3); } }   // gezoomt: Rechenpunkte zeigen
        }
        g.restore();
      };
      plot(0, 0, p => p.alpha, [a0, a1], 'α [°]', 1);
      plot(1, w2 + gap, p => p.cd, [0, d1], 'cd [Counts]', 1e4);
      // Tabelle
      const R = C[0], rp = R.pol;
      const val = pol => ({ cl0: at(pol.pts, p => p.alpha, p => p.cl, 0), cd3: cdAtCl(pol, 0.3), cd6: cdAtCl(pol, 0.6), cd9: cdAtCl(pol, 0.9), clmax: pol.clmax, amax: pol.alphaMax,
        ld: Math.max(...pol.pts.map(p => p.cd > 0 ? p.cl / p.cd : -Infinity)) });
      const V = C.map(c => val(c.pol)), V0 = V[0];
      const f = (v, d) => isFinite(v) ? v.toFixed(d) : '–';
      const cnt = v => isFinite(v) ? (v * 1e4).toFixed(1) : '–';
      const dl = (v, r, d, mul) => (isFinite(v) && isFinite(r)) ? ' <span style="opacity:.75">(' + ((v - r) * (mul || 1) >= 0 ? '+' : '') + ((v - r) * (mul || 1)).toFixed(d) + ')</span>' : '';
      let h = '<table style="border-collapse:collapse;width:100%"><tr><th style="text-align:left">' + T('Größe') + '</th>' + C.map(c => '<th style="text-align:right;color:' + c.color + '">' + c.name + '</th>').join('') + '</tr>';
      const row = (lbl, k, d, fmt, mul) => { h += '<tr><td>' + T(lbl) + '</td>' + V.map((v, i) => '<td style="text-align:right">' + (fmt ? fmt(v[k]) : f(v[k], d)) + (i ? dl(v[k], V0[k], d, mul) : '') + '</td>').join('') + '</tr>'; };
      row('cl bei α = 0°', 'cl0', 3);
      row('cd bei cl 0,3 [Counts]', 'cd3', 1, cnt, 1e4);
      row('cd bei cl 0,6 [Counts]', 'cd6', 1, cnt, 1e4);
      row('cd bei cl 0,9 [Counts]', 'cd9', 1, cnt, 1e4);
      row('cl max', 'clmax', 3);
      row('α bei cl max [°]', 'amax', 1);
      row('cl/cd max', 'ld', 1);
      h += '</table><div style="margin-top:6px">' + (cfg.calc === 'xfoil'
        ? T('XFOIL: rechnet mit den Punkten selbst und reagiert auf feine Formunterschiede (auch Welligkeit). Fehlende Punkte = dort nicht konvergiert.')
        : T('NeuralFoil: schnell und stabil, rechnet intern über eine geglättete CST-Form (8+8 Parameter). Unterschiede im Hundertstel-Millimeter-Bereich und Welligkeit sieht es kaum — kleine Abweichungen hier heißen: die Glättung ändert aerodynamisch praktisch nichts.'))
        + ' ' + T('In Klammern: Unterschied zur ersten Spalte (Original-.dat).')
        + '<br>' + T('Diagramme: Mausrad = Zoom am Cursor (Shift = nur waagrecht, Alt = nur cl), Ziehen = Verschieben, Doppelklick = zurück.') + '</div>';
      tab.innerHTML = h;
    }

    // Bedienung (bei jedem Neuaufbau der Seitenleiste neu)
    function controls(s, noHead) {
    if (!noHead) { const head = document.createElement('div'); head.className = 'hint'; head.style.cssText = 'font-weight:600;margin-top:6px'; head.textContent = T('Polaren'); s.appendChild(head); }
    const row = (label, input) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = T(label); r.appendChild(l); r.appendChild(input); s.appendChild(r); return input; };
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = cfg.on;
    row('Polaren anzeigen', chk).onchange = () => { cfg.on = chk.checked; saveCfg(cfg); res = null; show(); if (o.onChange) o.onChange(); if (cfg.on) (cfg.calc === 'xfoil' ? draw() : compute()); };
    const sel = document.createElement('select');
    [['nf', 'NeuralFoil (schnell)'], ['xfoil', XF() ? 'XFOIL (echtes xfoil.exe)' : 'XFOIL (nicht verfügbar)']].forEach(([v, t]) => { const op = document.createElement('option'); op.value = v; op.textContent = T(t); sel.appendChild(op); });
    sel.value = cfg.calc; row('Rechenverfahren', sel).onchange = () => { cfg.calc = sel.value; saveCfg(cfg); res = null; cfg.calc === 'xfoil' ? draw() : compute(); };
    { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!cfg.cmp;
      row('Vergleich NeuralFoil ↔ XFOIL', cb).onchange = () => { cfg.cmp = cb.checked; saveCfg(cfg); res = null; cfg.calc === 'xfoil' || cfg.cmp ? draw() : compute(); };
      cb.title = T('Jede Kurve zusätzlich mit der anderen Methode rechnen — gestrichelt in derselben Farbe, eigene Spalte in der Tabelle'); }
    const num = (label, k, step, min) => { const i = document.createElement('input'); i.type = 'number'; i.step = step; i.min = min; i.value = cfg[k];
      row(label, i).onchange = () => { const v = +i.value; if (isFinite(v)) { cfg[k] = v; saveCfg(cfg); res = null; cfg.calc === 'xfoil' ? draw() : compute(); } }; };
    { const i = document.createElement('input'); i.type = 'text'; i.value = fmtRe(cfg.re); i.title = T('k = Tausend, M = Million (z. B. 150k)');
      row('Reynoldszahl', i).onchange = () => { const v = parseRe(i.value); if (v >= 1e4) { cfg.re = v; saveCfg(cfg); res = null; cfg.calc === 'xfoil' ? draw() : compute(); } i.value = fmtRe(cfg.re); }; }
    num('Ncrit', 'ncrit', 1, 1);
    num('α von (°)', 'a0', 1, -20);
    num('α bis (°)', 'a1', 1, -10);
    const b = document.createElement('button'); b.textContent = T('Polaren rechnen'); b.onclick = () => { cfg.on = true; chk.checked = true; saveCfg(cfg); show(); run(); };
    s.appendChild(b);
    }
    show();

    return {
      controls,
      // nach Rippen-/Parameterwechsel: NeuralFoil sofort neu, XFOIL erst auf Knopfdruck
      refresh() { if (!cfg.on) return; if (cfg.calc === 'xfoil' || cfg.cmp) { res = null; draw(); } else compute(); },
      redraw: draw,
      shown: () => cfg.on
    };
  }

  Object.assign(App, { profPolarAttach: attach });
})();
