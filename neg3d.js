/* neg3d.js — Negativschalendesign: 3D-Ansicht der geschnittenen Teile über die
 * ganze Tragfläche (eigenes Fenster). Wählbar: Ober-/Unterschale einzeln, Kern
 * bzw. Stege und Stützstoff, sofern sie mitgeschnitten werden. In Stege zerlegte
 * Kerne erscheinen ZUSAMMENGESETZT (ohne Stegabstand), die Trennschnitte als
 * Kanten. Je Segment wird der Querschnitt Wurzel -> Rand gelofted; Lage global
 * (Spannweite = Summe der Segmentspannweiten, Pfeilung = Summe leOffset).
 * Darstellung: eigener Canvas-2D-Maler (Flächen nach Tiefe sortiert, Lambert). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;

  const VIS = { up: true, lo: true, core: true, sup: true };
  const COL = { up: [87, 168, 255], lo: [255, 180, 84], core: [120, 210, 140], sup: [200, 140, 255] };

  // Geschlossenen bzw. offenen Linienzug nach Bogenlänge auf n Punkte bringen.
  function resample(P, n, closed) {
    const Q = closed ? P.concat([P[0]]) : P, L = [0];
    for (let i = 1; i < Q.length; i++) L.push(L[i - 1] + Math.hypot(Q[i].x - Q[i - 1].x, Q[i].y - Q[i - 1].y));
    const tot = L[L.length - 1] || 1, out = [], m = closed ? n : n - 1;
    for (let k = 0, j = 1; k < n; k++) {
      const s = tot * k / m;
      while (j < Q.length - 1 && L[j] < s) j++;
      const t = (s - L[j - 1]) / ((L[j] - L[j - 1]) || 1);
      out.push({ x: Q[j - 1].x + (Q[j].x - Q[j - 1].x) * t, y: Q[j - 1].y + (Q[j].y - Q[j - 1].y) * t });
    }
    return out;
  }
  const same = (a, b) => a.length === b.length ? [a, b] : (n => [resample(a, n, true), resample(b, n, true)])(Math.max(a.length, b.length));

  /* Querschnitte einer Rippe: Polygone je Teil (Cut-mm). Schalen = Blockhälften
   * über/unter der Kavität (inkl. Schnittverlängerung ovF/ovR und Trennfuge). */
  function ribParts(cut, k, rib) {
    const c = state.cfg, pts = App.negRibPts(cut, k, rib);
    const g = App.negRibGeom({ H: c.negBlockH, ovF: c.negOvF, ovR: c.negOvR, split: c.negSplit }, App.negBlockCy(), [],
      rib === 'root' ? cut.root.chord : cut.tip.chord, [], null, { idx: k, rib });
    const iLE = Math.ceil(pts.length / 2) - 1, s2 = (+c.negSplit || 0) / 2, H = +c.negBlockH || 0, cy = App.negBlockCy();
    const xs = pts.map(p => p.x), xL = Math.min.apply(null, xs), xT = Math.max.apply(null, xs);
    const xBL = xL - (g.ovF || 0), xBR = xT + (g.ovR || 0), yTop = cy + H / 2, yBot = cy - H / 2;
    const upS = pts.slice(0, iLE + 1).map(p => ({ x: p.x, y: p.y + s2 }));   // TE -> LE
    const loS = pts.slice(iLE).map(p => ({ x: p.x, y: p.y - s2 }));          // LE -> TE
    const out = {
      up: [{ x: xBR, y: upS[0].y }].concat(upS, [{ x: xBL, y: upS[upS.length - 1].y }, { x: xBL, y: yTop }, { x: xBR, y: yTop }]),
      lo: [{ x: xBL, y: loS[0].y }].concat(loS, [{ x: xBR, y: loS[loS.length - 1].y }, { x: xBR, y: yBot }, { x: xBL, y: yBot }]),
    };
    if (c.negSupport) {
      const sOff = c.negSupportMode !== 'core' ? (+c.negSupportGap || 0) : (+c.negSupportMM || 0);
      out.sup = App.negCoreContour(pts, sOff);
    }
    if (c.negCore) {
      const cR = App.negCoreContour(pts, +c.negCoreSheeting || 0);
      if (App.stegeOn && App.stegeOn()) {
        // Stege ohne Stegabstand (zusammengesetzt): Ober- + Unterseite zu einem Umriss.
        out.stege = App.stegePieces(cR).map(pc => pc.top.map(p => ({ x: p.x - pc.dx, y: p.y }))
          .concat(pc.bot.slice().reverse().map(p => ({ x: p.x - pc.dx, y: p.y }))));
      } else out.core = cR;
    }
    return out;
  }

  // Alle Flächen (Polygone in 3D) + Kanten der sichtbaren Teile.
  function buildScene() {
    const cuts = (App.wing && App.wing.cuts) || [], faces = [], edges = [];
    let z = 0, dx = 0;
    cuts.forEach((cut, k) => {
      if (k >= state.segments.length) return;
      const span = cut.span || 0, sweep = (cut.tip.pl && cut.tip.pl.leOffset) || 0;
      const R = ribParts(cut, k, 'root'), Tp = ribParts(cut, k, 'tip');
      const P3 = (p, zz) => [p.x + dx, p.y, zz];
      const loft = (a, b, col, edgeCaps) => {
        [a, b] = same(a, b);
        const n = a.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          faces.push({ p: [P3(a[i], z), P3(a[j], z), P3(b[j], z + span), P3(b[i], z + span)], col });
        }
        faces.push({ p: a.map(p => P3(p, z)), col, cap: 1 }, { p: b.map(p => P3(p, z + span)), col, cap: 1 });
        if (edgeCaps) { edges.push(a.map(p => P3(p, z)).concat([P3(a[0], z)]), b.map(p => P3(p, z + span)).concat([P3(b[0], z + span)])); }
      };
      if (VIS.up) loft(R.up, Tp.up, COL.up, true);
      if (VIS.lo) loft(R.lo, Tp.lo, COL.lo, true);
      if (VIS.sup && R.sup) loft(R.sup, Tp.sup, COL.sup, true);
      if (VIS.core && R.core) loft(R.core, Tp.core, COL.core, true);
      if (VIS.core && R.stege) R.stege.forEach((s, i) => {
        loft(s, Tp.stege[i], COL.core, true);
        // Trennschnitte: Flanken des Stegs als Kanten über die Spannweite.
        const a = same(s, Tp.stege[i]), n = a[0].length, h = n / 2;
        [0, h - 1, h, n - 1].forEach(q => edges.push([P3(a[0][q], z), P3(a[1][q], z + span)]));
      });
      z += span; dx += sweep;
    });
    return { faces, edges };
  }

  // ---------- Fenster + Maler ----------
  let win = null, cv = null, scene = null;
  const cam = { yaw: -0.7, pitch: 0.45, zoom: 1, px: 0, py: 0 };
  function project(S, w, h) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    S.faces.forEach(f => f.p.forEach(q => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i]); hi[i] = Math.max(hi[i], q[i]); } }));
    const c = lo.map((v, i) => (v + hi[i]) / 2), R = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 || 1;
    const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const s = Math.min(w, h) / (2.1 * R) * cam.zoom;
    // Welt: x = Sehne (nach hinten), y = hoch, z = Spannweite.
    return q => {
      const x = q[2] - c[2], y = q[1] - c[1], zz = -(q[0] - c[0]);
      const x1 = x * cyw - zz * syw, z1 = x * syw + zz * cyw;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      return [w / 2 + cam.px + x1 * s, h / 2 + cam.py - y2 * s, z2];
    };
  }
  function draw() {
    if (!cv || !win || win.style.display === 'none') return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg') || '#11161c'; ctx.fillRect(0, 0, w, h);
    if (!scene || !scene.faces.length) {
      ctx.fillStyle = '#8a97a6'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(T('Nichts zum Anzeigen gewählt.'), w / 2, h / 2); return;
    }
    const pr = project(scene, w, h);
    const L = [0.35, 0.8, 0.5], ln = Math.hypot.apply(null, L);
    const list = scene.faces.map(f => {
      const q = f.p.map(pr);
      let nx = 0, ny = 0, nz = 0;   // Newell-Normale im Bildraum
      for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
      const nl = Math.hypot(nx, ny, nz) || 1;
      const lam = Math.abs((nx * L[0] - ny * L[1] + nz * L[2]) / nl / ln);
      return { q, d: q.reduce((s, v) => s + v[2], 0) / q.length, col: f.col, lam, cap: f.cap };
    }).sort((a, b) => a.d - b.d);
    ctx.lineJoin = 'round';
    list.forEach(f => {
      const k = 0.35 + 0.65 * f.lam, c = f.col.map(v => Math.round(v * k));
      ctx.beginPath(); f.q.forEach((v, i) => i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1])); ctx.closePath();
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fill();
      if (!f.cap) { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke(); }
    });
    ctx.strokeStyle = 'rgba(10,14,20,.85)'; ctx.lineWidth = 1.1;
    scene.edges.forEach(E => { ctx.beginPath(); E.map(pr).forEach((v, i) => i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1])); ctx.stroke(); });
  }
  function refresh() { if (win && win.style.display !== 'none') { scene = buildScene(); buildChecks(); draw(); } }

  function buildChecks() {
    const box = win.querySelector('.n3d-checks'), c = state.cfg;
    const st = c.negCore && App.stegeOn && App.stegeOn();
    const items = [['up', 'Oberschale'], ['lo', 'Unterschale']];
    if (c.negCore) items.push(['core', st ? 'Kern (Stege zusammengesetzt)' : 'Kern']);
    if (c.negSupport) items.push(['sup', 'Stützstoff']);
    box.innerHTML = '';
    items.forEach(([k, lab]) => {
      const l = document.createElement('label'), i = document.createElement('input');
      i.type = 'checkbox'; i.checked = VIS[k];
      i.onchange = () => { VIS[k] = i.checked; scene = buildScene(); draw(); };
      l.appendChild(i); l.appendChild(document.createTextNode(' ' + T(lab))); box.appendChild(l);
    });
  }
  function open() {
    if (!win) {
      win = document.createElement('div');
      win.style.cssText = 'position:fixed;left:6%;top:7%;width:88%;height:84%;z-index:9000;background:var(--panel,#1a2028);'
        + 'border:1px solid var(--line,#334);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);display:flex;flex-direction:column';
      win.innerHTML = '<div class="n3d-head" style="display:flex;align-items:center;gap:14px;padding:6px 10px;border-bottom:1px solid var(--line,#334);cursor:move;font-size:12px">'
        + '<b>' + T('Negativschalen — 3D-Ansicht') + '</b><div class="n3d-checks" style="display:flex;gap:12px;flex-wrap:wrap"></div>'
        + '<span style="flex:1"></span><button type="button" class="n3d-home" title="' + T('Ansicht zurücksetzen') + '">⌂</button>'
        + '<button type="button" class="n3d-close">✕</button></div>'
        + '<div style="position:relative;flex:1;min-height:0"><canvas style="width:100%;height:100%;display:block;cursor:grab"></canvas>'
        + '<div style="position:absolute;left:10px;bottom:8px;font-size:11px;color:var(--muted,#8a97a6)">'
        + T('Linke Maustaste: drehen · rechte: verschieben · Rad: zoomen') + '</div></div>';
      document.body.appendChild(win);
      cv = win.querySelector('canvas');
      win.querySelector('.n3d-close').onclick = () => { win.style.display = 'none'; };
      win.querySelector('.n3d-home').onclick = () => { Object.assign(cam, { yaw: -0.7, pitch: 0.45, zoom: 1, px: 0, py: 0 }); draw(); };
      win.querySelectorAll('.n3d-head label, .n3d-head button').forEach(b => b.addEventListener('mousedown', e => e.stopPropagation()));
      // Fenster am Kopf verschieben.
      win.querySelector('.n3d-head').addEventListener('mousedown', e => {
        if (e.target.closest('label,button,input')) return;
        const r = win.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
        const mv = ev => { win.style.left = (ev.clientX - ox) + 'px'; win.style.top = Math.max(0, ev.clientY - oy) + 'px'; };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
      });
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('mousedown', e => {
        const x0 = e.clientX, y0 = e.clientY, c0 = Object.assign({}, cam), pan = e.button !== 0;
        const mv = ev => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (pan) { cam.px = c0.px + dx; cam.py = c0.py + dy; }
          else { cam.yaw = c0.yaw + dx * 0.008; cam.pitch = Math.max(-1.55, Math.min(1.55, c0.pitch + dy * 0.008)); }
          draw();
        };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
      });
      cv.addEventListener('wheel', e => { e.preventDefault(); cam.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12; draw(); }, { passive: false });
      addEventListener('resize', draw);
    }
    win.style.display = 'flex';
    refresh();
  }

  // Knopf im Ansichtsfenster des Reiters + Nachführen bei jeder Neuzeichnung.
  function wire() {
    const b = document.getElementById('neg3dBtn');
    if (b && !b.dataset.wired) { b.dataset.wired = '1'; b.addEventListener('click', open); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  Object.assign(App, { neg3dOpen: open, neg3dRefresh: refresh });
})();
