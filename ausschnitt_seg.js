/* ausschnitt_seg.js — Reiter „Ausschnitte": Segment aus „DXF-Formen" oder „3D-Modell" als Bezug
 * (Teil der Funktion „ausschnitt", ausschnitt.js ruft nur geschützt über window.AusSeg).
 *
 *   Segment  : Schnappschuss der synchronisierten Querschnitte A (Anfang, z = 0) und B (Ende, z = Länge)
 *              ohne Abbrand + Block des Quell-Reiters → cfg.waSeg (mit dem Projekt gespeichert, „Neu laden"
 *              holt den aktuellen Stand). Der Körper ist die Regelfläche A_i → B_i, wie ihn der Draht schneidet.
 *   Lage     : 'long' = Draht entlang der Segmentachse (Ansicht = Querschnitt), 'side' = quer, Draht waagrecht
 *              durch die Breite (Seitenansicht), 'top' = quer, Draht senkrecht durch die Höhe (Draufsicht);
 *              flip = Segment umgedreht (Anfang rechts). Daraus Blockbreite/-höhe/-dicke und die Bezugskontur.
 *   3D       : eigene kleine Ansicht (Canvas #cAusschnitt3d): Block als Drahtgitter, Segment halbdurchsichtig,
 *              Ausschnitte als rote Prismen durch die Blockdicke. Welt = Ansicht der Ausschnitte
 *              (X rechts, Y oben, Z = Drahtrichtung). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const r3 = v => Math.round(v * 1000) / 1000;

  // ======================================================================
  //  Quellen
  // ======================================================================
  function dxfCount() {
    try { return state.dxf && App.dxfSegCount && App.dxfSegPaths && state.dxf.layers && Object.keys(state.dxf.layers).length ? App.dxfSegCount() : 0; } catch (e) { return 0; }
  }
  function modelCount() {
    // Jedes geladene Modell: Segmente zwischen den Schnittebenen (ohne Ebenen = ganzes Modell),
    // auch wenn im Reiter „3D-Modell" noch nicht „Zerlegen" gedrückt wurde.
    try { return window.Model3D && Model3D.hasModel && Model3D.hasModel() ? Model3D.segCount() : 0; } catch (e) { return 0; }
  }
  function bbox(L) {
    const b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
    L.forEach(P => P.forEach(p => { b.minx = Math.min(b.minx, p[0]); b.maxx = Math.max(b.maxx, p[0]); b.miny = Math.min(b.miny, p[1]); b.maxy = Math.max(b.maxy, p[1]); }));
    return b;
  }
  // Geschlossenen Zug gleichmäßig auf n Punkte (falls A/B verschieden lang sind).
  function resample(P, n) {
    const s = [0]; for (let i = 1; i <= P.length; i++) { const a = P[i - 1], b = P[i % P.length]; s.push(s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const L = s[s.length - 1] || 1, out = []; let j = 0;
    for (let i = 0; i < n; i++) {
      const t = L * i / n; while (j < P.length - 1 && s[j + 1] < t) j++;
      const a = P[j], b = P[(j + 1) % P.length], u = (t - s[j]) / ((s[j + 1] - s[j]) || 1);
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    return out;
  }
  // → Schnappschuss { src, k, name, A, B, span, z0, blk } oder null; z0 = Lage des Anfangs auf der Achse
  // (Summe der Längen davor), damit mehrere Segmente lagerichtig hintereinander stehen.
  function capture(src, k) {
    let A, B, span, blk, name, z0 = 0;
    if (src === 'dxf') {
      const d = state.dxf, sg = d && d.segs && d.segs[k]; if (!sg) return null;
      // Bezug ohne Abbrand: Schalter nur für diesen Aufruf aus.
      const k0 = d.kerf, k1 = sg.kerf; let P = null;
      d.kerf = false; sg.kerf = false;
      try { P = App.dxfSegPaths(k); } catch (e) { P = null; } finally { d.kerf = k0; sg.kerf = k1; }
      if (!P || !P.root || P.root.length < 3) return null;
      A = P.root.map(p => [p.x, p.y]); B = P.tip.map(p => [p.x, p.y]);
      span = Math.max(1, +sg.span || 100);
      for (let j = 0; j < k; j++) z0 += Math.max(1, +((d.segs[j] || {}).span) || 100);
      const gb = bbox([A, B]);
      blk = App.dxfBlockRect ? App.dxfBlockRect(gb) : gb;
      name = T('DXF-Formen') + ' · ' + T('Segment') + ' ' + (k + 1);
    } else if (src === 'model') {
      let cp = null; try { if (Model3D.ensureSegments()) cp = Model3D.cutPaths(k, { N: 160, kerf: 0 }); } catch (e) { cp = null; }
      if (!cp || !cp.A || cp.A.length < 3) return null;
      A = cp.A.map(p => [p[0], p[1]]); B = cp.B.map(p => [p[0], p[1]]);
      span = Math.max(1, +Model3D.segSpan(k) || 1);
      for (let j = 0; j < k; j++) { try { z0 += Math.max(1, +Model3D.segSpan(j) || 1); } catch (e) { /* Länge fehlt */ } }
      const bm = Math.max(0, +((state.modelGcode || {}).blockMargin) || 0), gb = bbox([A, B]);
      blk = { minx: gb.minx - bm, miny: gb.miny - bm, maxx: gb.maxx + bm, maxy: gb.maxy + bm };
      let sn = ''; try { sn = Model3D.sectionName ? ' (' + Model3D.sectionName(k) + '–' + Model3D.sectionName(k + 1) + ')' : ''; } catch (e) { sn = ''; }
      name = T('3D-Modell') + ' · ' + T('Segment') + ' ' + (k + 1) + sn;
    } else return null;
    const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
    if (A.length > 3 && same(A[0], A[A.length - 1]) && B.length > 3 && same(B[0], B[B.length - 1])) { A.pop(); B.pop(); }
    if (A.length !== B.length) { const n = Math.max(A.length, B.length); A = resample(A, n); B = resample(B, n); }
    if (!(blk.maxx > blk.minx && blk.maxy > blk.miny)) return null;
    return { src, k, name, A: A.map(p => [r3(p[0]), r3(p[1])]), B: B.map(p => [r3(p[0]), r3(p[1])]), span: r3(span), z0: r3(z0),
      blk: { minx: r3(blk.minx), miny: r3(blk.miny), maxx: r3(blk.maxx), maxy: r3(blk.maxy) } };
  }

  // ======================================================================
  //  Lage → Blockmaße, Abbildung, Bezugskontur
  // ======================================================================
  const ORIENT = ['long', 'side', 'top'];
  const okPart = s => s && Array.isArray(s.A) && s.A.length >= 3 && Array.isArray(s.B) && s.B.length === s.A.length && s.blk;
  // Hauptsegment + seg.more (weitere Segmente derselben Quelle) → Teile mit z0 ab dem vordersten Anfang.
  function partsOf(seg) {
    const P = [seg].concat(Array.isArray(seg.more) ? seg.more : []).filter(okPart);
    const zm = Math.min.apply(null, P.map(s => +s.z0 || 0));
    return P.map(s => ({ A: s.A, B: s.B, span: Math.max(1, +s.span || 1), z0: (+s.z0 || 0) - zm, blk: s.blk, k: s.k }));
  }
  function view(seg) {
    if (!okPart(seg)) return null;
    const parts = partsOf(seg);
    const b = { minx: Math.min.apply(null, parts.map(p => p.blk.minx)), miny: Math.min.apply(null, parts.map(p => p.blk.miny)),
      maxx: Math.max.apply(null, parts.map(p => p.blk.maxx)), maxy: Math.max.apply(null, parts.map(p => p.blk.maxy)) };
    const wx = b.maxx - b.minx, hy = b.maxy - b.miny, L = Math.max(1, Math.max.apply(null, parts.map(p => p.z0 + p.span)));
    const o = ORIENT.indexOf(seg.orient) >= 0 ? seg.orient : 'side';
    const W = o === 'long' ? wx : L, H = o === 'top' ? wx : hy, D = o === 'long' ? L : o === 'side' ? wx : hy;
    // Segment (x, y = Querschnitt, z = Achse ab A) → Block-lokal (X rechts, Y oben, Z = Drahtrichtung)
    const map = (x, y, z) => {
      let X, Y, Z;
      if (o === 'long') { X = x - b.minx; Y = y - b.miny; Z = z; }
      else if (o === 'side') { X = z; Y = y - b.miny; Z = x - b.minx; }
      else { X = z; Y = x - b.minx; Z = y - b.miny; }
      if (seg.flip) X = W - X;
      return [X, Y, Z];
    };
    const ref = [];
    parts.forEach(pt => {
      const A = pt.A, B = pt.B, z0 = pt.z0, Ls = pt.span;
      if (o === 'long') {
        ref.push({ k: 'A', pts: A.map(p => map(p[0], p[1], z0)) });
        ref.push({ k: 'B', pts: B.map(p => map(p[0], p[1], z0 + Ls)) });
        return;
      }
      // Umriss der Regelfläche quer zur Achse: je Station oberste/unterste Stelle.
      const up = [], lo = [], n = 40;
      for (let s = 0; s <= n; s++) {
        const t = s / n; let mn = Infinity, mx = -Infinity, X = 0;
        for (let i = 0; i < A.length; i++) {
          const q = map(A[i][0] + (B[i][0] - A[i][0]) * t, A[i][1] + (B[i][1] - A[i][1]) * t, z0 + Ls * t);
          X = q[0]; if (q[1] < mn) mn = q[1]; if (q[1] > mx) mx = q[1];
        }
        up.push([X, mx]); lo.push([X, mn]);
      }
      ref.push({ k: 'sil', pts: up.concat(lo.reverse()) });
    });
    const nm = (seg.name || '') + (parts.length > 1 ? ' + ' + (parts.length - 1) + ' ' + T('weitere') : '');
    return { W, H, D, L, orient: o, flip: !!seg.flip, name: nm, map, ref, parts };
  }

  // ======================================================================
  //  Seitenleiste
  // ======================================================================
  const ORIENT_OPTS = [['side', 'quer, Seitenansicht (Draht waagrecht durch die Breite)'], ['top', 'quer, Draufsicht (Draht senkrecht durch die Höhe)'], ['long', 'längs (Draht entlang der Segmentachse)']];
  // api = { get(), set(seg), selectRow, numRow, hint, changed() }
  function sidebar(body, api) {
    const { selectRow, hint } = api, seg = api.get();
    const opts = [['', '— kein Segment —']];
    const nd = dxfCount(), nm = modelCount();
    for (let k = 0; k < nd; k++) opts.push(['dxf:' + k, T('DXF-Formen') + ' · ' + T('Segment') + ' ' + (k + 1)]);
    for (let k = 0; k < nm; k++) opts.push(['model:' + k, T('3D-Modell') + ' · ' + T('Segment') + ' ' + (k + 1)]);
    const cur = seg ? seg.src + ':' + seg.k : '';
    if (seg && !opts.some(o => o[0] === cur)) opts.push([cur, seg.name + ' ' + T('(gespeichert)')]);
    selectRow(body, 'Segment', opts, () => cur, v => {
      if (!v) { api.set(null); return; }
      const [src, ks] = v.split(':'), s = capture(src, +ks);
      if (!s) { if (App.toast) App.toast(T('Segment ließ sich nicht übernehmen — im Quell-Reiter fehlt die Schnittbahn (Synchronisation).')); api.changed(); return; }
      s.orient = seg ? seg.orient : 'side'; s.flip = seg ? !!seg.flip : false;
      if (seg && seg.src === s.src && Array.isArray(seg.more)) s.more = seg.more.filter(m => m.k !== s.k);
      api.set(s);
    }, 'Ein Segment aus „DXF-Formen" oder „3D-Modell" samt Block als Bezug laden: Blockmaße und -dicke kommen dann vom Segment, die Ansicht zeigt seinen Umriss (grün), die 3D-Vorschau den Ausschnitt im Segment. Gespeichert wird eine Kopie — „Neu laden" holt den aktuellen Stand.');
    if (!nd && !nm) hint(body, 'Noch keine Segmente: in „DXF-Formen" Querschnitte synchronisieren bzw. im Reiter „3D-Modell" ein Modell laden (Segmente = Abschnitte zwischen den Schnittebenen).');
    if (!seg) return;
    selectRow(body, 'Lage des Segments', ORIENT_OPTS, () => (ORIENT.indexOf(seg.orient) >= 0 ? seg.orient : 'side'), v => { seg.orient = v; api.set(seg); },
      'So liegt das Segment in der Maschine (Ansicht von vorne, Draht in die Tiefe). Quer: der Ausschnitt geht quer durch das Segment, z. B. eine Flächenaufnahme im Rumpfsegment. Längs: der Ausschnitt läuft wie der Segmentschnitt entlang der Achse.');
    // Weitere Segmente derselben Quelle, lagerichtig hintereinander (z0 aus den Längen davor).
    const nSrc = seg.src === 'dxf' ? nd : seg.src === 'model' ? nm : 0;
    if (nSrc > 1) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px 10px;flex-wrap:wrap;align-items:center;margin:4px 0';
      const lb = document.createElement('span'); lb.textContent = T('Weitere Segmente'); lb.title = T('Zusätzliche Segmente derselben Quelle mitladen — sie stehen lagerichtig vor bzw. hinter dem gewählten Segment; Block und Ansicht umfassen alle.'); row.appendChild(lb);
      const more = Array.isArray(seg.more) ? seg.more : [];
      for (let k = 0; k < nSrc; k++) {
        if (k === seg.k) continue;
        const l = document.createElement('label'); l.style.cssText = 'display:inline-flex;gap:3px;align-items:center;cursor:pointer';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = more.some(m => m.k === k);
        cb.onchange = () => {
          const m = more.filter(x => x.k !== k);
          if (cb.checked) { const s = capture(seg.src, k); if (!s) { if (App.toast) App.toast(T('Segment ließ sich nicht übernehmen — im Quell-Reiter fehlt die Schnittbahn (Synchronisation).')); api.changed(); return; } m.push(s); }
          seg.more = m.sort((a, b) => a.k - b.k); api.set(seg);
        };
        l.appendChild(cb); l.appendChild(document.createTextNode(String(k + 1))); row.appendChild(l);
      }
      body.appendChild(row);
    }
    selectRow(body, 'Segment umdrehen', [['no', 'nein'], ['yes', 'ja (Anfang rechts)']], () => seg.flip ? 'yes' : 'no', v => { seg.flip = v === 'yes'; api.set(seg); });
    const v = view(seg);
    if (v) hint(body, T('Block aus dem Segment: ') + v.W.toFixed(1) + ' × ' + v.H.toFixed(1) + ' mm, ' + T('Dicke ') + v.D.toFixed(1) + ' mm · ' + T('Segmentlänge ') + v.L.toFixed(1) + ' mm');
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0';
    const rl = document.createElement('button'); rl.textContent = T('Neu laden'); rl.title = T('Querschnitte und Block erneut aus dem Quell-Reiter holen (Lage bleibt)');
    rl.onclick = () => { const s = capture(seg.src, seg.k); if (!s) { if (App.toast) App.toast(T('Segment nicht mehr vorhanden.')); return; } s.orient = seg.orient; s.flip = seg.flip;
      s.more = (Array.isArray(seg.more) ? seg.more : []).map(m => capture(seg.src, m.k)).filter(m => m && m.k !== s.k); api.set(s); };
    const v3 = document.createElement('button'); v3.textContent = T(R.on ? '◩ 3D-Vorschau aus' : '◩ 3D-Vorschau'); if (R.on) v3.className = 'primary';
    v3.onclick = () => setOn(!R.on);
    bar.appendChild(rl); bar.appendChild(v3); body.appendChild(bar);
  }

  // ======================================================================
  //  3D-Vorschau
  // ======================================================================
  const R = { on: false, yaw: -0.65, pitch: 0.42, zoom: 1, px: 0, py: 0, pivot: null, key: '' };
  let cv = null, ctx = null, bound = false, scene = null;
  const ROT = (v, yaw, pitch) => (window.ViewCube ? ViewCube.ROT_STD(v, yaw, pitch) : v);
  function setOn(on) {
    R.on = !!on;
    if (R.on && window.Ausschnitt && Ausschnitt.build) { try { Ausschnitt.build(); } catch (e) { /* Vorschau ohne Nachbarn */ } }
    const c = document.getElementById('cAusschnitt3d'); if (c) c.style.display = R.on ? '' : 'none';
    const b = document.getElementById('ausView3d'); if (b) { b.classList.toggle('primary', R.on); b.textContent = T(R.on ? '◩ 3D aus' : '◩ 3D-Vorschau'); }
    if (App.buildSidebar) App.buildSidebar();
    if (R.on) draw3d();
  }
  function resetView() { R.yaw = -0.65; R.pitch = 0.42; R.zoom = 1; R.px = 0; R.py = 0; R.pivot = null; }
  function triangulate(P) {
    if (!App.earcut || P.length < 3) return [];
    try { return App.earcut([P.map(p => ({ x: p[0], y: p[1] }))]).tris; } catch (e) { return []; }
  }
  // Szene: { W, H, D, tris:[{p:[a,b,c], c:[r,g,b,α]}], lines:[{p:[…], c}] } in Block-lokalen Koordinaten.
  function buildScene() {
    const d = window.Ausschnitt && Ausschnitt.results ? Ausschnitt.results() : null, res = d && d.res;
    if (!res || res.empty) return null;
    const blk = res.block, W = blk.w, H = blk.h, D = blk.d, tris = [], lines = [];
    // Block (Drahtgitter)
    const bc = [[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0], [0, 0, D], [W, 0, D], [W, H, D], [0, H, D]];
    [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => lines.push({ p: [bc[a], bc[b]], c: 'rgba(200,170,110,0.9)', w: 1.2 }));
    // Segment (Regelfläche + Stirnflächen)
    const sv = res.seg;
    if (sv && sv.parts) sv.parts.forEach(sg => {
      const pa = sg.A.map(p => sv.map(p[0], p[1], sg.z0)), pb = sg.B.map(p => sv.map(p[0], p[1], sg.z0 + sg.span)), n = pa.length, cS = [120, 170, 230, 0.42];
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; tris.push({ p: [pa[i], pa[j], pb[j]], c: cS }); tris.push({ p: [pa[i], pb[j], pb[i]], c: cS }); }
      triangulate(sg.A).forEach(t => tris.push({ p: [pa[t[0]], pa[t[1]], pa[t[2]]], c: cS }));
      triangulate(sg.B).forEach(t => tris.push({ p: [pb[t[0]], pb[t[1]], pb[t[2]]], c: cS }));
      lines.push({ p: pa.concat([pa[0]]), c: 'rgba(160,200,255,0.9)', w: 1 }); lines.push({ p: pb.concat([pb[0]]), c: 'rgba(160,200,255,0.9)', w: 1 });
    });
    // Ausschnitte als Prismen durch die Blockdicke (aktiver kräftig, die übrigen blasser).
    const all = d.all && d.all.length ? d.all.map(o => ({ r: o.r, act: o.i === d.active })) : [{ r: res, act: true }];
    all.forEach(o => {
      const r = o.r; if (!r || r.empty || !r.contour || r.contour.length < 3) return;
      const b0 = r.block || blk, P = r.contour.map(p => [p[0] - b0.x0, p[1] - b0.y0]), n = P.length, cc = o.act ? [255, 90, 60, 0.6] : [255, 150, 120, 0.35];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = P[i], b = P[j];
        tris.push({ p: [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], D]], c: cc }); tris.push({ p: [[a[0], a[1], 0], [b[0], b[1], D], [a[0], a[1], D]], c: cc });
      }
      triangulate(P).forEach(t => { tris.push({ p: t.map(i => [P[i][0], P[i][1], 0]), c: cc }); tris.push({ p: t.map(i => [P[i][0], P[i][1], D]), c: cc }); });
      lines.push({ p: P.concat([P[0]]).map(q => [q[0], q[1], D]), c: o.act ? 'rgba(255,120,90,1)' : 'rgba(255,160,130,0.6)', w: 1.2 });
      lines.push({ p: P.concat([P[0]]).map(q => [q[0], q[1], 0]), c: o.act ? 'rgba(255,120,90,1)' : 'rgba(255,160,130,0.6)', w: 1.2 });
    });
    return { W, H, D, tris, lines };
  }
  function fit() {
    const r = cv.getBoundingClientRect(), S = scene;
    const rad = 0.5 * Math.hypot(S.W, S.H, S.D) || 1;
    return { cw: r.width, ch: r.height, s: R.zoom * 0.45 * Math.min(r.width, r.height) / rad, c: R.pivot || [S.W / 2, S.H / 2, S.D / 2] };
  }
  function proj(p, F) {
    const q = ROT([p[0] - F.c[0], p[1] - F.c[1], p[2] - F.c[2]], R.yaw, R.pitch);
    return { x: F.cw / 2 + R.px + q[0] * F.s, y: F.ch / 2 + R.py - q[1] * F.s, z: q[2], d: -q[2] };
  }
  function draw3d() {
    if (!R.on) return;
    cv = document.getElementById('cAusschnitt3d'); if (!cv) return;
    bind();
    const r = cv.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel2').trim() || '#1e242c'; ctx.fillRect(0, 0, r.width, r.height);
    scene = buildScene();
    if (!scene) { ctx.fillStyle = '#8b98a8'; ctx.font = '13px Segoe UI, sans-serif'; ctx.fillText(T('Kein Ausschnitt.'), 20, 140); return; }
    const F = fit();
    // Flächen von hinten nach vorne (+z zeigt zum Betrachter), einfach schattiert.
    const list = scene.tris.map(t => {
      const a = proj(t.p[0], F), b = proj(t.p[1], F), c = proj(t.p[2], F);
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - a.x, vy = c.y - a.y;
      const A = ROT(t.p[0], R.yaw, R.pitch), B = ROT(t.p[1], R.yaw, R.pitch), Cc = ROT(t.p[2], R.yaw, R.pitch);
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], nl = Math.hypot(nx, ny, nz) || 1;
      const sh = 0.45 + 0.55 * Math.abs(nz / nl) + 0.12 * (ny / nl);
      return { a, b, c, z: (a.z + b.z + c.z) / 3, col: t.c, sh, area: Math.abs(ux * vy - uy * vx) };
    }).sort((p, q) => p.z - q.z);
    list.forEach(t => {
      if (t.area < 0.01) return;
      const k = Math.max(0.2, Math.min(1.2, t.sh)), c = t.col;
      ctx.fillStyle = 'rgba(' + Math.round(Math.min(255, c[0] * k)) + ',' + Math.round(Math.min(255, c[1] * k)) + ',' + Math.round(Math.min(255, c[2] * k)) + ',' + c[3] + ')';
      ctx.beginPath(); ctx.moveTo(t.a.x, t.a.y); ctx.lineTo(t.b.x, t.b.y); ctx.lineTo(t.c.x, t.c.y); ctx.closePath(); ctx.fill();
    });
    scene.lines.forEach(L => {
      ctx.strokeStyle = L.c; ctx.lineWidth = L.w || 1; ctx.beginPath();
      L.p.forEach((p, i) => { const q = proj(p, F); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
    });
    if (R.pivot && window.ViewCube) { const q = proj(R.pivot, F); ViewCube.drawPivot(ctx, q.x, q.y); }
    ctx.fillStyle = '#8b98a8'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText(T('3D-Vorschau · blau = Segment · rot = Ausschnitt (aktiv kräftig) · gelb = Block · Ziehen = drehen · rechte Taste = schieben · Rad = Zoom · Doppelklick = Standardansicht'), 8, r.height - 52);
  }
  function bind() {
    if (bound || !cv) return; bound = true;
    let drag = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button }; e.preventDefault(); });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.b === 0) { R.yaw += dx * 0.01; R.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, R.pitch + dy * 0.01)); }
      else { R.px += dx; R.py += dy; }
      draw3d();
    });
    window.addEventListener('mouseup', () => { drag = null; });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); if (!scene) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2, f = Math.exp(-e.deltaY * 0.0015);
      R.px = mx - (mx - R.px) * f; R.py = my - (my - R.py) * f; R.zoom *= f; draw3d();
    }, { passive: false });
    cv.addEventListener('dblclick', e => { if (e.button === 0) { resetView(); draw3d(); } });
    if (window.ViewCube) {
      // Mausrad-Doppelklick = Drehpunkt (nächster Eckpunkt der Szene), ohne dass das Bild springt.
      ViewCube.midDbl(cv, (x, y) => {
        if (!scene) return false;
        const F = fit();
        const p = ViewCube.pickNear(x, y, cb => { scene.tris.forEach(t => t.p.forEach(q => cb(q[0], q[1], q[2]))); scene.lines.forEach(L => L.p.forEach(q => cb(q[0], q[1], q[2]))); }, (a, b, c) => proj([a, b, c], F), 14);
        if (!p) return false;
        const s = proj(p, F); R.pivot = p; R.px = s.x - F.cw / 2; R.py = s.y - F.ch / 2; draw3d(); return true;
      });
      ViewCube.attach({
        canvas: () => document.getElementById('cAusschnitt3d'),
        get: () => ({ yaw: R.yaw, pitch: R.pitch }), set: (y, p) => { R.yaw = y; R.pitch = p; }, redraw: draw3d,
        rot: ViewCube.ROT_STD, k: [0.01, 0.01],
        labels: { '+x': 'Rechts', '-x': 'Links', '+y': 'Oben', '-y': 'Unten', '+z': 'Vorne', '-z': 'Hinten' },
        active: () => R.on && state.activeTab === 'ausschnitt',
        reset: () => { resetView(); draw3d(); }
      });
    }
  }
  function bindButton() {
    const b = document.getElementById('ausView3d'); if (!b || b._wired) return; b._wired = true;
    b.onclick = () => setOn(!R.on);
  }

  window.AusSeg = { capture, view, sidebar, draw3d, setOn, on: () => R.on, bindButton, sources: () => ({ dxf: dxfCount(), model: modelCount() }) };
})();
