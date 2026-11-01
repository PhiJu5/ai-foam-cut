/* meshsection.js — Schnitte durch die Körper der „3D-Bearbeitung" (Feature meshedit)
 *
 * Schnittebenen entlang X/Y/Z oder frei gedreht/geneigt; je Ebene werden alle sichtbaren Körper geschnitten,
 * die Schnittkanten zu Konturen verkettet und in einem eigenen, verschiebbaren Fenster in 2D gezeigt.
 * Ausgabe: DXF (Ebene je Körper), SVG (1:1 in mm) und Drucken — auf A4/A3/Letter aufgeteilt, mit Überlappung,
 * Passkreuzen in den Überlappungen (gleiche Modellstelle auf beiden Blättern), Blattbezeichnung und 100-mm-Prüfmaß.
 *
 * Koordinaten der 3D-Bearbeitung: Y oben. Ebenen-Rahmen (n, u, v) mit u × v = n; 2D-Koordinaten = (u·P, v·P),
 * also bei Achsenschnitten die echten Modellkoordinaten.
 * Einstellungen: state.cfg.meshed.sec (im Projekt). Schnittstelle: window.MeshSection.
 * Andere Module rufen nur geschützt (window.MeshSection && …).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10;
  const SHEETS = { a4: ['A4', 210, 297], a3: ['A3', 297, 420], letter: ['Letter', 215.9, 279.4] };
  const DEF = { list: [], sel: 0, show3d: true, fill: true, grid: true, tiles: false,
    pr: { sheet: 'a4', orient: 'auto', margin: 10, overlap: 15, scale: 100, marks: true } };
  let uid = 1;

  function cfg() {
    const m = state.cfg.meshed = state.cfg.meshed || {};
    let c = m.sec;
    if (!c || typeof c !== 'object') c = m.sec = JSON.parse(JSON.stringify(DEF));
    for (const k in DEF) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEF[k]));
    for (const k in DEF.pr) if (c.pr[k] === undefined) c.pr[k] = DEF.pr[k];
    if (!Array.isArray(c.list)) c.list = [];
    c.list.forEach(q => { if (!q.id) q.id = 'c' + (uid++); else uid = Math.max(uid, (+String(q.id).slice(1) || 0) + 1); });
    return c;
  }
  const ME = () => window.MeshEdit && MeshEdit.api ? MeshEdit.api() : null;
  function bodies() { const a = ME(); return a ? a.bodies().filter(b => !b.hidden && b.F && b.F.length) : []; }
  function bbox(list) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const b of list) { const V = b.V; for (let i = 0; i < V.length; i += 3) for (let k = 0; k < 3; k++) { const v = V[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; } }
    return isFinite(mn[0]) ? { mn, mx } : { mn: [0, 0, 0], mx: [100, 100, 100] };
  }

  // ---------- Ebene ----------
  const BASE = {   // n, u, v mit u × v = n (Y oben)
    x: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], name: 'X', un: '−Z', vn: 'Y' },
    y: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], name: 'Y', un: 'X', vn: '−Z' },
    z: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], name: 'Z', un: 'X', vn: 'Y' }
  };
  const AXI = { x: 0, y: 1, z: 2 };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const rotAbout = (p, k, ang) => {   // Rodrigues
    const c = Math.cos(ang), s = Math.sin(ang), kp = cross(k, p), kd = dot(k, p);
    return [p[0] * c + kp[0] * s + k[0] * kd * (1 - c), p[1] * c + kp[1] * s + k[1] * kd * (1 - c), p[2] * c + kp[2] * s + k[2] * kd * (1 - c)];
  };
  // Ebene eines Schnitts: Drehpunkt = Mitte der Körper, Lage entlang der Grundachse; frei: erst um v drehen, dann um u neigen.
  function planeOf(cut, bb) {
    const B = BASE[cut.axis] || BASE.x, a = AXI[cut.axis] || 0, rad = Math.PI / 180;
    let n = B.n.slice(), u = B.u.slice(), v = B.v.slice();
    if (cut.free) {
      const a1 = (+cut.a1 || 0) * rad, a2 = (+cut.a2 || 0) * rad;
      n = rotAbout(n, v, a1); u = rotAbout(u, v, a1);
      n = rotAbout(n, u, a2); v = rotAbout(v, u, a2);
    }
    if (cut.flip) { u = u.map(x => -x); n = n.map(x => -x); }   // von der anderen Seite gesehen (u × v = n bleibt)
    const C = [(bb.mn[0] + bb.mx[0]) / 2, (bb.mn[1] + bb.mx[1]) / 2, (bb.mn[2] + bb.mx[2]) / 2]; C[a] = +cut.pos || 0;
    return { n, u, v, C, d: dot(n, C), B };
  }

  // ---------- Schnitt ----------
  // Dreiecke ∩ Ebene: Kantenpunkte (Schlüssel = gerundete Lage, damit auch nicht verschweißte Netze Ketten bilden),
  // Strecken je Dreieck, verkettet zu Konturen. → [{ pts: [[u,v],…], closed }]
  function sliceBody(b, P) {
    const V = b.V, F = b.F, nv = V.length / 3, d = new Float64Array(nv), n = P.n;
    for (let i = 0; i < nv; i++) d[i] = n[0] * V[i * 3] + n[1] * V[i * 3 + 1] + n[2] * V[i * 3 + 2] - P.d;
    const pt = new Map(), keyOf = (i, j) => {
      const t = d[i] / (d[i] - d[j]), x = V[i * 3] + (V[j * 3] - V[i * 3]) * t, y = V[i * 3 + 1] + (V[j * 3 + 1] - V[i * 3 + 1]) * t, z = V[i * 3 + 2] + (V[j * 3 + 2] - V[i * 3 + 2]) * t;
      const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
      if (!pt.has(k)) pt.set(k, [x, y, z]);
      return k;
    };
    const segs = [];
    for (let f = 0; f < F.length; f += 3) {
      const a = F[f], c = F[f + 1], e = F[f + 2], sa = d[a] < 0, sc = d[c] < 0, se = d[e] < 0;
      if (sa === sc && sc === se) continue;
      const ks = [];
      if (sa !== sc) ks.push(keyOf(a, c)); if (sc !== se) ks.push(keyOf(c, e)); if (se !== sa) ks.push(keyOf(e, a));
      if (ks.length === 2 && ks[0] !== ks[1]) segs.push(ks);
    }
    // verketten
    const adj = new Map(); segs.forEach((s, i) => { for (const k of s) { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); } });
    const used = new Uint8Array(segs.length), loops = [];
    const walk = (start, from) => {   // von Punkt start aus entlang unbenutzter Strecken
      const out = []; let k = start;
      for (;;) {
        const nx = (adj.get(k) || []).find(i => !used[i]); if (nx == null) break;
        used[nx] = 1; const s = segs[nx]; k = s[0] === k ? s[1] : s[0]; out.push(k);
        if (k === from) break;
      }
      return out;
    };
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1; const [k0, k1] = segs[i];
      const fwd = walk(k1, k0); let chain = [k0, k1].concat(fwd), closed = chain[chain.length - 1] === k0 && chain.length > 3;
      if (!closed) { const back = walk(k0, null); chain = back.reverse().concat(chain); }
      else chain.pop();
      const pts = chain.map(k => { const p = pt.get(k); return [dot(P.u, p), dot(P.v, p)]; });
      if (pts.length >= 2) loops.push({ pts, closed });
    }
    return loops;
  }
  // Draufsicht/Ansicht: Umriss der Projektion der Körper auf die Ebene (Blick entlang −n). Die projizierten Dreiecke
  // werden fein gerastert (Zellmittelpunkte), leicht geglättet (3×3-Binomial) und bei 0,5 mit Konturlinien (marching
  // squares, lineare Interpolation) nachgezogen, dann ausgedünnt. Genauigkeit ≈ halbe Zelle (0,05–0,15 mm).
  // list: Körper; je Aufruf ein gemeinsamer Umriss. → { loops, r }
  function projOutline(list, P) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const b of list) { const V = b.V; for (let i = 0; i < V.length; i += 3) { const a = P.u[0] * V[i] + P.u[1] * V[i + 1] + P.u[2] * V[i + 2], c = P.v[0] * V[i] + P.v[1] * V[i + 1] + P.v[2] * V[i + 2]; if (a < u0) u0 = a; if (a > u1) u1 = a; if (c < v0) v0 = c; if (c > v1) v1 = c; } }
    if (!isFinite(u0)) return { loops: [], r: 0 };
    const w = Math.max(1e-3, u1 - u0), h = Math.max(1e-3, v1 - v0);
    const r = clamp(Math.sqrt(w * h / 6e6), 0.04, 5), nx = Math.ceil(w / r) + 5, ny = Math.ceil(h / r) + 5;
    const ox = u0 - 2.5 * r, oy = v0 - 2.5 * r, G = new Uint8Array(nx * ny);
    const X = new Float64Array(3), Y = new Float64Array(3);
    for (const b of list) {
      const V = b.V, F = b.F;
      for (let f = 0; f < F.length; f += 3) {
        for (let q = 0; q < 3; q++) { const i = F[f + q] * 3; X[q] = (P.u[0] * V[i] + P.u[1] * V[i + 1] + P.u[2] * V[i + 2] - ox) / r - 0.5; Y[q] = (P.v[0] * V[i] + P.v[1] * V[i + 1] + P.v[2] * V[i + 2] - oy) / r - 0.5; }
        const ya = Math.max(0, Math.ceil(Math.min(Y[0], Y[1], Y[2]))), yb = Math.min(ny - 1, Math.floor(Math.max(Y[0], Y[1], Y[2])));
        for (let y = ya; y <= yb; y++) {   // Zeile y: Schnitt mit den drei Kanten -> [xl, xr]
          let xl = Infinity, xr = -Infinity;
          for (let e = 0; e < 3; e++) {
            const a = e, c = (e + 1) % 3, ya2 = Y[a], yc = Y[c];
            if ((ya2 <= y && yc >= y) || (yc <= y && ya2 >= y)) {
              if (ya2 === yc) { xl = Math.min(xl, X[a], X[c]); xr = Math.max(xr, X[a], X[c]); }
              else { const x = X[a] + (X[c] - X[a]) * (y - ya2) / (yc - ya2); if (x < xl) xl = x; if (x > xr) xr = x; }
            }
          }
          const xa = Math.max(0, Math.ceil(xl)), xb = Math.min(nx - 1, Math.floor(xr)), row = y * nx;
          for (let x = xa; x <= xb; x++) G[row + x] = 1;
        }
      }
    }
    // glätten (binomial 1-2-1 in x und y)
    const A = new Float32Array(nx * ny), B = new Float32Array(nx * ny);
    for (let y = 0; y < ny; y++) for (let x = 1; x < nx - 1; x++) { const i = y * nx + x; A[i] = (G[i - 1] + 2 * G[i] + G[i + 1]) / 4; }
    for (let y = 1; y < ny - 1; y++) for (let x = 0; x < nx; x++) { const i = y * nx + x; B[i] = (A[i - nx] + 2 * A[i] + A[i + nx]) / 4; }
    // Konturlinien bei 0,5
    const lev = 0.5, pts = new Map(), segs = [];
    const ep = (key, x0, y0, x1, y1, a, c) => {   // Punkt auf der Kante zwischen (x0,y0) mit Wert a und (x1,y1) mit c
      if (!pts.has(key)) { const t = (lev - a) / ((c - a) || 1e-9); pts.set(key, [ox + (x0 + (x1 - x0) * t + 0.5) * r, oy + (y0 + (y1 - y0) * t + 0.5) * r]); }
      return key;
    };
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      const i = y * nx + x, a = B[i], c = B[i + 1], d = B[i + nx + 1], e = B[i + nx];
      const m = (a > lev ? 1 : 0) | (c > lev ? 2 : 0) | (d > lev ? 4 : 0) | (e > lev ? 8 : 0);
      if (m === 0 || m === 15) continue;
      const S = () => ep(2 * i, x, y, x + 1, y, a, c), Ri = () => ep(2 * (i + 1) + 1, x + 1, y, x + 1, y + 1, c, d), N = () => ep(2 * (i + nx), x, y + 1, x + 1, y + 1, e, d), Le = () => ep(2 * i + 1, x, y, x, y + 1, a, e);
      const add = (p, q) => segs.push([p(), q()]);
      switch (m) {
        case 1: case 14: add(Le, S); break;
        case 2: case 13: add(S, Ri); break;
        case 3: case 12: add(Le, Ri); break;
        case 4: case 11: add(Ri, N); break;
        case 6: case 9: add(S, N); break;
        case 7: case 8: add(Le, N); break;
        case 5: case 10: { const mid = (a + c + d + e) / 4; if ((mid > lev) === (m === 5)) { add(Le, N); add(S, Ri); } else { add(Le, S); add(Ri, N); } break; }
      }
    }
    // verketten (wie beim Schnitt)
    const adj = new Map(); segs.forEach((sg, i) => { for (const q of sg) { if (!adj.has(q)) adj.set(q, []); adj.get(q).push(i); } });
    const used = new Uint8Array(segs.length), loops = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue; used[i] = 1;
      const chain = [segs[i][0], segs[i][1]];
      for (;;) { const k2 = chain[chain.length - 1], nx2 = (adj.get(k2) || []).find(j => !used[j]); if (nx2 == null) break; used[nx2] = 1; const sg = segs[nx2]; const nk = sg[0] === k2 ? sg[1] : sg[0]; if (nk === chain[0]) break; chain.push(nk); }
      if (chain.length >= 4) loops.push({ pts: simplify(chain.map(q => pts.get(q)), 0.3 * r), closed: true });
    }
    return { loops: loops.filter(L => L.pts.length >= 3 && Math.abs(polyArea(L.pts)) > 4 * r * r), r };
  }
  function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  // Douglas-Peucker für geschlossene Linien (an den zwei entferntesten Punkten geteilt)
  function simplify(P, tol) {
    if (P.length < 8) return P;
    const dp = (a, b, out) => {
      let md = 0, mi = -1; const A = P[a], B = P[b % P.length], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-12;
      for (let i = a + 1; i < b; i++) { const q = P[i % P.length], d = Math.abs((q[0] - A[0]) * dy - (q[1] - A[1]) * dx) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol && mi > 0) { dp(a, mi, out); dp(mi, b, out); } else out.push(P[a % P.length]);
    };
    let far = 0, fd = 0; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > fd) { fd = d; far = i; } }
    const out = []; dp(0, far, out); dp(far, P.length, out);
    return out;
  }
  const cache = new Map();
  function sectionOf(cut) {
    const list = bodies(), bb = bbox(list);
    const key = JSON.stringify([cut.kind, cut.union, cut.axis, cut.pos, cut.free, cut.a1, cut.a2, cut.flip]) + '|' + list.map(b => b.id + ':' + b.ver).join(',');
    const hit = cache.get(cut.id); if (hit && hit.key === key) return hit.res;
    const P = planeOf(cut, bb), parts = [];
    let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity], len = 0, nl = 0;
    let rr = 0;
    const groups = cut.kind === 'proj' ? (cut.union ? [{ name: T('Umriss'), color: '#e0c060', bs: list }] : list.map(b => ({ name: b.name, color: b.color, bs: [b] }))) : null;
    for (const b of (groups || list)) {
      let loops;
      if (groups) { const o = projOutline(b.bs, P); loops = o.loops; rr = Math.max(rr, o.r); } else loops = sliceBody(b, P);
      if (!loops.length) continue;
      for (const L of loops) { nl++; for (let i = 0; i < L.pts.length; i++) { const p = L.pts[i]; for (let k = 0; k < 2; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } const q = L.pts[(i + 1) % L.pts.length]; if (i + 1 < L.pts.length || L.closed) len += Math.hypot(q[0] - p[0], q[1] - p[1]); } }
      parts.push({ name: b.name, color: b.color || '#888888', loops });
    }
    if (!parts.length) { mn = [0, 0]; mx = [0, 0]; }
    const res = { P, parts, mn, mx, len, nl, bb, r: rr };
    cache.set(cut.id, { key, res });
    return res;
  }
  const selCut = () => { const c = cfg(); return c.list[clamp(c.sel | 0, 0, c.list.length - 1)] || null; };
  // Ansichten (Y oben, wie die Ansichtsknöpfe der 3D-Bearbeitung): von oben = entlang Y, Seite = entlang Z, vorne = entlang X
  const viewName = axis => T({ x: 'Vorderansicht', y: 'Draufsicht', z: 'Seitenansicht' }[axis] || 'Ansicht');
  function addCut(axis, free, kind) {
    const c = cfg(), bb = bbox(bodies()), a = AXI[axis], pj = kind === 'proj';
    const q = { id: 'c' + (uid++), name: pj ? viewName(axis) : (free ? T('frei') + ' ' : '') + axis.toUpperCase() + ' ' + r1((bb.mn[a] + bb.mx[a]) / 2),
      kind: pj ? 'proj' : 'cut', union: false, axis, pos: r1(pj ? bb.mx[a] : (bb.mn[a] + bb.mx[a]) / 2), free: !!free, a1: 0, a2: 0, flip: false, on: true };
    c.list.push(q); c.sel = c.list.length - 1; fitNext = autoFit = true; refresh(true);
  }

  // ---------- Fenster ----------
  let win = null, cv = null, cx = null, side = null, view = { s: 1, ox: 0, oy: 0 }, fitNext = true, autoFit = true, drag = null, mouse = null;
  function open() {
    if (!win) build();
    win.style.display = 'flex'; keepInside(); fitNext = autoFit = true; refresh(true);
  }
  // Fenster im sichtbaren Bereich halten (Kopfzeile mit ✕ muss erreichbar bleiben)
  function keepInside() {
    if (!win) return; const r = win.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    if (r.width > vw) win.style.width = (vw - 8) + 'px'; if (r.height > vh) win.style.height = (vh - 8) + 'px';
    const q = win.getBoundingClientRect();
    win.style.left = clamp(q.left, 4, Math.max(4, vw - q.width - 4)) + 'px'; win.style.top = clamp(q.top, 0, Math.max(0, vh - 40)) + 'px';
  }
  function close() { if (win) win.style.display = 'none'; redraw3d(); }
  const isOpen = () => !!(win && win.style.display !== 'none');
  function build() {
    win = document.createElement('div');
    win.id = 'meshSecWin';
    win.style.cssText = 'position:fixed;left:6vw;top:7vh;width:86vw;height:82vh;min-width:520px;min-height:320px;z-index:60;display:none;flex-direction:column;'
      + 'background:var(--panel,#161a20);border:1px solid var(--border,#2a3038);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);resize:both;overflow:hidden';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border,#2a3038);cursor:move;user-select:none';
    const ttl = document.createElement('b'); ttl.textContent = '✂ ' + T('Schnitte'); ttl.style.flex = '1';
    const bt = (txt, tip, fn) => { const b = document.createElement('button'); b.textContent = txt; b.title = T(tip); b.onclick = fn; b.style.padding = '2px 8px'; return b; };
    let big = null;
    head.append(ttl, bt('⤢', 'Fenster groß/klein', () => {
      if (!big) { big = [win.style.left, win.style.top, win.style.width, win.style.height]; Object.assign(win.style, { left: '1vw', top: '1vh', width: '98vw', height: '97vh' }); }
      else { [win.style.left, win.style.top, win.style.width, win.style.height] = big; big = null; }
      setTimeout(() => { fitNext = true; draw2d(); }, 30);
    }), bt('✕', 'Schließen', close));
    head.onmousedown = e => {
      if (e.target.closest('button')) return;
      e.preventDefault(); const r = win.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const mv = ev => { win.style.left = (r.left + ev.clientX - sx) + 'px'; win.style.top = Math.max(0, r.top + ev.clientY - sy) + 'px'; };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); keepInside(); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    };
    const body = document.createElement('div'); body.style.cssText = 'flex:1;display:flex;min-height:0';
    side = document.createElement('div'); side.className = 'sidebar-inner';
    side.style.cssText = 'width:300px;flex:none;overflow:auto;padding:8px 10px;border-right:1px solid var(--border,#2a3038);display:flex;flex-direction:column;gap:6px';
    const right = document.createElement('div'); right.style.cssText = 'flex:1;position:relative;min-width:0';
    cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair';
    right.appendChild(cv); body.append(side, right); win.append(head, body); document.body.appendChild(win);
    cx = cv.getContext('2d');
    new ResizeObserver(() => { if (autoFit) fitNext = true; draw2d(); }).observe(right);   // solange nicht selbst gezoomt: neu einpassen
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      autoFit = false; const wx = (mx - view.ox) / view.s, wy = (view.oy - my) / view.s; view.s *= f; view.ox = mx - wx * view.s; view.oy = my + wy * view.s; draw2d();
    }, { passive: false });
    cv.addEventListener('mousedown', e => { autoFit = false; drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; cv.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', e => {
      if (drag) { view.ox = drag.ox + e.clientX - drag.x; view.oy = drag.oy + e.clientY - drag.y; draw2d(); return; }
      if (!isOpen()) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      mouse = x >= 0 && y >= 0 && x <= r.width && y <= r.height ? [(x - view.ox) / view.s, (view.oy - y) / view.s] : null; if (mouse || drag === null) draw2d();
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; cv.style.cursor = 'crosshair'; } });
    cv.addEventListener('dblclick', () => { fitNext = autoFit = true; draw2d(); });
    window.addEventListener('resize', () => { if (isOpen()) keepInside(); });
  }

  // Seitenleiste des Fensters
  function buildSide() {
    if (!side) return;
    const { numRow, boolRow, selectRow, hint, subhead } = App, c = cfg(), cut = selCut();
    const R = () => refresh(true);
    side.innerHTML = '';
    const bar = (defs) => { const d = document.createElement('div'); d.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px'; for (const [t, tip, fn, prim, dis] of defs) { const b = document.createElement('button'); b.textContent = T(t); if (tip) b.title = T(tip); if (prim) b.className = 'primary'; b.disabled = !!dis; b.onclick = fn; d.appendChild(b); } side.appendChild(d); return d; };
    hint(side, 'Schnitt durch alle sichtbaren Körper. Achsenschnitte liefern echte Modellkoordinaten; „frei“ wird um die Mitte der Körper gedreht und geneigt (z. B. für eine Trennebene). Ansicht: Rad = Zoom, Ziehen = verschieben, Doppelklick = einpassen.');
    bar([['+ X', 'Schnitt senkrecht zu X', () => addCut('x')], ['+ Y', 'Schnitt senkrecht zu Y (waagrecht)', () => addCut('y')], ['+ Z', 'Schnitt senkrecht zu Z', () => addCut('z')], ['+ frei', 'Frei gedrehte/geneigte Ebene', () => addCut('x', true)],
      ['+ Draufsicht', 'Umriss der Körper von oben gesehen (Projektion auf eine waagrechte Ebene, Blick entlang Y) — Blickrichtung danach frei wählbar', () => addCut('y', false, 'proj')],
      ['+ Seitenansicht', 'Umriss der Körper von der Seite gesehen (Blick entlang Z, wie „Seitenansicht“ unter der 3D-Ansicht)', () => addCut('z', false, 'proj')],
      ['+ Vorderansicht', 'Umriss der Körper von vorne gesehen (Blick entlang X)', () => addCut('x', false, 'proj')]]);
    if (!c.list.length) { hint(side, 'Noch kein Schnitt — oben einen anlegen.'); return; }
    subhead(side, T('Schnitte') + ' (' + c.list.length + ')');
    c.list.forEach((q, i) => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center';
      const nb = document.createElement('button'); nb.textContent = q.name; nb.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left';
      if (i === (c.sel | 0)) nb.className = 'primary'; nb.onclick = () => { c.sel = i; fitNext = autoFit = true; R(); };
      const mini = (t, tip, fn) => { const b = document.createElement('button'); b.textContent = t; b.title = T(tip); b.style.padding = '2px 7px'; b.onclick = fn; row.appendChild(b); };
      row.appendChild(nb);
      mini(q.on ? '●' : '◌', q.on ? 'In 3D ausblenden' : 'In 3D zeigen', () => { q.on = !q.on; R(); });
      mini('⧉', 'Kopie anlegen', () => { const k = JSON.parse(JSON.stringify(q)); k.id = 'c' + (uid++); k.name = q.name + ' ' + T('Kopie'); c.list.splice(i + 1, 0, k); c.sel = i + 1; R(); });
      mini('✕', 'Schnitt löschen', () => { c.list.splice(i, 1); cache.delete(q.id); c.sel = clamp(c.sel, 0, c.list.length - 1); R(); });
      side.appendChild(row);
    });
    if (cut) {
      const bb = bbox(bodies()), a = AXI[cut.axis];
      const pj = cut.kind === 'proj';
      subhead(side, pj ? 'Gewählte Ansicht' : 'Gewählter Schnitt');
      if (App.txtRow) App.txtRow(side, 'Name', () => cut.name, v => { cut.name = v; buildSide(); });
      selectRow(side, 'Art', [['cut', 'Schnitt (Kontur in der Ebene)'], ['proj', 'Ansicht (Umriss der Projektion)']], () => cut.kind || 'cut', v => { cut.kind = v; const k = AXI[cut.axis]; cut.pos = r1(v === 'proj' ? bb.mx[k] : (bb.mn[k] + bb.mx[k]) / 2); fitNext = autoFit = true; R(); },
        'Schnitt: Kontur, wo die Ebene die Körper schneidet. Ansicht (Drauf-, Seiten-, Vorderansicht): Umriss der Körper, wenn man senkrecht auf die Ebene schaut (alles, was dahinter liegt, wird auf die Ebene projiziert).');
      selectRow(side, pj ? 'Blick entlang' : 'Senkrecht zu', pj ? [['y', 'Y — Draufsicht (von oben)'], ['z', 'Z — Seitenansicht'], ['x', 'X — Vorderansicht']] : [['x', 'X'], ['y', 'Y'], ['z', 'Z']], () => cut.axis, v => { if (pj && cut.name === viewName(cut.axis)) cut.name = viewName(v); cut.axis = v; const k = AXI[v]; cut.pos = r1(pj ? bb.mx[k] : (bb.mn[k] + bb.mx[k]) / 2); fitNext = autoFit = true; R(); });
      if (pj) boolRow(side, 'ein Umriss für alle Körper', () => !!cut.union, v => { cut.union = v; R(); }, 'Aus: je Körper ein eigener Umriss (in seiner Farbe). An: ein gemeinsamer Umriss aller sichtbaren Körper.');
      if (!pj) numRow(side, T('Lage') + ' ' + cut.axis.toUpperCase() + ' (mm)', () => cut.pos, v => { cut.pos = v; refresh(false); }, { step: 1, norender: true, hint: T('Bereich der Körper: ') + r1(bb.mn[a]) + ' … ' + r1(bb.mx[a]) + ' mm' });
      // Schieber für die Lage
      const sl = document.createElement('input'); sl.type = 'range'; if (pj) sl.style.display = 'none'; sl.min = bb.mn[a]; sl.max = bb.mx[a]; sl.step = Math.max(0.1, (bb.mx[a] - bb.mn[a]) / 1000); sl.value = cut.pos; sl.style.width = '100%';
      sl.oninput = () => { cut.pos = r1(+sl.value); const inp = side.querySelector('input[data-secpos]'); if (inp) inp.value = cut.pos; refresh(false); };
      side.appendChild(sl);
      const posIn = [...side.querySelectorAll('input[type=text]')].pop(); if (posIn) posIn.dataset.secpos = '1';
      boolRow(side, pj ? 'Blickrichtung frei drehen/neigen' : 'frei drehen/neigen', () => cut.free, v => { cut.free = v; R(); }, 'Ebene um die Mitte der Körper drehen (um die senkrechte Bildachse) und neigen (um die waagrechte Bildachse).');
      if (cut.free) {
        numRow(side, 'Drehen (°)', () => cut.a1, v => { cut.a1 = clamp(v, -89, 89); refresh(false); }, { step: 1, norender: true });
        numRow(side, 'Neigen (°)', () => cut.a2, v => { cut.a2 = clamp(v, -89, 89); refresh(false); }, { step: 1, norender: true });
      }
      boolRow(side, 'von der Gegenseite ansehen', () => cut.flip, v => { cut.flip = v; fitNext = true; R(); });
      const s = sectionOf(cut);
      hint(side, s.parts.length
        ? T('Größe ') + r1(s.mx[0] - s.mn[0]) + ' × ' + r1(s.mx[1] - s.mn[1]) + ' mm · ' + s.nl + T(' Konturen · Umfang ') + r1(s.len) + ' mm · ' + s.parts.map(p => p.name).join(', ') + (s.r ? ' · ' + T('Raster ') + (Math.round(s.r * 100) / 100) + ' mm' : '')
        : T('Die Ebene schneidet keinen sichtbaren Körper.'));
    }
    subhead(side, 'Ansicht');
    boolRow(side, 'Flächen füllen', () => c.fill, v => { c.fill = v; draw2d(); });
    boolRow(side, 'Raster', () => c.grid, v => { c.grid = v; draw2d(); });
    boolRow(side, 'Schnittebenen in 3D zeigen', () => c.show3d, v => { c.show3d = v; redraw3d(); });
    subhead(side, 'Ausgabe');
    bar([['DXF', 'Gewählter Schnitt als DXF (mm, eine Ebene je Körper)', () => exportDxf(false), true, !cut], ['DXF alle', 'Alle Schnitte in eine DXF, nebeneinander, eine Ebene je Schnitt und Körper', () => exportDxf(true), false, !c.list.length], ['SVG', 'Gewählter Schnitt als SVG im Maßstab 1:1 (mm)', exportSvg, false, !cut]]);
    if (window.RumpfPro && RumpfPro.setFormerFromSection) {
      bar([['→ Rumpf (als Spant)', 'Gewählten Querschnitt direkt als Spant im Reiter Rumpf übernehmen, lagerichtig an seiner Station: Ein Spant in ±5 mm wird ersetzt, sonst kommt ein neuer dazu. Die Umrisse laufen danach durch Ober-, Unterkante und Breite des Schnitts. Rumpf-Spanten sind symmetrisch: genommen wird die äußere Hülle, innere Ausschnitte fallen weg.', () => toRumpfFormer(false), true, !cut]]);
      boolRow(side, 'Rumpf nur aus diesen Spanten', () => !!c.rpOnly, v => { c.rpOnly = v; }, 'Ab zwei übernommenen Spanten werden alle anderen Spanten im Reiter Rumpf gelöscht. Seitenansicht, Draufsicht und Dickenlinie hängen sich dann nur noch an die übernommenen Spanten; Nase und Heck richten sich nach dem ersten und letzten Spant.');
    }
    if (window.RumpfPro && RumpfPro.setBackground) {
      bar([['→ Rumpf (Hintergrundbild)', 'Gewählten Schnitt bzw. die Ansicht lagerichtig als Hintergrundbild im Reiter Rumpf übernehmen (gleiche Achsen wie „An Rumpf übergeben“): Seitenansicht, Draufsicht oder Spantansicht je nach Blickrichtung.', toRumpfPro, false, !cut]]);
      boolRow(side, 'Querschnitt als eigenes Bild des Spants dort', () => c.rpFrame !== false, v => { c.rpFrame = v; }, 'Schnitt quer zur Rumpfachse: liegt im Reiter Rumpf ein Spant an dieser Stelle (±5 mm), bekommt er das Bild als eigene Spantansicht — wird im Projekt gespeichert. Sonst: gemeinsames Bild der Spantansicht (ebenfalls im Projekt gespeichert).');
      if (lastRp) hint(side, T('Zuletzt übernommen: ') + ({ side: T('Seitenansicht'), top: T('Draufsicht'), sec: T('Spantansicht') }[lastRp.kind]) + (lastRp.frame >= 0 ? ', ' + T('Spant ') + (lastRp.frame + 1) : '') + '.');
    }
    const pr = c.pr;
    selectRow(side, 'Drucken auf', Object.keys(SHEETS).map(k => [k, SHEETS[k][0]]), () => pr.sheet, v => { pr.sheet = v; R(); });
    selectRow(side, 'Ausrichtung', [['auto', 'automatisch (wenigste Blätter)'], ['p', 'hoch'], ['l', 'quer']], () => pr.orient, v => { pr.orient = v; R(); });
    numRow(side, 'Maßstab (%)', () => pr.scale, v => { pr.scale = clamp(v, 1, 1000); R(); }, { step: 5, norender: true, enter: true });
    numRow(side, 'Rand (mm)', () => pr.margin, v => { pr.margin = clamp(v, 3, 40); R(); }, { step: 1, norender: true, enter: true, hint: 'Nicht bedruckbarer Rand des Druckers + etwas Luft.' });
    numRow(side, 'Überlappung (mm)', () => pr.overlap, v => { pr.overlap = clamp(v, 0, 60); R(); }, { step: 1, norender: true, enter: true, hint: 'So weit zeigen benachbarte Blätter dasselbe. In der Überlappung liegen die Passkreuze — Blätter so übereinanderlegen, dass sie sich decken, dann kleben.' });
    boolRow(side, 'Blattaufteilung in der Ansicht zeigen', () => c.tiles, v => { c.tiles = v; draw2d(); });
    const pl = cut ? pages(sectionOf(cut)) : null;
    bar([['🖨 ' + T('Drucken…'), 'Gewählten Schnitt im Maßstab auf Blätter aufgeteilt drucken (im Druckdialog „Tatsächliche Größe/100 %“ wählen, nicht „Anpassen“)', printCut, true, !cut || !pl]]);
 if (pl) hint(side, pl.n + T(' Blatt') + (pl.all > pl.n ? ' (' + (pl.all - pl.n) + T(' leere weggelassen') + ')' : '') + ' (' + pl.cols + ' × ' + pl.rows + ', ' + SHEETS[pr.sheet][0] + ' ' + (pl.land ? T('quer') : T('hoch')) + ') · ' + T('Prüfmaß 100 mm auf jedem Blatt nachmessen.'));
  }

  // ---------- 2D-Ansicht ----------
  const css = (v, d) => (window.getComputedStyle ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() : '') || d;
  function draw2d() {
    if (!isOpen() || !cv) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, W = Math.max(10, r.width), H = Math.max(10, r.height);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.fillStyle = css('--bg', '#0f1216'); cx.fillRect(0, 0, W, H);
    const c = cfg(), cut = selCut();
    if (!cut) { cx.fillStyle = css('--muted', '#8a94a3'); cx.font = '13px system-ui'; cx.fillText(T('Links einen Schnitt anlegen (+ X, + Y, + Z, + frei).'), 16, 28); return; }
    const s = sectionOf(cut);
    if (fitNext && s.parts.length) {
      const w = Math.max(1, s.mx[0] - s.mn[0]), h = Math.max(1, s.mx[1] - s.mn[1]);
      view.s = 0.85 * Math.min(W / w, H / h); view.ox = W / 2 - (s.mn[0] + w / 2) * view.s; view.oy = H / 2 + (s.mn[1] + h / 2) * view.s; fitNext = false;
    }
    const X = u => view.ox + u * view.s, Y = v => view.oy - v * view.s;
    if (c.grid) {   // Raster 1/2/5·10^n so, dass etwa 60 px
      const raw = 60 / view.s, e = Math.pow(10, Math.floor(Math.log10(raw))), st = raw / e < 2 ? 2 * e : raw / e < 5 ? 5 * e : 10 * e;
      const u0 = Math.floor((-view.ox) / view.s / st) * st, u1 = (W - view.ox) / view.s, v0 = Math.floor((view.oy - H) / view.s / st) * st, v1 = view.oy / view.s;
      cx.lineWidth = 1; cx.font = '10px system-ui'; cx.fillStyle = css('--muted', '#8a94a3');
      for (let u = u0; u <= u1; u += st) { cx.strokeStyle = Math.abs(u) < st / 2 ? 'rgba(120,160,220,.45)' : 'rgba(128,128,128,.13)'; cx.beginPath(); cx.moveTo(X(u), 0); cx.lineTo(X(u), H); cx.stroke(); cx.fillText(r1(u), X(u) + 2, H - 4); }
      for (let v = v0; v <= v1; v += st) { cx.strokeStyle = Math.abs(v) < st / 2 ? 'rgba(120,160,220,.45)' : 'rgba(128,128,128,.13)'; cx.beginPath(); cx.moveTo(0, Y(v)); cx.lineTo(W, Y(v)); cx.stroke(); cx.fillText(r1(v), 3, Y(v) - 2); }
    }
    if (c.tiles && s.parts.length) {   // Blattaufteilung
      const pl = pages(s);
      if (pl) {
        cx.setLineDash([6, 4]); cx.lineWidth = 1;
        for (const p of pl.list) {
          cx.strokeStyle = 'rgba(255,200,80,.75)'; cx.strokeRect(X(p.u0), Y(p.v1), (p.u1 - p.u0) * view.s, (p.v1 - p.v0) * view.s);
          cx.fillStyle = 'rgba(255,200,80,.9)'; cx.font = '12px system-ui'; cx.fillText(p.label, X(p.u0) + 4, Y(p.v1) + 14);
        }
        cx.setLineDash([]);
      }
    }
    for (const part of s.parts) {
      cx.beginPath();
      for (const L of part.loops) { L.pts.forEach((p, i) => (i ? cx.lineTo(X(p[0]), Y(p[1])) : cx.moveTo(X(p[0]), Y(p[1])))); if (L.closed) cx.closePath(); }
      if (c.fill) { cx.fillStyle = part.color + '40'; cx.fill('evenodd'); }
      cx.strokeStyle = part.color; cx.lineWidth = 1.6; cx.stroke();
    }
    // Kopf: Name, Achsen, Größe, Mausposition
    cx.fillStyle = css('--txt', '#e6e9ee'); cx.font = '13px system-ui';
    const B = s.P.B, ax = cut.free ? 'u / v' : (cut.flip ? '−' : '') + B.un + ' / ' + B.vn;
    cx.fillText(cut.name + ' — ' + T('waagrecht ') + ax.split(' / ')[0] + ', ' + T('senkrecht ') + ax.split(' / ')[1] + (s.parts.length ? ' — ' + r1(s.mx[0] - s.mn[0]) + ' × ' + r1(s.mx[1] - s.mn[1]) + ' mm' : ''), 10, 18);
    if (mouse) { cx.fillStyle = css('--muted', '#8a94a3'); cx.fillText(r1(mouse[0]) + ' / ' + r1(mouse[1]) + ' mm', 10, 36); }
    if (!s.parts.length) { cx.fillStyle = css('--muted', '#8a94a3'); cx.fillText(T('Die Ebene schneidet keinen sichtbaren Körper.'), 10, 56); }
  }

  // ---------- 3D-Überlagerung (Rahmen der Ebenen, gewählter Schnitt als Linie) ----------
  function overlay(ctx, scr) {
    const c = cfg(); if (!c.show3d || !c.list.length || !isOpen()) return;
    const list = bodies(); if (!list.length) return;
    const bb = bbox(list), sel = selCut();
    for (const q of c.list) {
      if (!q.on && q !== sel) continue;
      const P = planeOf(q, bb);
      // Rahmen: Bounding-Box-Ecken auf die Ebene projiziert, in u/v umrandet
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < 8; i++) { const p = [i & 1 ? bb.mx[0] : bb.mn[0], i & 2 ? bb.mx[1] : bb.mn[1], i & 4 ? bb.mx[2] : bb.mn[2]]; const a = dot(P.u, p), b = dot(P.v, p); u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b); }
      const m = 0.05 * Math.max(u1 - u0, v1 - v0); u0 -= m; u1 += m; v0 -= m; v1 += m;
      const W3 = (a, b) => { const p = [P.n[0] * P.d + P.u[0] * a + P.v[0] * b, P.n[1] * P.d + P.u[1] * a + P.v[1] * b, P.n[2] * P.d + P.u[2] * a + P.v[2] * b]; return scr(p[0], p[1], p[2]); };
      const Q = [W3(u0, v0), W3(u1, v0), W3(u1, v1), W3(u0, v1)], on = q === sel;
      ctx.beginPath(); Q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.fillStyle = on ? 'rgba(80,200,255,.10)' : 'rgba(200,200,200,.05)'; ctx.fill();
      ctx.strokeStyle = on ? 'rgba(80,200,255,.9)' : 'rgba(200,200,200,.45)'; ctx.lineWidth = on ? 1.4 : 1; ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = '11px system-ui'; ctx.fillText(q.name, Q[3].x + 4, Q[3].y - 4);
      if (on) {
        const s = sectionOf(q); ctx.strokeStyle = '#50c8ff'; ctx.lineWidth = 2;
        for (const part of s.parts) for (const L of part.loops) { ctx.beginPath(); L.pts.forEach((p, i) => { const w = W3(p[0], p[1]); if (i) ctx.lineTo(w.x, w.y); else ctx.moveTo(w.x, w.y); }); if (L.closed) ctx.closePath(); ctx.stroke(); }
      }
    }
  }
  function redraw3d() { const a = ME(); if (a && a.redraw) a.redraw(); }
  function refresh(side) { if (!isOpen()) return; if (side) buildSide(); draw2d(); redraw3d(); }
  // Körper geändert (aus der 3D-Bearbeitung)
  function changed() { if (isOpen()) { buildSide(); draw2d(); } }

  // ---------- Ausgabe ----------
  // ---------- als Hintergrundbild an Rumpf ----------
  // Linien im Reiter Rumpf-Koordinaten (Achsenrahmen wie beim Ableiten), Zielansicht nach der Blickrichtung: entlang der
  // Rumpfachse -> Spantansicht, senkrecht -> Draufsicht, seitlich -> Seitenansicht. Weißes Bild, Linien in Körperfarbe.
  function toRumpfPro() {
    const cut = selCut(), a = ME();
    if (!cut || !a) return;
    if (!(window.RumpfPro && RumpfPro.setBackground && RumpfPro.frameOf)) { alert(T('Reiter „Rumpf" ist in dieser Ausgabe nicht enthalten.')); return; }
    const soup = a.fusSoup(); if (!soup) { alert(T('Keine sichtbaren Körper.')); return; }
    const s = sectionOf(cut); if (!s.parts.length) { alert(T('Die Ebene schneidet keinen sichtbaren Körper.')); return; }
    let Fr; try { Fr = window.RumpfPro.frameOf(soup, a.rpAxes()); } catch (e) { alert(T(e.message || String(e))); return; }
    const P = s.P, o = Fr.toLocal([0, 0, 0]), nl = Fr.toLocal(P.n).map((v, k) => v - o[k]);
    const ax = [0, 1, 2].reduce((b, k) => Math.abs(nl[k]) > Math.abs(nl[b]) ? k : b, 0);
    const kind = ax === 0 ? 'sec' : ax === 1 ? 'top' : 'side';
    const to2 = p3 => { const q = Fr.toLocal(p3); return kind === 'side' ? [q[0], q[1]] : kind === 'top' ? [q[0], q[2]] : [q[2], q[1]]; };
    const w3 = (u, v) => [P.n[0] * P.d + P.u[0] * u + P.v[0] * v, P.n[1] * P.d + P.u[1] * u + P.v[1] * v, P.n[2] * P.d + P.u[2] * u + P.v[2] * v];
    const parts = s.parts.map(pt => ({ name: pt.name, color: pt.color, loops: pt.loops.map(L => ({ closed: L.closed, pts: L.pts.map(q => to2(w3(q[0], q[1]))) })) }));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const pt of parts) for (const L of pt.loops) for (const q of L.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    const mg = Math.max(5, 0.03 * Math.max(x1 - x0, y1 - y0)); x0 -= mg; x1 += mg; y0 -= mg; y1 += mg;
    const mmpp = Math.max(0.05, (x1 - x0) / 3000, (y1 - y0) / 3000), W = Math.ceil((x1 - x0) / mmpp), H = Math.ceil((y1 - y0) / mmpp);
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    const g = cvs.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    const px = q => [(q[0] - x0) / mmpp, (y1 - q[1]) / mmpp];
    for (const pt of parts) {
      g.beginPath();
      for (const L of pt.loops) { L.pts.forEach((q, i) => { const p = px(q); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); if (L.closed) g.closePath(); }
      g.fillStyle = pt.color + '33'; g.fill('evenodd');
      g.strokeStyle = pt.color; g.lineWidth = Math.max(2, 0.35 / mmpp); g.lineJoin = 'round'; g.stroke();
    }
    const frameX = kind === 'sec' && cut.kind !== 'proj' && cfg().rpFrame !== false ? Fr.toLocal(w3((s.mn[0] + s.mx[0]) / 2, (s.mn[1] + s.mx[1]) / 2))[0] : null;
    // Konturen als Linien mitgeben (Bildanteile 0…1): Rumpf zeichnet daraus exakt nach statt aus den Pixeln
    const vec = { parts: parts.map(pt => ({ name: pt.name, loops: pt.loops.filter(L => L.closed && L.pts.length >= 3).map(L => L.pts.map(q => { const p = px(q); return [p[0] / W, p[1] / H]; })) })).filter(pt => pt.loops.length) };
    const r = window.RumpfPro.setBackground(kind, cvs, { len: W * mmpp, x: x0, y: y1 }, frameX, vec);
    const where = { side: T('Seitenansicht'), top: T('Draufsicht'), sec: T('Spantansicht') }[kind] + (r.frame >= 0 ? ' — ' + T('eigenes Bild von Spant ') + (r.frame + 1) : '');
    (App.toast || alert)(T('Als Hintergrundbild im Reiter Rumpf übernommen: ') + where + '.');
    lastRp = { kind, frame: r.frame }; buildSide();
  }
  // Querschnitt direkt als Spant: nur Ebenen (nahezu) quer zur Rumpfachse, sonst wäre die Kontur verzerrt
  function toRumpfFormer() {
    const cut = selCut(), a = ME();
    if (!cut || !a) return;
    if (cut.kind === 'proj') { alert(T('Als Spant lässt sich nur ein Schnitt quer zur Rumpfachse übernehmen.')); return; }
    const soup = a.fusSoup(); if (!soup) { alert(T('Keine sichtbaren Körper.')); return; }
    const s = sectionOf(cut); if (!s.parts.length) { alert(T('Die Ebene schneidet keinen sichtbaren Körper.')); return; }
    try {
      const Fr = window.RumpfPro.frameOf(soup, a.rpAxes()), P = s.P, o = Fr.toLocal([0, 0, 0]), nl = Fr.toLocal(P.n).map((v, k) => v - o[k]);
      if (Math.abs(nl[0]) < 0.9986) throw new Error(T('Als Spant lässt sich nur ein Schnitt quer zur Rumpfachse übernehmen.'));
      const w3 = (u, v) => [0, 1, 2].map(k => P.n[k] * P.d + P.u[k] * u + P.v[k] * v);
      const loops = []; let x = 0, m = 0;
      for (const pt of s.parts) for (const L of pt.loops) if (L.pts.length >= 2) loops.push({ closed: L.closed, pts: L.pts.map(q => { const l = Fr.toLocal(w3(q[0], q[1])); x += l[0]; m++; return [l[2], l[1]]; }) });   // auch offene Züge: Innenplatten an der Haut zerlegen die Außenkontur in Stücke
      if (!loops.length) throw new Error(T('Die Ebene schneidet keinen sichtbaren Körper.'));
      const r = window.RumpfPro.setFormerFromSection(x / m, loops, { only: !!cfg().rpOnly });
      (App.toast || alert)(T(r.replaced ? 'Spant ersetzt: ' : 'Neuer Spant: ') + (r.frame + 1) + ' — X ' + r.x + ' mm, ' + T('Abweichung ') + r.err + ' mm.' + (r.removed ? ' ' + T('Andere Spanten gelöscht: ') + r.removed + '.' : ''));
    } catch (e) { alert(T(e.message || String(e))); }
  }
  let lastRp = null;
  const fileBase = () => (((state.projectName || 'schnitt').replace(/[^\w\-]+/g, '_')) || 'schnitt');
  const safe = s => String(s || '').replace(/[^\w\-]+/g, '_').toUpperCase().slice(0, 28) || 'X';
  function save(name, data, mime, which) { if (typeof App.download === 'function') App.download(name, data, mime, which); else if (App.anchorDownload) App.anchorDownload(name, data, mime); }
  const ACI = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [7, 255, 255, 255], [8, 128, 128, 128], [30, 255, 127, 0]];
  function aci(hex) { const n = parseInt(String(hex).replace('#', ''), 16) || 0, r = n >> 16, g = (n >> 8) & 255, b = n & 255; let best = 7, bd = Infinity; ACI.forEach(a => { const d = (a[1] - r) ** 2 + (a[2] - g) ** 2 + (a[3] - b) ** 2; if (d < bd) { bd = d; best = a[0]; } }); return best; }
  // DXF R12: POLYLINE je Kontur, Ebene je (Schnitt,) Körper; dx = Versatz in u (nebeneinander)
  function dxfText(items) {
    const lay = new Map(), ent = [], ext = [Infinity, Infinity, -Infinity, -Infinity];
    for (const it of items) {
      for (const part of it.s.parts) {
        const name = (items.length > 1 ? safe(it.cut.name) + '_' : '') + safe(part.name);
        if (!lay.has(name)) lay.set(name, aci(part.color));
        for (const L of part.loops) {
          ent.push('0', 'POLYLINE', '8', name, '66', '1', '70', L.closed ? '1' : '0');
          for (const p of L.pts) { const x = p[0] + it.dx, y = p[1]; ext[0] = Math.min(ext[0], x); ext[1] = Math.min(ext[1], y); ext[2] = Math.max(ext[2], x); ext[3] = Math.max(ext[3], y); ent.push('0', 'VERTEX', '8', name, '10', x.toFixed(4), '20', y.toFixed(4)); }
          ent.push('0', 'SEQEND', '8', name);
        }
      }
      if (items.length > 1) { if (!lay.has('BESCHRIFTUNG')) lay.set('BESCHRIFTUNG', 7); ent.push('0', 'TEXT', '8', 'BESCHRIFTUNG', '10', (it.s.mn[0] + it.dx).toFixed(3), '20', (it.s.mx[1] + 8).toFixed(3), '40', '6', '1', it.cut.name); }
    }
    if (!isFinite(ext[0])) ext.splice(0, 4, 0, 0, 0, 0);
    const L = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1',
      '9', '$EXTMIN', '10', ext[0].toFixed(3), '20', ext[1].toFixed(3), '9', '$EXTMAX', '10', ext[2].toFixed(3), '20', ext[3].toFixed(3), '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(lay.size)];
    for (const [n, col] of lay) L.push('0', 'LAYER', '2', n, '70', '0', '62', String(col), '6', 'CONTINUOUS');
    L.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'); ent.forEach(e => L.push(e)); L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\r\n') + '\r\n';
  }
  function exportDxf(all) {
    const c = cfg(), cuts = all ? c.list : [selCut()].filter(Boolean); if (!cuts.length) return;
    const items = []; let x = 0;
    for (const q of cuts) {
      const s = sectionOf(q); if (!s.parts.length) continue;
      const dx = all ? x - s.mn[0] : 0; items.push({ cut: q, s, dx }); x += (s.mx[0] - s.mn[0]) + 30;
    }
    if (!items.length) { alert(T('Die Ebene schneidet keinen sichtbaren Körper.')); return; }
    save(fileBase() + (all ? '_schnitte' : '_' + safe(cuts[0].name).toLowerCase()) + '.dxf', dxfText(items), 'application/dxf', 'svDxf');
  }
  const f3 = v => (Math.round(v * 1000) / 1000).toString();
  function pathOf(part, map) {
    return part.loops.map(L => L.pts.map((p, i) => { const q = map(p); return (i ? 'L' : 'M') + f3(q[0]) + ' ' + f3(q[1]); }).join('') + (L.closed ? 'Z' : '')).join('');
  }
  function exportSvg() {
    const cut = selCut(); if (!cut) return; const s = sectionOf(cut); if (!s.parts.length) { alert(T('Die Ebene schneidet keinen sichtbaren Körper.')); return; }
    const m = 5, w = s.mx[0] - s.mn[0] + 2 * m, h = s.mx[1] - s.mn[1] + 2 * m, map = p => [p[0] - s.mn[0] + m, s.mx[1] - p[1] + m];
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<svg xmlns="http://www.w3.org/2000/svg" width="' + f3(w) + 'mm" height="' + f3(h) + 'mm" viewBox="0 0 ' + f3(w) + ' ' + f3(h) + '">', '<title>' + esc(cut.name) + '</title>'];
    for (const part of s.parts) out.push('<g id="' + esc(safe(part.name)) + '"><path d="' + pathOf(part, map) + '" fill="none" stroke="' + part.color + '" stroke-width="0.25" fill-rule="evenodd"/></g>');
    out.push('</svg>');
    save(fileBase() + '_' + safe(cut.name).toLowerCase() + '.svg', out.join('\n'), 'image/svg+xml', 'save');
  }
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // Blattaufteilung: Modellbereich je Blatt (u0…u1, v0…v1, in mm im Modell), Schritt = Druckbereich − Überlappung.
  function pages(s) {
    if (!s.parts.length) return null;
    const pr = cfg().pr, sh = SHEETS[pr.sheet] || SHEETS.a4, k = clamp(+pr.scale || 100, 1, 1000) / 100, m = clamp(+pr.margin || 10, 3, 40), ov = clamp(+pr.overlap || 0, 0, 60);
    const plan = land => {
      const sw = land ? sh[2] : sh[1], shh = land ? sh[1] : sh[2], pw = (sw - 2 * m) / k, ph = (shh - 2 * m) / k, o = ov / k;
      if (pw <= o + 1 || ph <= o + 1) return null;
      const W = s.mx[0] - s.mn[0], H = s.mx[1] - s.mn[1], cols = Math.max(1, Math.ceil((W - o) / (pw - o) - 1e-9)), rows = Math.max(1, Math.ceil((H - o) / (ph - o) - 1e-9));
      // mittig ausrichten (Rest gleichmäßig verteilen)
      const tw = cols * (pw - o) + o, th = rows * (ph - o) + o, ux = s.mn[0] - (tw - W) / 2, vy = s.mx[1] + (th - H) / 2, list = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const u0 = ux + c * (pw - o), v1 = vy - r * (ph - o);
        list.push({ r, c, u0, u1: u0 + pw, v0: v1 - ph, v1, label: String.fromCharCode(65 + (r % 26)) + (c + 1) });
      }
      // leere Blätter weglassen (keine Kontur im Druckbereich)
      const hit = p => s.parts.some(part => part.loops.some(L => L.pts.some((q, i) => {
        const r = L.pts[(i + 1) % L.pts.length]; if (!L.closed && i === L.pts.length - 1) return q[0] >= p.u0 && q[0] <= p.u1 && q[1] >= p.v0 && q[1] <= p.v1;
        return Math.max(q[0], r[0]) >= p.u0 && Math.min(q[0], r[0]) <= p.u1 && Math.max(q[1], r[1]) >= p.v0 && Math.min(q[1], r[1]) <= p.v1;
      })));
      const used = list.filter(hit), all = cols * rows;
      return { land, sw, sh: shh, pw, ph, o, k, m, cols, rows, n: used.length, all, list: used, ux, vy, has: (r, c) => used.some(q => q.r === r && q.c === c) };
    };
    const a = plan(false), b = plan(true);
    if (pr.orient === 'p') return a; if (pr.orient === 'l') return b;
    if (!a) return b; if (!b) return a;
    return b.n < a.n ? b : a;
  }
  // Ein Blatt als SVG (mm): Inhalt beschnitten auf den Druckbereich, Passkreuze in den Überlappungen, Beschriftung, Prüfmaß.
  function pageSvg(cut, s, pl, p) {
    const { sw, sh, k, m, pw, ph, o } = pl;
    const map = q => [m + (q[0] - p.u0) * k, m + (p.v1 - q[1]) * k];
    const g = [];
    g.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + sw + 'mm" height="' + sh + 'mm" viewBox="0 0 ' + sw + ' ' + sh + '">');
    g.push('<defs><clipPath id="cp' + p.label + '"><rect x="' + m + '" y="' + m + '" width="' + f3(pw * k) + '" height="' + f3(ph * k) + '"/></clipPath></defs>');
    // Druckbereich, Überlappungszonen leicht getönt
    g.push('<rect x="' + m + '" y="' + m + '" width="' + f3(pw * k) + '" height="' + f3(ph * k) + '" fill="none" stroke="#999" stroke-width="0.15" stroke-dasharray="2 2"/>');
    const zones = [];
    if (o > 0) {
      if (p.c > 0) zones.push([m, m, o * k, ph * k]); if (p.c < pl.cols - 1) zones.push([m + (pw - o) * k, m, o * k, ph * k]);
      if (p.r > 0) zones.push([m, m, pw * k, o * k]); if (p.r < pl.rows - 1) zones.push([m, m + (ph - o) * k, pw * k, o * k]);
    }
    zones.forEach(z => g.push('<rect x="' + f3(z[0]) + '" y="' + f3(z[1]) + '" width="' + f3(z[2]) + '" height="' + f3(z[3]) + '" fill="#000" fill-opacity="0.04"/>'));
    // Inhalt
    g.push('<g clip-path="url(#cp' + p.label + ')">');
    for (const part of s.parts) g.push('<path d="' + pathOf(part, map) + '" fill="none" stroke="#000" stroke-width="0.3" stroke-linejoin="round"/>');
    g.push('</g>');
    // Passkreuze: Mitte jeder Überlappung, an mehreren Stellen entlang der Fuge (gleiche Modellstelle auf beiden Blättern)
    if (cfg().pr.marks && o > 0) {
      const cross = (u, v) => { const q = map([u, v]); if (q[0] < m - 0.01 || q[1] < m - 0.01 || q[0] > m + pw * k + 0.01 || q[1] > m + ph * k + 0.01) return; const r = 4;
        g.push('<g stroke="#000" stroke-width="0.2" fill="none"><circle cx="' + f3(q[0]) + '" cy="' + f3(q[1]) + '" r="' + r / 2 + '"/><path d="M' + f3(q[0] - r) + ' ' + f3(q[1]) + 'H' + f3(q[0] + r) + 'M' + f3(q[0]) + ' ' + f3(q[1] - r) + 'V' + f3(q[1] + r) + '"/></g>'); };
      const along = (a, b, n) => { const out = []; for (let i = 0; i < n; i++) out.push(a + (b - a) * (i + 0.5) / n); return out; };
      for (let c = 1; c < pl.cols; c++) { const u = pl.ux + c * (pw - o) + o / 2; for (let r = 0; r < pl.rows; r++) { const v1 = pl.vy - r * (ph - o); along(v1 - ph + o, v1 - o, 3).forEach(v => cross(u, v)); } }
      for (let r = 1; r < pl.rows; r++) { const v = pl.vy - r * (ph - o) - o / 2; for (let c = 0; c < pl.cols; c++) { const u0 = pl.ux + c * (pw - o); along(u0 + o, u0 + pw - o, 3).forEach(u => cross(u, v)); } }
    }
    // Beschriftung + Nachbarn + Prüfmaß 100 mm
    const nb = [];   // Nachbarblätter (nur gedruckte)
    if (pl.has(p.r - 1, p.c)) nb.push('↑ ' + String.fromCharCode(64 + p.r) + (p.c + 1)); if (pl.has(p.r + 1, p.c)) nb.push('↓ ' + String.fromCharCode(66 + p.r) + (p.c + 1));
    if (pl.has(p.r, p.c - 1)) nb.push('← ' + String.fromCharCode(65 + p.r) + p.c); if (pl.has(p.r, p.c + 1)) nb.push('→ ' + String.fromCharCode(65 + p.r) + (p.c + 2));
    g.push('<text x="' + m + '" y="' + f3(m - 2.5) + '" font-family="Arial,sans-serif" font-size="3.6" fill="#000">' + esc(p.label + ' · ' + cut.name + ' · ' + T('Maßstab') + ' ' + Math.round(k * 100) + ' % · ' + (pl.list.indexOf(p) + 1) + '/' + pl.n + (nb.length ? ' · ' + nb.join('  ') : '')) + '</text>');
    const bx = m + 2, by = sh - m + 4.5, L = 100 * k <= pw * k - 4 ? 100 : 50;
    g.push('<g stroke="#000" stroke-width="0.25"><path d="M' + bx + ' ' + by + 'H' + f3(bx + L) + 'M' + bx + ' ' + (by - 1.5) + 'V' + (by + 1.5) + 'M' + f3(bx + L) + ' ' + (by - 1.5) + 'V' + (by + 1.5) + '"/></g>');
    g.push('<text x="' + f3(bx + L + 2) + '" y="' + f3(by + 1.2) + '" font-family="Arial,sans-serif" font-size="3" fill="#000">' + esc(T('Prüfmaß') + ' ' + L + ' mm') + '</text>');
    g.push('</svg>');
    return g.join('');
  }
  function printCut() {
    const cut = selCut(); if (!cut) return; const s = sectionOf(cut), pl = pages(s);
    if (!pl) { alert(T('Die Ebene schneidet keinen sichtbaren Körper.')); return; }
    const sw = pl.sw, sh = pl.sh;
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(cut.name) + '</title><style>@page{size:' + sw + 'mm ' + sh + 'mm;margin:0}html,body{margin:0;padding:0;background:#fff}'
      + '.pg{width:' + sw + 'mm;height:' + sh + 'mm;page-break-after:always;break-after:page;overflow:hidden}.pg:last-child{page-break-after:auto;break-after:auto}svg{display:block}</style></head><body>'
      + pl.list.map(p => '<div class="pg">' + pageSvg(cut, s, pl, p) + '</div>').join('') + '</body></html>';
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(fr);
    const d = fr.contentWindow.document; d.open(); d.write(html); d.close();
    setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { alert(T('Drucken nicht möglich: ') + e.message); } setTimeout(() => fr.remove(), 2000); }, 300);
  }

  window.MeshSection = { open, close, isOpen, overlay, changed, refresh, _test: { toRumpfFormer, cfg, sectionOf, planeOf, sliceBody, pages, pageSvg, dxfText, addCut, selCut } };
})();
