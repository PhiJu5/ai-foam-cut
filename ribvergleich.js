/* ribvergleich.js — „Profilvergleich" der Heißdraht-Schnittrippen (Tragflächendesign).
 *
 * Zeigt je Rippe (Segment innen/außen) die Punkte der Original-.dat gegen die Schnittkontur,
 * die Wing.build daraus erzeugt (Methode cfg.ribFit: Spline neu abtasten / B-Spline mit
 * Toleranz / exakt durch die Punkte), dazu die Abweichung entlang des Profils. Die
 * Abweichung wird gegen die Polylinie gemessen, die der Draht wirklich fährt (inkl.
 * Sehnenfehler der Abtastung). Optional eine zweite Methode als graue Vergleichskurve.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const state = () => App.state;
  let R = null;   // { el, cvs, cvsDev, nav, drag, show, rib, refMode }

  const MODES = [['cr', 'Spline neu abtasten (bisher)'], ['bspline', 'B-Spline geglättet (Toleranz)'], ['interp', 'exakt durch die Punkte (Interpolation)']];
  const modeOf = () => { const m = state().cfg.ribFit; return m === 'bspline' || m === 'interp' ? m : 'cr'; };

  // Alle Rippen der Schnitt-Paneele: { name, rib, cut }
  function ribList() {
    const w = App.wing; if (!w || !w.cuts) return [];
    const out = [];
    w.cuts.forEach((c, k) => {
      out.push({ name: T('Segment ') + (k + 1) + ' ' + T('innen'), rib: c.root, N: c.N });
      out.push({ name: T('Segment ') + (k + 1) + ' ' + T('außen'), rib: c.tip, N: c.N });
    });
    return out;
  }
  // Normiertes Profil mit der Platzierung pl der Rippe in mm (wie die Schnittrippe, ohne Kopfüber).
  function placeLike(norm, pl) {
    const pts = Wing.place(norm, { chord: pl.chord, washoutDeg: pl.twist, twistRefX: pl.twistRef, leOffset: pl.leOffset, z: 0 }).pts;
    return pts.map(p => ({ x: p.x, y: p.y + (pl.shift || 0) }));
  }
  function ribData() {
    const L = ribList(); if (!L.length) return null;
    const k = Math.min(Math.max(0, R.rib | 0), L.length - 1), e = L[k], r = e.rib, pl = r.pl;
    if (!r.src || !pl) return null;
    const fy = pl.flip ? -1 : 1;
    const cut = r.pts.map(p => ({ x: p.x, y: p.y * fy }));
    const src = placeLike(r.src, pl);
    let ref = null;
    if (R.refMode && R.refMode !== modeOf()) {
      const rf = Object.assign({}, App.ribFitCfg ? App.ribFitCfg() : {}, { mode: R.refMode });
      const norm = rf.mode === 'cr' ? Airfoil.resample(r.src, e.N) : ProfilFit.ribSample(r.src, e.N, pl.chord, rf);
      ref = placeLike(norm, pl);
    }
    return { k, name: e.name, cut, src, ref, chord: pl.chord, N: cut.length, fit: null };
  }
  // Kurven für die Polaren: Original-.dat (Referenz), Schnittkontur, ggf. Vergleich
  function polarCurves() {
    const d = ribData(); if (!d) return [];
    const out = [{ key: 'src', name: T('.dat'), color: '#ff7b7b', pts: d.src, ref: true }, { key: 'cut', name: T('Schnittkontur'), color: '#4fc3f7', pts: d.cut }];
    if (d.ref) out.push({ key: 'ref', name: T('Vergleich'), color: 'rgba(200,200,200,.9)', pts: d.ref, dash: true });
    return out;
  }
  const ppRefresh = () => { if (R && R.pp) R.pp.refresh(); };
  // signierte Abweichung je .dat-Punkt zur Polylinie (positiv = Kontur liegt außerhalb der .dat)
  function devs(src, poly) { return src.map(p => { const d = ProfilFit.distToPolyline(p, poly); return d.d * d.s; }); }

  function dom() {
    if (R) return R;
    const bd = document.createElement('div'); bd.className = 'modal-backdrop'; bd.id = 'ribCmpModal';
    bd.innerHTML =
      '<div class="modal" style="width:min(1300px,96vw);max-width:96vw;height:min(880px,94vh);max-height:94vh;display:flex;flex-direction:column">'
      + '<div class="head"><h2>' + T('Profilvergleich — Schnittrippe gegen Original-.dat') + '</h2>'
      + '<button class="close-x" id="ribCmpClose" style="margin-left:auto" title="' + T('Schließen') + '">×</button></div>'
      + '<div class="body" style="flex:1 1 auto;display:flex;gap:14px;min-height:0;overflow:hidden;padding-top:10px">'
      +   '<div id="ribCmpLeft" style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:6px">'
      +     '<div id="ribCmpTop" class="hint" style="flex:0 0 auto"></div>'
      +     '<div style="position:relative;flex:3 1 0;min-height:0;background:var(--panel2,#0e1520);border-radius:8px"><canvas id="cRibCmp" style="width:100%;height:100%;display:block;cursor:grab"></canvas></div>'
      +     '<div class="hint" style="flex:0 0 auto">' + T('Abweichung .dat-Punkt → Schnittkontur (Polylinie, die der Draht fährt; positiv = Kontur liegt außerhalb), von der Endleiste oben über die Nase zur Endleiste unten') + '</div>'
      +     '<div style="position:relative;flex:1 1 0;min-height:90px;background:var(--panel2,#0e1520);border-radius:8px"><canvas id="cRibCmpDev" style="width:100%;height:100%;display:block"></canvas></div>'
      +     '<div class="hint" style="flex:0 0 auto">' + T('Mausrad = Zoom (am Cursor) · Ziehen = Verschieben · Doppelklick = zurücksetzen · Tasten N / E = Nase / Endleiste vergrößern') + '</div>'
      +   '</div>'
      +   '<div id="ribCmpSide" style="flex:0 0 300px;overflow:auto;display:flex;flex-direction:column;gap:4px"></div>'
      + '</div></div>';
    document.body.appendChild(bd);
    R = { el: bd, cvs: bd.querySelector('#cRibCmp'), cvsDev: bd.querySelector('#cRibCmpDev'), nav: { zoom: 1, px: 0, py: 0 }, drag: null,
      show: { src: true, srcLine: false, cut: true, cutPts: false, ref: true }, rib: 0, refMode: 'cr', pp: null };
    // Polaren (nur mit Funktion „Aerodynamik", fehlt in der freien Fassung)
    if (App.profPolarAttach) R.pp = App.profPolarAttach({ host: bd.querySelector('#ribCmpLeft'), onChange: () => draw(), curves: polarCurves });
    bd.querySelector('#ribCmpClose').onclick = close;
    bd.addEventListener('mousedown', e => { if (e.target === bd) close(); });
    const c = R.cvs;
    c.addEventListener('mousedown', e => { R.drag = { x: e.clientX, y: e.clientY }; c.style.cursor = 'grabbing'; e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (!R.drag) return; R.nav.px += e.clientX - R.drag.x; R.nav.py += e.clientY - R.drag.y; R.drag = { x: e.clientX, y: e.clientY }; draw(); });
    window.addEventListener('mouseup', () => { if (R.drag) { R.drag = null; c.style.cursor = 'grab'; } });
    c.addEventListener('wheel', e => {
      e.preventDefault(); const r = c.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      const f = e.deltaY < 0 ? 1.25 : 0.8, nz = Math.min(4000, Math.max(0.2, R.nav.zoom * f)), k = nz / R.nav.zoom;
      R.nav.px = mx - (mx - R.nav.px) * k; R.nav.py = my - (my - R.nav.py) * k; R.nav.zoom = nz; draw();
    }, { passive: false });
    c.addEventListener('dblclick', () => { R.nav = { zoom: 1, px: 0, py: 0 }; draw(); });
    window.addEventListener('keydown', e => {
      if (!R.el.classList.contains('open') || /INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === 'n' || e.key === 'N') focus(0.0); else if (e.key === 'e' || e.key === 'E') focus(1.0);
      else if (e.key === 'Escape') close();
    });
    window.addEventListener('resize', () => { if (R.el.classList.contains('open')) { draw(); if (R.pp) R.pp.redraw(); } });
    return R;
  }
  // Ansicht auf Nase (s = 0) bzw. Endleiste (s = 1) vergrößern.
  function focus(s) {
    const d = ribData(); if (!d) return;
    const view = viewOf(d), iLE = ProfilFit.noseIndex(d.src), P = d.src;
    const q = s === 0 ? P[iLE] : { x: (P[0].x + P[P.length - 1].x) / 2, y: (P[0].y + P[P.length - 1].y) / 2 };
    const z = 25; R.nav.zoom = z;
    R.nav.px = -(q.x - view.cx) * view.sc0 * z; R.nav.py = (q.y - view.cy) * view.sc0 * z; draw();
  }
  function canvas(c) {
    const dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
    c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, Wc: r.width, Hc: r.height };
  }
  function viewOf(d) {
    const r = R.cvs.getBoundingClientRect();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of d.src) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const sc0 = Math.min((r.width - 60) / ((x1 - x0) || 1), (r.height - 60) / ((y1 - y0) || 1));
    return { sc0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  function draw() {
    if (!R || !R.el.classList.contains('open')) return;
    const { g, Wc, Hc } = canvas(R.cvs);
    g.fillStyle = '#0e1520'; g.fillRect(0, 0, Wc, Hc);
    const top = R.el.querySelector('#ribCmpTop');
    const d = ribData();
    if (!d) { top.textContent = T('Keine Rippe mit Originalprofil vorhanden.'); drawDev(null); return; }
    const v = viewOf(d), sc = v.sc0 * R.nav.zoom;
    const P = p => ({ x: Wc / 2 + R.nav.px + (p.x - v.cx) * sc, y: Hc / 2 + R.nav.py - (p.y - v.cy) * sc });
    const line = (pts, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke(); };
    const dots = (pts, col, r) => { g.fillStyle = col; for (const p of pts) { const q = P(p); g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.fill(); } };
    const sh = R.show, rr = Math.min(3.5, 1.5 + R.nav.zoom * 0.15);
    if (sh.ref && d.ref) line(d.ref, 'rgba(200,200,200,.8)', 1.4);
    if (sh.srcLine) line(d.src, 'rgba(255,123,123,.55)', 1);
    if (sh.cut) line(d.cut, '#4fc3f7', 1.8);
    if (sh.cutPts) dots(d.cut, '#4fc3f7', Math.max(1.2, rr - 0.6));
    if (sh.src) dots(d.src, '#ff7b7b', rr);
    // Legende
    const leg = [];
    if (sh.src || sh.srcLine) leg.push(['#ff7b7b', T('.dat-Punkte') + ' (' + d.src.length + ')']);
    if (sh.cut) leg.push(['#4fc3f7', T('Schnittkontur') + ' (' + T(MODES.find(m => m[0] === modeOf())[1]) + ', ' + d.N + ' ' + T('Punkte') + ')']);
    if (sh.ref && d.ref) leg.push(['rgba(200,200,200,.9)', T('Vergleich') + ' (' + T(MODES.find(m => m[0] === R.refMode)[1]) + ')']);
    let ly = 16; g.font = '12px system-ui';
    for (const l of leg) { g.fillStyle = l[0]; g.fillRect(12, ly - 8, 14, 4); g.fillStyle = '#ddd'; g.fillText(l[1], 32, ly); ly += 17; }
    // Kennzahlen
    const D = devs(d.src, d.cut); let mx = 0, im = 0; D.forEach((x, i) => { if (Math.abs(x) > mx) { mx = Math.abs(x); im = i; } });
    const xs = d.src.map(p => p.x), xmin = Math.min(...xs), xmax = Math.max(...xs), xc = (d.src[im].x - xmin) / ((xmax - xmin) || 1);
    let txt = '<b>' + d.name + '</b> · ' + T('Sehne') + ' ' + d.chord.toFixed(1) + ' mm · ' + d.src.length + ' ' + T('.dat-Punkte') + ' → ' + d.N + ' ' + T('Punkte')
      + ' · <b>' + T('max. Abweichung') + ' ' + mx.toFixed(3) + ' mm</b> (' + T('bei') + ' ' + (xc * 100).toFixed(1) + ' % ' + T('Sehne') + ')';
    if (d.ref) { const Dr = devs(d.src, d.ref); let m2 = 0; for (const x of Dr) m2 = Math.max(m2, Math.abs(x)); txt += ' · ' + T('Vergleich') + ' ' + m2.toFixed(3) + ' mm'; }
    if (modeOf() === 'bspline') { const rf = App.ribFitCfg ? App.ribFitCfg() : null; if (rf && rf.tol > 0) txt += '<br>' + T('Toleranz der Kurve') + ' ' + rf.tol + ' mm · ' + T('die Polylinie kommt zusätzlich mit dem Sehnenfehler der Abtastung dazu (mehr Punkte = kleiner)'); }
    top.innerHTML = txt;
    drawDev(d, D);
  }
  function drawDev(d, D) {
    const { g, Wc, Hc } = canvas(R.cvsDev);
    g.fillStyle = '#0e1520'; g.fillRect(0, 0, Wc, Hc);
    if (!d) return;
    const Dr = d.ref && R.show.ref ? devs(d.src, d.ref) : null;
    let mx = 0; for (const x of D) mx = Math.max(mx, Math.abs(x)); if (Dr) for (const x of Dr) mx = Math.max(mx, Math.abs(x));
    mx = Math.max(mx, 0.005);
    const L = 44, Rm = 10, Tp = 10, B = 18, w = Wc - L - Rm, h = Hc - Tp - B, y0 = Tp + h / 2;
    const u = ProfilFit.chordParam(d.src), iLE = ProfilFit.noseIndex(d.src);
    const px = i => L + u[i] * w, py = x => y0 - x / mx * (h / 2);
    g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, y0); g.lineTo(L + w, y0); g.stroke();
    g.setLineDash([3, 4]); g.beginPath(); g.moveTo(px(iLE), Tp); g.lineTo(px(iLE), Tp + h); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#aaa'; g.font = '10px system-ui';
    g.fillText('+' + mx.toFixed(3), 2, Tp + 9); g.fillText('0', 4, y0 + 3); g.fillText('-' + mx.toFixed(3), 2, Tp + h);
    g.fillText(T('EL oben'), L, Hc - 5); g.fillText(T('Nase'), px(iLE) - 12, Hc - 5); g.fillText(T('EL unten'), L + w - 44, Hc - 5);
    const plot = (X, col, wd) => { g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); X.forEach((x, i) => { const a = px(i), b = py(x); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke(); };
    if (Dr) plot(Dr, 'rgba(200,200,200,.7)', 1.5);
    plot(D, '#4fc3f7', 1.5);
    g.fillStyle = '#4fc3f7'; for (let i = 0; i < D.length; i++) g.fillRect(px(i) - 1, py(D[i]) - 1, 2, 2);
  }

  function side() {
    const el = R.el.querySelector('#ribCmpSide'); el.innerHTML = '';
    const cfg = state().cfg;
    const rebuild = () => { App.recompute(); side(); draw(); ppRefresh(); };
    const redraw = () => { App.recompute(); draw(); ppRefresh(); };
    const head = t => { const h = document.createElement('div'); h.className = 'hint'; h.style.cssText = 'font-weight:600;margin-top:6px'; h.textContent = T(t); el.appendChild(h); };
    const row = (label, input) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = T(label); r.appendChild(l); r.appendChild(input); el.appendChild(r); return input; };
    const sel = (label, opts, get, set) => { const s = document.createElement('select'); for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = T(t); s.appendChild(o); } s.value = get(); s.onchange = () => set(s.value); return row(label, s); };
    const num = (label, get, set, o) => { const i = document.createElement('input'); i.type = 'number'; i.value = get(); if (o.step) i.step = o.step; if (o.min != null) i.min = o.min; if (o.max != null) i.max = o.max;
      i.onchange = () => { const v = +i.value; if (isFinite(v)) set(o.int ? Math.round(v) : v); }; return row(label, i); };
    const chk = (label, get, set) => { const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!get(); i.onchange = () => set(i.checked); return row(label, i); };

    head('Rippe');
    const L = ribList();
    if (L.length) sel('Rippe', L.map((x, i) => [String(i), x.name]), () => String(Math.min(R.rib, L.length - 1)), v => { R.rib = +v; R.nav = { zoom: 1, px: 0, py: 0 }; draw(); ppRefresh(); });
    head('Schnittkontur');
    sel('Kurve durch die .dat-Punkte', MODES, modeOf, v => { cfg.ribFit = v; if (R.refMode === v) R.refMode = v === 'cr' ? 'bspline' : 'cr'; rebuild(); });
    num('Profil Punkteanzahl', () => cfg.points, v => { cfg.points = Math.max(40, Math.min(400, v)); redraw(); }, { int: true, min: 40, max: 400 });
    if (modeOf() === 'bspline') {
      chk('Nase fest (Nasenpunkt + Tangente)', () => cfg.ribNoseFix === true, v => { cfg.ribNoseFix = v; redraw(); });
      num('Kontrollpunkte je Seite', () => cfg.ribCtrl != null ? cfg.ribCtrl : 18, v => { cfg.ribCtrl = Math.max(4, Math.min(60, v)); redraw(); }, { int: true, min: 4, max: 60 });
      num('Glättung (0 = keine Strafe)', () => cfg.ribLambda != null ? cfg.ribLambda : 1, v => { cfg.ribLambda = Math.max(0, v); redraw(); }, { step: 0.5, min: 0 });
      num('Toleranz zur .dat (mm, 0 = aus)', () => cfg.ribTol != null ? cfg.ribTol : 0.02, v => { cfg.ribTol = Math.max(0, v); redraw(); }, { step: 0.01, min: 0 });
    }
    head('Vergleich');
    sel('Vergleichskurve (grau)', [['', 'keine']].concat(MODES.filter(m => m[0] !== modeOf())), () => R.refMode || '', v => { R.refMode = v || null; draw(); ppRefresh(); });
    head('Anzeige');
    chk('.dat-Punkte (rot)', () => R.show.src, v => { R.show.src = v; draw(); });
    chk('.dat als Linie', () => R.show.srcLine, v => { R.show.srcLine = v; draw(); });
    chk('Schnittkontur (blau)', () => R.show.cut, v => { R.show.cut = v; draw(); });
    chk('Punkte der Schnittkontur', () => R.show.cutPts, v => { R.show.cutPts = v; draw(); });
    chk('Vergleichskurve (grau)', () => R.show.ref, v => { R.show.ref = v; draw(); });
    if (R.pp) R.pp.controls(el);
    const hn = document.createElement('div'); hn.className = 'hint'; hn.style.marginTop = '8px';
    hn.textContent = T('Die Einstellungen gelten für alle Schnittrippen dieser Tragfläche (Kern-, Negativ-, Holmschnitt und G-Code). Schließen übernimmt sie in die Seitenleiste.');
    el.appendChild(hn);
    for (const ch of el.children) ch.style.flexShrink = '0';   // nicht stauchen → Spalte scrollt
  }
  function open() {
    dom(); if (!App.wing && App.recompute) App.recompute();
    R.el.classList.add('open'); side(); draw(); ppRefresh(); requestAnimationFrame(() => { draw(); if (R.pp) R.pp.redraw(); });
  }
  function close() {
    if (!R) return; R.el.classList.remove('open');
    if (App.buildSidebar) App.buildSidebar(); if (App.render) App.render();
  }
  App.ribCompareOpen = open;
})();
