/* pc2wing.js — Tragflächendesign: glatte (elliptische) Fläche aus Planform Creator (.pc2).
 *
 * Für den Heißdraht wird die Fläche beim Import in Trapeze zerlegt; die Originalform liegt je
 * Tragfläche in cfg.formPlanSrc = { raw, st, name } (st = Trapezgrenzen als Spannweitenanteil,
 * siehe filesys.js pc2DoImport). Dieses Modul
 *   - zeigt im Seitenmenü „Elliptische Fläche (Planform Creator)" die Kennwerte, die Profilschnitte
 *     (Lage exakt wie in PC2, Strak-Mischprofile) und die Scharnierlinie,
 *   - übernimmt die PC2-Scharnierlinie in die Segmente und richtet die Scharniere auf Wunsch der
 *     Höhe nach aus (Profilhöhenausrichtung mit Bezug Scharnierlinie, Gruppen an den Knicken),
 *   - zeichnet die glatte Kontur, die PC2-Scharnierlinie und die Profilschnitte in den Grundriss
 *     (render.js ruft App.pc2PlanOverlay geschützt auf).
 * Rechnung der Kurve über der Trapezkette: PC2.overlay (pc2.js). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;

  let cache = { raw: null, m: null };
  function model() {
    const src = state.cfg.formPlanSrc;
    if (!src || !src.raw || !Array.isArray(src.st) || src.st.length < 2 || !window.PC2) return null;
    if (cache.raw !== src.raw) {
      let m = null; try { m = PC2.parse(src.raw); } catch (e) { m = null; }
      cache = { raw: src.raw, m };
    }
    return cache.m ? { m: cache.m, st: src.st, name: src.name || cache.m.name } : null;
  }
  // Passt die Segmentkette noch zu den gespeicherten Trapezgrenzen?
  function info() {
    const pi = model(); if (!pi) return null;
    const n = (state.segments || []).length;
    if (n !== pi.st.length - 1) return Object.assign({}, pi, { err: T('Segmentzahl geändert (') + n + ' ' + T('statt') + ' ' + (pi.st.length - 1) + T(') — die glatte Fläche kann nicht mehr zugeordnet werden.') });
    return pi;
  }
  // Grenzen der Trapezkette im Grundriss (z, Nase, Sehne) aus den berechneten Stationen.
  function boundsFromWing() {
    const st = App.wing && App.wing.stations; if (!st) return null;
    return st.map(s => { let mn = Infinity, mx = -Infinity; s.pts.forEach(p => { if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x; }); return { z: s.z, le: mn, c: mx - mn }; });
  }
  function overlayNow(pi) {
    const b = boundsFromWing(); if (!b || b.length !== pi.st.length) return null;
    return PC2.overlay(pi.m, pi.st, b);
  }
  // Profilschnitte in PC2-Reihenfolge mit Profil bzw. Strak.
  function sectionList(m) {
    return m.sections.map(s => ({ xn: s.xn, spec: m.airfoilSpec(s.xn), own: !!s.airfoil }));
  }
  function specText(sp) {
    if (!sp) return '—';
    if (sp.b) return 'Strak ' + PC2.strakName(sp);
    return sp.name || T('(kein Profil)');
  }

  // ---------- Grundriss-Overlay (render.js drawPlan) ----------------------
  // g = { ctx, V, poly }; Rückgabe: Legendeneinträge [Farbe, Text, Strich, Art, Breite].
  const COL = '#c792ea';
  function planOverlay(g) {
    if (state.cfg.pc2Show === false) return null;
    const pi = info(); if (!pi || pi.err) return null;
    const ov = overlayNow(pi); if (!ov) return null;
    const { ctx, V, poly } = g, m = pi.m, leg = [];
    // Abtastung: Kosinus zur Spitze hin verdichtet (Ellipse wird dort steil), plus Trapezgrenzen.
    const xs = []; const N = 240;
    for (let i = 0; i <= N; i++) xs.push(1 - Math.cos(i / N * Math.PI / 2));
    for (let i = 1; i <= 30; i++) xs.push(1 - Math.pow(1 - i / 31, 3) * 0.02);
    pi.st.forEach(v => xs.push(+v));
    xs.sort((a, b) => a - b);
    const S = xs.map(xn => { const z = ov.zOfXn(xn); return Object.assign({ z }, ov.at(z)); });
    ctx.save();
    // Kontur (Nase, Endleiste, Abschluss an der Spitze)
    ctx.strokeStyle = COL; ctx.lineWidth = 1.8; ctx.setLineDash([]);
    const out = S.map(p => ({ x: p.z, y: -p.le })).concat(S.slice().reverse().map(p => ({ x: p.z, y: -(p.le + p.c) })));
    poly(ctx, V, out, true); ctx.stroke();
    leg.push([COL, T('Glatte Fläche (Planform Creator)'), [], 'line', 1.8]);
    // Scharnierlinie nach PC2 (nur wo es Klappen gibt)
    const HC = (App.PAL && App.PAL.hinge) || '#ff9e64';
    ctx.strokeStyle = HC; ctx.lineWidth = 1.4; ctx.setLineDash([2, 3]);
    let run = [];
    const flush = () => { if (run.length > 1) { poly(ctx, V, run, false); ctx.stroke(); } run = []; };
    S.forEach(p => { if (m.flapGroupAt(Math.min(p.xn, 1 - 1e-9)) === 0) { flush(); return; } run.push({ x: p.z, y: -p.hinge }); });
    flush();
    leg.push([HC, T('Scharnierlinie (Planform Creator)'), [2, 3], 'line', 1.4]);
    // Profilschnitte
    if (state.cfg.pc2ShowSec !== false) {
      ctx.setLineDash([]); ctx.font = '10px Segoe UI';
      sectionList(m).forEach(sc => {
        const z = ov.zOfXn(sc.xn), a = ov.at(z);
        ctx.strokeStyle = sc.own ? '#57d38c' : '#57d38c88'; ctx.lineWidth = 1.2;
        poly(ctx, V, [{ x: z, y: -a.le }, { x: z, y: -(a.le + a.c) }], false); ctx.stroke();
        const X = V.X(z), Y = V.Y(-(a.le + a.c)) + 12;
        ctx.save(); ctx.translate(X + 3, Y); ctx.rotate(Math.PI / 2);
        ctx.fillStyle = '#57d38c'; ctx.fillText(sc.spec.b ? 'Strak ' + Math.round(sc.spec.t * 100) + '%' : (sc.spec.name || ''), 0, 0);
        ctx.restore();
      });
      leg.push(['#57d38c', T('Profilschnitte (Planform Creator)'), [], 'line', 1.2]);
    }
    ctx.restore();
    return leg;
  }

  // ---------- Scharniere ----------------------------------------------------
  function applyHinge(pi) {
    if (!PC2.hingeToSegments(pi.m, pi.st, state.segments)) return false;
    state.cfg.showHingePlan = true;
    return true;
  }
  // Höhenausrichtung: Profilhöhenausrichtung mit Bezug Scharnierlinie; neue V-Gruppe an jedem Knick
  // der PC2-Scharnierlinie (dort beginnt eine neue gerade Scharnierstrecke).
  function hingeHeightOn() { const a = state.cfg.align; return !!(a && a.enable && a.ref === 'hinge'); }
  function setHingeHeight(on, pi) {
    const a = state.cfg.align = state.cfg.align || { enable: false, ref: 'hinge', dih: 0, dihMode: 'mm' };
    if (!on) { a.enable = false; return; }
    a.enable = true; a.ref = 'hinge';
    // Randbogenprofil (Spitze, oft nur wenige mm Tiefe) folgt dem Verlauf, nicht dem Scharnierpunkt.
    const last = state.segments[state.segments.length - 1];
    if (last && state.segments.length > 1) last.alignTrendTip = true;
    const kinks = pi.m.hingeKinks || [];
    state.segments.forEach((sg, k) => {
      if (k === 0) return;
      sg.alignGroupStart = kinks.some(x => Math.abs(x - pi.st[k]) < 1e-6);
    });
  }

  // ---------- Seitenmenü -----------------------------------------------------
  function wingSidebar(side) {
    const pi = info(); if (!pi) return;
    const { grp, hint, subhead, boolRow, selectRow, buildSidebar, render } = App;
    const rr = () => { App.recompute(); render(); };
    const rb = () => { buildSidebar(); App.recompute(); render(); };
    const g = grp('Elliptische Fläche (Planform Creator)', true, 'wing');
    const m = pi.m;
    const inf = document.createElement('div'); inf.className = 'hint';
    inf.innerHTML = '<b>' + pi.name + '</b><br>' + T('Halbspannweite') + ': ' + m.halfspan.toFixed(0) + ' mm · '
      + T('Wurzelsehne') + ': ' + m.chordRoot.toFixed(0) + ' mm · ' + T('Spitze') + ': ' + m.chordTip.toFixed(1) + ' mm<br>'
      + (pi.st.length - 1) + ' ' + T('Trapeze für den Heißdraht') + ' · ' + T('max. Sehnenabweichung') + ' ' + PC2.chordError(m, pi.st).max.toFixed(1) + ' mm';
    g.body.appendChild(inf);
    hint(g.body, 'Für den Heißdraht ist die Fläche in Trapeze zerlegt (Segmente unten). Die glatte Form bleibt gespeichert: sie wird hier angezeigt und im Formenbau für Urmodell und Formen verwendet.');
    if (pi.err) { const w = hint(g.body, pi.err); w.style.color = 'var(--warn,#e6b450)'; g.g && side.appendChild(g.g); return; }

    boolRow(g.body, 'Glatte Fläche im Grundriss anzeigen', () => state.cfg.pc2Show !== false, v => { state.cfg.pc2Show = v; buildSidebar(); render(); },
      'Zeichnet Nasen- und Endleiste der Originalform sowie die Scharnierlinie aus dem Planform Creator über die Trapeze.');
    if (state.cfg.pc2Show !== false)
      boolRow(g.body, 'Profilschnitte anzeigen', () => state.cfg.pc2ShowSec !== false, v => { state.cfg.pc2ShowSec = v; render(); });

    // Profilschnitte: Lage wie in PC2 (Sektionen mit cn werden über die Tiefe eingeordnet), Strak.
    subhead(g.body, 'Profilschnitte');
    const ov = overlayNow(pi);
    const tb = document.createElement('div');
    tb.style.cssText = 'display:grid;grid-template-columns:auto auto 1fr;gap:2px 8px;font-size:12px;align-items:baseline';
    const cell = (t, st) => { const d = document.createElement('div'); d.textContent = t; if (st) d.style.cssText = st; tb.appendChild(d); };
    cell(T('Lage'), 'color:var(--muted)'); cell(T('Sehne'), 'color:var(--muted)'); cell(T('Profil'), 'color:var(--muted)');
    sectionList(m).forEach(sc => {
      const z = ov ? ov.zOfXn(sc.xn) : sc.xn * m.halfspan;
      const onSt = pi.st.some(v => Math.abs(v - sc.xn) < 1e-6);
      cell(z.toFixed(1) + ' mm', onSt ? '' : 'color:var(--warn,#e6b450)');
      cell(m.chord(sc.xn).toFixed(1) + ' mm');
      const nm = specText(sc.spec); cell(nm, 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' + (sc.spec.b ? ';font-style:italic' : ''));
    });
    g.body.appendChild(tb);
    const offSt = sectionList(m).filter(sc => !pi.st.some(v => Math.abs(v - sc.xn) < 1e-6));
    hint(g.body, offSt.length
      ? T('Gelb: Profilschnitt liegt zwischen zwei Trapezgrenzen — dort wird im Heißdrahtschnitt nur linear gemittelt. Für exakte Profillagen neu importieren mit „Profilschnitte immer als Trapezgrenze".')
      : T('Jeder Profilschnitt ist eine Trapezgrenze: die Profile sitzen exakt wie im Planform Creator. Strak = Mischprofil der Nachbarn nach Tiefenverhältnis (wie PC2), wird berechnet, sobald beide .dat geladen sind.'));

    // Scharnierlinie
    subhead(g.body, 'Scharnierlinie');
    const hDesc = m.hingeTied ? T('Scharnierlinie = Bezugslinie (gerade).')
      : T('Gerade Scharnierstrecken zwischen den Sektionen mit Scharnierangabe (wie im Planform Creator)') + (m.hingeKinks.length ? ' — ' + m.hingeKinks.length + ' ' + T('Knick(e)') : '') + '.';
    hint(g.body, hDesc + ' ' + T('Bei elliptischer Fläche ändert sich dadurch der Anteil an der Sehne entlang der Spannweite.'));
    const bh = document.createElement('button'); bh.textContent = T('Scharnierlinie aus Planform Creator übernehmen');
    bh.onclick = () => { if (applyHinge(pi)) { if (hingeHeightOn()) setHingeHeight(true, pi); rb(); } };
    g.body.appendChild(bh);
    hint(g.body, 'Setzt je Segment die Scharnierlage (% von hinten, innen und außen) und die Klappengruppen wieder genau auf die Linie aus dem Planform Creator (beim Import bereits geschehen).');
    selectRow(g.body, 'Scharnier auf der', [['top', 'Oberseite'], ['bottom', 'Unterseite']],
      () => (state.segments[0] && state.segments[0].hingeSide) || 'top',
      v => { state.segments.forEach(sg => { sg.hingeSide = v; }); rb(); });
    boolRow(g.body, 'Scharniere der Höhe nach ausrichten', hingeHeightOn, v => { setHingeHeight(v, pi); rb(); },
      'Richtet die Profile in der Höhe so aus, dass die Scharnierpunkte je gerader Scharnierstrecke auf einer Geraden liegen (Profilhöhenausrichtung mit Bezug „Scharnierlinie", neue Gruppe an jedem Knick der Scharnierlinie). Mit der geraden Scharnierlinie im Grundriss ist das Scharnier dann auch räumlich gerade — die Klappe lässt sich durchgehend anschlagen. V-Form und Gruppen im Block „Profilhöhenausrichtung" einstellen.');
    if (hingeHeightOn()) {
      const last = state.segments[state.segments.length - 1];
      if (last && state.segments.length > 1)
        boolRow(g.body, 'Randbogenprofil im Verlauf ausrichten', () => !!last.alignTrendTip, v => { last.alignTrendTip = v; rb(); },
          'Das Profil an der Spitze wird nicht mit seinem Scharnierpunkt auf die Scharnierlinie gesetzt, sondern seine Sehne setzt die Neigung des letzten Trapezes fort — kein Sprung im dünnen Randbogen.');
      hint(g.body, 'Aktiv: die V-Form der einzelnen Segmente ist abgeschaltet und folgt der Profilhöhenausrichtung.');
    }
    side.appendChild(g.g);
  }

  Object.assign(App, { pc2WingSidebar: wingSidebar, pc2PlanOverlay: planOverlay, pc2WingInfo: info });
})();
