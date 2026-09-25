/* render.js — Zeichnen: Zoom/Pan, Overlays, Canvas-Helfer, Ansichten, Hauptrendering  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, applyView, blockCenterY, dashFor, drawSpars, dxfEnsureModel, dxfSetActive, exportViaPicker } = App;
  const { profileWithPockets, renderDxf, saveSettings, segCross, sparFromLE, sparOnProfile, sparPolys, sparProportional, sparRange, sparYc } = App;
  const { state, toast } = App;
  // ---------- Zoom / Pan ----------------------------------------------
  const nav = {};
  function ensureNav(key) {
    if (!nav[key]) nav[key] = { z: 1, ox: 0, oy: 0, drag: null };
    return nav[key];
  }
  // Profil-Ansichtsfenster: Tragflächendesign (wing) und Kerndesign (core)
  // teilen sich zwar denselben Canvas (cProf), führen aber je Reiter EIGENE
  // Zoom-/Pan-Zustände. So verschiebt ein Zoom im einen Reiter nicht die
  // Ansicht im anderen. -> bewusst entkoppelt.
  const profNavKey = () => state.activeTab === 'core' ? 'profCore' : 'prof';
  // Zuletzt gezeichnete Grundriss-Transformation -> Klick im Grundriss auf ein
  // Segment abbilden (Segmentaktivierung).
  let planPick = null;
  function setupNav(canvasId, name, redraw) {
    const cv = document.getElementById(canvasId);
    const rd = redraw || draw;
    // name kann ein fester Schlüssel (String) ODER ein Resolver (Funktion)
    // sein — Letzteres für Canvas, deren Nav-Zustand vom aktiven Reiter abhängt.
    const keyOf = typeof name === 'function' ? name : () => name;
    ensureNav(keyOf());
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const v = ensureNav(keyOf()), r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      v.ox = mx - (mx - v.ox) * f;
      v.oy = my - (my - v.oy) * f;
      v.z *= f;
      rd();
    }, { passive: false });
    cv.addEventListener('mousedown', e => {
      const v = ensureNav(keyOf());
      v.drag = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy }; v.moved = false;
      cv.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', e => {
      const v = nav[keyOf()]; if (!v || !v.drag) return;
      if (Math.abs(e.clientX - v.drag.x) + Math.abs(e.clientY - v.drag.y) > 3) v.moved = true;
      v.ox = v.drag.ox + (e.clientX - v.drag.x);
      v.oy = v.drag.oy + (e.clientY - v.drag.y);
      rd();
    });
    window.addEventListener('mouseup', () => { const v = nav[keyOf()]; if (v) { v.drag = null; } cv.style.cursor = 'grab'; });
    cv.addEventListener('dblclick', () => { const v = ensureNav(keyOf()); v.z = 1; v.ox = 0; v.oy = 0; rd(); });
    cv.style.cursor = 'grab';
  }

  // Punkt-in-Polygon (Ray-Casting) in Weltkoordinaten.
  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // Klick in den Grundriss -> Segment aktivieren (nur echter Klick, kein Ziehen).
  function setupPlanPick() {
    const cv = document.getElementById('cPlan');
    cv.addEventListener('click', e => {
      const v = nav.plan; if (v && v.moved) return;      // war ein Verschieben
      if (!planPick) return;
      const r = cv.getBoundingClientRect();
      const p = planPick.inv(e.clientX - r.left, e.clientY - r.top);
      // Zuerst prüfen, ob ein Holm-Band getroffen wurde -> diesen aktiv schalten.
      const hit = (planPick.spars || []).find(s => pointInPoly(p, s.poly));
      if (hit) {
        state.activeTab = 'wing';   // Holm-Editor liegt im Tragflächen-Reiter
        state.activeSpar = state.activeSpar === hit.k ? null : hit.k;
        App.buildSidebar(); render(); return;
      }
      const z = p.x;
      const seg = planPick.segZ.findIndex(s => z >= s.z0 && z <= s.z1);
      if (seg < 0) return;
      state.activeSeg = seg; state.cfg.profSegs = [];   // Grundriss-Klick: nur dieses Segment aktiv/angezeigt
      App.buildSidebar(); render();
    });
  }

  // ---------- Verschiebbare Overlays (Legenden / Klickmenüs) ----------
  // Legenden, Beschriftungen und die Sichtbarkeits-Schalter im Ansichtsfenster
  // lassen sich frei ziehen. Enthält das Overlay Bedienelemente, wird ein kleiner
  // Griff oben eingefügt; reine Textboxen sind komplett greifbar.
  function makeDraggable(el) {
    if (!el || el._drag) return; el._drag = true;
    const hasCtl = !!el.querySelector('input,select,button,textarea');
    let handle = el;
    if (hasCtl) {
      handle = document.createElement('div');
      handle.textContent = '⠿';
      handle.title = T('Ziehen zum Verschieben');
      handle.style.cssText = 'cursor:move;color:var(--muted);font-size:12px;line-height:1;'
        + 'text-align:center;margin:-2px -3px 4px;user-select:none';
      el.insertBefore(handle, el.firstChild);
    } else {
      el.style.cursor = 'move';
      el.style.pointerEvents = 'auto';   // pane-label ist sonst klick-transparent
    }
    handle.addEventListener('mousedown', e => {
      // Ganzes Feld als Griff (Inhalt wird oft erst später gefüllt, z. B. Bedienfelder
      // Krümmungs-/Zebra-Analyse im Formenbau): Klicks auf Bedienelemente durchlassen,
      // sonst lassen sich Schieber, Auswahlfelder und Eingaben nicht bedienen.
      if (handle === el && e.target !== el && e.target.closest('input,select,button,textarea,label,a')) return;
      e.preventDefault(); e.stopPropagation();
      const par = el.offsetParent || el.parentElement;
      const pr = par.getBoundingClientRect(), r = el.getBoundingClientRect();
      const ox = r.left - pr.left, oy = r.top - pr.top;
      const sx = e.clientX, sy = e.clientY;
      el.style.left = ox + 'px'; el.style.top = oy + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
      const mv = ev => {
        el.style.left = (ox + ev.clientX - sx) + 'px';
        el.style.top = (oy + ev.clientY - sy) + 'px';
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
  }

  // ---------- 3D-Fenster: geschnittene Segmente zusammengebaut -------------
  /* Gemeinsames, frei schwebendes Fenster (#seg3dWin, Canvas #cSeg3d) für den
   * Tragflächendesigner UND die DXF-Formen. Quelle = Funktion, die
   * { list: [{ k, root, tip, z0, z1, label }], active } liefert; root/tip sind
   * gleich lange Punktlisten (mm) in der Profilebene, z0/z1 die Spannweitenlage.
   * Eigener Mini-Renderer: Orbit-Kamera, Perspektive, Beleuchtung, Maler-
   * Algorithmus auf 2D-Canvas (kein WebGL nötig). */
  const SEG3D_CAM0 = { yaw: 0.85, pitch: 0.32, zoom: 1, px: 0, py: 0 };
  const seg3d = Object.assign({ side: 'one', drag: null, source: null, hover: null, gizmo: null, anim: null, pivot: null, pick: null }, SEG3D_CAM0);
  const SEG3D_TITLES = {
    wing: '3D-Ansicht — geschnittene Segmente der Tragfläche (zusammengebaut)',
    dxf:  '3D-Ansicht — geschnittene Segmente (zusammengebaut)'
  };
  /* Tragfläche: je Segment die Kern-Rippen (Wurzel/Außen) aus dem Schnitt-Paneel —
   * mit Schränkung, V-Form (Höhe bereits im Paneel) und Pfeilung (LE-Versatz der
   * Vorsegmente aufsummiert). Beplankung wird wie beim Schnitt abgezogen (Kern). */
  function wingSeg3DList() {
    const cuts = (App.wing && App.wing.cuts) || [];
    const list = []; let xoff = 0;
    state.segments.forEach((sg, k) => {
      const c = cuts[Math.min(k, cuts.length - 1)]; if (!c || !App.segZ || !App.segZ[k]) return;
      const sf = App.sheetFor ? App.sheetFor(sg) : null;
      const core = (pts, sh) => {
        const t = sh ? Math.max(sh.top || 0, sh.bot || 0) : 0;
        return (t > 0 ? negCoreContour(pts, t) : pts).map(p => ({ x: p.x + xoff, y: p.y }));
      };
      const root = core(c.root.pts, sf && sf.root), tip = core(c.tip.pts, sf && sf.tip);
      if (root.length > 2 && tip.length === root.length)
        list.push({ k, root, tip, z0: App.segZ[k].z0, z1: App.segZ[k].z1, label: 'S' + (k + 1) + ' · ' + Math.round(sg.span || 0) + ' mm' });
      xoff += sg.sweep || 0;
    });
    return { list, active: state.activeSeg };
  }
  function seg3dSourceData() {
    if (seg3d.source === 'wing') return wingSeg3DList();
    if (seg3d.source === 'dxf' && App.dxfSeg3DList) return App.dxfSeg3DList();
    return { list: [], active: -1 };
  }
  function renderSeg3D(ctx, w, h, data) {
    // Seitenwahl: 'one' = konstruierte Seite, 'other' = gespiegelte Gegenseite, 'both' = beide.
    // Gespiegelt wird an der Wurzelebene Z = 0 (Spannweite -> −Z).
    const base = data.list || [], activeK = data.active;
    const mir = base.map(S => Object.assign({}, S, { z0: -S.z0, z1: -S.z1 }));
    const segs = seg3d.side === 'both' ? mir.concat(base) : seg3d.side === 'other' ? mir : base;
    const muted = App.PAL.muted || '#8a97a6';
    if (!segs.length) {
      ctx.fillStyle = muted; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(T('Keine geschnittenen Segmente vorhanden.'), w / 2, h / 2);
      ctx.textAlign = 'left'; return;
    }
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    segs.forEach(S => [S.root, S.tip].forEach(a => a.forEach(p => { if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x; if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y; })));
    const zLo = Math.min.apply(null, segs.map(S => Math.min(S.z0, S.z1))), zHi = Math.max.apply(null, segs.map(S => Math.max(S.z0, S.z1)));
    // Drehpunkt: per Doppelklick aufs Modell gesetzt, sonst Modellmitte.
    const C = seg3d.pivot || { x: (mnx + mxx) / 2, y: (mny + mxy) / 2, z: (zLo + zHi) / 2 };
    const R = Math.max(1, Math.hypot(mxx - mnx, mxy - mny, zHi - zLo) / 2);
    const cy = Math.cos(seg3d.yaw), sy = Math.sin(seg3d.yaw), cpch = Math.cos(seg3d.pitch), spch = Math.sin(seg3d.pitch);
    const dist = R * 3.2;
    const f = Math.min(w, h) * 0.42 * seg3d.zoom * dist / R;   // ganzes Modell passt bei Zoom 1
    const cam = p => {
      const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z;
      const x1 = dz * cy - dx * sy, z1 = dz * sy + dx * cy;          // Drehung um Hochachse
      const y2 = dy * cpch - z1 * spch, z2 = dy * spch + z1 * cpch;   // Kippen
      return { x: x1, y: y2, d: dist + z2 };
    };
    const proj = c => ({ x: w / 2 + seg3d.px + c.x * f / c.d, y: h / 2 + seg3d.py - c.y * f / c.d });
    const L = { x: -0.4, y: 0.7, z: -0.6 }; const ll = Math.hypot(L.x, L.y, L.z); L.x /= ll; L.y /= ll; L.z /= ll;
    const faces = [];
    const wp = (p, z) => ({ x: p.x, y: p.y, z });
    segs.forEach(S => {
      const n = S.root.length, active = S.k === activeK;
      const cr = S.root.map(p => cam(wp(p, S.z0))), ct = S.tip.map(p => cam(wp(p, S.z1)));
      const addFace = (pts, c, wpts) => {
        const a = pts[0], b = pts[1], q = pts[2];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.d - a.d, vx = q.x - a.x, vy = q.y - a.y, vz = q.d - a.d;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
        const lit = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
        let depth = 0; pts.forEach(p => depth += p.d); depth /= pts.length;
        // Welt-Schwerpunkt der Fläche (für die Trefferprüfung / Drehpunkt per Doppelklick).
        let wx = 0, wy = 0, wz = 0; wpts.forEach(p => { wx += p.x; wy += p.y; wz += p.z; });
        faces.push({ pts, depth, lit, c, wc: { x: wx / wpts.length, y: wy / wpts.length, z: wz / wpts.length } });
      };
      const wr = S.root.map(p => wp(p, S.z0)), wt = S.tip.map(p => wp(p, S.z1));
      for (let i = 0; i < n - 1; i++) addFace([cr[i], cr[i + 1], ct[i + 1], ct[i]], active ? 'a' : (S.k % 2 ? 'b' : 'c'), [wr[i], wr[i + 1], wt[i + 1], wt[i]]);
      // Schließkante (letzter -> erster Punkt), falls die Kontur offen übergeben wurde.
      const closeGap = Math.hypot(S.root[n - 1].x - S.root[0].x, S.root[n - 1].y - S.root[0].y);
      if (closeGap > 1e-6) addFace([cr[n - 1], cr[0], ct[0], ct[n - 1]], active ? 'a' : (S.k % 2 ? 'b' : 'c'), [wr[n - 1], wr[0], wt[0], wt[n - 1]]);
      const capOf = (arr, z) => {   // Deckel (Fächer um den Schwerpunkt)
        let gx = 0, gy = 0; arr.forEach(p => { gx += p.x; gy += p.y; }); gx /= arr.length; gy /= arr.length;
        const gw = { x: gx, y: gy, z }, g = cam(gw), ww = arr.map(p => wp(p, z)), cc = ww.map(cam);
        for (let i = 0; i < arr.length; i++) addFace([g, cc[i], cc[(i + 1) % arr.length]], 'cap', [gw, ww[i], ww[(i + 1) % arr.length]]);
      };
      capOf(S.root, S.z0); capOf(S.tip, S.z1);
    });
    faces.sort((a, b) => b.depth - a.depth);
    const col = (c, lit) => {
      const l = 30 + 48 * lit;
      if (c === 'a') return 'hsl(210,85%,' + Math.round(38 + 34 * lit) + '%)';
      if (c === 'cap') return 'hsl(210,8%,' + Math.round(l - 2) + '%)';
      return 'hsl(210,' + (c === 'b' ? 10 : 6) + '%,' + Math.round(l) + '%)';
    };
    ctx.lineJoin = 'round';
    const pick = [];   // Bildschirm-Polygone (hinten -> vorn) für die Trefferprüfung
    faces.forEach(F => {
      const sp = F.pts.map(proj);
      ctx.beginPath();
      sp.forEach((s, i) => { if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.closePath();
      ctx.fillStyle = col(F.c, F.lit); ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();
      pick.push({ sp, wc: F.wc });
    });
    seg3d.pick = pick;
    // Drehpunkt-Markierung (nur wenn per Doppelklick gesetzt).
    if (seg3d.pivot) {
      const s = proj(cam(seg3d.pivot));
      ctx.strokeStyle = App.PAL.accent || '#4aa3ff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x - 9, s.y); ctx.lineTo(s.x + 9, s.y); ctx.moveTo(s.x, s.y - 9); ctx.lineTo(s.x, s.y + 9); ctx.stroke();
    }
    const drawLoop = (arr, z, colr, lw) => {
      ctx.strokeStyle = colr; ctx.lineWidth = lw; ctx.beginPath();
      arr.forEach((p, i) => { const s = proj(cam(wp(p, z))); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.closePath(); ctx.stroke();
    };
    segs.forEach(S => {
      const act = S.k === activeK;
      drawLoop(S.root, S.z0, act ? (App.PAL.profInner || '#4aa3ff') : 'rgba(160,176,196,.55)', act ? 2 : 0.8);
      drawLoop(S.tip, S.z1, act ? (App.PAL.profOuter || '#ffb454') : 'rgba(160,176,196,.55)', act ? 2 : 0.8);
    });
    ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    segs.forEach(S => {
      const s = proj(cam({ x: mnx, y: mxy, z: (S.z0 + S.z1) / 2 }));
      ctx.fillStyle = S.k === activeK ? (App.PAL.accent || '#4aa3ff') : muted;
      ctx.fillText(S.label || '', s.x, s.y - 10);
    });
    // Achsenkreuz unten links (X Profiltiefe, Y Höhe, Z Spannweite).
    const o = { x: 44, y: h - 40 }, al = 26;
    const ax = (v, name, colr) => {
      const c = cam({ x: C.x + v.x, y: C.y + v.y, z: C.z + v.z }), c0 = cam(C);
      const dx = (c.x - c0.x), dy = -(c.y - c0.y); const l = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = colr; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + dx / l * al, o.y + dy / l * al); ctx.stroke();
      ctx.fillStyle = colr; ctx.fillText(name, o.x + dx / l * (al + 9), o.y + dy / l * (al + 9) + 4);
    };
    ax({ x: R, y: 0, z: 0 }, 'X', '#e06b6b'); ax({ x: 0, y: R, z: 0 }, 'Y', '#6bc46b'); ax({ x: 0, y: 0, z: R }, 'Z', '#6b9be0');
    ctx.textAlign = 'left'; ctx.fillStyle = muted; ctx.font = '10px system-ui';
    ctx.fillText(T('Ziehen: drehen · Mausrad/rechte Maus/Umschalt: verschieben · Rad: Zoom · Doppelklick Modell: Drehpunkt · Doppelklick leer: zurücksetzen · Gizmo: Klick = Ansicht'), 10, h - 8);
    if (!window.ViewCube) seg3dDrawGizmo(ctx, w, h); else seg3d.gizmo = null;   // Ansichtswürfel (viewcube.js) ersetzt das Achsen-Gizmo
  }
  // Richtungsvektor (Welt) -> Kameraraum (nur Drehung, wie cam() ohne Verschiebung).
  function seg3dRotDir(v) {
    const cy = Math.cos(seg3d.yaw), sy = Math.sin(seg3d.yaw), cp = Math.cos(seg3d.pitch), sp = Math.sin(seg3d.pitch);
    const x1 = v.z * cy - v.x * sy, z1 = v.z * sy + v.x * cy;
    return { x: x1, y: v.y * cp - z1 * sp, d: v.y * sp + z1 * cp };
  }
  /* Navigations-Gizmo oben rechts: Kugeln für +X/+Y/+Z (mit Buchstabe) und
   * −X/−Y/−Z (hohl), perspektivisch mit der Kamera gedreht. Klick auf eine Kugel
   * dreht die Kamera animiert so, dass diese Achse zum Betrachter zeigt; Ziehen
   * auf dem Gizmo dreht die Szene wie im Canvas. Trefferflächen in seg3d.gizmo. */
  const SEG3D_AXES = [
    { v: { x: 1, y: 0, z: 0 }, name: 'X', col: '#e06b6b', sign: 1 }, { v: { x: -1, y: 0, z: 0 }, name: 'X', col: '#e06b6b', sign: -1 },
    { v: { x: 0, y: 1, z: 0 }, name: 'Y', col: '#6bc46b', sign: 1 }, { v: { x: 0, y: -1, z: 0 }, name: 'Y', col: '#6bc46b', sign: -1 },
    { v: { x: 0, y: 0, z: 1 }, name: 'Z', col: '#6b9be0', sign: 1 }, { v: { x: 0, y: 0, z: -1 }, name: 'Z', col: '#6b9be0', sign: -1 }
  ];
  function seg3dDrawGizmo(ctx, w, h) {
    const cx = w - 62, cy = 62, r = 36;
    const g = { cx, cy, r, balls: [] };
    if (seg3d.hover) {
      ctx.fillStyle = 'rgba(160,176,196,.12)'; ctx.beginPath(); ctx.arc(cx, cy, r + 14, 0, Math.PI * 2); ctx.fill();
    }
    const balls = SEG3D_AXES.map((a, i) => {
      const c = seg3dRotDir(a.v);
      return { i, a, x: cx + c.x * r, y: cy - c.y * r, d: c.d };
    }).sort((p, q) => q.d - p.d);   // hinten zuerst
    balls.forEach(b => {
      const hov = seg3d.hover && seg3d.hover.ball === b.i;
      const rad = b.a.sign > 0 ? 9 : 7, fade = 0.55 + 0.45 * (1 - (b.d + 1) / 2);   // hinten blasser
      ctx.globalAlpha = hov ? 1 : fade;
      if (b.a.sign > 0) {
        ctx.strokeStyle = b.a.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = b.a.col; ctx.beginPath(); ctx.arc(b.x, b.y, rad + (hov ? 2 : 0), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0c0f13'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.a.name, b.x, b.y + 0.5);
      } else {
        ctx.fillStyle = hov ? b.a.col : 'rgba(12,15,19,.75)'; ctx.strokeStyle = b.a.col; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(b.x, b.y, rad + (hov ? 2 : 0), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (hov) { ctx.fillStyle = '#0c0f13'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('-' + b.a.name, b.x, b.y + 0.5); }
      }
      g.balls.push({ i: b.i, x: b.x, y: b.y, r: rad + 3 });
    });
    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    seg3d.gizmo = g;
  }
  // Modell unter dem Mauszeiger (Canvas-Pixel): Welt-Schwerpunkt der vordersten
  // getroffenen Fläche oder null. seg3d.pick liegt hinten -> vorn sortiert.
  function seg3dPickModel(x, y) {
    const P = seg3d.pick; if (!P) return null;
    for (let k = P.length - 1; k >= 0; k--) if (pointInPoly({ x, y }, P[k].sp)) return P[k].wc;
    return null;
  }
  // Trefferprüfung Gizmo: { ball: i } | { bg: true } | null (Position in Canvas-Pixeln).
  function seg3dGizmoHit(x, y) {
    const g = seg3d.gizmo; if (!g) return null;
    for (let k = g.balls.length - 1; k >= 0; k--) { const b = g.balls[k]; if (Math.hypot(x - b.x, y - b.y) <= b.r) return { ball: b.i }; }
    return Math.hypot(x - g.cx, y - g.cy) <= g.r + 14 ? { bg: true } : null;
  }
  // Kamera animiert auf die Ansicht drehen, in der Achse i zum Betrachter zeigt.
  function seg3dSnapAxis(i) {
    const a = SEG3D_AXES[i]; if (!a) return;
    let yaw = seg3d.yaw, pitch = 0;
    if (a.name === 'X') yaw = a.sign > 0 ? Math.PI : 0;
    else if (a.name === 'Z') yaw = a.sign > 0 ? -Math.PI / 2 : Math.PI / 2;
    else pitch = a.sign > 0 ? -Math.PI / 2 : Math.PI / 2;   // Y: Blick von oben/unten, yaw bleibt
    const wrap = v => Math.atan2(Math.sin(v), Math.cos(v));   // kürzester Weg
    const y0 = seg3d.yaw, p0 = seg3d.pitch, dy = wrap(yaw - y0), dp = pitch - p0;
    const t0 = performance.now(), DUR = 260;
    if (seg3d.anim) cancelAnimationFrame(seg3d.anim);
    const step = now => {
      const t = Math.min(1, (now - t0) / DUR), e = t * t * (3 - 2 * t);   // smoothstep
      seg3d.yaw = y0 + dy * e; seg3d.pitch = p0 + dp * e;
      renderSeg3DWin();
      seg3d.anim = t < 1 ? requestAnimationFrame(step) : null;
    };
    seg3d.anim = requestAnimationFrame(step);
  }
  function seg3dWinEl() { return document.getElementById('seg3dWin'); }
  function seg3dIsOpen() { const el = seg3dWinEl(); return !!(el && el.style.display === 'flex'); }
  // Zeichnet das Fenster neu (nur wenn offen) — von render()/renderDxf() aufgerufen.
  function renderSeg3DWin() {
    if (!seg3dIsOpen()) return;
    const cv = document.getElementById('cSeg3d'); if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    renderSeg3D(ctx, w, h, seg3dSourceData());
  }
  function seg3dOpen(source) {
    const el = seg3dWinEl(); if (!el) return;
    const src = source || 'wing'; if (src !== seg3d.source) seg3d.pivot = null;   // anderes Modell: Drehpunkt verwerfen
    seg3d.source = src;
    const t = el.querySelector('.ttl'); if (t) t.textContent = T(SEG3D_TITLES[seg3d.source] || SEG3D_TITLES.dxf);
    if (!el.style.left) {   // erste Öffnung: rechts, mittig über der Zeichenfläche
      const vw = window.innerWidth, vh = window.innerHeight;
      const W = Math.min(720, vw - 40), H = Math.min(520, vh - 80);
      el.style.width = W + 'px'; el.style.height = H + 'px';
      el.style.left = Math.max(10, vw - W - 24) + 'px'; el.style.top = Math.max(10, (vh - H) / 2) + 'px';
    }
    el.style.display = 'flex';
    renderSeg3DWin();
  }
  function seg3dClose() { const el = seg3dWinEl(); if (el) el.style.display = 'none'; }
  // Verdrahtung: Maus im Canvas (Orbit/Verschieben/Zoom), Fenster ziehen, Tasten.
  function seg3dWire() {
    const el = seg3dWinEl(), cv = document.getElementById('cSeg3d'); if (!el || !cv || el._wired) return; el._wired = true;
    if (window.ViewCube) ViewCube.attach({ canvas: () => document.getElementById('cSeg3d'), get: () => seg3d, set: (y, p) => { seg3d.yaw = y; seg3d.pitch = p; }, redraw: () => renderSeg3DWin(), k: [0.01, -0.01],
      rot: (v, yaw, pitch) => { const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), x1 = v[2] * cy - v[0] * sy, z1 = v[2] * sy + v[0] * cy; return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp]; },
      labels: { '+x': 'Endleiste', '-x': 'Nase', '+y': 'Oben', '-y': 'Unten', '+z': 'Außen', '-z': 'Wurzel' } });
    const cvPos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('mousedown', e => {
      e.preventDefault();
      const q = cvPos(e), hit = seg3dGizmoHit(q.x, q.y);
      if (hit && hit.ball != null && e.button === 0 && !e.shiftKey) { seg3dSnapAxis(hit.ball); return; }
      // Verschieben: rechte Maustaste, gedrücktes Mausrad (mittlere Taste) oder Umschalt.
      seg3d.drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
      const mv = ev => {
        const g = seg3d.drag; if (!g) return;
        const dx = ev.clientX - g.x, dy = ev.clientY - g.y; g.x = ev.clientX; g.y = ev.clientY;
        if (g.pan) { seg3d.px += dx; seg3d.py += dy; }
        else {
          // Volles Durchdrehen in alle Richtungen (keine Kipp-Begrenzung). Steht die
          // Szene kopfüber (cos(pitch) < 0), Drehsinn um die Hochachse umkehren, damit
          // die Bewegung der Maus folgt.
          seg3d.yaw += dx * 0.01 * (Math.cos(seg3d.pitch) < 0 ? -1 : 1);   // links/rechts wie urspruenglich, nur Kippen invertiert
          seg3d.pitch -= dy * 0.01;
        }
        renderSeg3DWin();
      };
      const up = () => { seg3d.drag = null; window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
    cv.addEventListener('mousemove', e => {   // Hover über dem Gizmo hervorheben
      if (seg3d.drag) return;
      const q = cvPos(e), hit = seg3dGizmoHit(q.x, q.y);
      const key = hit ? (hit.ball != null ? 'b' + hit.ball : 'bg') : '';
      const prev = seg3d.hover ? (seg3d.hover.ball != null ? 'b' + seg3d.hover.ball : 'bg') : '';
      cv.style.cursor = hit && hit.ball != null ? 'pointer' : (hit ? 'grab' : '');
      if (key !== prev) { seg3d.hover = hit; renderSeg3DWin(); }
    });
    cv.addEventListener('mouseleave', () => { if (seg3d.hover) { seg3d.hover = null; renderSeg3DWin(); } });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('auxclick', e => e.preventDefault());   // kein Browser-Autoscroll bei mittlerer Taste
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      seg3d.zoom = Math.max(0.1, Math.min(40, seg3d.zoom * Math.exp(-e.deltaY * 0.0015)));
      renderSeg3DWin();
    }, { passive: false });
    cv.addEventListener('dblclick', e => {
      e.preventDefault();
      const q = cvPos(e), hit = seg3dPickModel(q.x, q.y);
      if (hit) {
        // Drehpunkt auf den getroffenen Punkt legen. Damit die Ansicht dabei nicht
        // springt, die Bildverschiebung so setzen, dass der neue Drehpunkt an der
        // Klickstelle bleibt (Drehpunkt liegt immer bei Bildmitte + px/py).
        const r = cv.getBoundingClientRect();
        seg3d.pivot = hit; seg3d.px = q.x - r.width / 2; seg3d.py = q.y - r.height / 2;
      } else { Object.assign(seg3d, SEG3D_CAM0); seg3d.pivot = null; }
      renderSeg3DWin();
    });
    const head = el.querySelector('.head');
    if (head) head.addEventListener('mousedown', e => {
      if (e.target.closest('button,select,input')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, ox = r.left, oy = r.top;
      const mv = ev => {
        el.style.left = Math.max(0, Math.min(window.innerWidth - 60, ox + ev.clientX - sx)) + 'px';
        el.style.top = Math.max(0, Math.min(window.innerHeight - 30, oy + ev.clientY - sy)) + 'px';
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
    if (window.ResizeObserver) new ResizeObserver(() => renderSeg3DWin()).observe(el);
    const sSide = document.getElementById('seg3dSide'); if (sSide) { sSide.value = seg3d.side; sSide.onchange = () => { seg3d.side = sSide.value; seg3d.pivot = null; renderSeg3DWin(); }; }
    const bClose = document.getElementById('seg3dClose'); if (bClose) bClose.onclick = seg3dClose;
    const bReset = document.getElementById('seg3dReset'); if (bReset) bReset.onclick = () => { Object.assign(seg3d, SEG3D_CAM0); seg3d.pivot = null; renderSeg3DWin(); };
    const bW = document.getElementById('wing3dOpenBtn'); if (bW) bW.onclick = () => seg3dOpen('wing');
    const bD = document.getElementById('dxf3dOpenBtn'); if (bD) bD.onclick = () => seg3dOpen('dxf');
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && seg3dIsOpen() && !(e.target && e.target.closest && e.target.closest('input,textarea,select'))) seg3dClose(); });
  }

  function setupDraggableOverlays() {
    seg3dWire();   // gemeinsames 3D-Fenster (Tragfläche / DXF-Formen)
    document.querySelectorAll('.pane-toggles, .pane-label, .simlegend, .legend').forEach(makeDraggable);
  }

  // Verschiebbare Teiler in den Reitern „Tragflächendesigner" (2×2-Raster) und
  // „Kernschneiden" (übereinander). Im Kernschneiden teilt EINE waagrechte Linie
  // (coreSplit) Grundriss/Profile; im Tragflächen-Reiter zwei Linien: senkrecht
  // (wingColSplit: Grundriss|Profile) und waagrecht (wingRowSplit: obere Reihe|
  // Aufriss). Alle setzen nur das CSS-Grid und lösen ein Neuzeichnen aus —
  // fitCanvas misst je Draw neu, daher skalieren die Canvas automatisch mit.
  function applyCoreSplit() {
    const stack = document.querySelector('#wingView .wing-stack');
    const coreBar = document.getElementById('coreSplit');
    const colBar = document.getElementById('wingColSplit');
    const rowBar = document.getElementById('wingRowSplit');
    if (!stack || !coreBar) return;
    const core = stack.classList.contains('core-mode');
    const clamp = v => Math.max(0.15, Math.min(0.85, v));
    // Kernschneiden: waagrechte Teilung Grundriss/Profile.
    coreBar.style.display = core ? 'block' : 'none';
    if (colBar) colBar.style.display = core ? 'none' : 'block';
    if (rowBar) rowBar.style.display = core ? 'none' : 'block';
    if (core) {
      const f = clamp(state.cfg.coreSplit || 0.333);
      stack.style.gridTemplateColumns = '1fr';
      stack.style.gridTemplateRows = f + 'fr ' + (1 - f) + 'fr';
      coreBar.style.top = (f * 100) + '%';
    } else {
      // Tragflächen-Reiter: 2×2-Raster mit zwei ziehbaren Teilern.
      const fc = clamp(state.cfg.wingColSplit != null ? state.cfg.wingColSplit : 0.5);
      const fr = clamp(state.cfg.wingRowSplit != null ? state.cfg.wingRowSplit : 0.5);
      stack.style.gridTemplateColumns = fc + 'fr ' + (1 - fc) + 'fr';
      stack.style.gridTemplateRows = fr + 'fr ' + (1 - fr) + 'fr';
      if (colBar) { colBar.style.left = (fc * 100) + '%'; colBar.style.height = (fr * 100) + '%'; }
      if (rowBar) rowBar.style.top = (fr * 100) + '%';
    }
  }
  // Einen Teilerbalken ziehbar machen: `axis` = 'x' (senkrecht) oder 'y' (waagrecht),
  // `set` schreibt den Anteil (0..1) in die Config.
  function makeSplitDraggable(bar, stack, axis, set) {
    if (!bar) return;
    bar.addEventListener('mousedown', e => {
      e.preventDefault();
      const mv = ev => {
        const r = stack.getBoundingClientRect();
        const f = axis === 'x' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        set(Math.max(0.15, Math.min(0.85, f)));
        applyCoreSplit(); draw();
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
  }
  function setupCoreSplit() {
    const stack = document.querySelector('#wingView .wing-stack');
    if (!stack) return;
    makeSplitDraggable(document.getElementById('coreSplit'), stack, 'y', v => state.cfg.coreSplit = v);
    makeSplitDraggable(document.getElementById('wingColSplit'), stack, 'x', v => state.cfg.wingColSplit = v);
    makeSplitDraggable(document.getElementById('wingRowSplit'), stack, 'y', v => state.cfg.wingRowSplit = v);
  }
  function kerfColor(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [[74, 163, 255], [87, 211, 140], [255, 180, 84], [255, 90, 60]];
    const x = t * (stops.length - 1), i = Math.floor(x), f = x - i;
    const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
    const c = k => Math.round(a[k] + (b[k] - a[k]) * f);
    return 'rgb(' + c(0) + ',' + c(1) + ',' + c(2) + ')';
  }
  // Schnittspur für die Zeichnung in Züge teilen: klassisch (von hinten, beide
  // Seiten) EIN Zug = die ganze Bahn; Schnittrichtung „von vorne" je Kopie zwei Züge,
  // „nur Ober-/Unterseite" nur der geschnittene Zug — jeweils in Fahrtrichtung
  // (HotWire.cutPasses auf der Wurzelbahn, gleiche Indizes für P).
  function spurParts(pr, P) {
    const front = !!(App.cutFront && App.cutFront());
    const sides = state.cfg.cutSides === 'top' || state.cfg.cutSides === 'bottom' ? state.cfg.cutSides : null;
    if (!P || !(front || sides) || !(window.HotWire && HotWire.cutPasses)) return [P];
    const ps = HotWire.cutPasses(pr.rootPath, (pr.stack && pr.stack.count > 1) ? pr.stack.count : 1, { front, sides });
    return ps.length ? ps.map(q => q.idx.map(i => P[i])) : [P];
  }
  // Kleiner Richtungspfeil am Anfang eines Zugs (Spitze ~4 mm nach dem Start).
  function spurArrow(ctx, V, pts, dy) {
    if (!pts || pts.length < 3) return;
    let s = 0, k = 1;
    for (; k < pts.length - 1; k++) { s += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y); if (s > 4) break; }
    const a = pts[k - 1], b = pts[k];
    const x0 = V.X(a.x), y0 = V.Y(a.y + dy), x1 = V.X(b.x), y1 = V.Y(b.y + dy);
    const L = Math.hypot(x1 - x0, y1 - y0); if (L < 1e-6) return;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L, S = 7;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * S - uy * S * 0.5, y1 - uy * S + ux * S * 0.5);
    ctx.lineTo(x1 - ux * S + uy * S * 0.5, y1 - uy * S - ux * S * 0.5);
    ctx.closePath(); ctx.fill();
  }
  // Polylinie segmentweise nach dem lokalen kerf (p.k) einfärben. `dy` = Y-Versatz,
  // lo/hi = Wertebereich der Skala, width = Linienbreite.
  function polyKerf(ctx, V, pts, dy, lo, hi, width) {
    const span = (hi - lo) || 1;
    ctx.lineWidth = width; ctx.setLineDash([]);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const kv = a.k != null ? a.k : (b.k != null ? b.k : lo);
      ctx.strokeStyle = kerfColor((kv - lo) / span);
      ctx.beginPath();
      ctx.moveTo(V.X(a.x), V.Y(a.y + dy));
      ctx.lineTo(V.X(b.x), V.Y(b.y + dy));
      ctx.stroke();
    }
  }
  // ---------- Abbrandlinie in wahrer Dicke --------------------------------
  /* Band unter einer Abbrandlinie (Drahtmitte), so breit wie der volle Schnitt-
   * spalt k im aktuellen Zoom: es reicht von der Sollkontur (Mitte − k/2) bis k/2
   * in den Abfall — genau das Material, das der Draht wegschmilzt. Schalter und
   * Deckkraft JE DESIGNEBENE in App.KTRUE (Schalter der Ansicht / Einstellungen →
   * Farben); die Ebene kommt aus opt.view, sonst aus dem aktiven Reiter.
   *   V     : Abbildung { s (px je mm), X(x), Y(y) } wie makeView
   *   paths : Liste von Bahnen; je Bahn ein Punkt-Array ({x,y,k?} oder [x,y]) oder
   *           { pts, k, kk, dx, dy, close } — k = Rückfall-Spalt (mm), kk = Spalt
   *           je Punkt, dx/dy = Versatz in mm (sonst opt.dx/opt.dy)
   *   opt   : { view, k (Rückfall, mm), dx, dy, close, color, alpha (Faktor), heat {lo,hi} }
   * Spalt je Punkt: kk[i], sonst p.k (HotWire.offsetPath/negShellOffset setzen den
   * lokalen VOLLEN Spalt), sonst k. Alle Bahnen eines Aufrufs werden offscreen
   * deckend gemalt und gemeinsam mit der Deckkraft übertragen — Stöße, runde
   * Enden und Teilzüge färben sich so nicht dunkler. Rückgabe: true = gezeichnet. */
  let kbCv = null;
  function kerfBand(ctx, V, paths, opt) {
    const o = opt || {}, view = o.view || App.kerfView();
    if (!App.kerfTrueOn(view) || !paths || !V || !(V.s > 0)) return false;
    const cv = ctx.canvas;
    if (!kbCv) kbCv = document.createElement('canvas');
    if (kbCv.width !== cv.width || kbCv.height !== cv.height) { kbCv.width = cv.width; kbCv.height = cv.height; }
    const c2 = kbCv.getContext('2d');
    c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, kbCv.width, kbCv.height);
    c2.setTransform(ctx.getTransform());
    c2.lineCap = 'round'; c2.lineJoin = 'round'; c2.setLineDash([]);
    const span = o.heat ? ((o.heat.hi - o.heat.lo) || 1) : 1;
    let drawn = false;
    paths.forEach(path => {
      const pts = Array.isArray(path) ? path : (path && path.pts);
      if (!pts || pts.length < 2) return;
      const kk = path.kk || null, k0 = (path.k != null) ? path.k : (o.k || 0);
      const dx = path.dx != null ? path.dx : (o.dx || 0), dy = path.dy != null ? path.dy : (o.dy || 0);
      const arr = Array.isArray(pts[0]);
      const gx = arr ? (p => p[0] + dx) : (p => p.x + dx), gy = arr ? (p => p[1]) : (p => p.y);
      const kOf = i => { const v = kk ? kk[i] : (arr ? null : pts[i].k); return (v != null && isFinite(v)) ? Math.abs(v) : k0; };
      const n = pts.length, m = (o.close || path.close) ? n : n - 1;
      // Aufeinanderfolgende Kanten mit (fast) gleicher Breite/Farbe als EIN Pfad.
      let run = null;
      const flush = () => { if (run) { c2.lineWidth = run.w; c2.strokeStyle = run.c; c2.stroke(); run = null; } };
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % n, kv = (kOf(i) + kOf(j)) / 2;
        if (!(kv > 0)) { flush(); continue; }
        const w = Math.max(0.5, Math.round(kv * V.s * 4) / 4);
        const c = o.heat ? kerfColor(Math.round((kv - o.heat.lo) / span * 23) / 23) : (o.color || App.PAL.kerf);
        const a = pts[i], b = pts[j];
        if (!run || run.w !== w || run.c !== c) {
          flush(); run = { w, c };
          c2.beginPath(); c2.moveTo(V.X(gx(a)), V.Y(gy(a) + dy));
        }
        c2.lineTo(V.X(gx(b)), V.Y(gy(b) + dy));
        drawn = true;
      }
      flush();
    });
    if (drawn) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.max(0.05, Math.min(1, App.kerfTrueAlpha(view))) * (o.alpha != null ? o.alpha : 1);
      ctx.drawImage(kbCv, 0, 0);
      ctx.restore();
    }
    return drawn;
  }
  // Schalter/Deckkraft „wahre Dicke" einer Designebene ändern: speichern, deren
  // Schalter angleichen und — ist die Ebene gerade sichtbar — neu zeichnen.
  function kerfTrueSet(view, on, alpha) {
    const KT = App.KTRUE[view]; if (!KT) return;
    if (on != null) KT.on = !!on;
    if (alpha != null && isFinite(alpha)) KT.alpha = Math.max(0.05, Math.min(1, alpha));
    App.saveKerfTrue();
    document.querySelectorAll('input[data-ktrue="' + view + '"]').forEach(cb => { cb.checked = KT.on; });
    if (App.kerfView() !== view) return;
    // Reine Anzeige -> nur neu zeichnen, nichts neu berechnen (Deckkraft-Regler!).
    const tab = state.activeTab;
    try {
      if (tab === 'neg') renderNeg();
      else if (tab === 'dxf') { if (App.renderDxf) App.renderDxf(); }
      else if (tab === 'model') { if (window.Model3D) Model3D.draw(); }
      else if (tab === 'schrift') { if (window.Schrift) Schrift.draw(); }
      else { applyView(); draw(); }
    } catch (e) { render(); }
  }
  // Legendenzeile einer Abbrandlinie: bei „wahrer Dicke" mit Band-Probe darunter.
  function kerfLeg(row, view) {
    return App.kerfTrueOn(view) ? Object.assign(row, { band: App.kerfTrueAlpha(view) }) : row;
  }
  // Kleiner Farbverlauf-Balken (Legende) links unten mit min/max-Beschriftung.
  function kerfColorbar(ctx, x, y, lo, hi) {
    const w = 90, h = 8, N = 24;
    for (let i = 0; i < N; i++) {
      ctx.fillStyle = kerfColor(i / (N - 1));
      ctx.fillRect(x + i * w / N, y, w / N + 1, h);
    }
    ctx.fillStyle = '#8b98a8'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(lo.toFixed(2), x, y - 3);
    ctx.fillText(hi.toFixed(2) + ' mm', x + w - 34, y - 3);
  }

  // ---------- Legenden mit echter Linienprobe --------------------------
  /* Jede Legendenzeile zeigt eine Probe in GENAU der Farbe und dem Strichmuster,
   * mit dem das Element gerade gezeichnet wurde (Palette je Ansicht + Strichtyp
   * aus den Einstellungen) — statt fester Textsymbole wie „—"/„--". Zeilen
   * werden nur dann eingetragen, wenn das Element auch wirklich gezeichnet ist
   * (gleiche Bedingung wie beim Zeichnen).
   *   L(color, text, dash, kind, width)  kind: 'line' (Standard), 'rect'
   *   (Block/Fläche; Füllung über .f), 'dot' (Punkt), 'grad' (Farbverlauf der
   *   Abbrand-Heatmap), 'text' (nur Hinweis, keine Probe).
   *   Alte [color, text]-Paare gelten als 'text'.
   * drawLegend(ctx, x, y, rows, opt): opt.top = y ist Oberkante (sonst
   * Unterkante der letzten Zeile), opt.kheat = {lo,hi} zeichnet den Farbbalken. */
  function L(c, t, d, k, w) { return { c, t, d: d || [], k: k || 'line', w: w || 1.8 }; }
  function drawLegend(ctx, x, y, rows, opt) {
    opt = opt || {};
    const rowH = 15, sw = 22, gap = 8;
    rows = rows.map(r => Array.isArray(r) ? { c: r[0], t: r[1], k: 'text' } : r);
    if (!rows.length) return;
    if (!opt.top) y -= (rows.length - 1) * rowH;
    if (opt.kheat) { kerfColorbar(ctx, x, y - 18, opt.kheat.lo, opt.kheat.hi); y += 4; }
    ctx.save();
    ctx.font = '11px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    rows.forEach(r => {
      const ym = y - 4;
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      // Abbrandlinie in wahrer Dicke: Band-Probe unter der Linie (kerfLeg).
      if (r.band) {
        ctx.globalAlpha = r.band;
        if (r.k === 'grad') for (let i = 0; i < 12; i++) { ctx.fillStyle = kerfColor(i / 11); ctx.fillRect(x + i * sw / 12, ym - 4, sw / 12 + 1, 8); }
        else { ctx.fillStyle = r.c; ctx.fillRect(x, ym - 4, sw, 8); }
        ctx.globalAlpha = 1;
      }
      if (r.k === 'line') {
        ctx.strokeStyle = r.c; ctx.lineWidth = r.w; ctx.setLineDash(r.d);
        ctx.beginPath(); ctx.moveTo(x, ym); ctx.lineTo(x + sw, ym); ctx.stroke();
      } else if (r.k === 'rect') {
        ctx.strokeStyle = r.c; ctx.lineWidth = 1.2; ctx.setLineDash(r.d);
        ctx.fillStyle = r.f || 'rgba(220,235,255,.05)';
        ctx.beginPath(); ctx.rect(x + 0.5, ym - 4.5, sw - 1, 9); ctx.fill(); ctx.stroke();
      } else if (r.k === 'dot') {
        ctx.fillStyle = r.c; ctx.beginPath(); ctx.arc(x + sw / 2, ym, 3.5, 0, 2 * Math.PI); ctx.fill();
      } else if (r.k === 'grad') {
        for (let i = 0; i < 12; i++) { ctx.fillStyle = kerfColor(i / 11); ctx.fillRect(x + i * sw / 12, ym - 1.5, sw / 12 + 1, 3); }
      }
      ctx.setLineDash([]);
      ctx.fillStyle = r.tc || r.c || '#8b98a8'; ctx.fillText(r.t, x + sw + gap, y);
      y += rowH;
    });
    ctx.restore();
  }

  // ---------- Canvas-Helfer -------------------------------------------
  function fitCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }
  function makeView(w, h, b, pad, n) {
    pad = pad || 45;
    const bw = b.maxx - b.minx || 1, bh = b.maxy - b.miny || 1;
    const s0 = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
    const ox0 = (w - s0 * bw) / 2 - s0 * b.minx, oy0 = (h - s0 * bh) / 2 - s0 * b.miny;
    const z = n ? n.z : 1, nx = n ? n.ox : 0, ny = n ? n.oy : 0;
    return {
      s: s0 * z,
      X: x => nx + z * (ox0 + s0 * x),
      Y: y => ny + z * (h - (oy0 + s0 * y)),
      inv: (px, py) => ({ x: (((px - nx) / z) - ox0) / s0, y: ((h - ((py - ny) / z)) - oy0) / s0 })
    };
  }
  function bounds() {
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (let k = 0; k < arguments.length; k++) {
      const arr = arguments[k]; if (!arr) continue;
      for (const p of arr) {
        if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
      }
    }
    return { minx, miny, maxx, maxy };
  }
  function poly(ctx, V, pts, close) {
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y)));
    if (close) ctx.closePath();
  }
  function grid(ctx, w, h, V) {
    ctx.save(); ctx.strokeStyle = App.PAL.grid; ctx.lineWidth = 1; ctx.setLineDash(dashFor('grid', []));
    const step = niceStep(100 / V.s);
    const wb = V.inv(0, 0), we = V.inv(w, h);
    for (let x = Math.floor(wb.x / step) * step; x < we.x; x += step) { const px = V.X(x); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); }
    for (let y = Math.floor(we.y / step) * step; y < wb.y; y += step) { const py = V.Y(y); ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke(); }
    ctx.restore();
  }
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))); const f = x / p; return (f < 2 ? 2 : f < 5 ? 5 : 10) * p; }
  const SEGCOL = ['#4aa3ff', '#ffb454', '#57d38c', '#c78bff', '#ff6b6b', '#3ad2c9'];
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function rect(x0, y0, x1, y1) { return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]; }
  /* Blockverlängerungen für ein Segment. Rückgabe in mm:
   *   leR/teR = Verlängerung vor Nase / hinter Endleiste am WURZELprofil
   *   leT/teT = dito am AUSSENprofil (absolut oder proportional zur Sehne).
   * rootChord/tipChord = Sehnen der beiden Segmentenden für den Proportionalfall. */
  function blockExt(seg, rootChord, tipChord) {
    const ratio = rootChord ? tipChord / rootChord : 1;
    return {
      leR: seg.bLE || 0,
      teR: seg.bTE || 0,
      leT: seg.bLEProp ? (seg.bLE || 0) * ratio : (seg.bLETip || 0),
      teT: seg.bTEProp ? (seg.bTE || 0) * ratio : (seg.bTETip || 0)
    };
  }
  function drawBlock(ctx, V, r, color, noFill, styleKey) {
    poly(ctx, V, r, true);
    if (!noFill) { ctx.fillStyle = 'rgba(220,235,255,.05)'; ctx.fill(); }
    ctx.strokeStyle = color || '#5d6b7d'; ctx.lineWidth = 1.2; ctx.setLineDash(dashFor(styleKey || 'block', [7, 5]));
    ctx.stroke(); ctx.setLineDash([]);
  }
  /* Bemaßung zwischen zwei Weltpunkten (a,b), rechtwinklig um `off` Bildpunkte
   * versetzt. Zeichnet Maßhilfslinien, Maßlinie mit Pfeilen und beschriftet mit
   * `label` (mm-Wert wird ergänzt, wenn label eine Zahl ist). */
  const DIM_COL = '#c9d4e0';
  function dimArrow(ctx, from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, s = 6;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - ux * s - uy * s * 0.5, to.y - uy * s + ux * s * 0.5);
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - ux * s + uy * s * 0.5, to.y - uy * s - ux * s * 0.5);
    ctx.stroke();
  }
  function dim(ctx, V, ax, ay, bx, by, label, opt) {
    opt = opt || {};
    const col = opt.color || App.PAL.dim || DIM_COL, off = opt.off == null ? 26 : opt.off;
    const A = { x: V.X(ax), y: V.Y(ay) }, B = { x: V.X(bx), y: V.Y(by) };
    let dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;                 // Bild-Normale
    const A2 = { x: A.x + nx * off, y: A.y + ny * off };
    const B2 = { x: B.x + nx * off, y: B.y + ny * off };
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath();                                     // Maßhilfslinien
    ctx.moveTo(A.x, A.y); ctx.lineTo(A2.x + nx * 4, A2.y + ny * 4);
    ctx.moveTo(B.x, B.y); ctx.lineTo(B2.x + nx * 4, B2.y + ny * 4);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(A2.x, A2.y); ctx.lineTo(B2.x, B2.y); ctx.stroke();
    dimArrow(ctx, B2, A2); dimArrow(ctx, A2, B2);
    const mx = (A2.x + B2.x) / 2, my = (A2.y + B2.y) / 2;
    ctx.font = '10px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(15,18,22,.85)'; ctx.fillRect(mx - tw / 2 - 3, my - 7, tw + 6, 13);
    ctx.fillStyle = col; ctx.fillText(label, mx, my);
    ctx.restore();
  }
  // Punktnummern der Profilpunkte: jeder n-te Punkt (state.cfg.numEvery,
  // Standard 10) bekommt Marke + Index. Der letzte Punkt wird immer beschriftet.
  function drawNums(ctx, V, pts) {
    const n = Math.max(1, Math.round(+state.cfg.numEvery || 10));
    ctx.fillStyle = '#9fb0c4'; ctx.font = '9px Segoe UI';
    for (let i = 0; i < pts.length; i += n) {
      ctx.beginPath(); ctx.arc(V.X(pts[i].x), V.Y(pts[i].y), 1.8, 0, 6.3); ctx.fill();
      ctx.fillText(i, V.X(pts[i].x) + 4, V.Y(pts[i].y) - 3);
    }
  }

  // ---------- Ansichten -----------------------------------------------
  // Grundriss: waagerecht = Spannweite, senkrecht = Sehne, Flugrichtung OBEN
  // (Nase oben) -> wir plotten -x nach oben.
  function drawPlan() {
    const { ctx, w, h } = fitCanvas(document.getElementById('cPlan'));
    ctx.clearRect(0, 0, w, h);
    const st = App.wing.stations;
    const leTe = st.map(s => {
      const xs = s.pts.map(p => p.x);
      return { z: s.z, le: Math.min.apply(null, xs), te: Math.max.apply(null, xs) };
    });
    const outline = [];
    leTe.forEach(s => outline.push({ x: s.z, y: -s.le }));
    for (let i = leTe.length - 1; i >= 0; i--) outline.push({ x: leTe[i].z, y: -leTe[i].te });
    let blocks = [];
    if (state.cfg.showBlock) {
      state.segments.forEach((s, k) => {
        const rc = leTe[k].te - leTe[k].le, tc = leTe[k + 1].te - leTe[k + 1].le;
        const e = blockExt(s, rc, tc);
        // Trapez: Innen-/Außenende folgen der jeweiligen Kontur zzgl. Verlängerung.
        blocks.push([
          { x: App.segZ[k].z0, y: -(leTe[k].le - e.leR) },
          { x: App.segZ[k].z0, y: -(leTe[k].te + e.teR) },
          { x: App.segZ[k].z1, y: -(leTe[k + 1].te + e.teT) },
          { x: App.segZ[k].z1, y: -(leTe[k + 1].le - e.leT) }
        ]);
      });
    }
    // Werkstück-Drehung (Pfeilung): den Rohblock je Segment sichtbar drehen — um
    // seinen Mittelpunkt, damit er „wie er wirklich liegt" unter dem (fest
    // gezeichneten) Tragflächen-Segment erscheint. In der Draufsicht ist die
    // Drehung um die Hochachse eine Drehung in der Zeichenebene um denselben
    // Winkel. Wirkt nur auf die Blockdarstellung.
    if (state.cfg.showBlock && state.cfg.sweepRot && window.SweepRot) {
      blocks.forEach((bpts, k) => {
        const cut = App.wing.cuts[Math.min(k, App.wing.cuts.length - 1)];
        const seg = state.segments[Math.min(k, state.segments.length - 1)];
        const sr = App.projectCut(cut, seg).sweepRot;
        if (!sr) return;
        // Der Winkel gilt im Maschinen-Koordinatensystem; liegt die Wurzel dort am
        // rechten Portal (linke Fläche, bzw. rechte Fläche „von vorne"), ist die
        // Spannweite (z) gespiegelt, die Draufsicht hier aber nicht (Wurzel immer
        // links) -> Drehsinn umkehren.
        const ang = App.rootAtRight() ? -sr.angleRad : sr.angleRad;
        const c = Math.cos(ang), s = Math.sin(ang);
        let cx = 0, cy = 0; bpts.forEach(p => { cx += p.x; cy += p.y; }); cx /= bpts.length; cy /= bpts.length;
        bpts.forEach(p => { const dx = p.x - cx, dy = p.y - cy; p.x = cx + dx * c - dy * s; p.y = cy + dx * s + dy * c; });
      });
    }
    const V = makeView(w, h, bounds.apply(null, [outline].concat(blocks)), 55, nav.plan);
    if (App.meas2dView) App.meas2dView('plan', V, [outline.concat([outline[0]])].concat(blocks));   // Messwerkzeug: Abbildung + Fanggeometrie
    grid(ctx, w, h, V);
    if (state.cfg.showBlock) blocks.forEach(b => drawBlock(ctx, V, b));
    for (let k = 0; k < leTe.length - 1; k++) {
      const a = leTe[k], b = leTe[k + 1];
      poly(ctx, V, [{ x: a.z, y: -a.le }, { x: b.z, y: -b.le }, { x: b.z, y: -b.te }, { x: a.z, y: -a.te }], true);
      const c = SEGCOL[k % SEGCOL.length];
      ctx.fillStyle = hexA(c, state.activeSeg === k ? 0.28 : 0.10);
      ctx.strokeStyle = c; ctx.lineWidth = state.activeSeg === k ? 2.5 : 1.5;
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#8b98a8'; ctx.font = '11px Segoe UI';
      ctx.fillText('S' + (k + 1), V.X((a.z + b.z) / 2) - 6, V.Y(-(a.le + a.te) / 2));
    }
    ctx.strokeStyle = '#ffffff44'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1;
    poly(ctx, V, leTe.map(s => ({ x: s.z, y: -(s.le + (s.te - s.le) * 0.25) })), false);
    ctx.stroke(); ctx.setLineDash([]);
    // Scharnierlinie im Grundriss: je Segment von der Wurzel- zur Außenlage
    // (Prozent der jeweiligen Sehne, von hinten/Endleiste gemessen).
    let anyHinge = false;
    if (state.cfg.showHingePlan) {
      const hx = (s, pct) => s.te - Math.max(0, Math.min(100, pct)) / 100 * (s.te - s.le);
      ctx.strokeStyle = App.PAL.hinge; ctx.lineWidth = 1.6; ctx.setLineDash(dashFor('hinge', [5, 4]));
      for (let k = 0; k < leTe.length - 1; k++) {
        const seg = state.segments[k]; if (!seg) continue;
        const pr = seg.hingePct, pt = seg.hingePctTip;
        if (pr == null && pt == null) continue;
        anyHinge = true;
        const yR = -hx(leTe[k], pr != null ? pr : pt);
        const yT = -hx(leTe[k + 1], pt != null ? pt : pr);
        poly(ctx, V, [{ x: leTe[k].z, y: yR }, { x: leTe[k + 1].z, y: yT }], false); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // Holmausschnitte im Grundriss: je Segment ein Band von der Wurzel- zur
    // Außenlage (Sehnen-Fußabdruck des Holms), Mittellinie gestrichelt.
    let anySpar = false, anyNonProp = false;
    const sparPick = [];   // {k, poly} in Weltkoordinaten für die Klick-Auswahl
    const xr = poly => { let mn = Infinity, mx = -Infinity; poly.forEach(p => { mn = Math.min(mn, p.x); mx = Math.max(mx, p.x); }); return { min: mn, max: mx, c: (mn + mx) / 2 }; };
    (state.spars || []).forEach((sp, si) => {
      const active = state.activeSpar === si;
      const [ra, rb] = sparRange(sp);
      for (let k = ra; k <= rb && k < leTe.length - 1; k++) {
        const rpts = st[k] && st[k].pts, tpts = st[k + 1] && st[k + 1].pts;
        if (!rpts || !tpts) continue;
        const zr = leTe[k].z, zt = leTe[k + 1].z;
        const yco = sparYc(sp);
        const gr = sparOnProfile(sp, rpts, null, sparFromLE(sp, k, 'root'), yco, 'root', App.sparCoreOf(rpts, k, 'root'));
        const gt = sparOnProfile(sp, tpts, null, sparFromLE(sp, k, 'tip'), yco, 'tip', App.sparCoreOf(tpts, k, 'tip'));
        if (!gr || !gt) continue;
        anySpar = true;
        if (!sparProportional(sp)) anyNonProp = true;
        const a = xr(gr.poly), b = xr(gt.poly);
        const band = [{ x: zr, y: -a.min }, { x: zt, y: -b.min }, { x: zt, y: -b.max }, { x: zr, y: -a.max }];
        sparPick.push({ k: si, poly: band });
        poly(ctx, V, band, true);
        ctx.fillStyle = hexA(App.PAL.spar, active ? 0.34 : 0.18); ctx.strokeStyle = App.PAL.spar;
        ctx.lineWidth = active ? 2.4 : 1.2; ctx.setLineDash(dashFor('spar', []));
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = App.PAL.spar; ctx.setLineDash(dashFor('spar', [4, 3]));
        poly(ctx, V, [{ x: zr, y: -a.c }, { x: zt, y: -b.c }], false); ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // Legende oben links: nur, was gerade gezeichnet ist, mit echter Probe.
    const legP = [['#8b98a8', T('▲ Flugrichtung')]];
    legP.push(L(SEGCOL[(state.activeSeg || 0) % SEGCOL.length], T('Segmente (aktives kräftig, Segmentfarbe)'), [], 'line', 2.5));
    if (state.cfg.showBlock) legP.push(L('#5d6b7d', T('Block (Rohling)'), dashFor('block', [7, 5]), 'rect'));
    if (anyHinge) legP.push(L(App.PAL.hinge, T('Scharnierlinie'), dashFor('hinge', [5, 4]), 'line', 1.6));
    if (anySpar) legP.push(Object.assign(L(App.PAL.spar, T('Holmausschnitt'), dashFor('spar', []), 'rect'), { f: hexA(App.PAL.spar, 0.18) }));
    legP.push(L('#ffffff44', T('Viertel-Sehnenlinie (t/4)'), [6, 4], 'line', 1));
    drawLegend(ctx, 14, 20, legP, { top: true });
    ctx.fillStyle = '#8b98a8'; ctx.font = '11px Segoe UI';
    // Warnbanner (Holmlage/Tasche nicht proportional) -> im Profil-Ansichtsfenster (drawSparWarnings).
    leTe.forEach(s => ctx.fillText(Math.round(s.z) + 'mm', V.X(s.z) - 10, V.Y(-s.le) - 6));

    // Transformation & Segmentgrenzen für die Klick-Auswahl merken.
    planPick = { inv: V.inv, segZ: App.segZ.slice(), spars: sparPick };

    // Bemaßung des aktiven Segments: nur Profillängen (innen/außen), Spannweite
    // und Rückpfeilung (LE-Versatz). Keine Block-/Überstandmaße.
    if (state.cfg.showDim) {
      const mm = v => String(Math.round(v));
      // Bemaßung eines Segments: nur Zahlen (ohne Text). `inner` steuert, ob die
      // Innen-Sehne mitbemaßt wird (bei Folgesegmenten = geteilte Außen-Sehne des
      // Vorsegments, daher nur einmal).
      const dimSeg = (k, inner) => {
        const a = leTe[k], b = leTe[k + 1];
        if (inner) dim(ctx, V, a.z, -a.le, a.z, -a.te, mm(a.te - a.le), { off: -30 });
        dim(ctx, V, b.z, -b.le, b.z, -b.te, mm(b.te - b.le), { off: 30 });
        if (Math.abs(b.le - a.le) > 0.01)
          dim(ctx, V, b.z, -a.le, b.z, -b.le, mm(b.le - a.le), { off: -58, color: '#ffb454' });
        const yBase = -(Math.max(a.te, b.te));
        dim(ctx, V, a.z, yBase, b.z, yBase, mm(b.z - a.z), { off: 34, color: '#57d38c' });
      };
      if (state.activeTab === 'wing') {
        // Tragflächendesigner: alle Segmente bemaßen.
        for (let k = 0; k < leTe.length - 1; k++) dimSeg(k, k === 0);
      } else {
        dimSeg(Math.min(App.activeIdx(), leTe.length - 2), true);
      }
    }
  }

  // Aufriss: waagerecht = Spannweite, senkrecht = Höhe (V-Form)
  function drawElev() {
    const { ctx, w, h } = fitCanvas(document.getElementById('cElev'));
    ctx.clearRect(0, 0, w, h);
    // Geometrie je Segment direkt aus dem Schnitt-Paneel (datum-relativ, gleiche
    // Höhenbasis wie die Blöcke). Dadurch erscheinen der reine Wurzel-Versatz
    // (dihRoot) und die durchgezogene V-Form korrekt — inkl. Stufe an der
    // Stoßstelle, wenn die Wurzel eines Segments nicht bündig anschließt.
    const G = state.segments.map((s, k) => {
      const c = App.wing.cuts[Math.min(k, App.wing.cuts.length - 1)];
      const ry = c.root.pts.map(p => p.y), ty = c.tip.pts.map(p => p.y);
      const rTop = Math.max.apply(null, ry), rBot = Math.min.apply(null, ry);
      const tTop = Math.max.apply(null, ty), tBot = Math.min.apply(null, ty);
      return { z0: App.segZ[k].z0, z1: App.segZ[k].z1, rTop, rBot, tTop, tBot,
               rMid: (rTop + rBot) / 2, tMid: (tTop + tBot) / 2 };
    });
    const panels = G.map(g => [
      { x: g.z0, y: g.rTop }, { x: g.z1, y: g.tTop },
      { x: g.z1, y: g.tBot }, { x: g.z0, y: g.rBot }
    ]);
    let blocks = [];
    if (state.cfg.showBlock) {
      const bh = App.blockH('wing');
      state.segments.forEach((s, k) => {
        // Blöcke liegen IMMER auf gleicher Höhe (festes Datum 0). Das Paneel
        // klettert/sitzt relativ dazu — der Block wandert NICHT mit.
        blocks.push([
          { x: App.segZ[k].z0, y: bh / 2 }, { x: App.segZ[k].z1, y: bh / 2 },
          { x: App.segZ[k].z1, y: -bh / 2 }, { x: App.segZ[k].z0, y: -bh / 2 }
        ]);
      });
    }
    const V = makeView(w, h, bounds.apply(null, panels.concat(blocks)), 55, nav.elev);
    grid(ctx, w, h, V);
    if (state.cfg.showBlock) blocks.forEach(b => drawBlock(ctx, V, b));
    panels.forEach((p, k) => {
      poly(ctx, V, p, true);
      const c = SEGCOL[k % SEGCOL.length];
      ctx.fillStyle = hexA(c, state.activeSeg === k ? 0.28 : 0.10);
      ctx.strokeStyle = c; ctx.lineWidth = state.activeSeg === k ? 2.5 : 1.5;
      ctx.fill(); ctx.stroke();
    });
    // Profilsehnen-Linie (V-Form) je Segment (mit Stufe bei Wurzel-Versatz)
    ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    G.forEach(g => { poly(ctx, V, [{ x: g.z0, y: g.rMid }, { x: g.z1, y: g.tMid }], false); ctx.stroke(); });
    ctx.setLineDash([]);
    // Holme im Aufriss: senkrechte Ausdehnung (Ober-/Unterkante der Tasche) je
    // Rippe, als Band über den Segmentbereich; Mittellinie gestrichelt.
    const yExt = pl => { let mn = Infinity, mx = -Infinity; pl.forEach(p => { mn = Math.min(mn, p.y); mx = Math.max(mx, p.y); }); return { mn, mx, c: (mn + mx) / 2 }; };
    let anySparE = false;
    (state.spars || []).forEach(sp => {
      const [ra, rb] = sparRange(sp);
      for (let k = ra; k <= rb && k < G.length; k++) {
        const c = App.wing.cuts[Math.min(k, App.wing.cuts.length - 1)];
        const yco = sparYc(sp);
        const gr = sparOnProfile(sp, c.root.pts, null, sparFromLE(sp, k, 'root'), yco, 'root', App.sparCoreOf(c.root.pts, k, 'root'));
        const gt = sparOnProfile(sp, c.tip.pts, null, sparFromLE(sp, k, 'tip'), yco, 'tip', App.sparCoreOf(c.tip.pts, k, 'tip'));
        if (!gr || !gt) continue;
        const pr_ = sparPolys(gr), pt_ = sparPolys(gt), z0 = App.segZ[k].z0, z1 = App.segZ[k].z1;
        // Je Taschenseite (oben/unten) ein eigenes Band — sonst fehlt die untere Tasche.
        for (let q = 0; q < Math.min(pr_.length, pt_.length); q++) {
          anySparE = true;
          const a = yExt(pr_[q]), b = yExt(pt_[q]);
          poly(ctx, V, [{ x: z0, y: a.mx }, { x: z1, y: b.mx }, { x: z1, y: b.mn }, { x: z0, y: a.mn }], true);
          ctx.fillStyle = hexA(App.PAL.spar, 0.18); ctx.strokeStyle = App.PAL.spar; ctx.lineWidth = 1.2; ctx.setLineDash(dashFor('spar', []));
          ctx.fill(); ctx.stroke();
          ctx.strokeStyle = App.PAL.spar; ctx.setLineDash(dashFor('spar', [4, 3]));
          poly(ctx, V, [{ x: z0, y: a.c }, { x: z1, y: b.c }], false); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    });
    ctx.fillStyle = '#8b98a8'; ctx.font = '11px Segoe UI';
    G.forEach((g, k) => {
      // Höhenangabe = kumulierte V-Form-Höhe der Profilsehne am Außenende
      // (wing.stations[k+1].yRise). Diese entspricht exakt den eingetragenen
      // Werten; das frühere g.tMid (Dickenmitte des Paneels) wich je nach
      // Profil/Sehne um ~1 mm ab.
      ctx.fillText('+' + Math.round(App.wing.stations[k + 1].yRise) + 'mm / ' + (App.wing.stations[k + 1].dihAngle || 0).toFixed(1) + '°',
        V.X(g.z1) - 24, V.Y(g.tTop) - 8);
    });
    // Bemaßung: von den drei gewünschten Maßen liegt im Aufriss nur die
    // Spannweite in der Zeichenebene (Sehne/Rückpfeilung stehen senkrecht dazu).
    if (state.cfg.showDim && G.length) {
      const mm = v => String(Math.round(v));
      const yBase = Math.min.apply(null, panels.reduce((a, p) => a.concat(p), []).map(p => p.y));
      const dimSeg = k => dim(ctx, V, G[k].z0, yBase, G[k].z1, yBase, mm(G[k].z1 - G[k].z0),
          { off: 34, color: '#57d38c' });
      if (state.activeTab === 'wing') {
        for (let k = 0; k < G.length; k++) dimSeg(k);
      } else {
        dimSeg(Math.min(App.activeIdx(), G.length - 1));
      }
    }
    const legE = [['#8b98a8', T('Aufriss (V-Form)')]];
    legE.push(L(SEGCOL[(state.activeSeg || 0) % SEGCOL.length], T('Segmente (aktives kräftig, Segmentfarbe)'), [], 'line', 2.5));
    if (state.cfg.showBlock) legE.push(L('#5d6b7d', T('Block (Rohling)'), dashFor('block', [7, 5]), 'rect'));
    legE.push(L('#ffffff88', T('Profilsehne (V-Form-Verlauf)'), [5, 4], 'line', 1.5));
    if (anySparE) legE.push(Object.assign(L(App.PAL.spar, T('Holmausschnitt'), dashFor('spar', []), 'rect'), { f: hexA(App.PAL.spar, 0.18) }));
    drawLegend(ctx, 14, 20, legE, { top: true });
  }

  // Profile: alle Stationen + optional Beplankung, Schnittspur, Nummern, Block
  function shift(pts, dy) { return dy ? pts.map(p => ({ x: p.x, y: p.y + dy })) : pts; }

  // ---------- Profilvergleich Drehung (Original vs. verzerrt) ----------
  // Liefert je Rippe das Original-Profil (Design-Rippe) und das durch die
  // Drehung VERZERRTE Führungsebenen-Profil (was der Draht am jeweiligen Turm
  // real abfährt). Beide aus der SAUBEREN Kernkontur (ohne Verlängerungen/Steg).
  function sweepCmpProfiles(cut, pr) {
    const rot = pr && pr.sweepRot; if (!rot) return null;
    const mw = state.cfg.machineWidth, zR = pr.zRoot, zT = pr.zTip;
    const rc = pr.rootCore || cut.root.pts, tc = pr.tipCore || cut.tip.pts;
    const n = Math.min(rc.length, tc.length);
    // Verzerrtes Profil = Schnitt des (gedrehten) Draht-Regelflächen-Verbands mit
    // der MASCHINEN-Ebene an der jeweiligen Rippe (z=zRoot bzw. z=zTip). Das ist
    // der schräg zur Spannweite liegende Schnitt, den man am Werkstück in
    // Fahrrichtung sieht — gegenüber dem konstruierten (spannweiten-senkrechten)
    // Original gestreckt/geschert.
    const distAt = zp => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const R = SweepRot.rotXZ(rc[i].x, zR, rot.angleRad, rot.pivot.x, rot.pivot.z);
        const T = SweepRot.rotXZ(tc[i].x, zT, rot.angleRad, rot.pivot.x, rot.pivot.z);
        R.z += rot.dz || 0; T.z += rot.dz || 0;
        const s = (T.z - R.z) || 1, t = (zp - R.z) / s;
        out.push({ x: R.x + t * (T.x - R.x), y: rc[i].y + t * (tc[i].y - rc[i].y) });
      }
      return out;
    };
    return {
      root: { orig: rc.map(p => ({ x: p.x, y: p.y })), dist: distAt(zR) },
      tip:  { orig: tc.map(p => ({ x: p.x, y: p.y })), dist: distAt(zT) }
    };
  }
  // Kontur auf ihre SEHNE legen: Nasenleiste (min-x-Punkt) in den Ursprung,
  // Sehne (LE→Endleisten-Mitte) entlang +x gedreht, dann mit S skaliert. So
  // liegen Original und verzerrt auf derselben Sehnenlinie übereinander; die
  // Längendifferenz (Stauchung) wird bei gemeinsamem S sichtbar.
  function chordAlign(pts, S) {
    if (!pts || !pts.length) return [];
    const le = pts.reduce((a, p) => (p.x < a.x ? p : a), pts[0]);
    const te = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
    const dx = te.x - le.x, dy = te.y - le.y, L = Math.hypot(dx, dy) || 1;
    const c = dx / L, s = dy / L;                 // Sehnenrichtung
    return pts.map(p => { const ux = p.x - le.x, uy = p.y - le.y; return { x: (ux * c + uy * s) * S, y: (-ux * s + uy * c) * S }; });
  }
  // Sehne (max−min x) und max. Dicke (max−min y) einer Kontur (Bounding-Box).
  function cmpBBox(pts) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    return { chord: x1 - x0, thick: y1 - y0, x0, x1, y0, y1 };
  }
  // Zoom/Pan-Zustand je Vergleichs-Canvas.
  const sweepCmpView = { cSweepCmpRoot: { z: 1, ox: 0, oy: 0 }, cSweepCmpTip: { z: 1, ox: 0, oy: 0 } };
  // Zwei Konturen chord-normiert überlagern (LE links, gleiche Skala je Kontur)
  // -> sichtbar wird die Formverzerrung (Dicken-/Wölbungsänderung). Zusätzlich
  // Kennzahlen (Sehnenstreckung, Dickenverhältnis) in infoEl. Zoom/Pan über view.
  function drawCmpCanvas(cv, orig, dist, infoEl) {
    if (!cv) return;
    const view = sweepCmpView[cv.id] || { z: 1, ox: 0, oy: 0 };
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 300, H = cv.clientHeight || 260;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const mo = cmpBBox(orig), md = cmpBBox(dist);
    // Beide Konturen auf DIESELBE Sehnenlinie legen (LE im Ursprung, Sehne entlang
    // +x) und mit GEMEINSAMEM Maßstab (aus der Original-Sehne) skalieren -> das
    // verzerrte Profil erscheint sichtbar kürzer/länger, direkt überlagert.
    const S = 1 / (mo.chord || 1);
    const no = chordAlign(orig, S), nd = chordAlign(dist, S);
    // gemeinsamer View: Bounding-Box beider Konturen
    let xmn = Infinity, xmx = -Infinity, yMax = 0;
    [...no, ...nd].forEach(p => { if (p.x < xmn) xmn = p.x; if (p.x > xmx) xmx = p.x; if (Math.abs(p.y) > yMax) yMax = Math.abs(p.y); });
    const spanX = (xmx - xmn) || 1;
    const pad = 26;
    const sx = (W - 2 * pad) / (spanX * 1.05), sy = (H - 2 * pad) / (2 * yMax * 1.3 || 1);
    const sc = Math.min(sx, sy);
    // Basis-Abbildung + Nutzer-Zoom/Pan: screen = ox + z * base(pt).
    const baseX = x => pad + (x - xmn + spanX * 0.025) * sc;
    const baseY = y => H / 2 - y * sc;
    const X = x => view.ox + view.z * baseX(x);
    const Y = y => view.oy + view.z * baseY(y);
    // Basisabbildung für Handler (Zoom am Cursor) merken.
    cv._cmpBase = { baseX, baseY };
    const line = (pts, col, dash) => {
      ctx.beginPath(); ctx.setLineDash(dash || []); ctx.lineWidth = 1.8; ctx.strokeStyle = col;
      pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    };
    // Sehnenlinie (LE=0 bis Original-Sehne=1)
    ctx.strokeStyle = 'rgba(150,160,175,.3)'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(0)); ctx.stroke();
    line(no, '#4aa3ff', []);           // Original
    line(nd, '#ffb454', [6, 4]);       // Verzerrt
    // Legende
    ctx.font = '12px Segoe UI'; ctx.textAlign = 'left';
    ctx.fillStyle = '#4aa3ff'; ctx.fillText(T('— Original'), 10, 16);
    ctx.fillStyle = '#ffb454'; ctx.fillText(T('– – verzerrt (Drehung)'), 10, 32);
    if (infoEl) {
      const stretch = mo.chord ? md.chord / mo.chord : 1;
      const tcOrig = mo.chord ? mo.thick / mo.chord : 0;
      const tcDist = md.chord ? md.thick / md.chord : 0;
      infoEl.textContent =
        T('Sehne') + ': ' + mo.chord.toFixed(1) + ' → ' + md.chord.toFixed(1) + ' mm ('
        + (stretch >= 1 ? '×' : '×') + stretch.toFixed(3) + ')  ·  '
        + T('Dicke/Sehne') + ': ' + (tcOrig * 100).toFixed(1) + '% → ' + (tcDist * 100).toFixed(1) + '%';
    }
  }
  let sweepCmpOpen = false;
  function renderSweepCmp() {
    if (!sweepCmpOpen) return;
    const hintEl = document.getElementById('sweepCmpHint');
    if (!state.cfg.sweepRot) { if (hintEl) hintEl.textContent = T('Werkstück-Drehung ist nicht aktiv.'); return; }
    const cut = App.activeCut(), seg = state.segments[App.activeIdx()];
    const pr = App.projectCut(cut, seg);
    const cmp = sweepCmpProfiles(cut, pr);
    if (!cmp) { if (hintEl) hintEl.textContent = T('Keine Drehung angewandt (Winkel ≈ 0).'); return; }
    if (hintEl) hintEl.textContent =
      T('Segment') + ' ' + (App.activeIdx() + 1) + ' · ' + T('Drehwinkel') + ' ' + (Math.round(pr.sweepRot.angleDeg * 10) / 10) + '°. '
      + T('Blau = konstruiertes Profil, Orange = was der Draht an der Führungsebene abfährt (chord-normiert überlagert). Das fertige Werkstück (Schnitt senkrecht zur Spannweite) bleibt das Original.');
    drawCmpCanvas(document.getElementById('cSweepCmpRoot'), cmp.root.orig, cmp.root.dist, document.getElementById('sweepCmpRootInfo'));
    drawCmpCanvas(document.getElementById('cSweepCmpTip'),  cmp.tip.orig,  cmp.tip.dist,  document.getElementById('sweepCmpTipInfo'));
  }
  function openSweepCmp() {
    const m = document.getElementById('sweepCmpModal'); if (!m) return;
    sweepCmpOpen = true; m.classList.add('open'); renderSweepCmp();
    // Nach dem Layout erneut zeichnen (Canvas-Maße stehen ggf. erst dann).
    requestAnimationFrame(renderSweepCmp);
  }
  function closeSweepCmp() {
    const m = document.getElementById('sweepCmpModal'); if (m) m.classList.remove('open');
    sweepCmpOpen = false;
  }
  // Die verglichenen Profile (Original + verzerrt, Wurzel + Rand) als DXF
  // exportieren — in echten mm, jede Kontur auf eigenem farbigem Layer. Wurzel
  // und Rand werden vertikal getrennt platziert, damit sie sich nicht überlagern.
  async function exportSweepCmpDxf() {
    if (!(state.cfg.sweepRot && window.SweepRot && window.Dxf)) { toast(T('Drehung nicht aktiv.')); return; }
    const cut = App.activeCut(), seg = state.segments[App.activeIdx()];
    const pr = App.projectCut(cut, seg);
    const cmp = sweepCmpProfiles(cut, pr);
    if (!cmp) { toast(T('Keine Drehung angewandt (Winkel ≈ 0).')); return; }
    // Original UND verzerrt je Rippe auf DIESELBE Sehnenlinie legen (LE im
    // Ursprung, Sehne entlang +x), in echten mm (S=1). Wurzel und Rand werden
    // vertikal getrennt, damit sich die beiden Rippen nicht überlagern.
    const rootO = chordAlign(cmp.root.orig, 1), rootD = chordAlign(cmp.root.dist, 1);
    const tipO = chordAlign(cmp.tip.orig, 1), tipD = chordAlign(cmp.tip.dist, 1);
    const thickOf = a => { let lo = Infinity, hi = -Infinity; a.forEach(p => { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; }); return hi - lo; };
    const off = Math.max(thickOf(rootO), thickOf(rootD), thickOf(tipO), thickOf(tipD), 10) * 1.6 + 20;   // Rand unter Wurzel
    const shift = (pts, d) => pts.map(p => ({ x: p.x, y: p.y - d }));
    const seg1 = App.activeIdx() + 1;
    const ang = Math.round((pr.sweepRot.angleDeg || 0) * 10) / 10;
    const layers = [
      { name: 'Wurzel_Original_S' + seg1, color: 5, polys: [{ pts: rootO, closed: true }] },
      { name: 'Wurzel_verzerrt_' + ang + 'deg', color: 2, polys: [{ pts: rootD, closed: true }] },
      { name: 'Rand_Original_S' + seg1, color: 5, polys: [{ pts: shift(tipO, off), closed: true }] },
      { name: 'Rand_verzerrt_' + ang + 'deg', color: 2, polys: [{ pts: shift(tipD, off), closed: true }] }
    ];
    const text = Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 4 });
    await exportViaPicker('profilvergleich-drehung-S' + seg1 + '.dxf', text, 'application/dxf', 'save');
  }
  // Zoom (Mausrad, am Cursor) + Pan (Ziehen) + Reset (Doppelklick) je Canvas.
  function setupSweepCmpNav(id) {
    const cv = document.getElementById(id); if (!cv) return;
    const view = sweepCmpView[id];
    const pos = ev => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    cv.addEventListener('wheel', ev => {
      ev.preventDefault();
      const p = pos(ev);
      const f = Math.exp(-ev.deltaY * 0.0015);          // sanft
      const z2 = Math.max(0.3, Math.min(40, view.z * f));
      // Weltpunkt unter dem Cursor festhalten.
      view.ox = p.x - (z2 / view.z) * (p.x - view.ox);
      view.oy = p.y - (z2 / view.z) * (p.y - view.oy);
      view.z = z2;
      renderSweepCmp();
    }, { passive: false });
    let drag = null;
    cv.addEventListener('mousedown', ev => { drag = { x: ev.clientX, y: ev.clientY, ox: view.ox, oy: view.oy }; cv.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', ev => {
      if (!drag) return;
      view.ox = drag.ox + (ev.clientX - drag.x);
      view.oy = drag.oy + (ev.clientY - drag.y);
      renderSweepCmp();
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; cv.style.cursor = 'grab'; } });
    cv.addEventListener('dblclick', ev => { ev.preventDefault(); view.z = 1; view.ox = 0; view.oy = 0; renderSweepCmp(); });
  }
  // Kennwerte der Werkstück-Drehung in die Seitenleiste schreiben (falls aktiv).
  function updateSweepRotInfo(pr) {
    const el = document.getElementById('sweepRotInfo');
    if (!el) return;
    const i = pr && pr.sweepRot;
    if (!i) { el.textContent = T('Keine Drehung angewandt.'); return; }
    const f = v => (Math.round(v * 10) / 10);
    el.textContent = T('Drehwinkel') + ': ' + f(i.angleDeg) + '°  ·  '
      + T('X-Fahrweg') + ': ' + f(i.travelBefore) + ' → ' + f(i.travelAfter) + ' mm  ('
      + (i.saved >= 0 ? '−' : '+') + f(Math.abs(i.saved)) + ' mm)';
  }
  function drawProfiles() {
    const { ctx, w, h } = fitCanvas(document.getElementById('cProf'));
    ctx.clearRect(0, 0, w, h);
    const idx = App.activeIdx();
    const cut = App.activeCut();
    const s = state.segments[idx];
    const pr = App.projectCut(cut, s);
    const sheetOn = App.sheetActive(App.sheetFor(s));   // Beplankung an DIESEM Segment aktiv?
    updateSweepRotInfo(pr);
    // Profile GENAU wie im Werkstück: Innen- (Wurzel) und Außenprofil (Rand) aus
    // demselben Schnitt-Paneel (wing.cuts). Beide Konturen UND ihre Schnittspur/
    // Kernkontur stammen aus derselben Quelle -> kein künstlicher Höhenversatz.
    // Die V-Form steckt bereits als Höhenversatz im Paneel (Wurzel −rise/2,
    // Außen +rise/2), der Block liegt waagrecht darum.
    const rootPts = cut.root.pts, tipPts = cut.tip.pts;
    const xs = rootPts.map(p => p.x), ys = rootPts.map(p => p.y);
    const xt = tipPts.map(p => p.x), yt = tipPts.map(p => p.y);
    const leX = Math.min.apply(null, xs), teX = Math.max.apply(null, xs);
    const leXt = Math.min.apply(null, xt), teXt = Math.max.apply(null, xt);
    const e = blockExt(s, cut.root.chord, cut.tip.chord);
    const cyR = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    const cyT = (Math.min.apply(null, yt) + Math.max.apply(null, yt)) / 2;
    const bh = App.blockH('wing');
    // Block-Mitte = festes Datum (0). Die kumulierte V-Form steckt bereits in
    // den Schnittpunkten.
    const cy = blockCenterY(cut);
    // Anzeige-Versatz: „V-Form (Einbaulage)" AN -> Profile auf ihrer echten
    // Höhe. AUS -> beide auf die Blockmitte zentriert (flache Überlagerung).
    const dh = state.cfg.showDihedral;
    const dyR = dh ? 0 : cy - cyR, dyT = dh ? 0 : cy - cyT;

    // Im „Tragflächendesigner" (wing) zeigen wir nur die Tragfläche inkl.
    // Beplankung und die Scharnierlinie. Block, Schnittspur (kerf),
    // Punktnummern und Bemaßung sind Fertigungshilfen und bleiben dem
    // Reiter „Kernschneiden" (core) vorbehalten.
    const mfg = state.activeTab !== 'wing';
    const cfgBlock = state.cfg.showBlock;   // Block auch im Tragflächendesigner schaltbar
    const cfgKerf = mfg && state.cfg.showKerf;
    const cfgNums = state.cfg.showNums;     // Punktnummern der Profilpunkte, auch im Tragflächendesigner
    const cfgDim = mfg && state.cfg.showDim;

    const COL_PROF = App.PAL.profInner, COL_BLOCK = App.PAL.block, COL_TIP = App.PAL.profOuter;
    let blkRoot = null, blkTip = null;
    if (cfgBlock) {
      blkRoot = rect(leX - e.leR, cy - bh / 2, teX + e.teR, cy + bh / 2);
      blkTip = rect(leXt - e.leT, cy - bh / 2, teXt + e.teT, cy + bh / 2);
    }
    const dimG = { leX, teX, blkLo: leX - e.leR, blkHi: teX + e.teR,
                   yb: cy - bh / 2, leR: e.leR, teR: e.teR };
    // Schnittspur inkl. kerf: der VOLLSTÄNDIGE Drahtweg (Kern + kerf/2 UND die
    // Schnittverlängerungen), also pr.rootPath/tipPath — so wird gezeichnet, wie
    // wirklich geschnitten wird.
    const rootSpur = pr.rootPath;
    const tipSpur = pr.tipPath;

    // Weitere Segment-Profile (nur im Tragflächendesigner wählbar). Jedes Paneel
    // liegt in seinem eigenen lokalen X-Frame (Wurzel bei 0, Außen um sweep
    // versetzt). Damit der gemeinsame Stoß exakt überlagert, werden die anderen
    // Segmente um die kumulierte Rückpfeilung relativ zum aktiven Segment in X
    // verschoben. In Y teilen sich alle Schnitte bereits dasselbe Datum.
    const segLE = []; { let a = 0; for (let i = 0; i < state.segments.length; i++) { segLE[i] = a; a += App.effSweep(i); } }
    const leAt = i => segLE[Math.min(Math.max(i, 0), segLE.length - 1)] || 0;
    const shiftXY = (pts, dx, dy) => (dx || dy) ? pts.map(p => ({ x: p.x + dx, y: p.y + dy })) : pts;
    // Kern stapeln aktiv (Fertigungs-Reiter): das unverschobene Originalprofil
    // (Kontur, Skelettlinie, Holme, Kern, Punktnummern, Scharnier) wird NICHT mehr
    // gezeichnet — nur die Schnittspur des Stapels zeigt, was wirklich entsteht.
    const stacked = mfg && !!(pr.stack && pr.stack.count > 1);
    const dispCut = ci => {
      const c = App.wing.cuts[Math.min(ci, App.wing.cuts.length - 1)];
      const ry = c.root.pts.map(p => p.y), ty = c.tip.pts.map(p => p.y);
      const cR = (Math.min.apply(null, ry) + Math.max.apply(null, ry)) / 2;
      const cT = (Math.min.apply(null, ty) + Math.max.apply(null, ty)) / 2;
      const cc = blockCenterY(c);
      const dr = dh ? 0 : cc - cR, dt = dh ? 0 : cc - cT;
      const dx = leAt(ci) - leAt(idx);
      return { root: shiftXY(c.root.pts, dx, dr), tip: shiftXY(c.tip.pts, dx, dt) };
    };
    // Überlagerte Segment-Profile: in Tragflächendesign UND Kerndesign wählbar
    // (Standard = nur aktives Segment). Block/Kerf/Bemaßung bleiben dem aktiven
    // Segment vorbehalten; die weiteren Profile sind gedämpfte Kontur-Overlays.
    const showIdx = App.profShowIndices();
    const otherIdx = showIdx.filter(i => i !== idx);

    const bnd = stacked ? [] : [shift(rootPts, dyR), shift(tipPts, dyT)];
    if (cfgKerf || stacked) bnd.push(shift(rootSpur, dyR), shift(tipSpur, dyT));
    if (blkRoot) bnd.push(blkRoot, blkTip);
    otherIdx.forEach(ci => { const d = dispCut(ci); bnd.push(d.root, d.tip); });
    const V = makeView(w, h, bounds.apply(null, bnd), 55, ensureNav(profNavKey()));
    App.profDraw = { V, dyR, dyT };   // für den Punkte-Editor (Hit-Test)
    if (App.meas2dView) App.meas2dView('prof', V, bnd);   // Messwerkzeug: Abbildung + Fanggeometrie (gezeichnete Konturen)
    grid(ctx, w, h, V);
    if (cfgBlock) {
      drawBlock(ctx, V, blkRoot, COL_BLOCK);                             // Blockgrenze innen
      drawBlock(ctx, V, blkTip, App.PAL.blockOuter, true, 'blockOuter');     // Blockgrenze außen (ohne Füllung)
    }
    // Andere gewählte Segmente als Hintergrund (Segmentfarbe, gedämpft).
    otherIdx.forEach(ci => {
      const d = dispCut(ci), col = SEGCOL[ci % SEGCOL.length];
      ctx.strokeStyle = col; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.2; ctx.setLineDash([]);
      poly(ctx, V, d.root, true); ctx.stroke();
      ctx.setLineDash([6, 4]); poly(ctx, V, d.tip, true); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
    // Profil-Sichtbarkeit im Zeichenfenster: innen (Wurzel), außen (Rand), beide.
    const shR = state.cfg.ribShow !== 'outer', shT = state.cfg.ribShow !== 'inner';
    // Sichtbarkeit der ORIGINAL-Elemente (bei aktivem Stapel ausgeblendet).
    const oR = shR && !stacked, oT = shT && !stacked;
    // Profile: innen durchgezogen, außen gestrichelt, gleiche Farbe.
    ctx.lineWidth = 1.8;
    // Taschen (Gurt ohne Steg) in die gezeichnete Kontur einrechnen: das Profil über
    // der Tasche wird getrimmt und durch Wand→Boden→Wand ersetzt = fertiges Werkstück.
    const dispRoot = profileWithPockets(rootPts, idx, 'root');
    const dispTip = profileWithPockets(tipPts, idx, 'tip');
    ctx.strokeStyle = COL_PROF; ctx.setLineDash(dashFor('profInner', []));
    if (oR) { poly(ctx, V, shift(dispRoot, dyR), true); ctx.stroke(); }
    ctx.strokeStyle = COL_TIP; ctx.setLineDash(dashFor('profOuter', [6, 4]));
    if (oT) { poly(ctx, V, shift(dispTip, dyT), true); ctx.stroke(); }
    ctx.setLineDash([]);
    // Schalenschnitte (Trapez): horizontale Trennlinien für Ober-/Unterschale.
    // Höhe je Rippe = Blockkante ∓ Schalendicke ± Abbrand k (voller Kerf, s.
    // shellCutGeom). Innen (Wurzel) durchgezogen, außen (Rand) gestrichelt — so ist
    // die Trapez-Neigung (Wurzel vs. Rand) direkt sichtbar.
    if (cfgBlock && state.cfg.shellCut) {
      const k = App.cutKerf(cut.root.chord, cut.tip.chord);
      const Dt = state.cfg.shellTop || 0, Db = state.cfg.shellBot || 0;
      const yBo = cy + bh / 2, yBu = cy - bh / 2;
      const yTopNom = yBo - Dt, yBotNom = yBu + Db;   // Nennlage (flach, ohne Abbrand)
      const rX0 = leX - e.leR, rX1 = teX + e.teR, tX0 = leXt - e.leT, tX1 = teXt + e.teT;
      const hline = (x0, x1, y, dashed, key) => {
        ctx.setLineDash(dashFor(key || 'shellCut', dashed ? [6, 4] : []));
        poly(ctx, V, [{ x: x0, y }, { x: x1, y }], false); ctx.stroke();
      };
      // Nennlage der Schalen-Trennebene: FLACH (kein Abbrand) — innen durchgezogen,
      // außen gestrichelt. Wurzel und Rand liegen gleich hoch (nur V-Form-Versatz).
      ctx.strokeStyle = App.PAL.shellCut || '#5bd6c8'; ctx.lineWidth = 1.4;
      if (shR) { hline(rX0, rX1, yTopNom + dyR, false); hline(rX0, rX1, yBotNom + dyR, false); }
      if (shT) { hline(tX0, tX1, yTopNom + dyT, true);  hline(tX0, tX1, yBotNom + dyT, true); }
      // Schnittspur inkl. Abbrand = tatsächlicher Drahtweg (oben +k, unten −k). Weil
      // der Abbrand an der Außenrippe größer ist, läuft die Spur trapezförmig — genau
      // wie der G-Code. Nur wenn „Schnittspur (Abbrand)" aktiv ist.
      if (cfgKerf) {
        // Wahre Dicke: Band je Rippe in deren Schnittspalt (innen/außen getrennt).
        const hb = (x0, x1, y, kv) => ({ pts: [{ x: x0, y }, { x: x1, y }], k: kv });
        if (shR) kerfBand(ctx, V, [hb(rX0, rX1, yTopNom + k.root + dyR, k.root), hb(rX0, rX1, yBotNom - k.root + dyR, k.root)], { view: 'core' });
        if (shT) kerfBand(ctx, V, [hb(tX0, tX1, yTopNom + k.tip + dyT, k.tip), hb(tX0, tX1, yBotNom - k.tip + dyT, k.tip)], { view: 'core' });
        ctx.strokeStyle = App.PAL.kerf; ctx.lineWidth = 1.4;
        if (shR) { hline(rX0, rX1, yTopNom + k.root + dyR, false, 'kerf'); hline(rX0, rX1, yBotNom - k.root + dyR, false, 'kerf'); }
        if (shT) { hline(tX0, tX1, yTopNom + k.tip + dyT, true, 'kerf');   hline(tX0, tX1, yBotNom - k.tip + dyT, true, 'kerf'); }
      }
      ctx.setLineDash([]);
    }
    // Profilmittellinie (Skelettlinie) als Konstruktionshilfe — an der Endleiste
    // endend (kein Auslauf über die EL hinaus).
    const meanLine = pts => {
      const N = pts.length, iLE = Math.ceil(N / 2) - 1, out = [];
      for (let i = 0; i <= iLE; i++) { const a = pts[i], b = pts[N - 1 - i]; out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); }
      return out;
    };
    const camRoot = meanLine(rootPts);
    const camTip  = meanLine(tipPts);
    ctx.strokeStyle = App.PAL.skeleton; ctx.lineWidth = 1; ctx.setLineDash(dashFor('skeleton', [2, 3]));
    if (oR) { poly(ctx, V, shift(camRoot, dyR), false); ctx.stroke(); }
    if (oT) { poly(ctx, V, shift(camTip, dyT), false); ctx.stroke(); }
    ctx.setLineDash([]);
    // Holmausschnitte je Rippe (Innen/Wurzel + Außen/Rand). Höhe und Anfahrt
    // beziehen sich auf die Kernkontur (Beplankungsabzug), Nasenabstand aufs Profil.
    const sparSurfR = sheetOn ? pr.rootCore : null;
    const sparSurfT = sheetOn ? pr.tipCore : null;
    const spR = oR ? drawSpars(ctx, V, idx, 'root', rootPts, dyR, sparSurfR) : null;
    const spT = oT ? drawSpars(ctx, V, idx, 'tip', tipPts, dyT, sparSurfT) : null;
    const spAny = k => !!((spR && spR[k]) || (spT && spT[k]));
    // Kernkontur (nach Beplankungsabzug)
    if (state.cfg.showCore && sheetOn && !stacked) {
      ctx.strokeStyle = App.PAL.core; ctx.lineWidth = 1.2; ctx.setLineDash(dashFor('core', [4, 3]));
      if (shR) { poly(ctx, V, shift(pr.rootCore, dyR), true); ctx.stroke(); }
      if (shT) { poly(ctx, V, shift(pr.tipCore, dyT), true); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // Schnittspur inkl. kerf (vollständiger Drahtweg inkl. Verlängerungen).
    // Optional als Heatmap: segmentweise nach dem lokalen Schnittspalt eingefärbt.
    // Schnittrichtung „von vorne": je Kopie zwei Züge (Nase → Endleiste) — die
    // vordere Kante der Nasen-Schlaufe und die EL-Schließkante werden nicht
    // geschnitten und daher auch nicht gezeichnet; kleine Pfeile zeigen die Fahrtrichtung.
    let kheat = null;
    // Kern in Stege zerlegt (kernteile.js): statt der Kern-Schnittspur die Steg-/Schalenbahnen.
    const ktOn = mfg && !!(App.kernTeileOn && App.kernTeileOn());
    const spurOn = (cfgKerf || stacked) && !ktOn;
    if (spurOn) {
      const heat = state.cfg.kerfHeat && state.cfg.kerfMode === 'speed';
      const partsR = spurParts(pr, rootSpur), partsT = spurParts(pr, tipSpur);
      if (heat) {
        // Wertebereich der Skala aus den tatsächlichen kerf-Werten beider Rippen.
        let lo = Infinity, hi = -Infinity;
        const scan = pts => pts.forEach(p => { if (p.k != null) { lo = Math.min(lo, p.k); hi = Math.max(hi, p.k); } });
        scan(rootSpur); scan(tipSpur);
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        if (hi - lo < 0.01) { hi += 0.05; lo = Math.max(0, lo - 0.05); }   // fast konstant -> kleine Spanne
        kheat = { lo, hi };
      }
      // Wahre Dicke: Band in Schnittspaltbreite unter der Drahtmitte — Spalt je Punkt
      // (p.k), Rückfall der Rippen-Abbrand; innen und außen getrennt überblendet.
      const ckB = App.cutKerf(cut.root.chord, cut.tip.chord);
      if (shR) kerfBand(ctx, V, partsR, { view: 'core', dy: dyR, k: ckB.root, heat: kheat });
      if (shT) kerfBand(ctx, V, partsT, { view: 'core', dy: dyT, k: ckB.tip, heat: kheat });
      if (heat) {
        const { lo, hi } = kheat;
        if (shR) partsR.forEach(pp => polyKerf(ctx, V, pp, dyR, lo, hi, 2.0));   // innen (dick)
        if (shT) partsT.forEach(pp => polyKerf(ctx, V, pp, dyT, lo, hi, 1.2));   // außen (dünn)
      } else {
        ctx.strokeStyle = App.PAL.kerf; ctx.lineWidth = 1.4; ctx.setLineDash(dashFor('kerf', []));
        if (shR) partsR.forEach(pp => { poly(ctx, V, shift(pp, dyR), false); ctx.stroke(); });      // innen
        ctx.setLineDash(dashFor('kerf', [6, 4]));
        if (shT) partsT.forEach(pp => { poly(ctx, V, shift(pp, dyT), false); ctx.stroke(); });      // außen
        ctx.setLineDash([]);
      }
      if (partsR[0] !== rootSpur && (shR || shT)) {
        ctx.fillStyle = App.PAL.kerf;
        (shR ? partsR : partsT).forEach(pp => spurArrow(ctx, V, pp, shR ? dyR : dyT));
      }
      // Sind mehrere Segmente überlagert, wird auch deren Schnittspur (kerf)
      // gezeichnet — je Segment im eigenen lokalen X/Y-Frame wie die Kontur
      // (dispCut), gedämpft in Segmentfarbe. So sieht man den Drahtweg ALLER
      // gewählten Segmente, nicht nur des aktiven.
      otherIdx.forEach(ci => {
        const c = App.wing.cuts[Math.min(ci, App.wing.cuts.length - 1)];
        const pr2 = App.projectCut(c, state.segments[ci]);
        if (!pr2 || !pr2.rootPath) return;
        const ry = c.root.pts.map(p => p.y), ty = c.tip.pts.map(p => p.y);
        const cR = (Math.min.apply(null, ry) + Math.max.apply(null, ry)) / 2;
        const cT = (Math.min.apply(null, ty) + Math.max.apply(null, ty)) / 2;
        const cc = blockCenterY(c);
        const dr = dh ? 0 : cc - cR, dt = dh ? 0 : cc - cT;
        const dx = leAt(ci) - leAt(idx);
        const col = SEGCOL[ci % SEGCOL.length];
        const ck2 = App.cutKerf(c.root.chord, c.tip.chord);
        if (shR) kerfBand(ctx, V, spurParts(pr2, pr2.rootPath), { view: 'core', dx, dy: dr, k: ck2.root, color: col, alpha: 0.6 });
        if (shT) kerfBand(ctx, V, spurParts(pr2, pr2.tipPath), { view: 'core', dx, dy: dt, k: ck2.tip, color: col, alpha: 0.6 });
        ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.1;
        ctx.setLineDash(dashFor('kerf', []));
        if (shR) spurParts(pr2, pr2.rootPath).forEach(pp => { poly(ctx, V, shiftXY(pp, dx, dr), false); ctx.stroke(); });
        ctx.setLineDash(dashFor('kerf', [6, 4]));
        if (shT) spurParts(pr2, pr2.tipPath).forEach(pp => { poly(ctx, V, shiftXY(pp, dx, dt), false); ctx.stroke(); });
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      });
    }
    // Punktnummern auf den Profilpunkten (Sollkontur, nicht Schnittspur):
    // Innenprofil; ist nur das Außenprofil sichtbar, dann dieses.
    if (cfgNums && !stacked) drawNums(ctx, V, shR ? shift(rootPts, dyR) : shift(tipPts, dyT));
    // Scharnierlinie: Lage in % der Sehne von HINTEN (Endleiste) gemessen,
    // Markierung auf der gewählten Ober-/Unterseite des Innenprofils.
    // Scharnier je Profil (innen/außen) mit eigener Lage in % von hinten.
    const cyd = cy + (dyR + dyT) / 2;
    // Scharniermarkierung auf EINEM Profil: senkrechte Hilfslinie von der
    // Mittellinie zum Scharnierpunkt auf der gewählten Ober-/Unterseite + Punkt.
    // side/col je Segment (aktives Segment kräftig rosa, überlagerte in ihrer
    // Segmentfarbe/dünner).
    const drawHinge = (pts, pct, edgeLE, edgeTE, dy, side, col, thin) => {
      if (pct == null) return null;
      const hx = edgeTE - Math.max(0, Math.min(100, pct)) / 100 * (edgeTE - edgeLE);
      const surf = dy ? shift(pts, dy) : pts;
      const cands = [];
      for (let i = 0; i < surf.length - 1; i++) {
        const a = surf[i], b = surf[i + 1];
        if ((a.x - hx) * (b.x - hx) <= 0 && a.x !== b.x)
          cands.push(a.y + (hx - a.x) / (b.x - a.x) * (b.y - a.y));
      }
      if (!cands.length) return null;
      const hy = side === 'bottom' ? Math.min.apply(null, cands) : Math.max.apply(null, cands);
      ctx.strokeStyle = col; ctx.lineWidth = thin ? 0.9 : 1.2; ctx.setLineDash(dashFor('hinge', [3, 3]));
      ctx.beginPath(); ctx.moveTo(V.X(hx), V.Y(cyd)); ctx.lineTo(V.X(hx), V.Y(hy)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(V.X(hx), V.Y(hy), thin ? 2.5 : 3.5, 0, 2 * Math.PI); ctx.fill();
      return { x: hx, y: hy };
    };
    // Überlagerte Segmente: Scharnierlinie in deren Segmentfarbe (dünn).
    otherIdx.forEach(ci => {
      const seg2 = state.segments[ci]; if (!seg2) return;
      const d = dispCut(ci), col = SEGCOL[ci % SEGCOL.length];
      const rx = d.root.map(p => p.x), tx = d.tip.map(p => p.x);
      if (shR) drawHinge(d.root, seg2.hingePct, Math.min.apply(null, rx), Math.max.apply(null, rx), 0, seg2.hingeSide, col, true);
      if (shT) drawHinge(d.tip, seg2.hingePctTip, Math.min.apply(null, tx), Math.max.apply(null, tx), 0, seg2.hingeSide, col, true);
    });
    const hingePtR = oR ? drawHinge(rootPts, s.hingePct, leX, teX, dyR, s.hingeSide, App.PAL.hinge) : null;
    const hingePtT = oT ? drawHinge(tipPts, s.hingePctTip, leXt, teXt, dyT, s.hingeSide, App.PAL.hinge) : null;
    const hingePt = hingePtR || hingePtT;
    // Bemaßung: Innenprofil (Wurzel) + Block/Überstände UNTER dem Block; das
    // Außenprofil (Rand) OBERHALB, in eigener Farbe.
    if (cfgDim) {
      const g = dimG, mm = v => String(Math.round(v));
      // Innenprofil (Wurzel) UNTER dem Block: Sehne, Blockbreite, Überstände NL/EL.
      if (shR) {
        dim(ctx, V, g.leX, g.yb, g.teX, g.yb, mm(g.teX - g.leX), { off: 30 });
        dim(ctx, V, g.blkLo, g.yb, g.blkHi, g.yb, mm(g.blkHi - g.blkLo), { off: 58, color: COL_BLOCK });
        if (g.leR > 0.01) dim(ctx, V, g.blkLo, g.yb, g.leX, g.yb, mm(g.leR), { off: 86, color: '#ffb454' });
        if (g.teR > 0.01) dim(ctx, V, g.teX, g.yb, g.blkHi, g.yb, mm(g.teR), { off: 86, color: '#ffb454' });
      }
      // Außenprofil (Rand) OBERHALB: Sehne, Blockbreite UND Überstände NL/EL außen.
      if (shT) {
        const yTop = cy + bh / 2, blkLoT = leXt - e.leT, blkHiT = teXt + e.teT;
        dim(ctx, V, leXt, yTop, teXt, yTop, mm(teXt - leXt), { off: -30, color: COL_TIP });
        dim(ctx, V, blkLoT, yTop, blkHiT, yTop, mm(blkHiT - blkLoT), { off: -58, color: COL_TIP });
        if (e.leT > 0.01) dim(ctx, V, blkLoT, yTop, leXt, yTop, mm(e.leT), { off: -86, color: '#ffb454' });
        if (e.teT > 0.01) dim(ctx, V, teXt, yTop, blkHiT, yTop, mm(e.teT), { off: -86, color: '#ffb454' });
      }
      // Blockhöhe (senkrecht, an der linken Blockkante). Nur wenn der Block
      // gezeichnet wird.
      if (cfgBlock) {
        const xL = Math.min(g.blkLo, leXt - e.leT);   // linke Blockkante (Wurzel/außen)
        dim(ctx, V, xL, cy - bh / 2, xL, cy + bh / 2, mm(bh), { off: -30, color: COL_BLOCK });
      }
    }
    // Legende, unten links (unter der Abbildung) angeschlagen. Jede Zeile nur,
    // wenn das Element gerade gezeichnet ist — mit Probe in echter Farbe/Strichart.
    const rise = (App.wing.stations[idx + 1].yRise - App.wing.stations[idx].yRise) || 0;
    const leg = [];
    const segName = 'Segment ' + (idx + 1) + T(' (aktiv)');
    if (oR) leg.push(L(COL_PROF, segName + T(': Profil innen (Wurzel)'), dashFor('profInner', [])));
    if (oT) leg.push(L(COL_TIP, segName + T(': Profil außen (Rand)'), dashFor('profOuter', [6, 4])));
    if (stacked) leg.push(['#8b98a8', segName + T(': Kern gestapelt (') + pr.stack.count + T('×) — nur die Schnittspur des Stapels wird gezeigt')]);
    if (oR || oT) leg.push(L(App.PAL.skeleton, T('Profilmittellinie (Skelettlinie)'), dashFor('skeleton', [2, 3]), 'line', 1));
    otherIdx.forEach(ci => leg.push(L(SEGCOL[ci % SEGCOL.length], 'Segment ' + (ci + 1) + T(' (überlagert, Segmentfarbe; außen gestrichelt)'), [], 'line', 1.2)));
    if (spAny('n')) leg.push(L(App.PAL.spar, T('Holmausschnitt'), dashFor('spar', []), 'line', 1.6));
    if (spAny('lead')) leg.push(L(App.PAL.sparLead, T('Holm-Anfahrt'), dashFor('sparLead', [4, 3]), 'line', 1.2));
    if (state.cfg.showCore && sheetOn && !stacked && (shR || shT))
      leg.push(L(App.PAL.core, T('Kern (nach Beplankungsabzug)'), dashFor('core', [4, 3]), 'line', 1.2));
    if (cfgBlock && state.cfg.shellCut && (shR || shT)) {
      leg.push(L(App.PAL.shellCut || '#5bd6c8', T('Schalenschnitt: Trennebene Ober-/Unterschale (Nennlage)'), dashFor('shellCut', []), 'line', 1.4));
      if (cfgKerf) leg.push(kerfLeg(L(App.PAL.kerf, T('Schalenschnitt inkl. Abbrand (Drahtweg)'), dashFor('kerf', []), 'line', 1.4), 'core'));
    }
    if (spurOn && (shR || shT)) {
      const ki = pr.kerfInfo || {};
      let ktxt;
      if (ki.mode === 'speed')
        ktxt = T('lokal ') + ki.rootMin.toFixed(2) + '–' + ki.rootMax.toFixed(2) + ' / '
             + ki.tipMin.toFixed(2) + '–' + ki.tipMax.toFixed(2) + T(' mm (Geschwindigkeit)');
      else { const ck = App.cutKerf(cut.root.chord, cut.tip.chord);
        ktxt = T('innen ') + ck.root.toFixed(2) + T(' · außen ') + ck.tip.toFixed(2) + T(' mm'); }
      const ktext = T('Schnittspur inkl. Abbrand (') + ktxt + ')' + (kheat ? T(' · Farbe = lokaler Spalt') : '');
      leg.push(kerfLeg(kheat ? Object.assign(L(null, ktext, [], 'grad'), { tc: '#ffffffcc' })
                             : L(App.PAL.kerf, ktext, dashFor('kerf', []), 'line', 1.4), 'core'));
      if (spAny('kerf')) leg.push(kerfLeg(L(App.PAL.kerf, T('Holm-Schnittspur inkl. Abbrand (separat geschnitten)'), dashFor('kerf', [4, 3]), 'line', 1.3), 'core'));
      if (App.kerfTrueOn('core')) leg.push(['#8b98a8', T('Band = wahre Abbrandbreite (Schnittspalt) im Maßstab')]);
      if (state.cfg.kerfDatum && state.cfg.kerfDatum !== 'sym')
        leg.push(['#8b98a8', (state.cfg.kerfDatum === 'top' ? T('Oberschale') : T('Unterschale'))
          + T(' exakt (auf Nennkontur) — Kern voll, Verlust auf Gegenschale')]);
    }
    if (cfgBlock) {
      leg.push(L(COL_BLOCK, T('Blockgrenze innen'), dashFor('block', [7, 5]), 'rect'));
      leg.push(Object.assign(L(App.PAL.blockOuter, T('Blockgrenze außen'), dashFor('blockOuter', [7, 5]), 'rect'), { f: 'rgba(0,0,0,0)' }));
    }
    if (hingePt) leg.push(L(App.PAL.hinge, T('Scharnier ') + (s.hingeSide === 'bottom' ? T('unten') : T('oben'))
      + T(' · innen ') + Math.round(s.hingePct) + T(' % · außen ') + Math.round(s.hingePctTip) + T(' % von hinten'), [], 'dot'));
    leg.push(['#8b98a8', dh ? (T('Profile in Einbaulage (V-Form-Versatz ') + rise.toFixed(0) + T(' mm)'))
                            : T('Profile flach überlagert (V-Form ausgeblendet)')]);
    if (ktOn) App.kernTeileDraw(ctx, V, leg, { idx, dyR, dyT, shR, shT, kerf: cfgKerf });
    drawLegend(ctx, 14, h - 8, leg, { kheat });
    if (state.activeTab === 'core') drawSparWarnings(ctx, w, h);
    if (state.activeTab === 'core') App.ptDrawHandles(ctx, App.profDraw, 'prof');
  }
  // Kerndesign, Profil-Ansichtsfenster: Warnbanner zu den Holmausschnitten, mittig
  // oben, umbrochen, mit halbtransparentem Kasten — gut sichtbar (Präsentation).
  //  · Loch-Holm nicht proportional + „während des Schnitts": Anfahrt nur durch den Kern.
  //  · Gurttasche nicht proportional: Profilbahn abschnittsweise neu abgetastet,
  //    Zwischenrippen weichen ab (pocketSkewInfo).
  function drawSparWarnings(ctx, w, h) {
    if (!state.cfg.sparCut || state.cfg.sparOnly || !(state.spars || []).length) return;
    const msgs = [];
    if ((state.spars || []).some(sp => !App.isPocket(sp) && !App.sparProportional(sp) && App.sparModeOf(sp) === 'during'))
      msgs.push([T('⚠ Holmlage nicht proportional'), T('Anfahrt während des Profilschnitts nur durch den Kern möglich')]);
    const sk = (state.spars || []).map((sp, i) => ({ i, k: App.pocketSkewInfo(sp) })).filter(o => o.k);
    if (sk.length) {
      const dev = Math.max.apply(null, sk.map(o => o.k.devMm));
      const who = sk.map(o => T('Holm ') + (o.i + 1) + ' (' + o.k.rootPct.toFixed(0) + ' % / ' + o.k.tipPct.toFixed(0) + ' %)').join(', ');
      msgs.push([T('⚠ Tasche nicht proportional: ') + who,
        T('Profilbahn im Taschenbereich abschnittsweise neu abgetastet — Draht steht schräg, Zwischenrippen bis ≈ ')
        + dev.toFixed(1) + T(' mm in Flugrichtung verzerrt')]);
    }
    if (!msgs.length) return;
    const big = Math.max(16, Math.min(26, w / 32)), small = Math.max(12, Math.min(16, w / 52));
    const maxW = w - 180;
    const wrap = (txt, font) => {   // Zeilenumbruch an Wortgrenzen
      ctx.font = font; const out = []; let line = '';
      txt.split(' ').forEach(word => {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
      });
      if (line) out.push(line); return out;
    };
    const rows = [];   // { t, font, hgt }
    msgs.forEach((m, k) => {
      wrap(m[0], 'bold ' + big + 'px Segoe UI').forEach(t => rows.push({ t, font: 'bold ' + big + 'px Segoe UI', hgt: big * 1.25 }));
      wrap(m[1], small + 'px Segoe UI').forEach(t => rows.push({ t, font: small + 'px Segoe UI', hgt: small * 1.35 }));
      if (k < msgs.length - 1) rows.push({ t: '', font: '', hgt: small * 0.6 });
    });
    const pad = 12, boxH = rows.reduce((a, r) => a + r.hgt, 0) + pad * 2;
    let boxW = 0; rows.forEach(r => { if (r.t) { ctx.font = r.font; boxW = Math.max(boxW, ctx.measureText(r.t).width); } });
    boxW += pad * 2;
    // Mittig, aber rechts vom Overlay „Profile/Segmente" (oben links) beginnen.
    let x0 = Math.max(150, (w - boxW) / 2); if (x0 + boxW > w - 10) x0 = Math.max(10, w - 10 - boxW);
    const y0 = 12, cx = x0 + boxW / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(20, 22, 28, 0.86)'; ctx.strokeStyle = App.PAL.bad || '#ff6b6b'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(x0, y0, boxW, boxH); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    let y = y0 + pad;
    rows.forEach(r => { if (r.t) { ctx.font = r.font; ctx.fillStyle = App.PAL.bad || '#ff6b6b'; ctx.fillText(r.t, cx, y); } y += r.hgt; });
    ctx.restore();
  }

  function syncProfToggles() {
    // Nur die Beplankungslinie ist eine Konstruktionshilfe -> immer sichtbar.
    // Block/Schnittspur/Nummern/Bemaßung sind Fertigungshilfen und nur im
    // Reiter „Kernschneiden" (core) einstellbar.
    const mfg = state.activeTab !== 'wing';
    const wingToggles = ['showCore', 'showBlock', 'showNums'];   // im Tragflächendesigner sichtbar
    document.querySelectorAll('#profToggles input[data-cfg]').forEach(cb => {
      cb.checked = !!state.cfg[cb.dataset.cfg];
      let show = wingToggles.includes(cb.dataset.cfg) ? true : mfg;
      // „Abbrand-Verteilung farbig" nur bei Abbrand aus Bahngeschwindigkeit.
      if (cb.dataset.cfg === 'kerfHeat' && state.cfg.kerfMode !== 'speed') show = false;
      cb.closest('label').style.display = show ? '' : 'none';
    });
    // „Abbrand in wahrer Dicke" (Ebene Kerndesign) — nur wo die Schnittspur schaltbar ist.
    document.querySelectorAll('#profToggles input[data-ktrue]').forEach(cb => {
      cb.checked = App.kerfTrueOn('core');
      cb.closest('label').style.display = (mfg && state.cfg.showKerf) ? '' : 'none';
    });
    syncProfSegFilter();
  }
  /* Ausklappbares Segment-Menü direkt am Profil-Ansichtsfenster (wing UND core).
   * Je Segment: Häkchen = im Profilbild überlagert anzeigen (Mehrfachauswahl),
   * Klick auf den Namen = Segment aktiv schalten (wie Klick in der Draufsicht).
   * Das aktive Segment (●) wird immer gezeigt. Ein Klick im Grundriss ist
   * stärker als das Menü: das angeklickte Segment wird aktiv und ist dann das
   * einzige angezeigte (Häkchen werden zurückgesetzt). */
  function syncProfSegFilter() {
    const list = document.getElementById('profSegList');
    const head = document.getElementById('profSegHead');
    if (!list || !head) return;
    const n = state.segments.length;
    const act = App.activeIdx();
    const shown = App.profShowIndices();
    const all = !!(state.cfg.profSegs && state.cfg.profSegs.length) && App.profIsAll();
    // Dropdown-Knopf zeigt die aktuelle Auswahl als Kurztext.
    const lbl = document.getElementById('profSegLabel');
    if (lbl) lbl.textContent = all ? T('alle') : ('Segment ' + (act + 1) + (shown.length > 1 ? ' +' + (shown.length - 1) : ''));
    list.classList.toggle('open', App.profSegOpen);
    if (!App.profSegOpen) return;
    // Menü frisch aufbauen (Segmentzahl/aktives Segment können sich ändern).
    list.innerHTML = '';
    const row = (labelTxt, checked, onCheck, opt) => {
      opt = opt || {};
      const lab = document.createElement('label');
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.checked = checked; cb.disabled = !!opt.disabled;
      if (!opt.disabled) cb.onchange = () => { onCheck(cb.checked); render(); };
      if (opt.disabled) cb.title = T('Das aktive Segment wird immer gezeigt.');
      lab.appendChild(cb);
      const nm = document.createElement('span'); nm.textContent = ' ' + labelTxt;
      if (opt.onName) {
        nm.className = 'prof-seg-name'; nm.title = T('Klick: Segment aktiv schalten');
        nm.onclick = e => { e.preventDefault(); e.stopPropagation(); opt.onName(); App.buildSidebar(); render(); };
      }
      if (opt.active) { lab.classList.add('active'); }
      lab.appendChild(nm);
      list.appendChild(lab);
    };
    row(T('Alle'), all, v => { state.cfg.profSegs = v ? state.segments.map((_, i) => i) : []; });
    for (let i = 0; i < n; i++) (idx => {
      const isAct = idx === act;
      row((isAct ? '● ' : '') + 'Segment ' + (idx + 1), isAct || shown.includes(idx),
        v => App.profToggle(idx, v),
        { disabled: isAct, active: isAct, onName: isAct ? null : () => { state.activeSeg = idx; App.profToggle(idx, true); } });
    })(i);
    const h = document.createElement('div'); h.className = 'prof-seg-hint';
    h.textContent = T('Häkchen = anzeigen · Name = aktiv schalten');
    list.appendChild(h);
  }
  function draw() {
    drawPlan(); drawElev(); drawProfiles();
    if (App.meas2dOverlay) App.meas2dOverlay('core');   // Messwerkzeug (Kerndesign): Überlagerung neu malen
    syncProfToggles();
    updateStat();
  }
  function render() {
    applyView();        // Zeichnungsfarben/-strichtypen der aktiven Design-Ansicht setzen
    App.recompute();
    if (App.autoGen) App.autoGen();                 // G-Code hält sich automatisch aktuell (Funktion „G-Code-Erzeugung")
    else if (App.gcodeSceneRefresh) App.gcodeSceneRefresh();   // Design-Ausgabe: geladene Datei mit aktueller Szene zeigen
    draw();             // updateStat() zeigt danach die frische Schnittlänge
    if (App.updateSimContext) App.updateSimContext();   // Simulator: Tragfläche · Segment · Seite
    if (state.activeTab === 'neg') renderNeg();   // Negativschalen-Querschnitt
    if (state.activeTab === 'dxf' && App.renderDxf) App.renderDxf();   // DXF-Formen-Ansicht
    if (App.profModalOpen) renderProfEdit();          // offenes Profilbearbeitungs-Fenster mitziehen
    if (sweepCmpOpen) renderSweepCmp();           // offenes Drehungs-Vergleichsfenster mitziehen
    if (state.activeTab !== 'dxf') renderSeg3DWin();   // offenes 3D-Fenster (Tragfläche) mitziehen
    saveSettings();     // Maschinen-/Werkstoff-Einstellungen persistent halten
  }

  /* Profilbearbeitung: Querschnitt des gewählten Profils mit Skelett-/Sehnen-
   * linie, Dicken-/Wölbungsmaßen und Kennwerten. Zeichnet das tatsächlich
   * gespeicherte (bearbeitete) Profil — so ist das Ergebnis sofort sichtbar. */
  function renderProfEdit() {
    const cv = document.getElementById('cProfEdit'); if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const id = App.profNormTarget();
    const pts = App.profEditGet(id);
    if (!pts || pts.length < 4) return;
    const chord = App.profEditChord(id);
    const m = App.profMetrics(pts);
    // Skelettlinie über die punktweise Zuordnung (LE mittig nach Resampling).
    const skel = [];
    const half = Math.min(m.iLE, pts.length - 1 - m.iLE);
    for (let i = half; i >= 0; i--)
      skel.push({ x: (pts[i].x + pts[pts.length - 1 - i].x) / 2, y: (pts[i].y + pts[pts.length - 1 - i].y) / 2 });
    const le = pts[m.iLE];
    const teMid = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };

    const b = bounds(pts, skel, [le, teMid]);
    const V = makeView(w, h, b, 60, nav.profedit);
    grid(ctx, w, h, V);

    // Sehnenlinie LE -> EL-Mitte
    if (state.cfg.profShowChord !== false) {
      ctx.strokeStyle = '#5d6b7d'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(V.X(le.x), V.Y(le.y)); ctx.lineTo(V.X(teMid.x), V.Y(teMid.y)); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Profilkontur
    poly(ctx, V, pts, true);
    ctx.fillStyle = 'rgba(74,163,255,.08)'; ctx.fill();
    ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.8; ctx.stroke();
    // Punkte
    if (state.cfg.profShowPts) {
      ctx.fillStyle = '#9fb0c4';
      pts.forEach(p => { ctx.beginPath(); ctx.arc(V.X(p.x), V.Y(p.y), 1.6, 0, 6.3); ctx.fill(); });
    }
    // Skelett-/Mittellinie
    if (state.cfg.profShowSkel !== false) {
      ctx.strokeStyle = '#ffd27f'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]);
      poly(ctx, V, skel, false); ctx.stroke(); ctx.setLineDash([]);
    }
    // LE-/EL-Marker
    ctx.fillStyle = '#57d38c';
    ctx.beginPath(); ctx.arc(V.X(le.x), V.Y(le.y), 3, 0, 6.3); ctx.fill();

    // Maße: max. Dicke (senkrechte Linie an der Dickenstelle) + Endleistendicke.
    if (state.cfg.profShowDim !== false) {
      const xt = le.x + m.thickX;
      // Profilpunkte nahe xt für die Ober-/Unterseite finden (per Skelett + Dicke).
      let ui = 0, dbest = 1e9;
      for (let i = 0; i <= m.iLE; i++) { const d = Math.abs(pts[i].x - xt); if (d < dbest) { dbest = d; ui = i; } }
      const up = pts[ui], lo = pts[pts.length - 1 - ui];
      dim(ctx, V, up.x, up.y, lo.x, lo.y, (m.thickMax * chord).toFixed(1), { off: 34, color: '#4aa3ff' });
      dim(ctx, V, pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y,
        (m.teFrac * chord).toFixed(2), { off: 34, color: '#ff5a3c' });
    }

    // Kennwerte-Panel
    const info = document.getElementById('profEditInfo');
    if (info) {
      const lbl = (App.profEditTargets().find(t => String(t.id) === String(id)) || {}).label || '';
      info.innerHTML =
        '<div><b>' + (m.name || T('Profil')) + '</b></div>' +
        '<div style="color:var(--muted)">' + lbl + T(' · Sehne ') + chord.toFixed(0) + ' mm</div>' +
        row('Punktzahl', m.n) +
        row('Max. Dicke', (m.thickMax * 100).toFixed(1) + ' % &nbsp;@ ' + (m.thickX * 100).toFixed(0) + ' % · ' + (m.thickMax * chord).toFixed(1) + ' mm') +
        row('Max. Wölbung', (m.camMax * 100).toFixed(1) + ' % &nbsp;@ ' + (m.camX * 100).toFixed(0) + ' %') +
        row('Endleistendicke', (m.teFrac * 100).toFixed(2) + ' % · ' + (m.teFrac * chord).toFixed(2) + ' mm');
    }
    function row(k, v) {
      return '<div style="display:flex;justify-content:space-between"><span style="margin:0;color:var(--muted)">' + T(k)
        + '</span><span style="color:var(--txt)">' + v + '</span></div>';
    }
  }

  /* Werkstoff-Reiter: Eigenschaften der gewählten Art + Kennwerte des Rohblocks.
   * Liest die Art aus der Werkstoff-„Datenbank" (materials.js), die später durch
   * eine echte Datenbank ersetzt werden kann. */
  /* Reiter „Projektübersicht": seit 2026-09-14 in overview.js (mittige Akkordeon-Übersicht
   * ohne Seitenleiste). Hier nur noch die Weiterleitung. */
  function renderProjectOverview() { if (App.renderOverview) App.renderOverview(); }

  function renderMaterial() {
    App.updateFeedWarn();   // Sidebar-Warnung „gleiche Vorschübe" live mitpflegen
    renderProjectOverview();
    // Eigenschaftsanzeige erscheint in beiden Reitern: „Projektübersicht" (#matProps)
    // und „Werkstoff-Datenbank" (#matPropsDb).
    // (#matProps im Reiter „Projektübersicht" entfiel 2026-09-13: Schneidwerte stehen je Tragfläche im Block.)
    const els = ['matPropsDb'].map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;
    // #matProps (Projektübersicht): Werkstoff „Kern" der aktiven Tragfläche samt
    // Dicke; #matPropsDb: der in der Datenbank gerade bearbeitete Werkstoff.
    els.forEach(el => {
      el.innerHTML = el.id === 'matPropsDb' ? matHtml(state.material.id, null)
        : matHtml(App.matIdFor('wing'), App.blockH('wing'));
    });
  }
  function matHtml(id, height) {
    const d = { id, height };
    const m = window.Materials ? Materials.get(d.id) : null;
    const num = v => (v == null ? '—' : v);
    const kp = App.kerfPair(d.id), fp = App.feedPair(d.id), hp = App.heatPair(d.id);
    const rows = [
      [T('Art'), T(App.matField(d.id, 'name', d.id))],
      [T('Kategorie'), num(T(App.matField(d.id, 'category', '—')))],
      [T('Rohdichte'), App.matField(d.id, 'density', null) != null ? App.matField(d.id, 'density') + ' kg/m³' : '—'],
      height == null ? null : [T('Höhe / Dicke'), num(d.height) + ' mm'],
      [T('Punkt 1: schnell, Heizstrom 1'), fp.fast + T(' mm/min · ') + hp.fast + T(' % → Abbrand ') + kp.fast.toFixed(2) + ' mm'],
      [T('Punkt 2: langsam, Heizstrom 1'), fp.slow + T(' mm/min · ') + hp.fast + T(' % → Abbrand ') + kp.slow.toFixed(2) + ' mm'],
      hp.varies ? [T('Punkt 3: langsam, Heizstrom 2'), fp.slow + T(' mm/min · ') + hp.slow + T(' % → Abbrand ')
        + kp.fast.toFixed(2) + ' mm'] : null,
      [T('Drahtheizung'), App.currentHeat() + (hp.varies ? T(' % (folgt dem Vorschub, Punkt 1+3)') : T(' % (konstant)'))],
      [T('Eingegebener Vorschub'), state.cfg.feed + ' mm/min'],
      [T('Wirksamer Abbrand'), App.currentKerf().toFixed(2) + ' mm']
    ];
    let html = '<table class="set-table" style="margin-top:8px"><tbody>';
    for (const [k, v] of rows.filter(Boolean))
      html += `<tr><td style="color:var(--muted)">${k}</td><td class="num">${v}</td></tr>`;
    html += '</tbody></table>';
    const speedMode = state.cfg.kerfMode === 'speed';
    html += '<div class="hint" style="margin-top:8px">' + (hp.varies
        ? T('Heizstrom folgt dem Vorschub (Punkt 3 aktiv): der Abbrand beim vorgegebenen Vorschub bleibt konstant = Abbrand schnell ')
        : T('Der wirksame Abbrand folgt dem im G-Code eingegebenen Vorschub '))
      + '(' + state.cfg.feed + T(' mm/min). Abbrand-Berechnung Kerndesign: ') + '<b>' + (speedMode ? T('Bahngeschwindigkeit (lokal je Schnittsegment)') : T('Profillängen-Verhältnis (je Rippe)')) + '</b>. '
      + T('Kürzere/langsamere Rippe = mehr Abbrand = breiterer Spalt. Der Kern bleibt immer auf Nennmaß.') + '</div>';

    // Per-Segment: Sehnenverhältnis und die kerf-Werte je Rippe (bzw. lokaler
    // Bereich im Geschwindigkeitsmodus).
    if (App.wing && App.wing.cuts && App.wing.cuts.length) {
      let t = '<div class="hint" style="margin-top:10px;color:var(--txt)"><b>' + T('Abbrand je Segment (Trapez-Kompensation)') + '</b></div>'
        + '<table class="set-table" style="margin-top:4px"><thead><tr><th>' + T('Segment') + '</th>'
        + '<th>' + T('Sehne innen→außen') + '</th><th>' + T('Abbrand innen / außen') + '</th></tr></thead><tbody>';
      App.wing.cuts.forEach((c, k) => {
        const ratio = c.root.chord ? c.tip.chord / c.root.chord : 1;
        const warn = ratio < 0.5 - 1e-6;
        let kcell;
        if (speedMode) {
          const ki = App.projectCut(c, state.segments[Math.min(k, state.segments.length - 1)]).kerfInfo || {};
          kcell = ki.rootMin != null
            ? `${ki.rootMin.toFixed(2)}–${ki.rootMax.toFixed(2)} / ${ki.tipMin.toFixed(2)}–${ki.tipMax.toFixed(2)} mm`
            : '—';
        } else {
          const ck = App.cutKerf(c.root.chord, c.tip.chord);
          kcell = `${ck.root.toFixed(2)} / ${ck.tip.toFixed(2)} mm`;
        }
        t += `<tr><td style="color:var(--muted)">${k + 1}</td>`
          + `<td class="num">${c.root.chord.toFixed(0)} → ${c.tip.chord.toFixed(0)} mm`
          + (warn ? ' <span style="color:var(--bad)">⚠ &lt;½</span>' : '') + `</td>`
          + `<td class="num">${kcell}</td></tr>`;
      });
      t += '</tbody></table>';
      html += t;
      if (App.wing.cuts.some(c => c.root.chord && c.tip.chord / c.root.chord < 0.5 - 1e-6))
        html += '<div class="hint" style="margin-top:6px;color:var(--bad)">' + T('⚠ Ein Trapez ist außen kürzer als die halbe Innensehne — die kürzere Seite läuft unter das halbe Tempo, der Abbrand wird extrapoliert. Empfehlung: außen ≥ halbe Innensehne (bzw. langsam ≥ halber schneller Vorschub).') + '</div>';
    }
    if (m && m.note) html += `<div class="hint" style="margin-top:6px">${T(m.note)}</div>`;
    return html;
  }

  /* Negativschale: geschlossener Umriss (Drahtweg) einer Formhälften-Kavität aus
   * einem Profil, analog zur DXF-Vorlage. Der Block umschließt das Profil mit
   * Überstand vorne (ovF) / hinten (ovR); Ober- und Unterseite werden um `split`
   * mm auseinandergezogen (Ober +½ hoch, Unter −½ runter). Die Profilsehne liegt
   * mittig in der Gesamtblockhöhe H. Rückgabe: { path, block, cy, geom } — path =
   * geschlossene Polylinie [{x,y}…]. */
  // Profilsehnenmitte (LE-/TE-Höhe gemittelt) — Bezug für die Blocklage.
  function negChordMidY(pts) {
    let iLE = 0; for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    return (pts[iLE].y + (pts[0].y + pts[pts.length - 1].y) / 2) / 2;
  }
  /* Basis-Rippenpunkte der Negativschale (Cut-mm) für Rippe `rib` ('root'/'tip'),
   * ausschließlich aus dem Tragflächendesign: das Wing-Cut-Profil, aber jede
   * Kerndesign-Spiegelung (flipY/„Kopfüber") wird rückgängig gemacht, damit kein
   * einziger Kerndesign-Befehl die Negativschale beeinflusst. */
  function negBaseRibPts(cut, rib) {
    const src = rib === 'root' ? cut.root.pts : cut.tip.pts;
    const pl = rib === 'root' ? cut.root.pl : cut.tip.pl;
    return (pl && pl.flip) ? src.map(p => ({ x: p.x, y: -p.y }))
                           : src.map(p => ({ x: p.x, y: p.y }));
  }
  /* Wirksame Rippenkontur der Negativschale = Basis aus dem Tragflächendesign.
   * (Die editierbaren Overrides greifen weiter unten: Kavität = negShell-Umriss,
   * Schnittverlauf = kerf-kompensierte Abbrandlinie.) */
  function negRibPts(cut, idx, rib) { return negBaseRibPts(cut, rib); }
  function negShell(pts, geom) {
    const xs = pts.map(p => p.x);
    const xL = Math.min.apply(null, xs), xT = Math.max.apply(null, xs);
    // LE-Index: DETERMINISTISCH wie im Kerndesign (Airfoil.resample legt den LE auf
    // ceil(n/2)-1) — NICHT über min-x. Bei manchen Profilen (z. B. A-7026) krümmt
    // sich die Nase nach dem Ausrichten minimal in den negativen x-Bereich, sodass
    // der vorderste Punkt (min-x) je Rippe an einem ANDEREN Index liegt. Über min-x
    // würden Wurzel und Rand dann an verschiedenen Stellen geteilt -> Ober-/Unter-
    // schale bekämen unterschiedliche Punktzahlen -> die beiden Turmbahnen ent-
    // koppeln (Artefakte im G-Code). Der feste Index hält beide synchron.
    const iLE = Math.ceil(pts.length / 2) - 1;
    // WICHTIG: Das Profil bleibt auf seiner ECHTEN Höhe (inkl. V-Form-Versatz aus
    // dem Tragflächendesigner — Außenprofil sitzt um die V-Höhe höher als das
    // Wurzelprofil). Nur die Blockmitte ist frei wählbar (gemeinsamer, waagrechter
    // Block für Innen- und Außenprofil); ohne Vorgabe = eigene Sehnenmitte.
    const yLE = pts[iLE].y, yTE = (pts[0].y + pts[pts.length - 1].y) / 2;
    const ownCy = (yLE + yTE) / 2;
    const blockCy = geom.blockCy != null ? geom.blockCy : ownCy;
    const s2 = (geom.split || 0) / 2, H = geom.H;
    const xBL = xL - (geom.ovF || 0), xBR = xT + (geom.ovR || 0);
    const yBot = blockCy - H / 2, yTop = blockCy + H / 2;
    const upperTEtoLE = pts.slice(0, iLE + 1).map(p => ({ x: p.x, y: p.y + s2 })); // TE→LE, +s2
    const lowerLEtoTE = pts.slice(iLE).map(p => ({ x: p.x, y: p.y - s2 }));        // LE→TE, −s2
    // Schnittverlauf an der ENDLEISTE: 'horizontal' = waagrecht bis zur Block-
    // hinterkante (Standard) | 'skeleton' = gerade, tangentiale Verlängerung der
    // SKELETTLINIE (Profilmittellinie) hinter der EL — dieselbe Tangente (LSQ über
    // die letzten Skelettpunkte) wie beim EL-Steg „Entlang Skelettlinie" im Kern-
    // design. teSlope = dy/dx dieser Tangente; atBR(p) liefert den Punkt an der
    // Blockhinterkante xBR auf der Verlängerung durch p (gilt für Schalen, Kern,
    // Stege und Stützstoff-Flächen gleichermaßen -> eine gemeinsame Fugenrichtung).
    const xTE = (pts[0].x + pts[pts.length - 1].x) / 2;
    const teSlope = ((geom.teStyle === 'skeleton' || geom.teStyle === 'chord') && window.HotWire && HotWire.skelTeSlope)
      ? HotWire.skelTeSlope(pts, iLE) : 0;
    const atBR = p => ({ x: xBR, y: p.y + teSlope * (xBR - p.x) });
    const path = [];
    const noseApex = [];   // doppelt besuchte Kern-Nasenspitzen (Index im path)
    const supNose = [];    // Nasen-Ecken der Stützstoff-Flächen (Fläche↔Blockvorderkante)
    // „Nur Stege schneiden": KEINE Schalen — die Bahn ist allein die Steg-Schleife
    // (Anfahrt hinten am Block auf EL-Höhe, Oberseiten, Nasen-Schlaufe, Unterseiten,
    // hinten raus; der Schließzug läuft an der Block-Hinterkante hoch).
    if (geom.stegeOnly && geom.stege && geom.stege.length && App.stegeEmit) {
      const ap = App.stegeEmit(path, geom.stege, xBR, xBL, Math.max(geom.noseExt || 0, 0) / 2, teSlope);
      if (ap) noseApex.push(ap);
      return { path, noseApex, supNose, cy: blockCy, ownCy, geom, xL, xT, xBL, xBR, yBot, yTop, s2, yLE, yTE, xTE, teSlope, block: rect(xBL, yBot, xBR, yTop) };
    }
    // Reihenfolge IMMER von OBEN nach UNTEN, Einstich an der HINTEREN OBEREN
    // Blockkante (xBR = hinten/TE-Seite, yTop = oben). Letzter Schnitt = waag-
    // rechte Blockunterkante; der Schließzug fährt an der TE-Kante hoch zum Start.
    path.push({ x: xBR, y: yTop });                   // Start: hintere obere Blockkante
    path.push({ x: xBL, y: yTop });                   // horizontal über den Block (Oberkante)
    path.push({ x: xBL, y: yLE + s2 });               // vertikal runter (Nasenseite) bis oberer Schlitz
    for (let i = upperTEtoLE.length - 1; i >= 0; i--) path.push(upperTEtoLE[i]); // OBERE SCHALE Nase→TE
    path.push(atBR({ x: xTE, y: yTE + s2 }));         // Schlitz nach hinten (obere Schale fertig)
    // Kern(e) mit Nasen-Schlaufe im TE-Bereich (aus xBR heraus angefahren, nicht
    // von außen durch den Block).
    const emitCores = () => {
      // Kern in Stege zerlegt (stege.js): die Steg-Bahn ersetzt die Kern-Schlaufe.
      if (geom.stege && geom.stege.length && App.stegeEmit) {
        const ap = App.stegeEmit(path, geom.stege, xBR, xBL, Math.max(geom.noseExt || 0, 0) / 2, teSlope);
        if (ap) noseApex.push(ap);
        return;
      }
      const cores = geom.cores && geom.cores.length ? geom.cores : (geom.corePts ? [geom.corePts] : []);
      cores.forEach(C => {
        // LE deterministisch (wie oben) statt min-x -> Wurzel/Rand teilen den Kern
        // an derselben Stelle, auch wenn die Nase minimal negativ-x überschwingt.
        const iLEc = Math.ceil(C.length / 2) - 1;
        const nose = C[iLEc], teCoreU = C[0], teCoreL = C[C.length - 1];
        const hv = Math.max(geom.noseExt || 0, 0) / 2;
        const N1 = { x: nose.x - hv, y: nose.y - hv }, N2 = { x: xBL, y: nose.y - hv };
        const N3 = { x: xBL, y: nose.y + hv }, N4 = { x: nose.x - hv, y: nose.y + hv };
        path.push(atBR(teCoreU));
        for (let i = 0; i < iLEc + 1; i++) path.push(C[i]);   // Kern OBERSEITE TE→Nase
        const apexUp = path.length - 1;                       // Nasenspitze (1. Besuch)
        path.push(N1, N2, N3, N4);                            // Nasen-Schlaufe
        const apexLo = path.length;                           // Nasenspitze (2. Besuch)
        for (let i = iLEc; i < C.length; i++) path.push(C[i]); // Kern UNTERSEITE Nase→TE
        path.push(atBR(teCoreL));
        // Doppelt besuchte Nasenspitze merken — der spätere kerf-Versatz spreizt
        // die beiden Besuche sonst mit unterschiedlichen Normalen auseinander und
        // erzeugt an der Nasen-Schlaufe einen Haken (Fehler an der Nasen-
        // verlängerung). WIE IM KERNDESIGN: beide Besuche werden nach dem Versatz
        // auf GENAU EINEN Punkt (Miter der beiden Kern-Oberflächenkanten) gezogen.
        noseApex.push({ apexUp, apexLo,
          prev: C[iLEc > 0 ? iLEc - 1 : 0], nose: nose,
          next: C[iLEc < C.length - 1 ? iLEc + 1 : C.length - 1] });
      });
    };
    // Stützstoff als VERSETZTE FLÄCHEN (Schalenbauweise, wie im DXF): je Schale
    // eine oder zwei nach INNEN versetzte Flächen, an den Blockkanten verbunden.
    //   supOffsets[0] = Abstand der 1. Fläche zur Schale (Spalt)
    //   supOffsets[1] = Abstand der 2. Fläche zur Schale (= Spalt + Dicke)
    // Der Streifen zwischen Fläche 1 und Fläche 2 ist der Stützstoff.
    const supO = geom.supOffsets || [];
    if (supO.length >= 1) {
      const d1 = supO[0], d2 = supO.length >= 2 ? supO[1] : null;
      // supNose merkt je Stützfläche die Nasen-Ecke: corner = Nasenpunkt der Fläche,
      // surf = benachbarter Flächenpunkt, horiz = benachbarter Blockvorderkanten-Punkt.
      // Der kerf-Versatz spitzt diese ~90°-Ecke sonst nach oben/vorne (Haken am
      // Übergang zur Horizontalen) — nach dem Versatz werden corner+horiz auf die
      // Höhe des Flächenpunkts gezogen -> sauberer, bündiger Übergang.
      // Obere Stützfläche 1 (Spalt d1): TE→Nase.
      path.push(atBR({ x: xTE, y: yTE + s2 - d1 }));
      for (let i = 0; i < upperTEtoLE.length; i++) path.push({ x: upperTEtoLE[i].x, y: upperTEtoLE[i].y - d1 });
      const cU1 = path.length - 1;
      path.push({ x: xBL, y: yLE + s2 - d1 });
      supNose.push({ corner: cU1, surf: cU1 - 1, horiz: cU1 + 1 });
      if (d2 != null) {
        // Obere Stützfläche 2 (d2): Nase→TE.
        const hU2 = path.length; path.push({ x: xBL, y: yLE + s2 - d2 });
        supNose.push({ corner: hU2 + 1, surf: hU2 + 2, horiz: hU2 });
        for (let i = upperTEtoLE.length - 1; i >= 0; i--) path.push({ x: upperTEtoLE[i].x, y: upperTEtoLE[i].y - d2 });
        path.push(atBR({ x: xTE, y: yTE + s2 - d2 }));
        emitCores();
        // Untere Stützfläche 2 (d2): TE→Nase (über den Innenraum an der EL).
        path.push(atBR({ x: xTE, y: yTE - s2 + d2 }));
        for (let i = lowerLEtoTE.length - 1; i >= 0; i--) path.push({ x: lowerLEtoTE[i].x, y: lowerLEtoTE[i].y + d2 });
        const cL2 = path.length - 1;
        path.push({ x: xBL, y: yLE - s2 + d2 });
        supNose.push({ corner: cL2, surf: cL2 - 1, horiz: cL2 + 1 });
        // Untere Stützfläche 1 (d1): Nase→TE.
        const hL1 = path.length; path.push({ x: xBL, y: yLE - s2 + d1 });
        supNose.push({ corner: hL1 + 1, surf: hL1 + 2, horiz: hL1 });
        for (let i = 0; i < lowerLEtoTE.length; i++) path.push({ x: lowerLEtoTE[i].x, y: lowerLEtoTE[i].y + d1 });
        path.push(atBR({ x: xTE, y: yTE - s2 + d1 }));
      } else {
        // Nur eine versetzte Fläche je Schale: über den Innenraum an der Nase.
        const hL1 = path.length; path.push({ x: xBL, y: yLE - s2 + d1 });
        supNose.push({ corner: hL1 + 1, surf: hL1 + 2, horiz: hL1 });
        for (let i = 0; i < lowerLEtoTE.length; i++) path.push({ x: lowerLEtoTE[i].x, y: lowerLEtoTE[i].y + d1 });
        path.push(atBR({ x: xTE, y: yTE - s2 + d1 }));
        emitCores();
      }
      path.push(atBR({ x: xTE, y: yTE - s2 }));           // Schritt nach außen zur unteren Kavität
    } else {
      emitCores();
      path.push(atBR({ x: xTE, y: yTE - s2 }));           // auf Höhe der unteren Schale
    }
    for (let i = lowerLEtoTE.length - 1; i >= 0; i--) path.push(lowerLEtoTE[i]); // UNTERE SCHALE TE→Nase
    path.push({ x: xBL, y: yLE - s2 });               // Schlitz nach vorne (Nase unten)
    path.push({ x: xBL, y: yBot });                   // vertikal runter bis Blockunterkante
    path.push({ x: xBR, y: yBot });                   // horizontal (Blockunterkante) — letzter Schnitt
    return {
      path, noseApex, supNose, cy: blockCy, ownCy, geom, xL, xT, xBL, xBR, yBot, yTop, s2, yLE, yTE, xTE, teSlope,
      block: rect(xBL, yBot, xBR, yTop)
    };
  }
  /* Miterpunkt der Kern-Nasenspitze (nach VORNE, kleineres x) für den gegebenen
   * kerf-Versatz — dieselbe Winkelhalbierenden-Rechnung wie in HotWire.offsetPath.
   * Beide Besuche der doppelt gefahrenen Nasenspitze werden hierauf gezogen, damit
   * die Nasen-Schlaufe sauber an EINEM Punkt schließt (kein Haken). */
  function negNoseMiter(prev, nose, next, gap) {
    const g = gap || 0;
    const en = (a, b, s) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; return { x: dy * s / L, y: -dx * s / L }; };
    let n1 = en(prev, nose, 1), n2 = en(nose, next, 1);
    let bx = n1.x + n2.x, by = n1.y + n2.y; const L = Math.hypot(bx, by);
    if (L < 1e-9) return { x: nose.x, y: nose.y };   // entartet — Spitze belassen
    bx /= L; by /= L;
    if (bx > 0) { n1 = { x: -n1.x, y: -n1.y }; bx = -bx; by = -by; }   // Miter nach vorne (−x)
    const cosHalf = Math.max(0.35, n1.x * bx + n1.y * by);
    const s = g / cosHalf;
    return { x: nose.x + bx * s, y: nose.y + by * s };
  }
  /* Kern-Nasenspitzen enthaken: beide Besuche der Nasen-Schlaufe (durch den
   * kerf-Versatz auseinandergezogen) auf EINEN Miterpunkt ziehen — analog zur
   * Nasen-X-Schlaufe im Kerndesign. Mutiert rp/tp in-place; Punktzahl bleibt
   * erhalten -> Türme synchron. */
  function negSnapNoseApex(rp, tp, root, tip, kg) {
    const gAt = (g, i) => Array.isArray(g) ? (g[i] || 0) : g;
    (root.noseApex || []).forEach((ap, k) => {
      const tap = tip.noseApex[k]; if (!tap) return;
      const sR = negNoseMiter(ap.prev, ap.nose, ap.next, gAt(kg.gapR, ap.apexUp));
      const sT = negNoseMiter(tap.prev, tap.nose, tap.next, gAt(kg.gapT, tap.apexUp));
      if (rp[ap.apexUp]) rp[ap.apexUp] = { x: sR.x, y: sR.y, k: rp[ap.apexUp].k };
      if (rp[ap.apexLo]) rp[ap.apexLo] = { x: sR.x, y: sR.y, k: rp[ap.apexLo].k };
      if (tp[tap.apexUp]) tp[tap.apexUp] = { x: sT.x, y: sT.y, k: tp[tap.apexUp].k };
      if (tp[tap.apexLo]) tp[tap.apexLo] = { x: sT.x, y: sT.y, k: tp[tap.apexLo].k };
    });
    // Stützstoff-Nasenecken: den kerf-Haken am Übergang Fläche→Horizontale glätten.
    // Der ~90°-Eckpunkt (corner) und der Blockvorderkanten-Punkt (horiz) werden auf
    // die Höhe des angrenzenden Flächenpunkts (surf) gezogen -> bündiger Übergang.
    const snapSup = (P, list) => {
      if (!list) return;
      list.forEach(sn => {
        const s = P[sn.surf]; if (!s) return;
        if (P[sn.corner]) P[sn.corner] = { x: P[sn.corner].x, y: s.y, k: P[sn.corner].k };
        if (P[sn.horiz]) P[sn.horiz] = { x: P[sn.horiz].x, y: s.y, k: P[sn.horiz].k };
      });
    };
    snapSup(rp, root.supNose);
    snapSup(tp, tip.supNose);
  }
  /* Kerf-Offset der Negativschalen-Bahn.
   *
   * Bei KONSTANTEM Abbrand (ratio-Modus, gap = Zahl) verwenden wir einen
   * ECHTEN Parallel-Offset (negParallelOffset): jede Kante wird senkrecht um
   * gap verschoben, benachbarte versetzte Kanten werden per Schnittpunkt
   * verbunden. Ergebnis: horizontale Schalenkanten bleiben horizontal,
   * vertikale bleiben vertikal, 90°-Ecken bleiben scharfe 90°-Ecken —
   * und die Überschieß-Schlaufen an der Nase (Winkelhalbierenden-Miter
   * von offsetPath bei kurzen Profilen + viel Abbrand) entfallen von
   * Grund auf. Punktzahl bleibt identisch (n rein, n raus) -> Türme sync.
   *
   * Bei VARIABLEM Abbrand (speed-Modus, gap = Array je Punkt) fällt die
   * Kanten-Parallelisierung raus (jede Ecke braucht zwei unterschiedliche
   * Kanten-Versatzweiten) — dort weiter der bisherige Winkelhalbierenden-
   * Miter über HotWire.offsetPath.
   *
   * Richtung: exakt wie HotWire.offsetPath (gleiche winding-/Normalen-
   * konvention) -> Kerf-Kompensation nach außen (in die Waste). An SCHARFEN
   * Ecken (Profilnase) fällt der Kanten-Schnittpunkt sonst ins Unendliche
   * (Spike) — dort wird auf den begrenzten Winkelhalbierenden-Miter
   * zurückgegriffen (cosHalf>=0.35, wie HotWire). Punktzahl bleibt gleich. */
  function negParallelOffset(pts, g) {
    const n = pts.length;
    if (!g) return pts.map(p => ({ x: p.x, y: p.y }));
    // winding-Vorzeichen (Shoelace) — identisch zu HotWire.winding.
    let a2 = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; a2 += pts[i].x * pts[j].y - pts[j].x * pts[i].y; }
    const dir = a2 > 0 ? 1 : -1;
    // Kantennormale wie HotWire.edgeNormal.
    const eN = (p, q) => { const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1; return { x: dir * dy / L, y: -dir * dx / L }; };
    // Nachbar-Index ohne Nulllängenkanten (wie HotWire.neighborIdx).
    const nb = (i, s) => { for (let k = 1; k <= n; k++) { const j = (i + s * k + n * k) % n; if (Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) > 1e-9) return j; } return (i + s + n) % n; };
    const kk = Math.abs(g) * 2;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[nb(i, -1)], b = pts[i], c = pts[nb(i, 1)];
      const n1 = eN(a, b), n2 = eN(b, c);
      // Begrenzter Winkelhalbierenden-Miter (Rückfall für scharfe/parallele Ecken).
      let bx = n1.x + n2.x, by = n1.y + n2.y; const bl = Math.hypot(bx, by);
      const miter = () => {
        if (bl < 1e-9) return { x: b.x + n1.x * g, y: b.y + n1.y * g, k: kk };
        const nx = bx / bl, ny = by / bl;
        const cosHalf = Math.max(0.35, n1.x * nx + n1.y * ny);
        const s = g / cosHalf;
        return { x: b.x + nx * s, y: b.y + ny * s, k: kk };
      };
      // Schnittpunkt der beiden PARALLEL versetzten Kanten (echter Parallel-Offset).
      const p1x = a.x + n1.x * g, p1y = a.y + n1.y * g, d1x = b.x - a.x, d1y = b.y - a.y;
      const p2x = b.x + n2.x * g, p2y = b.y + n2.y * g, d2x = c.x - b.x, d2y = c.y - b.y;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) { out[i] = miter(); continue; }
      const t = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / den;
      const ix = p1x + t * d1x, iy = p1y + t * d1y;
      // Miterlänge begrenzen — bei scharfer Ecke Spike vermeiden.
      if (Math.hypot(ix - b.x, iy - b.y) > Math.abs(g) / 0.35) { out[i] = miter(); continue; }
      out[i] = { x: ix, y: iy, k: kk };
    }
    return out;
  }
  function negShellOffset(path, gap) {
    if (Array.isArray(gap)) return HotWire.offsetPath(path, gap, null);   // Speed-Modus: alter Miter
    if (!gap) return path.map(p => ({ x: p.x, y: p.y }));
    return negParallelOffset(path, gap);
  }
  // Selbstüberschneidungen in einem OFFENEN Teilstück entfernen (Endpunkte
  // bleiben erhalten): die eingeschlossene Schlaufe [a+1..b] wird durch den
  // Kreuzungspunkt ersetzt. Nur für die lokale Nasen-Reparatur.
  function deloopOpen(seg) {
    let P = seg.map(p => ({ x: p.x, y: p.y, k: p.k }));
    for (let pass = 0; pass < 60; pass++) {
      const m = P.length; if (m < 4) break;
      let hit = null;
      for (let a = 0; a < m - 1 && !hit; a++) {
        for (let b = a + 2; b < m - 1; b++) {
          const X = segCross(P[a], P[a + 1], P[b], P[b + 1]);
          if (X) { hit = { a, b, X }; break; }
        }
      }
      if (!hit) break;
      P = P.slice(0, hit.a + 1).concat([{ x: hit.X.x, y: hit.X.y, k: P[hit.a].k }], P.slice(hit.b + 1));
    }
    return P;
  }
  // OFFENES Teilstück bogenlängen-gleich auf exakt n Punkte abtasten (Endpunkte
  // bleiben exakt). Geometrieerhaltend — die Punkte liegen auf dem Teilstück.
  function resampleOpenN(seg, n) {
    const m = seg.length;
    if (m < 2 || n < 2) return seg.slice();
    const cum = [0];
    for (let i = 1; i < m; i++) cum.push(cum[i - 1] + Math.hypot(seg[i].x - seg[i - 1].x, seg[i].y - seg[i - 1].y));
    const tot = cum[m - 1] || 1;
    const out = [];
    let g = 0;
    for (let q = 0; q < n; q++) {
      const tg = tot * q / (n - 1);
      while (g < m - 2 && cum[g + 1] < tg) g++;
      const l = (cum[g + 1] - cum[g]) || 1, fr = (tg - cum[g]) / l;
      out.push({ x: seg[g].x + fr * (seg[g + 1].x - seg[g].x), y: seg[g].y + fr * (seg[g + 1].y - seg[g].y), k: seg[g].k });
    }
    return out;
  }
  /* Sicherheitsnetz nach dem Offset — REIN LOKAL: bei einer echten Selbst-
   * überschneidung wird NUR das kleine betroffene Teilstück [i..j+1] repariert
   * (Schlaufe raus, danach wieder auf die GLEICHE Punktzahl abgetastet), der
   * REST der Bahn bleibt Byte-für-Byte unverändert. Dadurch bleibt die parallele
   * Offset-Geometrie überall erhalten (auch die eng gekrümmte Nase — die Punkt-
   * dichte im Teilstück bleibt gleich); nur die winzige Schlaufe wird geglättet.
   * Das GLEICHE Indexfenster wird auf Wurzel UND Rand angewandt (auch wenn nur
   * eine der beiden kreuzt) und beide auf dieselbe Punktzahl abgetastet -> Türme
   * bleiben synchron. `maxSpan` begrenzt das Fenster auf echte lokale Loops. */
  function negDeloopSync(A, B, maxSpan) {
    const cap = maxSpan || 24;
    A = A.map(p => ({ x: p.x, y: p.y, k: p.k })); B = B.map(p => ({ x: p.x, y: p.y, k: p.k }));
    for (let pass = 0; pass < 60; pass++) {
      const n = Math.min(A.length, B.length); if (n < 6) break;
      let hit = null;
      for (let i = 0; i < n - 2 && !hit; i++) {
        const jMax = Math.min(n - 2, i + cap);
        for (let j = i + 2; j <= jMax; j++) {
          if (segCross(A[i], A[i + 1], A[j], A[j + 1]) || segCross(B[i], B[i + 1], B[j], B[j + 1])) { hit = { i, j }; break; }
        }
      }
      if (!hit) break;
      const { i, j } = hit;
      const cnt = j - i + 2;                              // Punkte im Fenster [i..j+1]
      const fix = P => resampleOpenN(deloopOpen(P.slice(i, j + 2)), cnt);
      const rA = fix(A), rB = fix(B);
      A = A.slice(0, i).concat(rA, A.slice(j + 2));
      B = B.slice(0, i).concat(rB, B.slice(j + 2));
    }
    return [A, B];
  }
  // Kernkontur (Profil, optional um Beplankung nach innen versetzt) für die
  // Negativschale — auf N Punkte resampled, damit Wurzel/Rand synchron bleiben.
  function negCoreContour(pts, sheeting) {
    if (!(sheeting > 0)) return pts.map(p => ({ x: p.x, y: p.y }));
    return Airfoil.resample(HotWire.trimTE(HotWire.offsetPath(pts, -sheeting, null)), pts.length);
  }
  // Stützstoff (Flächen-Modus): Abstände der versetzten Flächen zur Schale.
  //   [0] = Spalt Schale→1. Fläche, [1] = Spalt + Dicke (2. Fläche).
  // Bei Dicke 0 nur EINE Fläche (Spalt).
  function negSupportOffsets() {
    const gap = state.cfg.negSupportGap || 0, thick = state.cfg.negSupportMM || 0;
    return thick > 0 ? [gap, gap + thick] : [gap];
  }
  /* kerf-Kompensation der Negativschale — WIE BEI DEN KERNEN: der Abbrand (kerf)
   * hängt von der Draht-Geschwindigkeit ab. Beide Türme erreichen jeden Punkt
   * gleichzeitig -> die kürzere Rippe (meist außen) läuft langsamer -> breiterer
   * kerf. Rückgabe: gapR/gapT = Versatz je Punkt (kerf/2), Wurzel/Rand getrennt.
   *   kerfMode 'speed' : lokal je Schnittsegment aus den Segmentlängen.
   *   kerfMode 'ratio' : ein kerf je Rippe aus dem Sehnenverhältnis (cutKerf). */
  function negSpeedGaps(rp, tp) {
    const id = App.matIdFor('neg'), F = App.currentFeed() || 1;
    const n = Math.min(rp.length, tp.length), nSeg = Math.max(1, n - 1);
    const kR = new Array(nSeg), kT = new Array(nSeg);
    for (let i = 0; i < nSeg; i++) {
      const dR = Math.hypot(rp[i + 1].x - rp[i].x, rp[i + 1].y - rp[i].y);
      const dT = Math.hypot(tp[i + 1].x - tp[i].x, tp[i + 1].y - tp[i].y);
      const md = Math.max(dR, dT) || 1e-9;             // längere Seite = voller Vorschub
      kR[i] = App.kerfForSpeed(id, F * dR / md, F);
      kT[i] = App.kerfForSpeed(id, F * dT / md, F);
    }
    const gapR = new Array(n), gapT = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(nSeg - 1, i);
      gapR[i] = (kR[a] + kR[b]) / 4;                   // halber (gemittelter) kerf
      gapT[i] = (kT[a] + kT[b]) / 4;
    }
    return { gapR, gapT };
  }
  function negKerf(rootPath, tipPath, rootChord, tipChord) {
    if ((state.cfg.negKerfMode || 'ratio') === 'speed') return negSpeedGaps(rootPath, tipPath);
    const ck = App.cutKerf(rootChord, tipChord);           // kerf je Rippe (innen/außen) aus dem Geschwindigkeitsverhältnis
    return { gapR: ck.root / 2, gapT: ck.tip / 2 };
  }
  // Referenz-Sehne für die proportionalen Blocküberstände = Wurzel des 1. Segments.
  function negRefChord() { return (App.wing && App.wing.cuts[0] && App.wing.cuts[0].root.chord) || 1; }
  /* Geom je Rippe: Blocküberstände (ovF/ovR) sind für die Wurzel des 1. Segments
   * vorgegeben und skalieren PROPORTIONAL zur Profillänge. Dadurch sind Wurzel-
   * und Randquerschnitt geometrisch ähnlich -> die Draht-Geschwindigkeit bleibt
   * über die Spannweite konstant und die einfache (Sehnenverhältnis-)kerf-
   * Kompensation ist exakt. */
  function negRibGeom(geom, blockCy, cores, chord, supOffsets, stege) {
    const s = (chord || 0) / negRefChord();
    // Schneideweg „ein Zug": Block vorne/hinten = KONSTANTER Schalenüberstand je Rippe.
    const se = negDirectPath() ? Math.max(0, state.cfg.negShellEdge || 0) : null;
    return Object.assign({}, geom, {
      blockCy, cores: cores || [], supOffsets: supOffsets || [], noseExt: state.cfg.negNoseExt, teStyle: state.cfg.negTeStyle || 'horizontal', stege: stege || null, stegeOnly: !!state.cfg.negStegeOnly,
      ovF: se != null ? se : (geom.ovF || 0) * s, ovR: se != null ? se : (geom.ovR || 0) * s
    });
  }
  /* Schneideweg „Konstanter Schalenüberstand, ein Zug" (cfg.negCutPath 'direct'):
   * Blockvorder-/-hinterkante liegen genau auf Nase − negShellEdge / EL + negShellEdge
   * (konstant, nicht proportional zur Sehne). Keine Schnittverlängerung, keine
   * Randvorschnitte mit Freifahren — der Umriss schneidet die Schalenränder selbst:
   * hinten oben Start, oben nach vorne, runter auf Nasenhöhe, waagrecht auf die Nase …
   * Bei „Nur Stege schneiden" gibt es keine Schalen -> bisheriger Weg. */
  function negDirectPath() {
    return state.cfg.negCutPath === 'direct' && !(App.stegeOn && App.stegeOn() && state.cfg.negStegeOnly);
  }

  /* Werkstoff-Block (Reiter „Werkstoff": Höhe/Dicke) um den Negativblock: gleiche
   * X-Ausdehnung wie der Negativblock, Höhe = Werkstoffhöhe. Der Formblock
   * (Negativblock) sitzt mittig darin und wird über negMatShift der Höhe nach
   * verschoben (positiv = Formblock nach oben im Werkstoff) — für alle Segmente
   * gemeinsam. Cut-Koordinaten. */
  function negMatBlock(root) {
    const H = App.blockH('neg') || 0;
    const cy = (root.yBot + root.yTop) / 2 - (state.cfg.negMatShift || 0);
    return { H, yBot: cy - H / 2, yTop: cy + H / 2, rect: rect(root.xBL, cy - H / 2, root.xBR, cy + H / 2) };
  }
  /* GEMEINSAME Blockmitte ALLER Segmente der aktiven Tragfläche (Cut-mm).
   * Die Negativschalen der einzelnen Trapeze werden später aneinandergesetzt: an
   * jeder Stoßrippe müssen Blockober-/-unterkante und damit auch die waagrechten
   * Schnittverlängerungen vorne (Nase) und hinten (Endleiste) auf GENAU derselben
   * Höhe liegen. Da der Block je Segment waagrecht ist, geht das nur mit EINER
   * Blockmitte für alle Segmente — sonst springt die Blocklage (und mit ihr der
   * G-Code-Nullpunkt an der Werkstoff-Unterkante) an jedem Segmentstoß.
   * Bezug ist daher NICHT mehr das Segment, sondern die ganze Tragfläche: Mitte
   * zwischen der tiefsten und der höchsten Rippen-Sehnenmitte -> die V-Form-Spanne
   * liegt mittig im Block. negProfShift = „Trennebene im Formblock heben/senken":
   * die Trennebene (Profilsehne mit dem Auseinanderziehen) und damit die ganze
   * Tragfläche wandern gemeinsam in allen Segmenten im Block nach oben (positiv)
   * -> obere Formhälfte dünner, untere dicker; die Blockmitte rückt relativ
   * dazu nach unten. */
  function negBlockCy() {
    const cuts = (App.wing && App.wing.cuts) || [];
    let lo = Infinity, hi = -Infinity;
    cuts.forEach((c, k) => {
      const ys = [negChordMidY(negRibPts(c, k, 'root')), negChordMidY(negRibPts(c, k, 'tip'))];
      ys.forEach(y => { if (y < lo) lo = y; if (y > hi) hi = y; });
    });
    const mid = isFinite(lo) ? (lo + hi) / 2 : 0;
    return mid - (state.cfg.negProfShift || 0);
  }
  /* Negativdesign, OBERES Ansichtsfenster: Aufriss (Ansicht von vorne) über die
   * ganze Spannweite. Waagrecht = Spannweite (aufsummierte Segmentbreiten),
   * senkrecht = Höhe. Je Segment werden Werkstoffblock, Negativblock und die
   * Kavität (Profilhöhe inkl. „Ober-/Unterseite auseinanderziehen") in IHRER
   * echten Höhenlage gezeichnet — die V-Form bleibt so als Steigung bzw. als
   * Stufe an einer Stoßstelle sichtbar. Alle Höhen stammen aus denselben Werten
   * wie der Querschnitt darunter (renderNeg_): EINE gemeinsame Blockmitte für alle
   * Segmente (negBlockCy), Trennebene um negProfShift verschoben, Werkstoff
   * mittig um den Formblock -> Block- und Werkstoffkanten laufen über alle
   * Segmente durch. */
  function negElevGeom() {
    if (!App.wing || !App.wing.cuts || !App.wing.cuts.length || !App.segZ || !App.segZ.length) return [];
    const s2 = Math.max(0, +state.cfg.negSplit || 0) / 2;
    const H = +state.cfg.negBlockH || 0;
    const MH = App.blockH('neg') || 0;
    const ext = pts => {
      let lo = Infinity, hi = -Infinity;
      pts.forEach(p => { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; });
      return { lo: lo - s2, hi: hi + s2 };
    };
    const cy = negBlockCy();   // für ALLE Segmente dieselbe Blockmitte
    return state.segments.map((sg, k) => {
      const cut = App.wing.cuts[Math.min(k, App.wing.cuts.length - 1)];
      const rPts = negRibPts(cut, k, 'root'), tPts = negRibPts(cut, k, 'tip');
      const rMid = negChordMidY(rPts), tMid = negChordMidY(tPts);
      const mcy = cy - (state.cfg.negMatShift || 0);   // Formblock im Werkstoff (heben/senken)
      const z = App.segZ[Math.min(k, App.segZ.length - 1)];
      return { k, z0: z.z0, z1: z.z1, r: ext(rPts), t: ext(tPts), rMid, tMid,
               bH: H, bBot: cy - H / 2, bTop: cy + H / 2,
               mH: MH, mBot: mcy - MH / 2, mTop: mcy + MH / 2 };
    });
  }
  let negElevPick = null;   // {inv, segZ} — Klick im Aufriss -> Segment aktivieren
  function drawNegElev() {
    const cv = document.getElementById('cNegElev'); if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    const G = negElevGeom();
    if (!G.length) {
      negElevPick = null;
      ctx.fillStyle = App.PAL.muted || '#8a97a6'; ctx.font = '12px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(T('Keine Tragfläche.'), w / 2, h / 2); ctx.textAlign = 'left'; return;
    }
    const cav = g => [{ x: g.z0, y: g.r.hi }, { x: g.z1, y: g.t.hi }, { x: g.z1, y: g.t.lo }, { x: g.z0, y: g.r.lo }];
    const blk = g => rect(g.z0, g.bBot, g.z1, g.bTop);
    const mat = g => rect(g.z0, g.mBot, g.z1, g.mTop);
    // Rand: bei einem flachen Fenster (kleine Teilung) mitschrumpfen — mit festem
    // Rand würde der Maßstab negativ und die Ansicht kippen.
    const pad = Math.max(6, Math.min(46, Math.min(w, h) * 0.18));
    const V = makeView(w, h, bounds.apply(null, G.map(cav).concat(G.map(blk), G.map(mat))), pad, nav.negelev);
    grid(ctx, w, h, V);
    const MAT_COL = App.PAL.mat || '#c9a25e', MAT_FILL = hexA(MAT_COL, 0.10);
    const act = Math.max(0, Math.min(App.activeIdx(), G.length - 1));
    // Werkstoff- und Negativblock je Segment (wie im Querschnitt): Werkstoff in
    // eigener Farbe (PAL.mat, durchgezogen, leicht gefüllt) außen, Negativblock
    // in Blockfarbe (gestrichelt) darin — zwei klar unterscheidbare Rahmen.
    G.forEach(g => {
      if (g.mH <= 0) return;
      poly(ctx, V, mat(g), true); ctx.fillStyle = MAT_FILL; ctx.fill();
      ctx.strokeStyle = MAT_COL; ctx.lineWidth = 1.2; ctx.setLineDash(dashFor('mat', [])); ctx.stroke(); ctx.setLineDash([]);
    });
    G.forEach(g => { if (g.bH > 0) drawBlock(ctx, V, blk(g), App.PAL.block); });
    // Kavität in Segmentfarbe — aktives Segment kräftig (wie im Tragflächen-Aufriss).
    G.forEach(g => {
      poly(ctx, V, cav(g), true);
      const c = SEGCOL[g.k % SEGCOL.length];
      ctx.fillStyle = hexA(c, g.k === act ? 0.28 : 0.10);
      ctx.strokeStyle = c; ctx.lineWidth = g.k === act ? 2.5 : 1.5; ctx.setLineDash([]);
      ctx.fill(); ctx.stroke();
    });
    // Profilsehne (V-Form-Verlauf) je Segment, mit Stufe bei Wurzelversatz.
    ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    G.forEach(g => { poly(ctx, V, [{ x: g.z0, y: g.rMid }, { x: g.z1, y: g.tMid }], false); ctx.stroke(); });
    ctx.setLineDash([]);
    negElevPick = { inv: V.inv, segZ: G.map(g => ({ z0: g.z0, z1: g.z1 })) };
    // Segmentnummer über dem Block, V-Form-Höhe/Winkel am Außenende.
    ctx.font = '11px Segoe UI';
    G.forEach(g => {
      const top = Math.max(g.mTop, g.bTop, g.r.hi, g.t.hi);
      ctx.fillStyle = g.k === act ? SEGCOL[g.k % SEGCOL.length] : '#8b98a8';
      ctx.textAlign = 'center';
      ctx.fillText('Seg ' + (g.k + 1), (V.X(g.z0) + V.X(g.z1)) / 2, V.Y(top) - 8);
      const st = App.wing.stations && App.wing.stations[g.k + 1];
      if (st) {
        ctx.fillStyle = '#8b98a8'; ctx.textAlign = 'right';
        ctx.fillText('+' + Math.round(st.yRise) + 'mm / ' + (st.dihAngle || 0).toFixed(1) + '°', V.X(g.z1) - 6, V.Y(g.t.hi) - 8);
      }
    });
    ctx.textAlign = 'left';
    // Bemaßung: von den Maßen des Segments liegt hier nur die Spannweite in der
    // Zeichenebene (Sehne und Blockhöhe stehen senkrecht dazu bzw. im Querschnitt).
    if (state.cfg.showDim) {
      const g = G[act];
      const yBase = Math.min.apply(null, G.map(q => Math.min(q.mBot, q.bBot, q.r.lo, q.t.lo)));
      dim(ctx, V, g.z0, yBase, g.z1, yBase, String(Math.round(g.z1 - g.z0)), { off: 34, color: '#57d38c' });
    }
    const leg = [];
    leg.push(L(SEGCOL[act % SEGCOL.length], T('Kavität = Profil + Auseinanderziehen (aktives Segment kräftig)'), [], 'line', 2.5));
    if (G[0].bH > 0) leg.push(L(App.PAL.block, T('Negativblock ') + Math.round(G[0].bH) + T(' mm hoch'), dashFor('block', [7, 5]), 'rect'));
    if (G[0].mH > 0) leg.push(Object.assign(L(MAT_COL, T('Werkstoff ') + Math.round(G[0].mH) + T(' mm hoch'), dashFor('mat', []), 'rect'), { f: MAT_FILL }));
    leg.push(L('#ffffff88', T('Profilsehne (V-Form-Verlauf)'), [5, 4], 'line', 1.5));
    leg.push(['#8b98a8', T('Klick: Segment aktiv schalten')]);
    // Gemeinsame Blockmitte: Der Block muss die V-Form der GANZEN Tragfläche
    // fassen — Segmente, deren Kavität oben/unten herausragt, hier melden.
    const outOf = (g, bot, top, H) => H > 0 && (g.r.hi > top + 1e-6 || g.t.hi > top + 1e-6
                                             || g.r.lo < bot - 1e-6 || g.t.lo < bot - 1e-6);
    const over = G.filter(g => outOf(g, g.bBot, g.bTop, g.bH) || outOf(g, g.mBot, g.mTop, g.mH));
    if (over.length)
      leg.push([App.PAL.bad, T('⚠ Kavität ragt aus dem Block — Segment ')
        + over.map(g => g.k + 1).join(', ') + T(' (Blockhöhe erhöhen oder Tragfläche heben/senken)')]);
    drawLegend(ctx, 14, 20, leg, { top: true });
  }
  // Klick in den Negativ-Aufriss -> Segment aktivieren (nur echter Klick, kein Ziehen).
  function setupNegElevPick() {
    const cv = document.getElementById('cNegElev'); if (!cv) return;
    cv.addEventListener('click', e => {
      const v = nav.negelev; if (v && v.moved) return;      // war ein Verschieben
      if (!negElevPick) return;
      const r = cv.getBoundingClientRect();
      const p = negElevPick.inv(e.clientX - r.left, e.clientY - r.top);
      const seg = negElevPick.segZ.findIndex(q => p.x >= q.z0 && p.x <= q.z1);
      if (seg < 0 || seg === state.activeSeg) return;
      state.activeSeg = seg;
      App.buildSidebar(); renderNeg();
    });
  }
  // Teilung Aufriss (oben) / Querschnitt (unten) im Reiter „Negativschalendesign".
  function applyNegSplit() {
    const stack = document.getElementById('negStack');
    const bar = document.getElementById('negElevSplit');
    if (!stack) return;
    const f = Math.max(0.15, Math.min(0.85, state.cfg.negViewSplit || 0.3));
    stack.style.gridTemplateColumns = '1fr';
    stack.style.gridTemplateRows = f + 'fr ' + (1 - f) + 'fr';
    if (bar) { bar.style.display = 'block'; bar.style.top = (f * 100) + '%'; }
  }
  function setupNegSplit() {
    const stack = document.getElementById('negStack');
    const bar = document.getElementById('negElevSplit');
    if (!stack || !bar) return;
    bar.addEventListener('mousedown', e => {
      e.preventDefault();
      const mv = ev => {
        const r = stack.getBoundingClientRect();
        state.cfg.negViewSplit = Math.max(0.15, Math.min(0.85, (ev.clientY - r.top) / r.height));
        applyNegSplit(); renderNeg();
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
  }

  /* Reiter „Negativschalendesign": zeichnet den Negativschalen-Querschnitt des
   * aktiven Segments (Innen-/Wurzelprofil durchgezogen, Außenprofil gestrichelt). */
  // Während der Negativschalen-Darstellung gilt die Werkstoff-Zuweisung „Negativschalen".
  function renderNeg() {
    App.matCtxOverride = 'neg';
    try { renderNeg_(); drawNegElev(); } finally { App.matCtxOverride = null; if (App.meas2dOverlay) App.meas2dOverlay('neg'); }
  }
  function renderNeg_() {
    const cv = document.getElementById('cNeg');
    if (!cv || !App.wing || !App.wing.cuts || !App.wing.cuts.length) return;
    const { ctx, w, h } = fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    const idx = App.activeIdx();
    const cut = App.wing.cuts[Math.min(idx, App.wing.cuts.length - 1)];
    // Quellprofile NUR aus dem Tragflächendesign (flipY zurückgerechnet) bzw. aus
    // dem Negativ-Override — kein Kerndesign-Einfluss. Siehe negRibPts().
    const rPts = negRibPts(cut, idx, 'root'), tPts = negRibPts(cut, idx, 'tip');
    const geom = { H: state.cfg.negBlockH, ovF: state.cfg.negOvF, ovR: state.cfg.negOvR, split: state.cfg.negSplit };
    // Blockmitte: für ALLE Segmente dieselbe (negBlockCy) — nur so passen die
    // Schalen an den Segmentstößen zusammen. Die Profile behalten ihre echte Höhe
    // -> die V-Form bleibt als vertikaler Versatz im Block sichtbar, im Aufriss
    // darüber als durchgehende Steigung.
    const blockCy = negBlockCy();
    // Kern und/oder Stützstoff werden als EIN durchgehender Schnitt in den
    // Schalenumriss integriert (aus dem TE-Bereich angefahren) — sonst nur Schale.
    const withCore = state.cfg.negCore, withSup = state.cfg.negSupport;
    const supSurf = withSup && state.cfg.negSupportMode !== 'core';
    const supOffsets = supSurf ? negSupportOffsets() : [];
    const coresR = [], coresT = [];
    if (withSup && !supSurf) { const sm = state.cfg.negSupportMM || 0; coresR.push(negCoreContour(rPts, sm)); coresT.push(negCoreContour(tPts, sm)); }
    // Kern in Stege zerlegt (stege.js): Stege aus der Kernkontur statt der Kern-Schlaufe.
    const stegeOn = withCore && App.stegeOn && App.stegeOn();
    let stR = null, stT = null;
    if (withCore) {
      const sh = state.cfg.negCoreSheeting || 0;
      const cR = negCoreContour(rPts, sh), cT = negCoreContour(tPts, sh);
      if (stegeOn) { stR = App.stegePieces(cR); stT = App.stegePieces(cT); }
      else { coresR.push(cR); coresT.push(cT); }
    }
    const root = negShell(rPts, negRibGeom(geom, blockCy, coresR, cut.root.chord, supOffsets, stR));
    const tip = negShell(tPts, negRibGeom(geom, blockCy, coresT, cut.tip.chord, supOffsets, stT));
    // Von Hand bearbeiteter Schnittverlauf (Punkte-Editor): ersetzt die Nennbahn
    // dieser Schale. Nur die Bahn (.path) wird getauscht — Block/Bemaßung bleiben
    // aus der abgeleiteten Geometrie. Bei Override entfällt das Nasen-Enthaken.
    const negOv = state.negEdit[idx];
    if (negOv) { root.path = negOv.root.map(p => ({ x: p.x, y: p.y })); tip.path = negOv.tip.map(p => ({ x: p.x, y: p.y })); }
    const vRise = negChordMidY(tPts) - negChordMidY(rPts);   // V-Form-Versatz
    // Schnittspur (kerf): tatsächlicher Drahtweg = Umriss um kerf/2 nach außen
    // versetzt (wie im G-Code). Schaltbar über state.cfg.showKerf.
    const showKerf = state.cfg.showKerf;
    let rSpur = null, tSpur = null;
    const ck = App.cutKerf(cut.root.chord, cut.tip.chord);   // kerf innen/außen (Geschwindigkeit)
    // Von Hand bearbeitete Abbrandlinie (Ziel „Schnittverlauf"): ersetzt die Spur
    // und wird IMMER gezeigt (unabhängig von „Schnittspur anzeigen").
    const burnOv = state.negBurnEdit[idx];
    if (burnOv) {
      rSpur = burnOv.root.map(p => ({ x: p.x, y: p.y }));
      tSpur = burnOv.tip.map(p => ({ x: p.x, y: p.y }));
    } else if ((showKerf || (state.ptEdit.on && state.ptEdit.negTarget === 'burn')) && App.currentKerf() > 0) {
      const kg = negKerf(root.path, tip.path, cut.root.chord, cut.tip.chord);
      rSpur = negShellOffset(root.path, kg.gapR);
      tSpur = negShellOffset(tip.path, kg.gapT);
      if (!negOv) {
        negSnapNoseApex(rSpur, tSpur, root, tip, kg);   // Nasen-Schlaufe der Kerne enthaken
        [rSpur, tSpur] = negDeloopSync(rSpur, tSpur);    // Rest-Selbstüberschneidungen wegstutzen
      }
    }
    const mat = negMatBlock(root);   // Werkstoff-Block (Höhe aus Reiter „Werkstoff")
    const bnd = [root.path, root.block, tip.path, tip.block, mat.rect];
    if (rSpur) bnd.push(rSpur, tSpur);
    // Mit Stegen: oben ein Band mit der Draufsicht (Stege in Originallage), der
    // Querschnitt darunter — V um das Band nach unten verschoben (Maus/Punkte-Editor).
    const band = stegeOn ? Math.round(h * 0.28) : 0;
    // Profil-Sichtbarkeit im Zeichenfenster: innen (Wurzel), außen (Rand), beide.
    const shR = state.cfg.ribShow !== 'outer', shT = state.cfg.ribShow !== 'inner';
    // Schalenhöhen-Maße (innerste Reihe links) schieben Block- und Werkstoffhöhe um
    // eine Reihe nach außen -> etwas mehr Rand.
    const shellDimRow = !!state.cfg.showDim && !(stegeOn && state.cfg.negStegeOnly);
    let V = makeView(w, h - band, bounds.apply(null, bnd), shellDimRow ? 112 : 90, nav.neg);   // Rand: Platz für die äußere Werkstoff-Bemaßung
    if (band) { const V0 = V; V = { s: V0.s, X: V0.X, Y: y => V0.Y(y) + band, inv: (px, py) => V0.inv(px, py - band) }; }
    App.negDraw = { V, dyR: 0, dyT: 0 };   // Punkte-Editor: Profile in Cut-Koordinaten
    if (App.meas2dView) App.meas2dView('neg', V, bnd);   // Messwerkzeug: Abbildung + Fanggeometrie
    grid(ctx, w, h, V);
    if (band) App.stegePlan(ctx, w, band, idx);
    // Werkstoff-Block (eigene Farbe PAL.mat, Einstellungen -> Farben): umschließt den Negativblock.
    const MAT_COL = App.PAL.mat || '#c9a25e', MAT_FILL = hexA(MAT_COL, 0.10);
    poly(ctx, V, mat.rect, true);
    ctx.fillStyle = MAT_FILL; ctx.fill();
    ctx.strokeStyle = MAT_COL; ctx.lineWidth = 1.2; ctx.setLineDash(dashFor('mat', [])); ctx.stroke(); ctx.setLineDash([]);
    // Negativblock (gemeinsame Grenze der Schalen).
    drawBlock(ctx, V, root.block, App.PAL.block);
    // Konstanter Schalenrand: zwei planare Referenz-Vertikalschnitte (Nase/EL),
    // vor dem Profilschnitt gefahren. Bezug ist der WERKSTOFF: die Schnitte gehen
    // immer vertikal durch den ganzen Werkstoff-Block (Unter- bis Oberkante), nicht
    // nur durch den Negativblock — wie im G-Code (Sicherheitshöhe -> Vertikal 0).
    // Schneideweg „ein Zug": der Überstand IST die Blockkante -> keine Vorschnitt-Linien.
    const direct = negDirectPath();
    const se = (stegeOn && state.cfg.negStegeOnly) ? 0 : (state.cfg.negShellEdge || 0);
    if (se > 0 && !direct) {
      ctx.lineWidth = 1.4;
      if (shR) {   // innen (Wurzel)
        ctx.strokeStyle = App.PAL.shellEdge || '#c78bff';
        ctx.setLineDash(dashFor('shellEdge', [4, 3]));
        poly(ctx, V, [{ x: root.xL - se, y: mat.yBot }, { x: root.xL - se, y: mat.yTop }], false); ctx.stroke();
        poly(ctx, V, [{ x: root.xT + se, y: mat.yBot }, { x: root.xT + se, y: mat.yTop }], false); ctx.stroke();
      }
      if (shT) {   // außen (Rand)
        ctx.strokeStyle = App.PAL.shellEdgeOuter || '#c78bff';
        ctx.setLineDash(dashFor('shellEdgeOuter', [2, 4]));
        poly(ctx, V, [{ x: tip.xL - se, y: mat.yBot }, { x: tip.xL - se, y: mat.yTop }], false); ctx.stroke();
        poly(ctx, V, [{ x: tip.xT + se, y: mat.yBot }, { x: tip.xT + se, y: mat.yTop }], false); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // Durchgehender Schnitt-Umriss (Nennkontur): innen durchgezogen, außen gestrichelt.
    const COL = App.PAL.profInner;
    ctx.strokeStyle = COL; ctx.lineWidth = 1.8; ctx.setLineDash(dashFor('profInner', []));
    if (shR) { poly(ctx, V, root.path, true); ctx.stroke(); }
    ctx.strokeStyle = App.PAL.profOuter; ctx.lineWidth = 1.4; ctx.setLineDash(dashFor('profOuter', [6, 4]));
    if (shT) { poly(ctx, V, tip.path, true); ctx.stroke(); }
    ctx.setLineDash([]);
    // Stützstoff: bereits im Schalenumriss (blau) integriert. Im KERN-Modus die
    // Kernkontur zusätzlich grün markieren; im FLÄCHEN-Modus sind die versetzten
    // Flächen Teil der blauen Bahn (keine Extra-Kontur nötig).
    let supR = null;
    if (withSup && !supSurf) {
      const sm = state.cfg.negSupportMM || 0;
      supR = negCoreContour(rPts, sm);
      const supT = negCoreContour(tPts, sm);
      ctx.strokeStyle = App.PAL.core; ctx.lineWidth = 1.4; ctx.setLineDash(dashFor('core', [2, 3]));
      if (shR) { poly(ctx, V, supR, true); ctx.stroke(); }
      if (shT) { poly(ctx, V, supT, true); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // Schnittspur inkl. kerf. Optional als Heatmap (blau = schmal, rot = breit),
    // segmentweise nach dem lokalen kerf (p.k) — für Innen- UND Außenprofil.
    let kheat = null;
    if (rSpur) {
      if (state.cfg.kerfHeat && (state.cfg.negKerfMode || 'ratio') === 'speed') {
        let lo = Infinity, hi = -Infinity;
        const scan = pts => pts.forEach(p => { if (p.k != null) { lo = Math.min(lo, p.k); hi = Math.max(hi, p.k); } });
        scan(rSpur); scan(tSpur);
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        if (hi - lo < 0.01) { hi += 0.05; lo = Math.max(0, lo - 0.05); }
        kheat = { lo, hi };
      }
      // Wahre Dicke: Band in Schnittspaltbreite (p.k je Punkt, sonst Abbrand je Rippe;
      // von Hand bearbeitete Abbrandlinie ohne p.k -> Rippen-Abbrand).
      if (shR) kerfBand(ctx, V, [rSpur], { view: 'neg', k: ck.root, close: true, heat: kheat });
      if (shT) kerfBand(ctx, V, [tSpur], { view: 'neg', k: ck.tip, close: true, heat: kheat });
      if (kheat) {
        const { lo, hi } = kheat;
        if (shR) polyKerf(ctx, V, rSpur, 0, lo, hi, 2.2);   // innen (dick)
        if (shT) polyKerf(ctx, V, tSpur, 0, lo, hi, 1.3);   // außen (dünn)
      } else {
        ctx.strokeStyle = App.PAL.kerf; ctx.lineWidth = 1.4; ctx.setLineDash(dashFor('kerf', []));
        if (shR) { poly(ctx, V, rSpur, true); ctx.stroke(); }
        ctx.setLineDash(dashFor('kerf', [6, 4]));
        if (shT) { poly(ctx, V, tSpur, true); ctx.stroke(); }
        ctx.setLineDash([]);
      }
    }
    // Holmausschnitte: im Negativschalendesign NUR auf den Kern bezogen und nur,
    // wenn „Kern mitschneiden" aktiv ist (sonst gibt es keinen Kern). Der Kern ist
    // die zuletzt eingefügte Kernkontur (innerste).
    let negSpars = null;
    if (withCore && !stegeOn) {
      const coreR = negCoreContour(rPts, state.cfg.negCoreSheeting || 0);
      const coreT = negCoreContour(tPts, state.cfg.negCoreSheeting || 0);
      const sIdx = Math.min(idx, state.segments.length - 1);
      const a = shR ? drawSpars(ctx, V, sIdx, 'root', rPts, 0, coreR) : null;
      const b = shT ? drawSpars(ctx, V, sIdx, 'tip', tPts, 0, coreT) : null;
      negSpars = { n: (a && a.n || 0) + (b && b.n || 0), lead: !!((a && a.lead) || (b && b.lead)) };
    }
    // Bemaßung: Gesamtblockhöhe, Profillänge (Sehne), Blocküberstände (NL/EL) und
    // Auseinanderziehen — Innenprofil (Wurzel) unten, Außenprofil (Rand) oben.
    if (state.cfg.showDim) {
      const mm = v => String(Math.round(v));
      const mm1 = v => String(Math.round(v * 10) / 10);
      // Schalenhöhen an der Nasenseite (Blockvorderkante), innerste Reihe links:
      // obere Schale = Blockoberkante -> oberer Schlitz, untere = unterer Schlitz ->
      // Blockunterkante. Wurzel an der Blockkante; der Rand nur, wenn er abweicht
      // (V-Form/anderes Profil) — dann an seiner eigenen Vorderkante.
      if (shellDimRow) {
        const shellDims = (g, off, color) => {
          dim(ctx, V, g.xBL, g.yLE + g.s2, g.xBL, g.yTop, mm1(g.yTop - g.yLE - g.s2), { off, color });
          dim(ctx, V, g.xBL, g.yBot, g.xBL, g.yLE - g.s2, mm1(g.yLE - g.s2 - g.yBot), { off, color });
        };
        if (shR) shellDims(root, -34);
        if (shT && (!shR || Math.abs(tip.yLE - root.yLE) > 0.05)) {
          const gapPx = V.X(tip.xBL) - V.X(root.xBL);   // Rand-Vorderkante rechts der Blockkante
          shellDims(tip, !shR ? -34 - gapPx : (gapPx >= 44 ? -22 : 22), App.PAL.profOuter);
        }
      }
      const rowOff = shellDimRow ? 28 : 0;
      dim(ctx, V, root.xBL, root.yBot, root.xBL, root.yTop, mm(geom.H), { off: -34 - rowOff, color: '#8fa0b4' });
      // Werkstoffhöhe (grau) links außen; Abstand Werkstoff-Unterkante -> Negativblock-
      // Unterkante rechts (Lage der Schalen im Werkstoff).
      dim(ctx, V, root.xBL, mat.yBot, root.xBL, mat.yTop, mm(mat.H), { off: -66 - rowOff, color: MAT_COL });
      if (Math.abs(root.yBot - mat.yBot) > 0.5)
        dim(ctx, V, root.xBR, mat.yBot, root.xBR, root.yBot, mm(root.yBot - mat.yBot), { off: 70, color: MAT_COL });
      if (shR) {   // Wurzel UNTER dem Block
        const g = root;
        dim(ctx, V, g.xL, g.yBot, g.xT, g.yBot, mm(g.xT - g.xL), { off: 34 });                                  // Profillänge (Sehne) innen
        if (g.xL - g.xBL > 0.5) dim(ctx, V, g.xBL, g.yBot, g.xL, g.yBot, mm(g.xL - g.xBL), { off: 62, color: '#ffb454' }); // Überstand NL
        if (g.xBR - g.xT > 0.5) dim(ctx, V, g.xT, g.yBot, g.xBR, g.yBot, mm(g.xBR - g.xT), { off: 62, color: '#ffb454' }); // Überstand EL
        if (geom.split > 0.01)
          dim(ctx, V, g.xBR, g.yTE - g.s2 + (g.teSlope || 0) * (g.xBR - g.xTE), g.xBR, g.yTE + g.s2 + (g.teSlope || 0) * (g.xBR - g.xTE), mm(geom.split), { off: 40, color: '#57d38c' });
      }
      if (shT) {   // Rand OBERHALB des Blocks
        const g = tip;
        dim(ctx, V, g.xL, g.yTop, g.xT, g.yTop, mm(g.xT - g.xL), { off: -34, color: App.PAL.profOuter });            // Profillänge (Sehne) außen
        if (g.xL - g.xBL > 0.5) dim(ctx, V, g.xBL, g.yTop, g.xL, g.yTop, mm(g.xL - g.xBL), { off: -62, color: '#ffb454' }); // Überstand NL außen
        if (g.xBR - g.xT > 0.5) dim(ctx, V, g.xT, g.yTop, g.xBR, g.yTop, mm(g.xBR - g.xT), { off: -62, color: '#ffb454' }); // Überstand EL außen
      }
    }
    // Legende unten links: nur, was gerade gezeichnet ist, mit Probe in
    // echter Farbe/Strichart (Palette + Strichtyp der Ansicht „Negativdesign").
    const leg = [];
    if (shR) leg.push(L(COL, T('Schnitt-Umriss innen (Wurzel)'), dashFor('profInner', [])));
    if (shT) leg.push(L(App.PAL.profOuter, T('Schnitt-Umriss außen (Rand)'), dashFor('profOuter', [6, 4]), 'line', 1.4));
    if (negOv) leg.push(['#8b98a8', T('Schnittverlauf von Hand bearbeitet (Punkte-Editor) — Nasen-Enthaken entfällt')]);
    if (rSpur && (shR || shT)) {
      const ktext = T('Schnittspur inkl. Abbrand: innen ') + ck.root.toFixed(2)
        + T(' · außen ') + ck.tip.toFixed(2) + ' mm (' + ((state.cfg.negKerfMode || 'ratio') === 'speed' ? T('Bahngeschwindigkeit') : T('Sehnenverhältnis')) + ')'
        + (kheat ? T(' · Farbe = lokaler Spalt') : '') + (burnOv ? T(' · von Hand bearbeitet, immer sichtbar') : '');
      leg.push(kerfLeg(kheat ? Object.assign(L(null, ktext, [], 'grad'), { tc: '#ffffffcc' })
                             : L(App.PAL.kerf, ktext, dashFor('kerf', []), 'line', 1.4), 'neg'));
      if (App.kerfTrueOn('neg')) leg.push(['#8b98a8', T('Band = wahre Abbrandbreite (Schnittspalt) im Maßstab')]);
    }
    leg.push(L(App.PAL.block, T('Negativblock ') + Math.round(geom.H) + T(' mm hoch'), dashFor('block', [7, 5]), 'rect'));
    if (!(stegeOn && state.cfg.negStegeOnly)) {   // Schalenhöhen an der Nasenseite (wie die Maße links)
      const f1 = v => String(Math.round(v * 10) / 10);
      const sh = g => T('oben ') + f1(g.yTop - g.yLE - g.s2) + T(' / unten ') + f1(g.yLE - g.s2 - g.yBot) + ' mm';
      const parts = [];
      if (shR) parts.push(T('innen ') + sh(root));
      if (shT && (!shR || Math.abs(tip.yLE - root.yLE) > 0.05)) parts.push(T('außen ') + sh(tip));
      leg.push([App.PAL.dim || DIM_COL, T('Schalenhöhe an der Nase: ') + parts.join(' · ')]);
    }
    leg.push(Object.assign(L(MAT_COL, T('Werkstoff ') + Math.round(mat.H) + T(' mm hoch · Formblock ') + (state.cfg.negMatShift || 0) + T(' mm gegen Mitte versetzt, Unterkante ')
      + Math.round(root.yBot - mat.yBot) + T(' mm über Werkstoff-Unterkante'), dashFor('mat', []), 'rect'),
      { f: MAT_FILL }));
    if (direct) leg.push(['#ffb454', T('Schalenüberstand konstant vorne/hinten ') + (Math.round(se * 10) / 10)
      + T(' mm · ein Zug ohne Freifahren (keine Schnittverlängerung, keine Vorschnitte)')]);
    else leg.push(['#ffb454', T('Überstand Wurzel vorne ') + Math.round(root.xL - root.xBL) + T(' / hinten ') + Math.round(root.xBR - root.xT)
      + T(' mm · proportional zur Sehne (Vorgabe ') + Math.round(geom.ovF) + '/' + Math.round(geom.ovR) + T(' für 1. Seg.)')]);
    if (geom.split > 0.01) leg.push(['#57d38c', T('Ober-/Unterseite ') + Math.round(geom.split) + T(' mm auseinandergezogen')]);
    if (Math.abs(vRise) > 0.05) leg.push(['#8b98a8', T('V-Form berücksichtigt: Außenprofil ') + vRise.toFixed(1) + T(' mm höher als Wurzel')]);
    if (se > 0 && !direct) {
      const seTxt = Math.round(se) + T(' mm (Vorschnitt, Referenzkante · vertikal durch den ganzen Werkstoff)');
      if (shR) leg.push(L(App.PAL.shellEdge || '#c78bff', T('Schalenrand konstant innen ') + seTxt, dashFor('shellEdge', [4, 3]), 'line', 1.4));
      if (shT) leg.push(L(App.PAL.shellEdgeOuter || '#c78bff', T('Schalenrand konstant außen ') + seTxt, dashFor('shellEdgeOuter', [2, 4]), 'line', 1.4));
    }
    if (withCore && !stegeOn) leg.push([COL, T('Kern mitgeschnitten (EIN Schnitt, Teil des Umrisses)')
      + (state.cfg.negCoreSheeting > 0 ? T(' · Beplankungsabzug ') + state.cfg.negCoreSheeting + ' mm' : T(' · Nennmaß'))
      + T(' · Nase vertikal ') + state.cfg.negNoseExt + ' mm']);
    if (negSpars && negSpars.n) {
      leg.push(L(App.PAL.spar, T('Holmausschnitt (auf den Kern bezogen)'), dashFor('spar', []), 'line', 1.6));
      if (negSpars.lead) leg.push(L(App.PAL.sparLead, T('Holm-Anfahrt'), dashFor('sparLead', [4, 3]), 'line', 1.2));
    }
    if (stegeOn) {
      const supMax = supOffsets.length ? Math.max.apply(null, supOffsets) : 0;
      App.stegeDecorate(ctx, V, stR, stT, root, tip, rPts, tPts, supMax, ck, shR, shT).forEach(l => leg.push(l));
      leg.push([COL, (state.cfg.negStegeOnly ? T('NUR Stege geschnitten (ohne Schalen)') : T('Kern als Stege mitgeschnitten (EIN Schnitt)')) + (state.cfg.negCoreSheeting > 0 ? T(' · Beplankungsabzug ') + state.cfg.negCoreSheeting + ' mm' : T(' · Nennmaß'))]);
    }
    if (withSup) {
      if (supSurf) leg.push([COL, T('Stützstoff: 2 versetzte Flächen je Schale · Spalt ') + (state.cfg.negSupportGap || 0)
        + T(' mm + Dicke ') + (state.cfg.negSupportMM || 0) + T(' mm (Zickzack, Teil des Umrisses)')]);
      else if (shR || shT) leg.push(L(App.PAL.core, T('Stützstoff-Kern: Profil ') + (state.cfg.negSupportMM || 0) + T(' mm nach innen (in die Schnittfolge integriert)'), dashFor('core', [2, 3]), 'line', 1.4));
    }
    drawLegend(ctx, 14, h - 8, leg, { kheat });
    if (state.activeTab === 'neg') App.ptDrawHandles(ctx, App.negDraw, 'neg');
  }

  /* Kleinster Abstand zwischen Schnittpfad und der waagrechten Ober-/Unterkante
   * des Blocks, über alle Segmente. Nasen-X-Schlaufe und EL-Steg DÜRFEN bewusst
   * nach vorne bzw. hinten über den Block hinausragen — daher wird in X
   * (Nasen-/Endleiste) NICHT geprüft, nur die Blockhöhe (Y).
   * Rückgabe: { d, seg, side } mit dem kleinsten Abstand (negativ = ragt heraus). */
  const BLOCK_MARGIN_WARN = 5;   // mm
  function blockClearance() {
    const bh = App.blockH('wing');
    let worst = null;
    const consider = (d, seg, side) => { if (worst === null || d < worst.d) worst = { d, seg, side }; };
    App.wing.cuts.forEach((cut, k) => {
      const seg = state.segments[Math.min(k, state.segments.length - 1)];
      const pr = App.projectCut(cut, seg);
      // Gemeinsame, waagrechte Blockhöhe (wie blockOrigin / Profil-Ansicht).
      const yr = cut.root.pts.map(p => p.y), yt = cut.tip.pts.map(p => p.y);
      const cyMid = ((Math.min.apply(null, yr) + Math.max.apply(null, yr)) / 2 +
                     (Math.min.apply(null, yt) + Math.max.apply(null, yt)) / 2) / 2;
      const by0 = cyMid - bh / 2, by1 = cyMid + bh / 2;
      const check = path => {
        const cy = path.map(p => p.y);
        consider(Math.min.apply(null, cy) - by0, k, 'Blockunterkante');
        consider(by1 - Math.max.apply(null, cy), k, 'Blockoberkante');
      };
      check(pr.rootPath);
      check(pr.tipPath);
    });
    return worst;
  }

  function updateStat() {
    const el = document.getElementById('stat');
    let area = 0;
    for (const c of App.wing.cuts) area += 0.5 * (c.root.chord + c.tip.chord) * c.span;
    const g = state.lastGcode;
    const lastY = App.wing.stations[App.wing.stations.length - 1].yRise || 0;
    const cl = blockClearance();
    let warn = '';
    if (cl && cl.d < BLOCK_MARGIN_WARN) {
      const dtxt = cl.d < 0 ? `${cl.d.toFixed(1)}${T(' mm – ragt aus dem Block heraus!')}`
                            : `${T('nur ')}${cl.d.toFixed(1)}${T(' mm Rand')}`;
      warn = `<div style="color:var(--bad);font-weight:600;margin-top:4px">` +
        `${T('⚠ Schnitt zu nah an der ')}${T(cl.side)}${T(' (Segment ')}${cl.seg + 1}): ${dtxt} ` +
        `${T('– mind. ')}${BLOCK_MARGIN_WARN}${T(' mm empfohlen. Blockhöhe (Werkstoff) oder Verlängerungen vergrößern.')}</div>`;
    }
    el.innerHTML =
      `${T('Segmente')}: <b>${state.segments.length}</b> · ${T('Spannweite')} <b>${App.wing.totalSpan.toFixed(0)} mm</b> · ` +
      `${T('V-Höhe außen')} <b>${lastY.toFixed(0)} mm</b> · ${T('Fläche')} <b>${(area / 100).toFixed(0)} cm²</b>` +
      (() => {
        const c = state.cfg;
        if (c.sheetMode === 'segment') return ` · ${T('Beplankung')} <b>${T('segmentweise')}</b>`;
        if (c.sheetSides === 'asym') return (c.sheetTop || c.sheetBot)
          ? ` · ${T('Beplankung')} <b>${c.sheetTop || 0}/${c.sheetBot || 0} mm</b> (${T('o/u')})` : '';
        return c.sheeting > 0 ? ` · ${T('Beplankung')} <b>${c.sheeting} mm</b>` : '';
      })() +
      (g ? ` · ${T('Schnittlänge')} <b>${g.cutLengthFoam.toFixed(0)} mm</b> · ~<b>${g.estMinutes.toFixed(1)} min</b>` : '') +
      warn;
  }


  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { BLOCK_MARGIN_WARN, DIM_COL, SEGCOL, applyCoreSplit, blockClearance, blockExt });
  Object.assign(App, { bounds, chordAlign, closeSweepCmp, cmpBBox, deloopOpen, dim, dimArrow, draw, drawLegend, legendRow: L });
  Object.assign(App, { drawBlock, drawCmpCanvas, drawElev, drawNegElev, drawNums, drawPlan, drawProfiles, ensureNav });
  Object.assign(App, { applyNegSplit, setupNegSplit, setupNegElevPick });
  Object.assign(App, { exportSweepCmpDxf, fitCanvas, grid, hexA, kerfBand, kerfColor, kerfColorbar, kerfLeg, kerfTrueSet, makeDraggable, makeSplitDraggable });
  Object.assign(App, { makeView, nav, negBaseRibPts, negBlockCy, negChordMidY, negCoreContour, negDeloopSync, negKerf, negMatBlock });
  Object.assign(App, { negDirectPath, negNoseMiter, negParallelOffset, negRefChord, negRibGeom, negRibPts, negShell, negShellOffset, negSnapNoseApex });
  Object.assign(App, { negSpeedGaps, negSupportOffsets, niceStep, openSweepCmp, pointInPoly, poly, polyKerf, profNavKey });
  Object.assign(App, { rect, render, renderMaterial, renderNeg, renderProfEdit, renderSweepCmp });
  Object.assign(App, { renderSeg3D, renderSeg3DWin, seg3dOpen, seg3dClose, seg3dIsOpen, seg3dWire, wingSeg3DList, seg3dSnapAxis, seg3dGizmoHit, seg3dPickModel, seg3dCam: () => seg3d });
  Object.assign(App, { resampleOpenN, setupCoreSplit, setupDraggableOverlays, setupNav, setupPlanPick, setupSweepCmpNav });
  Object.assign(App, { shift, sweepCmpProfiles, sweepCmpView, syncProfSegFilter, syncProfToggles, updateStat, updateSweepRotInfo });
  Object.defineProperty(App, 'planPick', { get: () => planPick, set: v => { planPick = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'sweepCmpOpen', { get: () => sweepCmpOpen, set: v => { sweepCmpOpen = v; }, enumerable: true, configurable: true });
})();
