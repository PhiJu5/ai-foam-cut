/* decals.js — Reiter „Decals" (Funktion „decals"): Schriftzüge und Abbildungen maßgetreu für
 * Plotter und Drucker. Motive kommen aus decals_lib.js (konstruiert, keine Bilddateien), Schrift aus
 * der eingebauten Linienschrift bzw. TrueType-/OpenType-Dateien (schrift_fonts.js).
 *
 * Flächen:
 *   - Tragfläche (Grundriss, Ober-/Unterseite, beide Hälften) und freie Fläche: Decal liegt eben.
 *   - Rumpf: das Decal liegt auf der gekrümmten Oberfläche. Es wird aus einer
 *     Ansicht (links/rechts/oben/unten) PROJIZIERT (sieht aus dieser Richtung unverzerrt aus, der
 *     Zuschnitt wird abgewickelt) oder MASSGETREU AUFGELEGT (Zuschnitt = Motiv, die 3D-Ansicht zeigt,
 *     wie es sich um den Rumpf legt). Abwicklung: entlang einer Leitlinie durch den Ankerpunkt
 *     (u = Bogenlänge der Leitlinie, v = Umfangs-Bogenlänge im Spantschnitt).
 * Ausgabe: SVG (mm, farbig gefüllt oder Konturen je Farbe), DXF (R12, Ebene je Farbe) und eine
 *   DXF-Fassung für Silhouette Studio; wie platziert oder auf Bögen geschachtelt, optional mit
 *   Schneidekontur (Print & Cut) und 100-mm-Kontrollstrecke.
 * Daten: state.cfg.decals (Projekt). Andere Module rufen nur geschützt (App.decalSidebar, window.Decals).
 */
(function () {
  'use strict';
  // Echte Motiv-/Flächen-/Papierfarben: im hellen Modus nicht umrechnen (theme.js).
  const RAW = s => (window.DrawTheme && typeof s === 'string') ? DrawTheme.raw(s) : s;
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const LIB = window.DecalLib, DES = window.DecalDesign || null;
  const isDes = it => it.kind === 'fdes' || it.kind === 'wdes';       // Design, das der Bauteilform folgt (decals_design.js)
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10;
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // ---------- Konfiguration --------------------------------------------------------------------
  const SHEETS = { a4: ['A4 (210 × 297)', 210, 297], a4q: ['A4 quer (297 × 210)', 297, 210], a3: ['A3 (297 × 420)', 297, 420], letter: ['Letter (216 × 279)', 215.9, 279.4],
    s12: ['Silhouette-Matte 12 × 12 Zoll', 304.8, 304.8], s24: ['Silhouette-Matte 12 × 24 Zoll', 304.8, 609.6], s8: ['Silhouette Portrait 8 × 12 Zoll', 203.2, 304.8], own: ['eigenes Maß', 0, 0] };
  const DEF = {
    surf: 'free', freeW: 600, freeH: 300, surfCol: '#dfe5ec', fusSrc: 'auto', fusMid: 'top',
    items: [], sel: 0, seq: 0, fonts: {},
    view: { fill: true, dims: true, sheet: false },
    out: { scope: 'surf', arr: 'sheet', sheet: 'a4', sheetW: 210, sheetH: 297, margin: 8, gap: 4, place: 'auto', mode: 'print', sep: true, cut: 0, frame: true, scale: true, unit: 'mm' }
  };
  function cfg() {
    let c = state.cfg.decals;
    if (!c || typeof c !== 'object') c = state.cfg.decals = clone(DEF);
    for (const k in DEF) if (c[k] === undefined) c[k] = clone(DEF[k]);
    for (const k of ['view', 'out']) for (const q in DEF[k]) if (c[k][q] === undefined) c[k][q] = DEF[k][q];
    if (!Array.isArray(c.items)) c.items = [];
    if (!c.fonts || typeof c.fonts !== 'object') c.fonts = {};
    return c;
  }
  const selItem = () => { const c = cfg(); return c.items.find(it => it.id === c.sel) || null; };

  // ---------- Ring-Helfer ([[x,y],…], geschlossen) -------------------------------------------------
  function bbOf(rings) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const R of rings) for (const p of R) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; } return { minx: a, miny: b, maxx: c, maxy: d, w: c - a, h: d - b }; }
  const allRings = layers => [].concat.apply([], layers.map(l => l.rings));
  function densify(R, maxLen) {
    const out = [];
    for (let i = 0; i < R.length; i++) {
      const p = R[i], q = R[(i + 1) % R.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / maxLen));
      for (let k = 0; k < n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
    }
    return out;
  }
  // Douglas–Peucker auf dem geschlossenen Ring.
  function simplify(R, tol) {
    const n = R.length; if (n < 5) return R;
    const P = R.concat([R[0]]), keep = new Uint8Array(n + 1), st = [[0, n]]; keep[0] = keep[n] = 1;
    let far = 0, fd = -1; for (let i = 1; i < n; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > fd) { fd = d; far = i; } }
    keep[far] = 1; st[0] = [0, far]; st.push([far, n]);
    while (st.length) {
      const [a, b] = st.pop(); if (b - a < 2) continue;
      const ax = P[a][0], ay = P[a][1], dx = P[b][0] - ax, dy = P[b][1] - ay, L = Math.hypot(dx, dy) || 1e-12; let m = -1, md = tol;
      for (let i = a + 1; i < b; i++) { const d = L < 1e-9 ? Math.hypot(P[i][0] - ax, P[i][1] - ay) : Math.abs((P[i][0] - ax) * dy - (P[i][1] - ay) * dx) / L; if (d > md) { md = d; m = i; } }
      if (m > 0) { keep[m] = 1; st.push([a, m], [m, b]); }
    }
    const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(P[i]);
    return out.length > 2 ? out : R;
  }

  // ---------- Abstandsfeld + Höhenlinie (Vereinigung, Versatz, Linienschrift) ----------------------
  // Abstand zu Strecken auf einem Raster; optional Vorzeichen (innen negativ) aus Ebenen mit Füllregel.
  function field(segs, bb, h, R, layers) {
    const x0 = bb.minx - R - 2 * h, y0 = bb.miny - R - 2 * h, nx = Math.ceil((bb.maxx - bb.minx + 2 * R + 4 * h) / h) + 1, ny = Math.ceil((bb.maxy - bb.miny + 2 * R + 4 * h) / h) + 1;
    const F = new Float32Array(nx * ny).fill(R);
    for (const s of segs) {
      const ax = s[0], ay = s[1], dx = s[2] - ax, dy = s[3] - ay, L2 = dx * dx + dy * dy;
      const i0 = Math.max(0, Math.floor((Math.min(ax, s[2]) - R - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, s[2]) + R - x0) / h));
      const j0 = Math.max(0, Math.floor((Math.min(ay, s[3]) - R - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, s[3]) + R - y0) / h));
      for (let j = j0; j <= j1; j++) {
        const py = y0 + j * h - ay;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + i * h - ax; let t = L2 > 0 ? (px * dx + py * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - dx * t, ey = py - dy * t, d = Math.sqrt(ex * ex + ey * ey), k = j * nx + i;
          if (d < F[k]) F[k] = d;
        }
      }
    }
    if (layers) {
      const inside = new Uint8Array(nx * ny);
      for (const l of layers) {
        const nz = l.rule === 'nonzero';
        for (let j = 0; j < ny; j++) {
          const y = y0 + j * h + 1.37e-6, xs = [];
          for (const Rg of l.rings) for (let k = 0; k < Rg.length; k++) {
            const p = Rg[k], q = Rg[(k + 1) % Rg.length];
            if ((p[1] > y) !== (q[1] > y)) xs.push([p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]), q[1] > p[1] ? 1 : -1]);
          }
          if (!xs.length) continue;
          xs.sort((a, b) => a[0] - b[0]);
          let w = 0, k = 0;
          for (let i = 0; i < nx; i++) {
            const x = x0 + i * h;
            while (k < xs.length && xs[k][0] <= x) { w += nz ? xs[k][1] : 1; k++; }
            if (nz ? w !== 0 : (w & 1)) inside[j * nx + i] = 1;
          }
        }
      }
      for (let k = 0; k < F.length; k++) if (inside[k]) F[k] = -F[k];
    }
    return { F, nx, ny, x0, y0, h };
  }
  // Höhenlinie F = lev (Marching Squares, lineare Interpolation) als geschlossene Ringe.
  function contour(g, lev) {
    const { F, nx, ny, x0, y0, h } = g, adj = new Map();
    const link = (a, b) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b); l = adj.get(b); if (!l) adj.set(b, l = []); l.push(a); };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i, a = F[k] - lev, b = F[k + 1] - lev, c = F[k + nx + 1] - lev, d = F[k + nx] - lev;
      const idx = (a < 0 ? 1 : 0) | (b < 0 ? 2 : 0) | (c < 0 ? 4 : 0) | (d < 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const B = 2 * k, Rr = 2 * (k + 1) + 1, Tp = 2 * (k + nx), Lf = 2 * k + 1, mid = (a + b + c + d) / 4 < 0;
      switch (idx) {
        case 1: case 14: link(Lf, B); break;
        case 2: case 13: link(B, Rr); break;
        case 3: case 12: link(Lf, Rr); break;
        case 4: case 11: link(Rr, Tp); break;
        case 6: case 9: link(B, Tp); break;
        case 7: case 8: link(Lf, Tp); break;
        case 5: if (mid) { link(B, Rr); link(Tp, Lf); } else { link(Lf, B); link(Rr, Tp); } break;
        case 10: if (mid) { link(Lf, B); link(Rr, Tp); } else { link(B, Rr); link(Tp, Lf); } break;
      }
    }
    const pt = id => {
      const k = id >> 1, i = k % nx, j = (k - i) / nx, fa = F[k] - lev;
      if (id & 1) { const fb = F[k + nx] - lev; return [x0 + i * h, y0 + (j + fa / (fa - fb)) * h]; }
      const fb = F[k + 1] - lev; return [x0 + (i + fa / (fa - fb)) * h, y0 + j * h];
    };
    const seen = new Set(), rings = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const ring = []; let cur = start, prev = -1;
      for (let guard = 0; guard < 4e6; guard++) {
        seen.add(cur); ring.push(pt(cur));
        const l = adj.get(cur); let nxt = -1;
        for (let q = 0; q < l.length; q++) if (l[q] !== prev && !seen.has(l[q])) { nxt = l[q]; break; }
        if (nxt < 0) break;
        prev = cur; cur = nxt;
      }
      if (ring.length > 2) rings.push(ring);
    }
    return rings;
  }
  const segsOf = rings => { const s = []; for (const R of rings) for (let k = 0; k < R.length; k++) { const p = R[k], q = R[(k + 1) % R.length]; s.push([p[0], p[1], q[0], q[1]]); } return s; };
  // Außenkontur der Vereinigung aller Ebenen im Abstand d (> 0) — Rand, Umrandung, Schneidekontur.
  function offsetLayers(layers, d) {
    const rings = allRings(layers); if (!rings.length) return [];
    const bb = bbOf(rings), h = clamp(Math.max(bb.w, bb.h) / 420, 0.06, 2), g = field(segsOf(rings), bb, h, d + 3 * h, layers);
    return contour(g, d).map(R => simplify(R, h * 0.12));
  }

  // ---------- Schrift ------------------------------------------------------------------------------
  const SF = window.SchriftFonts || null;
  const LIB_KEY = 'hw_sc_fontlib';          // Schriftbibliothek des Reiters „Schriften" (gemeinsam genutzt)
  const session = {};
  const fontKeyOf = f => ((f.family || f.name || 'Schrift') + (f.style && !/^(regular|normal|standard)$/i.test(f.style) ? ' ' + f.style : '')).replace(/\s+/g, ' ').trim();
  function lsLib() { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function fontByKey(key) {
    if (session[key]) return session[key];
    if (!SF) return null;
    const lib = lsLib(); if (lib[key]) return (session[key] = SF.fromStored(lib[key]));
    const emb = cfg().fonts[key]; return emb ? SF.fromStored(emb) : null;
  }
  function fontKeys() {
    const ks = Object.keys(lsLib());
    Object.keys(session).concat(Object.keys(cfg().fonts)).forEach(k => { if (ks.indexOf(k) < 0) ks.push(k); });
    return ks.sort((a, b) => a.localeCompare(b));
  }
  // Im Projekt nur die verwendeten Zeichen je Schrift einbetten (Projekt bleibt auf anderen Rechnern lesbar).
  function embedFonts() {
    const c = cfg(), used = {};
    c.items.forEach(it => { if (it.kind === 'text' && String(it.p.font || '').indexOf('f:') === 0) { const k = it.p.font.slice(2); used[k] = (used[k] || '') + String(it.p.text || '') + ' ?'; } });
    for (const k in c.fonts) if (!used[k]) delete c.fonts[k];
    for (const k in used) {
      const f = session[k] || (SF && lsLib()[k] && SF.fromStored(lsLib()[k])); if (!f || !SF) continue;
      const chars = Array.from(new Set(Array.from(used[k]))).filter(ch => ch !== '\n'), emb = c.fonts[k];
      if (emb && chars.every(ch => emb.glyphs[ch] || !f.has || !f.has(ch))) continue;
      c.fonts[k] = SF.storeFont(f, chars.join(''));
    }
  }
  async function loadFontBuffer(buf, wantPs) {
    let f; const n = SF.fontCount(buf);
    if (n > 1) { let pick = 0; for (let i = 0; i < n; i++) { try { const g = SF.parseFont(buf, i); if (wantPs && (g.name === wantPs || fontKeyOf(g) === wantPs)) { pick = i; break; } } catch (e) {} } f = SF.parseFont(buf, pick); }
    else f = SF.parseFont(buf, 0);
    const key = fontKeyOf(f); session[key] = f;
    const it = selItem(); if (it && it.kind === 'text') it.p.font = 'f:' + key;
    changed(true); (App.toast || (() => {}))(T('Schrift geladen: ') + key);
  }
  function loadFontFile() {
    const handler = file => file.arrayBuffer().then(b => loadFontBuffer(b)).catch(e => alert(T('Schriftdatei konnte nicht gelesen werden: ') + T(e.message)));
    const inp = document.getElementById('fileDecalFont');
    if (inp && !inp._wired) { inp._wired = true; inp.onchange = e => { const f = e.target.files[0]; if (f) handler(f); e.target.value = ''; }; }
    if (App.loadFileVia) App.loadFileVia({ 'font/ttf': ['.ttf', '.otf', '.ttc'] }, handler, 'fileDecalFont', 'ldFont'); else if (inp) inp.click();
  }
  async function pickSystemFont() {
    if (!window.queryLocalFonts) { alert(T('Dieser Browser erlaubt keinen Zugriff auf die Systemschriften. Bitte „Schriftdatei laden…" verwenden (z. B. aus C:\\Windows\\Fonts).')); return; }
    let list; try { list = await window.queryLocalFonts(); } catch (e) { alert(T('Zugriff auf Systemschriften verweigert: ') + e.message); return; }
    if (!list || !list.length) { alert(T('Keine Systemschriften gefunden.')); return; }
    const ov = overlay(T('Systemschrift wählen'), 560);
    const q = document.createElement('input'); q.type = 'text'; q.placeholder = T('Suchen …'); q.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;border-radius:5px;border:1px solid var(--line);background:var(--panel2);color:var(--txt);margin-bottom:8px';
    const ul = document.createElement('div'); ul.style.cssText = 'overflow:auto;flex:1;min-height:220px;border:1px solid var(--line);border-radius:6px';
    ov.box.appendChild(q); ov.box.appendChild(ul);
    const draw = () => {
      const s = q.value.trim().toLowerCase(); ul.textContent = '';
      list.filter(fd => !s || (fd.fullName || '').toLowerCase().includes(s)).slice(0, 400).forEach(fd => {
        const row = document.createElement('div'); row.style.cssText = 'padding:5px 9px;cursor:pointer;border-bottom:1px solid var(--line)';
        row.innerHTML = '<span style="font-family:\'' + esc(fd.family) + '\';font-size:17px">' + esc(fd.fullName) + '</span>';
        row.onclick = async () => { ov.close(); try { const blob = await fd.blob(); await loadFontBuffer(await blob.arrayBuffer(), fd.postscriptName || fd.fullName); } catch (e) { alert(T('Schrift konnte nicht geladen werden: ') + T(e.message)); } };
        ul.appendChild(row);
      });
    };
    q.oninput = draw; draw(); q.focus();
  }
  function overlay(title, width) {
    const back = document.createElement('div'); back.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div'); box.style.cssText = 'width:min(94vw,' + width + 'px);max-height:86vh;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;box-shadow:0 10px 40px rgba(0,0,0,.5)';
    const hd = document.createElement('div'); hd.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:8px'; hd.textContent = title;
    const cl = document.createElement('button'); cl.textContent = '✕'; hd.appendChild(cl); box.appendChild(hd); back.appendChild(box); document.body.appendChild(back);
    const close = () => back.remove(); cl.onclick = close; back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    return { box, close };
  }

  // Eingebaute Linienschrift: Skelett (Versalhöhe 100) -> Umriss über das Abstandsfeld (runde Enden).
  const skelCache = {};
  function skelGlyph(ch, wPct) {
    const key = ch + '|' + wPct; if (skelCache[key]) return skelCache[key];
    const sk = SF && SF.skeleton(ch); if (!sk) return (skelCache[key] = null);
    const r = wPct / 2, k = (100 - 2 * r) / 100, segs = [], P = (x, y) => [x * k + r, y * k + r];
    sk.strokes.forEach(st => {
      let cur = null;
      st.forEach(it => {
        if (it.t === 'M') cur = P(it.x, it.y);
        else if (it.t === 'L') { const q = P(it.x, it.y); if (cur) segs.push([cur[0], cur[1], q[0], q[1]]); cur = q; }
        else if (it.t === 'D') { const q = P(it.x, it.y); segs.push([q[0], q[1], q[0], q[1]]); cur = null; }
        else if (it.t === 'A') {
          const n = Math.max(6, Math.ceil(Math.abs(it.a1 - it.a0) / 6));
          for (let i = 0; i <= n; i++) { const a = (it.a0 + (it.a1 - it.a0) * i / n) * Math.PI / 180, q = P(it.cx + it.rx * Math.cos(a), it.cy + it.ry * Math.sin(a)); if (cur) segs.push([cur[0], cur[1], q[0], q[1]]); cur = q; }
        }
      });
    });
    let rings = [];
    if (segs.length) {
      const bb = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
      segs.forEach(s => { bb.minx = Math.min(bb.minx, s[0], s[2]); bb.maxx = Math.max(bb.maxx, s[0], s[2]); bb.miny = Math.min(bb.miny, s[1], s[3]); bb.maxy = Math.max(bb.maxy, s[1], s[3]); });
      const h = 1.25; rings = contour(field(segs, bb, h, r + 3 * h, null), r).map(R => simplify(R, 0.12));
    }
    return (skelCache[key] = { rings, adv: sk.w * k + 2 * r });
  }
  function flatten(cn, tf, tol) {
    const P = []; let cx = 0, cy = 0;
    const cub = (p0, c1, c2, p1) => { const dev = 0.75 * Math.max(Math.hypot(p0[0] - 2 * c1[0] + c2[0], p0[1] - 2 * c1[1] + c2[1]), Math.hypot(c1[0] - 2 * c2[0] + p1[0], c1[1] - 2 * c2[1] + p1[1])), nn = clamp(Math.ceil(Math.sqrt(dev / tol)), 1, 64);
      for (let k = 1; k <= nn; k++) { const t = k / nn, u = 1 - t; P.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]); } };
    for (let i = 0; i < cn.length;) {
      const op = cn[i];
      if (op === 0 || op === 1) { cx = cn[i + 1]; cy = cn[i + 2]; P.push(tf(cx, cy)); i += 3; }
      else if (op === 2) { const p0 = tf(cx, cy), c = tf(cn[i + 1], cn[i + 2]), p1 = tf(cn[i + 3], cn[i + 4]); cub(p0, [p0[0] + 2 / 3 * (c[0] - p0[0]), p0[1] + 2 / 3 * (c[1] - p0[1])], [p1[0] + 2 / 3 * (c[0] - p1[0]), p1[1] + 2 / 3 * (c[1] - p1[1])], p1); cx = cn[i + 3]; cy = cn[i + 4]; i += 5; }
      else { cub(tf(cx, cy), tf(cn[i + 1], cn[i + 2]), tf(cn[i + 3], cn[i + 4]), tf(cn[i + 5], cn[i + 6])); cx = cn[i + 5]; cy = cn[i + 6]; i += 7; }
    }
    if (P.length > 1 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-6) P.pop();
    return P;
  }
  // Schriftzug -> Ebenen (mm, Versalhöhe = size), auf die Mitte des Umrisses zentriert.
  function textLayers(p, size) {
    const txt = String(p.text || ''), rings = [], wd = (+p.width || 100) / 100, sl = Math.tan((+p.slant || 0) * Math.PI / 180), track = (+p.track || 0) / 100;
    const font = String(p.font || '').indexOf('f:') === 0 ? fontByKey(p.font.slice(2)) : null, rule = font ? 'nonzero' : 'evenodd';
    const wPct = clamp(+p.weight || 14, 3, 40), lineH = size * (+p.line || 135) / 100;
    txt.split('\n').forEach((line, li) => {
      let x = 0; const y0 = -li * lineH, row = [], chars = Array.from(line);
      chars.forEach((ch, ci) => {
        if (font) {
          const s = size / (font.capH || 700), g = font.glyph(ch) || font.glyph('?'); if (!g) { x += size * 0.5; return; }
          if (ci > 0 && font.kern) x += (font.kern(chars[ci - 1], ch) || 0) * s * wd;
          const xo = x; g.contours.forEach(cn => { const R = flatten(cn, (gx, gy) => [xo + (gx * s + gy * s * sl) * wd, y0 + gy * s], Math.max(0.01, size / 800)); if (R.length > 2) row.push(R); });
          x += g.adv * s * wd + track * size;
        } else {
          const s = size / 100;
          if (ch === ' ') { x += size * 0.42 * wd + track * size; return; }
          const g = skelGlyph(ch, wPct) || skelGlyph(ch.toUpperCase(), wPct) || skelGlyph('?', wPct); if (!g) { x += size * 0.5; return; }
          const xo = x; g.rings.forEach(R => row.push(R.map(q => [xo + (q[0] * s + q[1] * s * sl) * wd, y0 + q[1] * s])));
          x += (g.adv * s + size * 0.13) * wd + track * size;
        }
      });
      if (row.length && p.align !== 'left') { const b = bbOf(row), dx = p.align === 'right' ? -b.maxx : -(b.minx + b.maxx) / 2; row.forEach(R => R.forEach(q => { q[0] += dx; })); }
      row.forEach(R => rings.push(R));
    });
    if (!rings.length) return [];
    const b = bbOf(rings), cx = (b.minx + b.maxx) / 2, cy = (b.miny + b.maxy) / 2; rings.forEach(R => R.forEach(q => { q[0] -= cx; q[1] -= cy; }));
    const main = { c: p.col || '#111111', rule, rings }, out = [];
    if (+p.outline > 0) out.push({ c: p.outCol || '#ffffff', rule: 'evenodd', rings: offsetLayers([main], +p.outline) });
    out.push(main);
    return out;
  }

  // ---------- Decal -> Ebenen ------------------------------------------------------------------------
  const lcache = new Map();
  // Grundform (mm, unverdreht, ungespiegelt), inkl. Farbtausch und Wiederholung.
  function baseLayers(it) {
    const key = JSON.stringify([it.kind, it.key, it.p, it.size, it.rep, it.repGap, it.cm, it.ds]);
    let L = lcache.get(key); if (L) return L;
    if (it.kind === 'text') L = textLayers(it.p, Math.max(0.5, +it.size || 10));
    else L = LIB.build(it.key, it.p).map(l => ({ c: l.c, rule: l.rule, rings: l.rings.map(R => R.map(q => [q[0] * it.size, q[1] * it.size])) }));
    const n = Math.max(1, Math.round(+it.rep || 1));
    if (n > 1 && L.length) {
      const b = bbOf(allRings(L)), step = b.w + (+it.repGap || 0);
      L = L.map(l => { const rings = []; for (let k = 0; k < n; k++) { const dx = (k - (n - 1) / 2) * step; l.rings.forEach(R => rings.push(R.map(q => [q[0] + dx, q[1]]))); } return { c: l.c, rule: l.rule, rings }; });
    }
    if (it.ds && L.length) L = distort(L, it.ds);
    if (it.cm) L.forEach(l => { if (it.cm[l.c]) l.c0 = l.c, l.c = it.cm[l.c]; });
    if (lcache.size > 300) lcache.clear();
    lcache.set(key, L); return L;
  }
  // Verzerren um die Mitte: Breite/Höhe strecken, verjüngen (Höhe läuft nach rechts zu oder auf), scheren, im Bogen biegen.
  function distort(L, ds) {
    const sx = clamp((ds.sx == null ? 100 : +ds.sx) / 100, 0.05, 20), sy = clamp((ds.sy == null ? 100 : +ds.sy) / 100, 0.05, 20), tp = clamp((+ds.tp || 0) / 100, -0.98, 0.98);
    const sh = Math.tan(clamp(+ds.sh || 0, -75, 75) * Math.PI / 180), bn = clamp(+ds.bn || 0, -340, 340) * Math.PI / 180;
    if (sx === 1 && sy === 1 && !tp && !sh && !bn) return L;
    const b = bbOf(allRings(L)), cx = (b.minx + b.maxx) / 2, cy = (b.miny + b.maxy) / 2, hw = Math.max(1e-6, b.w * sx / 2), R = bn ? 2 * hw / bn : 0, ml = Math.max(b.w, b.h) / 60;
    const f = q => {
      let x = (q[0] - cx) * sx, y = (q[1] - cy) * sy;
      y *= 1 + tp * x / hw; x += y * sh;
      if (bn) { const a = x / R, r = R + y; x = r * Math.sin(a); y = r * Math.cos(a) - R; }
      return [x, y];
    };
    const out = L.map(l => ({ c: l.c, rule: l.rule, rings: l.rings.map(Rg => (tp || bn ? densify(Rg, ml) : Rg).map(f)) }));
    const b2 = bbOf(allRings(out)), dx = (b2.minx + b2.maxx) / 2, dy = (b2.miny + b2.maxy) / 2;      // wieder auf die Mitte setzen
    out.forEach(l => l.rings.forEach(Rg => Rg.forEach(q => { q[0] -= dx; q[1] -= dy; })));
    return out;
  }
  // Gespiegelt/gedreht um die Decal-Mitte (noch ohne Lage).
  function localLayers(it, noRot) {
    const a = noRot ? 0 : (+it.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), fx = it.flip ? -1 : 1;
    return baseLayers(it).map(l => ({ c: l.c, rule: l.rule, rings: l.rings.map(R => R.map(q => { const x = q[0] * fx; return [x * c - q[1] * s, x * s + q[1] * c]; })) }));
  }
  const shift = (L, dx, dy) => L.map(l => ({ c: l.c, rule: l.rule, rings: l.rings.map(R => R.map(q => [q[0] + dx, q[1] + dy])) }));

  // ---------- Flächen --------------------------------------------------------------------------------
  function wingGeom(i) {
    const L = App.wingList ? App.wingList() : [], w = L[i]; if (!w) return null;
    const act = i === state.activeWing, root = act ? state.root : w.root, segs = (act ? state.segments : w.segments) || [];
    if (!root) return null;
    const st = [{ y: 0, le: 0, c: +root.chord || 0 }]; let y = 0, le = 0;
    segs.forEach(s => { y += +s.span || 0; le += +s.sweep || 0; st.push({ y, le, c: +s.chord || 0 }); });
    return st;
  }
  const wingName = i => (App.wingName ? App.wingName(i) : T('Tragfläche') + ' ' + (i + 1));
  const FVIEW = { L: { r: [1, 0, 0], u: [0, 1, 0], n: [0, 0, 1], name: 'linke Seite' }, R: { r: [-1, 0, 0], u: [0, 1, 0], n: [0, 0, -1], name: 'rechte Seite' },
    T: { r: [1, 0, 0], u: [0, 0, -1], n: [0, 1, 0], name: 'von oben' }, B: { r: [1, 0, 0], u: [0, 0, 1], n: [0, -1, 0], name: 'von unten' } };
  function surfaces() {
    const out = [['free', T('freie Fläche (Rechteck)')]];
    (App.wingList ? App.wingList() : []).forEach((w, i) => { out.push(['wing:' + i + ':top', wingName(i) + ' — ' + T('Oberseite')], ['wing:' + i + ':bot', wingName(i) + ' — ' + T('Unterseite')]); });
    if (fus()) { out.push(['fus:3d', T('Rumpf') + ' — ' + T('rundum in 3D (Abwicklung)')]); for (const k in FVIEW) out.push(['fus:' + k, T('Rumpf') + ' — ' + T(FVIEW[k].name)]); }
    return out;
  }
  const isFus = s => String(s).indexOf('fus:') === 0;
  // Abwicklungs-Ansicht „rundum": Mittellinie = Rückenlinie (fusMid 'top') oder Bauchlinie ('bot').
  // s = Umfangs-Bogenlänge ab der Rückenlinie, G = Umfang an dieser Stelle, y = Ansichtskoordinate.
  const midBot = () => cfg().fusMid === 'bot';
  function unY(s, G) { let d = midBot() ? s - G / 2 : s; if (G > 1e-9) d -= G * Math.ceil(d / G - 0.5 - 1e-9); return -d; }      // in (−G/2, G/2]: die Bauchlinie bleibt am selben Rand
  const unS = (y, G) => midBot() ? G / 2 - y : -y;
  function setFusMid(v) {      // umschalten; Decals bleiben an ihrer Stelle auf dem Rumpf
    const c = cfg(), f = fus(), todo = [];
    if (f) c.items.forEach(it => { if (it.surf === 'fus:3d') { const G = fusG(f, clamp(+it.x || 0, f.x0, f.x1)); todo.push([it, unS(+it.y || 0, G), G]); } });
    c.fusMid = v === 'bot' ? 'bot' : 'top';
    todo.forEach(q => { q[0].y = r1(unY(q[1], q[2])); });
    mcache.clear(); fitted = '';
  }
  // Umrisse der Fläche in Ansichtskoordinaten (mm, y nach oben) + Hilfslinien.
  function surfShape(id) {
    const c = cfg();
    if (id.indexOf('wing:') === 0) {
      const st = wingGeom(+id.split(':')[1]); if (!st) return null;
      const half = st.map(s => [s.y, -s.le]).concat(st.slice().reverse().map(s => [s.y, -(s.le + s.c)]));
      return { rings: [half, half.map(p => [-p[0], p[1]])], lines: [[[0, 20], [0, -st[0].c - 20]]], label: T(id.endsWith('top') ? 'Oberseite — Nase oben, Wurzel in der Mitte' : 'Unterseite (von unten gesehen) — Nase oben, Wurzel in der Mitte') };
    }
    if (id === 'fus:3d') {
      const f = fus(); if (!f) return null;
      const up = f.xs.map((x, i) => [x, f.G[i] / 2]), lo = f.xs.map((x, i) => [x, -f.G[i] / 2]);
      return { rings: [up.concat(lo.reverse())], lines: [[[f.x0, 0], [f.x1, 0]]], label: T(midBot() ? 'Rumpf rundum (Abwicklung): Mitte = Bauchlinie, Ränder = Rückenlinie, obere Hälfte = linke Rumpfseite' : 'Rumpf rundum (Abwicklung): Mitte = Rückenlinie, Ränder = Bauchlinie, untere Hälfte = linke Rumpfseite') };
    }
    if (isFus(id)) {
      const f = fus(), v = FVIEW[id.slice(4)]; if (!f || !v) return null;
      const up = [], lo = [];
      for (let i = 0; i < f.NX; i++) { let a0 = Infinity, a1 = -Infinity; const R = f.R[i]; for (let j = 0; j <= f.NS; j++) { const a = R[2 * j] * v.u[1] + R[2 * j + 1] * v.u[2]; if (a < a0) a0 = a; if (a > a1) a1 = a; } up.push([f.xs[i] * v.r[0], a1]); lo.push([f.xs[i] * v.r[0], a0]); }
      return { rings: [up.concat(lo.reverse())], lines: [], label: T('Rumpf') + ' — ' + T(v.name) };
    }
    return { rings: [[[0, 0], [c.freeW, 0], [c.freeW, c.freeH], [0, c.freeH]]], lines: [], label: T('freie Fläche') + ' ' + c.freeW + ' × ' + c.freeH + ' mm' };
  }

  // ---------- Rumpf: Oberfläche, Projektion, Abwicklung -----------------------------------------------
  let fusCache = null, fusStamp = 0;
  function fusHalfFn() {
    const want = cfg().fusSrc;
    // eigenes STL-Modell (stlbody.js): ausdrücklich gewählt oder als Rückfall ohne Rumpf-Reiter
    const stl = () => { if (window.StlBody && StlBody.api) { try { const a = StlBody.api(); if (a && a.x1 > a.x0) return { x0: a.x0, x1: a.x1, half: x => a.bodyHalf(x), src: 'stl' }; } catch (e) {} } return null; };
    if (want === 'stl') return stl();
    if (window.RumpfPro && RumpfPro.api) { try { const a = RumpfPro.api(); if (a && a.x1 > a.x0) return { x0: a.x0, x1: a.x1, half: x => a.bodyHalf(x), src: 'rpro' }; } catch (e) {} }
    return stl();
  }
  function fus() {
    if (fusCache !== null) return fusCache || null;
    fusCache = false;
    const src = fusHalfFn(); if (!src) return null;
    const NX = 141, NS = 96, H = NS / 2, eps = (src.x1 - src.x0) * 1e-4, f = { x0: src.x0, x1: src.x1, NX, NS, xs: [], R: [], G: new Float64Array(NX), src: src.src, stamp: ++fusStamp };
    for (let i = 0; i < NX; i++) {
      const t = i / (NX - 1), x = src.x0 + (src.x1 - src.x0) * (0.5 - 0.5 * Math.cos(Math.PI * t)), xe = clamp(x, src.x0 + eps, src.x1 - eps);   // an Nase/Heck dichter
      let P = []; try { P = src.half(xe) || []; } catch (e) {}
      P = P.filter(q => isFinite(q[0]) && isFinite(q[1])).map(q => [q[0], Math.max(0, q[1])]);
      if (P.length < 2) P = [[0, 0], [0, 0]];
      const cum = [0]; for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
      const tot = cum[cum.length - 1], R = new Float64Array(2 * (NS + 1)); let j = 0;
      for (let k = 0; k <= H; k++) {
        const s = tot * k / H; while (j < P.length - 2 && cum[j + 1] < s) j++;
        const d = cum[j + 1] - cum[j], tt = d > 1e-12 ? clamp((s - cum[j]) / d, 0, 1) : 0, y = P[j][0] + (P[j + 1][0] - P[j][0]) * tt, z = P[j][1] + (P[j + 1][1] - P[j][1]) * tt;
        R[2 * (H + k)] = y; R[2 * (H + k) + 1] = z; R[2 * (H - k)] = y; R[2 * (H - k) + 1] = -z;       // Index H = oben, 0 und NS = unten
      }
      f.xs.push(x); f.R.push(R); f.G[i] = 2 * tot;
    }
    return (fusCache = f);
  }
  function fusIdx(f, x) {
    let lo = 0, hi = f.NX - 1; x = clamp(x, f.x0, f.x1);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f.xs[m] <= x) lo = m; else hi = m; }
    const d = f.xs[hi] - f.xs[lo]; return { i: lo, t: d > 1e-12 ? (x - f.xs[lo]) / d : 0 };
  }
  // Kabinenhaube aus „Rumpf" (eigene Farbe): je x-Spalte die Umfangsabschnitte [von, bis] als Anteil der
  // halben Umfangslänge (0 = Rückenlinie, 1 = Bauchlinie); gilt für beide Rumpfseiten.
  function fusCanopy(f) {
    if (f.cano !== undefined) return f.cano;
    f.cano = null;
    if (f.src !== 'rpro') return null;
    let c = null; try { c = window.RumpfPro.api().canopy; } catch (e) {}
    if (!c || !(c.x1 > c.x0)) return null;
    const H = f.NS / 2, M = 240, cols = [];
    for (let q = 0; q <= M; q++) {
      const x = c.x0 + (c.x1 - c.x0) * q / M; if (x < f.x0 || x > f.x1) continue;
      const k = fusIdx(f, x), A = f.R[k.i], B = f.R[k.i + 1], Y = j => A[2 * (H + j)] + (B[2 * (H + j)] - A[2 * (H + j)]) * k.t;
      const fr = y => { if (y >= Y(0)) return 0; for (let j = 0; j < H; j++) { const a = Y(j), b = Y(j + 1); if (a > b && y <= a && y >= b) return (j + (a - y) / (a - b)) / H; } return 1; };
      cols.push({ x, iv: c.spans(x).map(sp => [fr(sp[1]), fr(sp[0])]).filter(sp => sp[1] - sp[0] > 1e-5) });
    }
    return (f.cano = { col: c.col, cols });
  }
  // Streifen zwischen benachbarten Spalten: fn(xa, [von, bis], xb, [von, bis]).
  function canoStrips(f, fn) {
    const c = fusCanopy(f); if (!c) return;
    for (let q = 0; q + 1 < c.cols.length; q++) { const a = c.cols[q], b = c.cols[q + 1]; if (a.iv.length && a.iv.length === b.iv.length) a.iv.forEach((sp, n) => fn(a.x, sp, b.x, b.iv[n])); }
  }
  // Kabinenhaube in der 2D-Ansicht (Abwicklung bzw. Seiten-/Drauf-/Unteransicht) in ihrer Farbe füllen.
  function drawCanopy2d(ctx, id) {
    const f = fus(), c = f && fusCanopy(f); if (!c) return;
    const v = id === 'fus:3d' ? null : FVIEW[String(id).slice(4)]; if (id !== 'fus:3d' && !v) return;
    // sichtbarer Höhenbereich eines Umfangsabschnitts in der Ansicht v (nur dem Betrachter zugewandte Punkte)
    const range = (x, sp, sg) => {
      const G = fusG(f, x) / 2; let lo = Infinity, hi = -Infinity;
      for (let q = 0; q <= 12; q++) {
        const s = (sp[0] + (sp[1] - sp[0]) * q / 12) * G, P = fusPt(f, x, sg * s), Q = fusPt(f, x, sg * (s + Math.max(0.2, G * 0.004)));
        const ty = Q[1] - P[1], tz = Q[2] - P[2];
        if (sg * (tz * v.n[1] - ty * v.n[2]) < -1e-9) continue;
        const a = P[1] * v.u[1] + P[2] * v.u[2]; if (a < lo) lo = a; if (a > hi) hi = a;
      }
      return hi > lo ? [lo, hi] : null;
    };
    ctx.save(); ctx.fillStyle = RAW(c.col); ctx.beginPath();
    const bot = midBot();
    const quad = (x0, a0, a1, x1, b0, b1) => { ctx.moveTo(SX(x0), SY(a0)); ctx.lineTo(SX(x1), SY(b0)); ctx.lineTo(SX(x1), SY(b1)); ctx.lineTo(SX(x0), SY(a1)); ctx.closePath(); };
    canoStrips(f, (xa, sa, xb, sb) => {
      for (const sg of [1, -1]) {
        if (!v) { const Ga = fusG(f, xa) / 2, Gb = fusG(f, xb) / 2; const cy = (fr, G) => bot ? -sg * (1 - fr) * G : sg * fr * G; quad(xa, cy(sa[0], Ga), cy(sa[1], Ga), xb, cy(sb[0], Gb), cy(sb[1], Gb)); continue; }
        const ra = range(xa, sa, sg), rb = range(xb, sb, sg); if (ra && rb) quad(xa * v.r[0], ra[0], ra[1], xb * v.r[0], rb[0], rb[1]);
      }
    });
    ctx.fill('nonzero'); ctx.restore();
  }
  const fusG = (f, x) => { const k = fusIdx(f, x); return f.G[k.i] + (f.G[k.i + 1] - f.G[k.i]) * k.t; };
  // Punkt der Oberfläche: s = Umfangs-Bogenlänge ab der Rückenlinie (+ = Seite z > 0).
  function fusPt(f, x, s) {
    const k = fusIdx(f, x), G = f.G[k.i] + (f.G[k.i + 1] - f.G[k.i]) * k.t; let tau = G > 1e-9 ? s / G + 0.5 : 0.5; tau -= Math.floor(tau);
    const fj = tau * f.NS, j = Math.min(f.NS - 1, Math.floor(fj)), tj = fj - j, A = f.R[k.i], B = f.R[k.i + 1];
    const ya = A[2 * j] + (A[2 * j + 2] - A[2 * j]) * tj, za = A[2 * j + 1] + (A[2 * j + 3] - A[2 * j + 1]) * tj, yb = B[2 * j] + (B[2 * j + 2] - B[2 * j]) * tj, zb = B[2 * j + 1] + (B[2 * j + 3] - B[2 * j + 1]) * tj;
    return [clamp(x, f.x0, f.x1), ya + (yb - ya) * k.t, za + (zb - za) * k.t];
  }
  // Projektion aus der Ansicht v: Punkt (X, Y) der Ansicht -> (x, s) auf der dem Betrachter zugewandten Seite.
  function fusHit(f, v, X, Y) {
    const x = clamp(X * v.r[0], f.x0, f.x1), k = fusIdx(f, x), A = f.R[k.i], B = f.R[k.i + 1], G = f.G[k.i] + (f.G[k.i + 1] - f.G[k.i]) * k.t;
    let best = -Infinity, bs = 0, near = Infinity, ns = 0, pa = 0, pb = 0;
    for (let j = 0; j <= f.NS; j++) {
      const y = A[2 * j] + (B[2 * j] - A[2 * j]) * k.t, z = A[2 * j + 1] + (B[2 * j + 1] - A[2 * j + 1]) * k.t, a = y * v.u[1] + z * v.u[2], b = y * v.n[1] + z * v.n[2];
      if (Math.abs(a - Y) < near || (Math.abs(a - Y) === near && b > 0)) { near = Math.abs(a - Y); ns = j; }
      if (j > 0 && (pa - Y) * (a - Y) <= 0 && pa !== a) { const t = (Y - pa) / (a - pa), bb = pb + (b - pb) * t; if (bb > best) { best = bb; bs = j - 1 + t; } }
      pa = a; pb = b;
    }
    return { x, s: ((best > -Infinity ? bs : ns) / f.NS - 0.5) * G, G };
  }
  // Leitlinie gleichen Umfangsanteils tauA und ihre Bogenlänge: u(x) und Umkehrung.
  function guide(f, tauA) {
    const U = new Float64Array(f.NX); let pp = null;
    for (let i = 0; i < f.NX; i++) { const p = fusPt(f, f.xs[i], tauA * f.G[i]); U[i] = i ? U[i - 1] + Math.hypot(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]) : 0; pp = p; }
    const uOf = x => { const k = fusIdx(f, x); return U[k.i] + (U[k.i + 1] - U[k.i]) * k.t; };
    const xOf = u => { u = clamp(u, 0, U[f.NX - 1]); let lo = 0, hi = f.NX - 1; while (hi - lo > 1) { const mm = (lo + hi) >> 1; if (U[mm] <= u) lo = mm; else hi = mm; } const d = U[hi] - U[lo]; return f.xs[lo] + (f.xs[hi] - f.xs[lo]) * (d > 1e-12 ? (u - U[lo]) / d : 0); };
    return { uOf, xOf };
  }
  // ---------- Designs, die der Bauteilform folgen (decals_design.js) ----------------------------------
  // Rumpf-Design -> Gruppen mit Ansicht (Abwicklung), Texturparametern und Zuschnitt.
  function desGroups(it) {
    const f = fus(), sp = DES && DES.BY[it.key]; if (!f || !sp) return [];
    const bot = midBot(), key = 'd' + f.stamp + (bot ? 'b|' : '|') + it.key + JSON.stringify(it.p); let R = mcache.get(key); if (R) return R;
    const L = f.x1 - f.x0, ctx = { x0: f.x0, x1: f.x1, L, G: x => fusG(f, x), tauH: (x, h) => {
      const k = fusIdx(f, x), A = f.R[k.i], B = f.R[k.i + 1], yT = A[f.NS] + (B[f.NS] - A[f.NS]) * k.t, yB = A[0] + (B[0] - A[0]) * k.t, hit = fusHit(f, FVIEW.L, x, yB + h * (yT - yB));
      return hit.G > 1e-9 ? clamp(hit.s / hit.G, 0, 0.5) : 0.25; } };
    let groups = []; try { groups = sp.build(DES.defaults(it.key, it.p), ctx) || []; } catch (e) { console.error(e); }
    const dens = Rg => { const o = []; for (let i = 0; i < Rg.length; i++) { const p = Rg[i], q = Rg[(i + 1) % Rg.length], n = Math.max(1, Math.ceil(Math.max(Math.abs(q[0] - p[0]) / (L / 260), Math.abs(q[1] - p[1]) / 0.015))); for (let k = 0; k < n; k++) o.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]); } return o; };
    R = groups.filter(g => g.layers && g.layers.length).map(g => {
      const layers = g.layers.map(l => ({ c: l.c, view: !!l.view, rings: l.rings.filter(r => r.length > 2).map(dens) }));
      let sx = 0, st = 0, n = 0; layers.forEach(l => l.rings.forEach(r => r.forEach(q => { sx += q[0]; st += q[1]; n++; })));
      const xa = n ? sx / n : f.x0, tauA = g.at != null ? g.at : (n ? st / n : 0), gd = guide(f, tauA), ua = gd.uOf(xa);
      const mk = fn => layers.map(l => ({ c: l.c, rule: 'evenodd', view: l.view, rings: l.rings.map(r => r.map(fn)) }));
      // Ansicht: bei Mittellinie = Bauchlinie jeden Ring als Ganzes um den halben Umfang versetzen
      const vw = layers.map(l => ({ c: l.c, rule: 'evenodd', view: l.view, rings: l.rings.map(r => {
        let k = 0; if (bot) { let a = 0; r.forEach(q => { a += q[1]; }); k = 0.5 + Math.round(a / r.length - 0.5); }
        return r.map(q => [q[0], -(q[1] - k) * fusG(f, q[0])]); }) }));
      return { name: g.name || '', at: [xa, unY(tauA * fusG(f, xa), fusG(f, xa))],
        view: vw, param: mk(q => [(q[0] - f.x0) / L, q[1] + 0.5]),
        flat: mk(q => { let d = q[1] - tauA; d -= Math.round(d); return [gd.uOf(q[0]) - ua, -d * fusG(f, q[0])]; }).map(l => ({ c: l.c, rule: l.rule, view: l.view, rings: l.rings.map(r => simplify(r, 0.03)) })) };
    });
    if (mcache.size > 80) mcache.clear();
    mcache.set(key, R); return R;
  }
  // Tragflächen-Design -> Ebenen in Grundrisskoordinaten.
  function wdesLayers(it) {
    const sp = DES && DES.BY[it.key], st = String(it.surf).indexOf('wing:') === 0 ? wingGeom(+it.surf.split(':')[1]) : null; if (!sp || !st || st.length < 2) return [];
    try { return sp.build(DES.defaults(it.key, it.p), st).map(l => ({ c: l.c, rule: 'evenodd', rings: l.rings.filter(r => r.length > 2) })); } catch (e) { console.error(e); return []; }
  }
  // Abbildung eines Decals auf den Rumpf: Ansicht, Parameter (x, tau), 3D und Abwicklung.
  const mcache = new Map();
  function fusMap(it) {
    const is3 = it.surf === 'fus:3d', f = fus(), v = is3 ? null : FVIEW[String(it.surf).slice(4)]; if (!f || (!v && !is3)) return null;
    const off = is3 && midBot() ? 0.5 : 0, key = f.stamp + (off ? 'b|' : '|') + JSON.stringify(it); let m = mcache.get(key); if (m) return m;
    let an, su, sv;
    if (is3) {
      // frei auf der Oberfläche: it.x = Längslage, it.y = −Umfangs-Bogenlänge (Abwicklungs-Ansicht)
      const x = clamp(it.x, f.x0, f.x1), G = fusG(f, x); let s = unS(it.y, G); if (G > 1e-9) s -= G * Math.round(s / G);
      an = { x, s, G };
      const right = s < -1e-6 * G && s > -G / 2 + 1e-6 * G;      // rechte Rumpfseite: um 180° gedreht, damit es von außen aufrecht steht
      su = right ? -1 : 1; sv = right ? 1 : -1;
    } else an = fusHit(f, v, it.x, it.y);
    const kw = is3 && an.G > 1e-9 ? Math.round((unS(it.y, an.G) - an.s) / an.G) : 0;      // Abwicklungs-Ansicht: an der gezogenen Stelle zeichnen, nicht am anderen Rand
    const tauA = an.G > 1e-9 ? an.s / an.G : 0, { uOf, xOf } = guide(f, tauA), ua = uOf(an.x), wrap = is3 || it.wrap;
    if (!is3) { const p0 = fusPt(f, an.x, an.s - 0.5), p1 = fusPt(f, an.x, an.s + 0.5); su = v.r[0]; sv = ((p1[1] - p0[1]) * v.u[1] + (p1[2] - p0[2]) * v.u[2]) >= 0 ? 1 : -1; }
    const L = localLayers(it), size = Math.max(1, bbOf(allRings(L)).w || 1), ml = clamp(size / 80, 0.4, 3);
    m = { view: [], param: [], flat: [], p3: [], an };
    L.forEach(l => {
      const V = [], Pm = [], Fl = [];
      l.rings.forEach(R0 => {
        const R = densify(R0, ml), rv = [], rp = [], rf = [];
        R.forEach(q => {
          let x, s, G;
          if (wrap) { x = xOf(ua + su * q[0]); G = fusG(f, x); s = tauA * G + sv * q[1]; rf.push([q[0], q[1]]); }
          else {
            const h = fusHit(f, v, it.x + q[0], it.y + q[1]); x = h.x; G = h.G; s = h.s; const sr = tauA * G;
            if (G > 1e-9) { while (s - sr > G / 2) s -= G; while (s - sr < -G / 2) s += G; }
            rf.push([su * (uOf(x) - ua), sv * (s - sr)]);
          }
          const P3 = fusPt(f, x, s);
          rv.push(is3 ? [x, -(s + (kw - off) * G)] : [P3[0] * v.r[0], P3[1] * v.u[1] + P3[2] * v.u[2]]);
          rp.push([(x - f.x0) / (f.x1 - f.x0), G > 1e-9 ? s / G + 0.5 : 0.5]);
        });
        V.push(rv); Pm.push(rp); Fl.push(rf);
      });
      m.view.push({ c: l.c, rule: l.rule, rings: V }); m.param.push({ c: l.c, rule: l.rule, rings: Pm }); m.flat.push({ c: l.c, rule: l.rule, rings: Fl.map(R => simplify(R, 0.02)) });
    });
    if (mcache.size > 80) mcache.clear();
    mcache.set(key, m); return m;
  }
  // Ebenen eines Decals in Ansichtskoordinaten seiner Fläche.
  function viewLayers(it) {
    if (it.kind === 'fdes') return [].concat.apply([], desGroups(it).map(g => g.view));
    if (it.kind === 'wdes') return wdesLayers(it);
    if (isFus(it.surf)) { const m = fusMap(it); return m ? m.view : []; }
    return shift(localLayers(it), it.x, it.y);
  }

  // ---------- 2D-Ansicht -------------------------------------------------------------------------------
  let V = { s: 1, ox: 0, oy: 0 }, fitted = '', drag = null, cv2 = null;
  const SX = x => V.ox + V.s * x, SY = y => V.oy - V.s * y;
  const WX = px => (px - V.ox) / V.s, WY = py => (V.oy - py) / V.s;
  function fit(bb, w, h) { const s = Math.min((w - 90) / Math.max(1, bb.w), (h - 110) / Math.max(1, bb.h)); V = { s, ox: w / 2 - s * (bb.minx + bb.maxx) / 2, oy: h / 2 + s * (bb.miny + bb.maxy) / 2 - 10 }; }
  function paint(ctx, layers, fill, lw) {
    layers.forEach(l => {
      ctx.beginPath();
      l.rings.forEach(R => { R.forEach((q, i) => i ? ctx.lineTo(SX(q[0]), SY(q[1])) : ctx.moveTo(SX(q[0]), SY(q[1]))); ctx.closePath(); });
      if (fill) { ctx.fillStyle = RAW(l.c); ctx.fill(l.rule === 'nonzero' ? 'nonzero' : 'evenodd'); }
      else { ctx.strokeStyle = RAW(l.c); ctx.lineWidth = lw || 1.2; ctx.stroke(); }
    });
  }
  // Umriss-Rechteck der Grundform, Spiegelung berücksichtigt.
  function baseBB(it) { const b = bbOf(allRings(baseLayers(it))); return it.flip ? { minx: -b.maxx, maxx: -b.minx, miny: b.miny, maxy: b.maxy, w: b.w, h: b.h } : b; }
  function boxOf(it) {      // Ecken des Auswahlrahmens in Ansichtskoordinaten
    if (isDes(it)) return null;
    const b = baseBB(it); if (!isFinite(b.w)) return null;
    const a = (+it.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const P = (x, y) => [it.x + x * c - y * s, it.y + x * s + y * c];
    return { b, pts: [P(b.minx, b.miny), P(b.maxx, b.miny), P(b.maxx, b.maxy), P(b.minx, b.maxy)], top: P((b.minx + b.maxx) / 2, b.maxy) };
  }
  function render2d() {
    const cv = document.getElementById('cDecal'); if (!cv || !App.fitCanvas) return;
    const { ctx, w, h } = App.fitCanvas(cv), c = cfg(); ctx.clearRect(0, 0, w, h);
    if (c.view.sheet) { renderSheet(ctx, w, h); return; }
    const sh = surfShape(c.surf) || surfShape(c.surf = 'free'), bb = bbOf(sh.rings), fk = 's|' + c.surf + '|' + Math.round(bb.w) + '|' + Math.round(bb.h) + '|' + Math.round(w) + '|' + Math.round(h);
    if (fitted !== fk) { fit(bb, w, h); fitted = fk; }
    ctx.fillStyle = RAW(c.surfCol); ctx.strokeStyle = '#7f8c99'; ctx.lineWidth = 1.2;
    sh.rings.forEach(R => { ctx.beginPath(); R.forEach((q, i) => i ? ctx.lineTo(SX(q[0]), SY(q[1])) : ctx.moveTo(SX(q[0]), SY(q[1]))); ctx.closePath(); ctx.fill(); ctx.stroke(); });
    ctx.setLineDash([7, 5]); ctx.strokeStyle = 'rgba(120,130,140,.9)'; sh.lines.forEach(Ln => { ctx.beginPath(); ctx.moveTo(SX(Ln[0][0]), SY(Ln[0][1])); ctx.lineTo(SX(Ln[1][0]), SY(Ln[1][1])); ctx.stroke(); }); ctx.setLineDash([]);
    if (isFus(c.surf)) drawCanopy2d(ctx, c.surf);
    ctx.fillStyle = '#9fb0c0'; ctx.font = '12px system-ui'; ctx.fillText(sh.label, 12, h - 70);
    const items = c.items.filter(it => it.surf === c.surf);
    items.forEach(it => { const L = viewLayers(it); if (c.view.fill) paint(ctx, L, true); else paint(ctx, L.map(l => ({ c: lum(l.c) > 0.8 ? '#667' : l.c, rule: l.rule, rings: l.rings })), false, 1.3); });
    const it = selItem();
    if (it && it.surf === c.surf) {
      const bx = boxOf(it);
      if (bx) {
        ctx.strokeStyle = '#ff9d2e'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.beginPath(); bx.pts.forEach((q, i) => i ? ctx.lineTo(SX(q[0]), SY(q[1])) : ctx.moveTo(SX(q[0]), SY(q[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ff9d2e'; bx.pts.forEach(q => ctx.fillRect(SX(q[0]) - 4, SY(q[1]) - 4, 8, 8));
        midHandles(bx).forEach(q => { ctx.beginPath(); ctx.moveTo(SX(q[0]), SY(q[1]) - 5); ctx.lineTo(SX(q[0]) + 5, SY(q[1])); ctx.lineTo(SX(q[0]), SY(q[1]) + 5); ctx.lineTo(SX(q[0]) - 5, SY(q[1])); ctx.closePath(); ctx.fill(); });
        const rh = rotHandle(bx); ctx.beginPath(); ctx.moveTo(SX(bx.top[0]), SY(bx.top[1])); ctx.lineTo(rh[0], rh[1]); ctx.stroke(); ctx.beginPath(); ctx.arc(rh[0], rh[1], 5, 0, 6.3); ctx.fill();
        if (c.view.dims) { ctx.font = '12px system-ui'; ctx.fillStyle = '#ffcf99'; const lo = bx.pts.reduce((a, q) => SY(q[1]) > SY(a[1]) ? q : a); ctx.fillText(r1(bx.b.w) + ' × ' + r1(bx.b.h) + ' mm', SX(lo[0]) - 30, SY(lo[1]) + 18); }
      }
    }
    info(items.length);
  }
  // Kantenmitten (rechts, oben, links, unten) — Griffe zum Strecken in Breite bzw. Höhe.
  const midHandles = bx => [[1, 2], [2, 3], [3, 0], [0, 1]].map(([i, j]) => [(bx.pts[i][0] + bx.pts[j][0]) / 2, (bx.pts[i][1] + bx.pts[j][1]) / 2]);
  function rotHandle(bx) { const cx = (bx.pts[0][0] + bx.pts[2][0]) / 2, cy = (bx.pts[0][1] + bx.pts[2][1]) / 2, dx = SX(bx.top[0]) - SX(cx), dy = SY(bx.top[1]) - SY(cy), l = Math.hypot(dx, dy) || 1; return [SX(bx.top[0]) + dx / l * 22, SY(bx.top[1]) + dy / l * 22]; }
  function lum(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0.5; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
  function info(n) {
    const el = document.getElementById('decalInfo'); if (!el) return; const it = selItem(), c = cfg();
    let s = n + ' ' + T('Decals auf dieser Fläche') + ' · ' + c.items.length + ' ' + T('im Projekt');
    if (it && isDes(it)) s += '<br><b>' + esc(itemName(it)) + '</b> — ' + T('folgt der Form des Bauteils; Maße und Lage in der Seitenleiste');
    else if (it) { const b = bbOf(allRings(baseLayers(it))); s += '<br><b>' + esc(itemName(it)) + '</b>: ' + r1(b.w) + ' × ' + r1(b.h) + ' mm' + (isFus(it.surf) ? ' · ' + T(it.wrap || it.surf === 'fus:3d' ? 'maßgetreu aufgelegt' : 'projiziert, Zuschnitt abgewickelt') : ''); }
    s += '<br><span style="opacity:.7">' + T('Klick = wählen · Ziehen = verschieben · Ecke = Größe · Kreis = drehen (Umschalt: 15°) · Rad = Zoom · Entf = löschen') + '</span>';
    el.innerHTML = s;
  }
  const itemName = it => it.name || (isDes(it) ? T((DES && DES.BY[it.key] || {}).name || it.key) : it.kind === 'text' ? '„' + String(it.p.text || '').split('\n')[0].slice(0, 22) + '"' : T((LIB.BY[it.key] || {}).name || it.key));

  function hitItem(wx, wy) {
    const c = cfg(), items = c.items.filter(it => it.surf === c.surf);
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k]; if (isDes(it)) continue;
      const b = baseBB(it); if (!isFinite(b.w)) continue;
      const a = -(+it.rot || 0) * Math.PI / 180, dx = wx - it.x, dy = wy - it.y, x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a), m = 4 / V.s;
      if (x >= b.minx - m && x <= b.maxx + m && y >= b.miny - m && y <= b.maxy + m) return it;
    }
    return null;
  }
  function wire2d() {
    const cv = cv2 = document.getElementById('cDecal'); if (!cv || cv._wired) return; cv._wired = true; cv.tabIndex = 0; cv.style.outline = 'none';
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('wheel', e => { e.preventDefault(); const [mx, my] = pos(e), f = Math.exp(-e.deltaY * 0.0015); V.ox = mx - (mx - V.ox) * f; V.oy = my - (my - V.oy) * f; V.s *= f; render2d(); }, { passive: false });
    cv.addEventListener('mousedown', e => {
      cv.focus(); const [mx, my] = pos(e), c = cfg(), wx = WX(mx), wy = WY(my);
      if (c.view.sheet) {
        const p = sheetHit(wx, wy), was = sheetSel; sheetSel = p ? p.key : '';
        drag = p ? { mode: 'sheet', key: p.key, mx, my, wx, wy } : { mode: 'pan', mx, my, ox: V.ox, oy: V.oy };
        if (was !== sheetSel) render2d(); return;
      }
      const cur = selItem();
      if (cur && cur.surf === c.surf) {
        const bx = boxOf(cur);
        if (bx) {
          const rh = rotHandle(bx), ctr = [(bx.pts[0][0] + bx.pts[2][0]) / 2, (bx.pts[0][1] + bx.pts[2][1]) / 2];
          if (Math.hypot(mx - rh[0], my - rh[1]) < 9) { drag = { mode: 'rot', it: cur, ctr, a0: Math.atan2(wy - ctr[1], wx - ctr[0]), r0: +cur.rot || 0 }; return; }
          const mh = midHandles(bx);
          for (let k = 0; k < 4; k++) if (Math.hypot(mx - SX(mh[k][0]), my - SY(mh[k][1])) < 8) { const ax = k % 2 ? 'sy' : 'sx', ds = cur.ds || {}; drag = { mode: 'stretch', it: cur, ctr, ax, d0: Math.hypot(wx - ctr[0], wy - ctr[1]) || 1, v0: ds[ax] == null ? 100 : +ds[ax] }; return; }
          for (const q of bx.pts) if (Math.hypot(mx - SX(q[0]), my - SY(q[1])) < 9) { drag = { mode: 'scale', it: cur, ctr, d0: Math.hypot(wx - ctr[0], wy - ctr[1]) || 1, s0: cur.size, g0: +cur.repGap || 0 }; return; }
        }
      }
      const it = hitItem(wx, wy);
      if (it) { const was = c.sel; c.sel = it.id; drag = { mode: 'move', it, wx, wy, x0: it.x, y0: it.y }; if (was !== it.id) App.buildSidebar(); render(); }
      else { drag = { mode: 'pan', mx, my, ox: V.ox, oy: V.oy, moved: false }; }
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return; const [mx, my] = pos(e), wx = WX(mx), wy = WY(my), it = drag.it;
      if (drag.mode === 'sheet') {
        if (!drag.moved) { if (Math.abs(mx - drag.mx) + Math.abs(my - drag.my) <= 3) return; drag.moved = true; drag.sw = cfg().out.place !== 'free'; const p0 = sheetFree()[drag.key]; if (!p0) { drag = null; return; } drag.x0 = p0.x; drag.y0 = p0.y; }
        const p = cfg().out.pos[drag.key]; if (p) { p.x = r1(drag.x0 + wx - drag.wx); p.y = r1(drag.y0 - (wy - drag.wy)); }
        render2d(); return;
      }
      if (drag.mode === 'pan') { if (Math.abs(mx - drag.mx) + Math.abs(my - drag.my) > 3) drag.moved = true; V.ox = drag.ox + mx - drag.mx; V.oy = drag.oy + my - drag.my; render2d(); return; }
      if (drag.mode === 'move') { it.x = r1(drag.x0 + wx - drag.wx); it.y = r1(drag.y0 + wy - drag.wy); }
      else if (drag.mode === 'stretch') { it.ds = it.ds || {}; it.ds[drag.ax] = clamp(Math.round(drag.v0 * Math.hypot(wx - drag.ctr[0], wy - drag.ctr[1]) / drag.d0), 5, 2000); }
      else if (drag.mode === 'scale') { const k = Math.hypot(wx - drag.ctr[0], wy - drag.ctr[1]) / drag.d0; it.size = Math.max(1, r1(drag.s0 * k)); if (drag.g0) it.repGap = r1(drag.g0 * k); }
      else if (drag.mode === 'rot') { let a = drag.r0 + (Math.atan2(wy - drag.ctr[1], wx - drag.ctr[0]) - drag.a0) * 180 / Math.PI; if (e.shiftKey) a = Math.round(a / 15) * 15; it.rot = r1(((a + 540) % 360) - 180); }
      drag.changed = true; render();
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return; const d = drag; drag = null;
      if (d.mode === 'sheet') { if (d.sw) App.buildSidebar(); return; }
      if (d.mode === 'pan' && !d.moved && !cfg().view.sheet && cfg().sel) { cfg().sel = 0; App.buildSidebar(); render(); }
      else if (d.changed) App.buildSidebar();
    });
    cv.addEventListener('dblclick', e => { const [mx, my] = pos(e); if (cfg().view.sheet ? !sheetHit(WX(mx), WY(my)) : !hitItem(WX(mx), WY(my))) { fitted = ''; render2d(); } });
    cv.addEventListener('keydown', e => {
      if (cfg().view.sheet) {
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0, rot = e.key === 'r' || e.key === 'R';
        if (!sheetSel || !sheetM || !sheetM.sheetArr || !(dx || dy || rot) || e.ctrlKey || e.metaKey) return;
        const sw = cfg().out.place !== 'free', p = sheetFree()[sheetSel]; if (!p) return; const k = e.shiftKey ? 10 : 1;
        if (rot) p.r = ((+p.r || 0) + 90) % 360; else { p.x = r1(p.x + dx * k); p.y = r1(p.y + dy * k); }
        e.preventDefault(); if (sw) App.buildSidebar(); render2d(); return;
      }
      const it = selItem(); if (!it) return; const st = e.shiftKey ? 10 : 1;
      if (isDes(it) && e.key !== 'Delete') return;
      if (e.key === 'Delete' || e.key === 'Backspace') delItem(it);
      else if (e.key === 'ArrowLeft') it.x -= st; else if (e.key === 'ArrowRight') it.x += st; else if (e.key === 'ArrowUp') it.y += st; else if (e.key === 'ArrowDown') it.y -= st;
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) dupItem(it);
      else return;
      e.preventDefault(); changed(true);
    });
  }

  // ---------- 3D-Ansicht des Rumpfs (WebGL2, Decals als Textur in (x, Umfang)) ----------------------------
  const G3 = { gl: null, prog: null, vao: null, n: 0, tex: null, stamp: -1, texKey: '', cam: { yaw: -0.55, pitch: 0.28, zoom: 1, px: 0, py: 0 }, tc: null };
  function init3d() {
    const cv = document.getElementById('cDecal3d'); if (!cv || G3.gl) return !!G3.gl;
    const gl = cv.getContext('webgl2', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true }); if (!gl) return false;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec3 aP;in vec3 aN;in vec2 aT;uniform mat3 uR;uniform vec3 uC;uniform vec3 uS;uniform vec2 uO;out vec3 vN;out vec2 vT;void main(){vec3 q=uR*(aP-uC);vN=uR*aN;vT=aT;gl_Position=vec4(q.x*uS.x+uO.x,q.y*uS.y+uO.y,-q.z*uS.z,1.0);}'));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;in vec3 vN;in vec2 vT;uniform sampler2D uTex;out vec4 o;void main(){vec3 n=normalize(vN);float d=abs(dot(n,normalize(vec3(0.25,0.45,0.86))));vec3 c=texture(uTex,vT).rgb;o=vec4(c*(0.42+0.6*d),1.0);}'));
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return false;
    G3.gl = gl; G3.prog = p; G3.tex = gl.createTexture(); G3.tc = document.createElement('canvas');
    const mt = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048; G3.tc.width = Math.min(4096, mt); G3.tc.height = Math.min(2048, mt);
    let d = null;
    // Klick auf den Rumpf setzt das gewählte Decal dorthin; Umschalt+Ziehen schiebt es über die Oberfläche.
    cv.addEventListener('mousedown', e => { d = { x: e.clientX, y: e.clientY, yaw: G3.cam.yaw, pitch: G3.cam.pitch, px: G3.cam.px, py: G3.cam.py, pan: e.button === 2 || e.button === 1 || e.ctrlKey, place: e.shiftKey && e.button === 0, moved: false }; if (d.place) d.did = place3d(e.clientX, e.clientY); });
    window.addEventListener('mousemove', e => { if (!d) return; if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true; if (d.place) { if (place3d(e.clientX, e.clientY)) d.did = true; return; }
      if (d.pan) { const r = cv.getBoundingClientRect(); G3.cam.px = d.px + (e.clientX - d.x) / r.width * 2; G3.cam.py = d.py - (e.clientY - d.y) / r.height * 2; render3d(); return; }
      G3.cam.yaw = d.yaw + (e.clientX - d.x) * 0.008; G3.cam.pitch = clamp(d.pitch + (e.clientY - d.y) * 0.008, -1.55, 1.55); render3d(); });
    window.addEventListener('mouseup', e => { if (!d) return; const q = d; d = null; if (!q.moved && !q.place && !q.pan) q.did = place3d(e.clientX, e.clientY); if (q.did) App.buildSidebar(); });
    cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width * 2 - 1, ny = 1 - (e.clientY - r.top) / r.height * 2, z0 = G3.cam.zoom, z1 = clamp(z0 * Math.exp(-e.deltaY * 0.0015), 0.3, 60), k = z1 / z0;
      G3.cam.px = nx - (nx - G3.cam.px) * k; G3.cam.py = ny - (ny - G3.cam.py) * k; G3.cam.zoom = z1; render3d(); }, { passive: false });
    const reset3d = () => { G3.cam = { yaw: -0.55, pitch: 0.28, zoom: 1, px: 0, py: 0 }; };
    cv.addEventListener('dblclick', () => { reset3d(); render3d(); });
    if (window.ViewCube && ViewCube.home) ViewCube.home({ canvas: () => cv, reset: reset3d, redraw: () => render3d() });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    // Mausrad-Doppelklick: Treffer auf dem Rumpf wird Drehpunkt (cam.piv). Er liegt
    // auf dem Strahl durch den Cursor → seine Bildlage ist genau die Cursor-NDC;
    // px/py = Cursor-NDC hält ihn dort fest (kein Sprung). Mittlere Taste ziehen
    // verschiebt weiterhin.
    if (window.ViewCube && ViewCube.midDbl) ViewCube.midDbl(cv, (x, y, e) => {
      const h = pick3d(e.clientX, e.clientY); if (!h || !h.p) return false;
      const r = cv.getBoundingClientRect();
      G3.cam.piv = h.p; G3.cam.px = (e.clientX - r.left) / r.width * 2 - 1; G3.cam.py = 1 - (e.clientY - r.top) / r.height * 2;
      d = null; render3d(); return true;
    });
    return true;
  }
  // Strahl durch den Bildpunkt -> vorderster Treffer auf dem Rumpf: { x, s } (s = Umfang ab der Rückenlinie).
  function pick3d(cx, cy) {
    const cv = document.getElementById('cDecal3d'), f = fus(); if (!cv || !f || !G3.ext) return null;
    const r = cv.getBoundingClientRect(), nx = (cx - r.left) / r.width * 2 - 1, ny = 1 - (cy - r.top) / r.height * 2, asp = r.width / r.height, k = G3.cam.zoom * 0.92 / G3.ext;
    const qx = (nx - (G3.cam.px || 0)) / (asp >= 1 ? k / asp : k), qy = (ny - (G3.cam.py || 0)) / (asp >= 1 ? k : k * asp);
    const cyw = Math.cos(G3.cam.yaw), syw = Math.sin(G3.cam.yaw), cp = Math.cos(G3.cam.pitch), sp = Math.sin(G3.cam.pitch);
    const c0 = [cyw, sp * syw, -cp * syw], c1 = [0, cp, sp], c2 = [syw, -sp * cyw, cp * cyw], C = ctr3d();
    const O = [c0[0] * qx + c0[1] * qy + C[0], c1[0] * qx + c1[1] * qy + C[1], c2[0] * qx + c2[1] * qy + C[2]], D = [c0[2], c1[2], c2[2]];
    let best = -Infinity, fi = 0, fj = 0;
    const tri = (ax, ay, az, bx, by, bz, ex, ey, ez) => {      // Möller–Trumbore, Gerade statt Halbstrahl
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = ex - ax, e2y = ey - ay, e2z = ez - az;
      const px = D[1] * e2z - D[2] * e2y, py = D[2] * e2x - D[0] * e2z, pz = D[0] * e2y - D[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) return null;
      const tx = O[0] - ax, ty = O[1] - ay, tz = O[2] - az, u = (tx * px + ty * py + tz * pz) / det; if (u < 0 || u > 1) return null;
      const qx2 = ty * e1z - tz * e1y, qy2 = tz * e1x - tx * e1z, qz2 = tx * e1y - ty * e1x, v = (D[0] * qx2 + D[1] * qy2 + D[2] * qz2) / det; if (v < 0 || u + v > 1) return null;
      return [(e2x * qx2 + e2y * qy2 + e2z * qz2) / det, u, v];
    };
    for (let i = 0; i < f.NX - 1; i++) {
      const A = f.R[i], B = f.R[i + 1], xa = f.xs[i], xb = f.xs[i + 1];
      for (let j = 0; j < f.NS; j++) {
        let h = tri(xa, A[2 * j], A[2 * j + 1], xb, B[2 * j], B[2 * j + 1], xa, A[2 * j + 2], A[2 * j + 3]);
        if (h && h[0] > best) { best = h[0]; fi = i + h[1]; fj = j + h[2]; }
        h = tri(xa, A[2 * j + 2], A[2 * j + 3], xb, B[2 * j], B[2 * j + 1], xb, B[2 * j + 2], B[2 * j + 3]);
        if (h && h[0] > best) { best = h[0]; fi = i + h[1] + h[2]; fj = j + 1 - h[1]; }
      }
    }
    if (best === -Infinity) return null;
    const i = Math.min(f.NX - 2, Math.floor(fi)), x = f.xs[i] + (f.xs[i + 1] - f.xs[i]) * (fi - i);
    return { x, s: (fj / f.NS - 0.5) * fusG(f, x), p: [O[0] + D[0] * best, O[1] + D[1] * best, O[2] + D[2] * best] };
  }
  // Drehzentrum der 3D-Ansicht: gesetzter Drehpunkt oder Rumpfmitte
  const ctr3d = () => G3.cam.piv || G3.ctr;
  function place3d(cx, cy) {
    const it = selItem(), f = fus(); if (!it || !f || !isFus(it.surf) || isDes(it)) return false;
    const h = pick3d(cx, cy); if (!h) return false;
    if (it.surf === 'fus:3d') { it.x = r1(h.x); it.y = r1(unY(h.s, fusG(fus(), h.x))); }
    else { const v = FVIEW[it.surf.slice(4)], P = fusPt(f, h.x, h.s); it.x = r1(P[0] * v.r[0]); it.y = r1(P[1] * v.u[1] + P[2] * v.u[2]); }
    render(); return true;
  }
  function mesh3d(f) {
    const gl = G3.gl, NX = f.NX, NS = f.NS, W = NS + 1, P = new Float32Array(NX * W * 8), I = new Uint32Array((NX - 1) * NS * 6);
    const at = (i, j) => [f.xs[i], f.R[i][2 * j], f.R[i][2 * j + 1]];
    for (let i = 0; i < NX; i++) for (let j = 0; j <= NS; j++) {
      const p = at(i, j), a = at(Math.min(NX - 1, i + 1), j), b = at(Math.max(0, i - 1), j), c = at(i, j === NS ? 1 : j + 1), d = at(i, j === 0 ? NS - 1 : j - 1);
      const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) { nx = i < NX / 2 ? -1 : 1; ny = 0; nz = 0; } else { nx /= l; ny /= l; nz /= l; }
      P.set([p[0], p[1], p[2], nx, ny, nz, (f.xs[i] - f.x0) / (f.x1 - f.x0), j / NS], (i * W + j) * 8);
    }
    let k = 0; for (let i = 0; i < NX - 1; i++) for (let j = 0; j < NS; j++) { const a = i * W + j, b = a + W; I[k++] = a; I[k++] = b; I[k++] = a + 1; I[k++] = a + 1; I[k++] = b; I[k++] = b + 1; }
    G3.vao = gl.createVertexArray(); gl.bindVertexArray(G3.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, P, gl.STATIC_DRAW);
    [['aP', 3, 0], ['aN', 3, 12], ['aT', 2, 24]].forEach(([n, s, o]) => { const l = gl.getAttribLocation(G3.prog, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, s, gl.FLOAT, false, 32, o); });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
    G3.n = I.length; G3.stamp = f.stamp;
    let r = 0; for (let i = 0; i < NX; i++) for (let j = 0; j <= NS; j++) r = Math.max(r, Math.hypot(f.R[i][2 * j], f.R[i][2 * j + 1]));
    G3.ext = Math.hypot((f.x1 - f.x0) / 2, r); let ym = 0, n = 0; for (let i = 0; i < NX; i++) { ym += f.R[i][NS] + f.R[i][0]; n += 2; } G3.ctr = [(f.x0 + f.x1) / 2, ym / n, 0];
    // anderes Modell: Drehpunkt außerhalb des neuen Rumpfs → zurück auf Rumpfmitte
    const pv = G3.cam.piv;
    if (pv && Math.hypot(pv[0] - G3.ctr[0], pv[1] - G3.ctr[1], pv[2] - G3.ctr[2]) > 1.2 * G3.ext) { G3.cam.piv = null; G3.cam.px = 0; G3.cam.py = 0; }
  }
  function texture3d() {
    const gl = G3.gl, c = cfg(), tc = G3.tc, items = c.items.filter(it => isFus(it.surf)), f = fus(), cano = f && fusCanopy(f), key = c.surfCol + '|' + fusStamp + '|' + (cano ? cano.col : '') + '|' + JSON.stringify(items);
    if (key === G3.texKey) return; G3.texKey = key;
    const ctx = tc.getContext('2d'), TW = tc.width, TH = tc.height;
    ctx.fillStyle = RAW(c.surfCol); ctx.fillRect(0, 0, TW, TH);
    if (cano) {   // Kabinenhaube aus Rumpf in ihrer Farbe (Textur: u = x, v = Umfang, 0,5 = Rückenlinie)
      const U = x => (x - f.x0) / (f.x1 - f.x0) * TW, V = (t, sg) => (0.5 + sg * t / 2) * TH;
      ctx.fillStyle = RAW(cano.col); ctx.beginPath();
      canoStrips(f, (xa, sa, xb, sb) => { for (const sg of [1, -1]) { ctx.moveTo(U(xa), V(sa[0], sg)); ctx.lineTo(U(xb), V(sb[0], sg)); ctx.lineTo(U(xb), V(sb[1], sg)); ctx.lineTo(U(xa), V(sa[1], sg)); ctx.closePath(); } });
      ctx.fill('nonzero');
    }
    items.forEach(it => {
      const pl = it.kind === 'fdes' ? [].concat.apply([], desGroups(it).map(g => g.param)) : (fusMap(it) || { param: [] }).param;
      pl.forEach(l => {
        let lo = Infinity, hi = -Infinity; l.rings.forEach(R => R.forEach(q => { if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1]; }));
        for (const off of [0, -1, 1]) {
          if ((off === -1 && hi <= 1) || (off === 1 && lo >= 0)) continue;
          ctx.beginPath(); l.rings.forEach(R => { R.forEach((q, i) => i ? ctx.lineTo(q[0] * TW, (q[1] + off) * TH) : ctx.moveTo(q[0] * TW, (q[1] + off) * TH)); ctx.closePath(); });
          ctx.fillStyle = RAW(l.c); ctx.fill(l.rule === 'nonzero' ? 'nonzero' : 'evenodd');
        }
      });
    });
    gl.bindTexture(gl.TEXTURE_2D, G3.tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tc); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }
  function render3d() {
    const cv = document.getElementById('cDecal3d'), f = fus(); if (!cv || !f || !isFus(cfg().surf) || !init3d()) return;
    const gl = G3.gl, dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    if (G3.stamp !== f.stamp) mesh3d(f);
    texture3d();
    gl.viewport(0, 0, w, h); gl.clearColor(0.09, 0.11, 0.14, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(G3.prog); gl.bindVertexArray(G3.vao);
    const cy = Math.cos(G3.cam.yaw), sy = Math.sin(G3.cam.yaw), cp = Math.cos(G3.cam.pitch), sp = Math.sin(G3.cam.pitch);
    // R = Rx(pitch) · Ry(yaw), spaltenweise
    gl.uniformMatrix3fv(gl.getUniformLocation(G3.prog, 'uR'), false, [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy]);
    gl.uniform3fv(gl.getUniformLocation(G3.prog, 'uC'), ctr3d());
    const k = G3.cam.zoom * 0.92 / G3.ext, asp = w / h;
    gl.uniform2f(gl.getUniformLocation(G3.prog, 'uO'), G3.cam.px || 0, G3.cam.py || 0);
    gl.uniform3f(gl.getUniformLocation(G3.prog, 'uS'), asp >= 1 ? k / asp : k, asp >= 1 ? k : k * asp, (G3.cam.piv ? 0.25 : 0.5) / G3.ext);   // mit Drehpunkt bis 2·ext Tiefe → halbe Tiefenskala
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G3.tex); gl.uniform1i(gl.getUniformLocation(G3.prog, 'uTex'), 0);
    gl.drawElements(gl.TRIANGLES, G3.n, gl.UNSIGNED_INT, 0);
  }

  // Drehung in 90°-Schritten (freie Platzierung auf dem Bogen)
  const rotR = (rings, r) => { const k = ((Math.round(r / 90) % 4) + 4) % 4; return k ? rings.map(R => R.map(q => k === 1 ? [-q[1], q[0]] : k === 2 ? [-q[0], -q[1]] : [q[1], -q[0]])) : rings; };
  const rotL = (L, r) => L.map(l => ({ c: l.c, rule: l.rule, rings: rotR(l.rings, r) }));
  // ---------- Ausgabe: Modell (mm, y nach oben) ----------------------------------------------------------
  // Liefert { W, H, frames: [Ring], pieces: [{ name, layers, cut: [Ring] }], scale: Ring|null, warn }
  function exportModel(forSil) {
    const c = cfg(), o = c.out, plot = forSil || o.mode === 'plot', items = c.items.filter(it => o.scope === 'all' || it.surf === c.surf);
    const sheet = o.arr === 'sheet', cutD = !plot && +o.cut > 0 ? +o.cut : 0, units = [];
    // Zuschnitt je Decal (relativ zur Decal-Mitte)
    items.forEach(it => {
      if (it.kind === 'fdes') {      // je Gruppe (z. B. linke / rechte Seite) ein eigener, abgewickelter Zuschnitt
        desGroups(it).forEach((g, gi) => { const Lg = g.flat.filter(l => !l.view); if (Lg.length) units.push({ key: it.id + '|g' + gi, name: itemName(it) + (g.name ? ' ' + g.name : ''), col: null, layers: Lg, cut: [], at: sheet ? [0, 0] : g.at, surf: it.surf }); });
        return;
      }
      let L;
      if (it.kind === 'wdes') L = wdesLayers(it);
      else if (isFus(it.surf)) { const m = fusMap(it); if (!m) return; L = (it.wrap || it.surf === 'fus:3d') && sheet ? localLayers(it, true) : m.flat; }
      else L = localLayers(it, sheet);
      if (!L.length) return;
      const cut = cutD && !isDes(it) ? offsetLayers(L, cutD) : [], at = sheet || it.kind === 'wdes' ? [0, 0] : [it.x, it.y];
      if (sheet && plot && o.sep) {
        const by = new Map(); L.forEach(l => { if (!by.has(l.c)) by.set(l.c, []); by.get(l.c).push(l); });
        by.forEach((ls, col) => units.push({ key: it.id + '|' + col, name: itemName(it), col, layers: ls, cut: [], at, surf: it.surf }));
      } else units.push({ key: String(it.id), name: itemName(it), col: null, layers: L, cut, at, surf: it.surf });
    });
    const res = { pieces: [], frames: [], scale: null, warn: '', plot, n: units.length };
    if (!units.length) return res;
    if (!sheet) {
      // wie platziert; mehrere Flächen untereinander
      const surfs = Array.from(new Set(units.map(u => u.surf))); let yOff = 0;
      surfs.forEach(sf => {
        const us = units.filter(u => u.surf === sf).map(u => ({ name: u.name, layers: shift(u.layers, u.at[0], u.at[1]), cut: u.cut.map(R => R.map(q => [q[0] + u.at[0], q[1] + u.at[1]])) }));
        const b = bbOf([].concat.apply([], us.map(u => allRings(u.layers).concat(u.cut)))), dy = yOff - b.maxy;
        us.forEach(u => res.pieces.push({ name: u.name, layers: shift(u.layers, -b.minx, dy), cut: u.cut.map(R => R.map(q => [q[0] - b.minx, q[1] + dy])) }));
        yOff -= b.h + 20;
      });
    } else {
      const sw = o.sheet === 'own' ? Math.max(20, +o.sheetW || 210) : SHEETS[o.sheet][1], shh = o.sheet === 'own' ? Math.max(20, +o.sheetH || 297) : SHEETS[o.sheet][2], mg = Math.max(0, +o.margin || 0), gap = Math.max(0, +o.gap || 0);
      const iw = sw - 2 * mg, ih = shh - 2 * mg, pitch = sw + 15; let sx = 0, x = 0, y = 0, rowH = 0, col = units[0].col, big = 0;
      const newSheet = () => { sx += pitch; x = 0; y = 0; rowH = 0; };
      // Freie Platzierung: Lage je Teil in o.pos (x nach rechts ab linkem Rand des ersten Bogens, y nach unten ab
      // Bogenoberkante, r = Drehung in 90°-Schritten). Teile ohne Eintrag bekommen einen freien Platz.
      const free = o.place === 'free', pos = free ? (o.pos && typeof o.pos === 'object' ? o.pos : (o.pos = {})) : null;
      if (free) { const ids = new Set(c.items.map(it => String(it.id))); Object.keys(pos).forEach(k => { if (!ids.has(k.split('|')[0])) delete pos[k]; }); }
      const seed = free && !units.some(u => pos[u.key]);
      const us = units.map(u => { const r = free && pos[u.key] ? (+pos[u.key].r || 0) : 0; if (r) { u.layers = rotL(u.layers, r); u.cut = rotR(u.cut, r); } return { u, b: bbOf(allRings(u.layers).concat(u.cut)) }; });
      if (!(plot && o.sep)) us.sort((a, b) => b.b.h - a.b.h); else us.sort((a, b) => (a.u.col < b.u.col ? -1 : a.u.col > b.u.col ? 1 : b.b.h - a.b.h));
      us.forEach(q => {
        const u = q.u, b = q.b;
        if (u.col !== col) { col = u.col; if (x > 0 || y > 0) newSheet(); }
        if (b.w > iw || b.h > ih) big++;
        if (x > 0 && x + b.w > iw) { x = 0; y += rowH + gap; rowH = 0; }
        if (y > 0 && y + b.h > ih) newSheet();
        q.X = sx + mg + x; q.Y = mg + y;
        x += b.w + gap; rowH = Math.max(rowH, b.h);
      });
      let nSheets = Math.round(sx / pitch) + 1, out = 0;
      if (free) {
        const rects = [], hit = (X, Y, b) => rects.some(q => X < q.x + q.w + gap && q.x < X + b.w + gap && Y < q.y + q.h + gap && q.y < Y + b.h + gap);
        const firstFit = b => { for (let s0 = 0; s0 < 30; s0++) for (let yy = 0; yy === 0 || yy + b.h <= ih; yy += 2) for (let xx = 0; xx === 0 || xx + b.w <= iw; xx += 2) { const X = s0 * pitch + mg + xx, Y = mg + yy; if (!hit(X, Y, b)) return [X, Y]; } return null; };
        us.forEach(q => { const p = pos[q.u.key]; if (p) { p.x = q.X = Math.max(0, +p.x || 0); p.y = q.Y = clamp(+p.y || 0, 0, Math.max(0, shh - q.b.h)); rects.push({ x: q.X, y: q.Y, w: q.b.w, h: q.b.h }); } });
        us.forEach(q => { if (pos[q.u.key]) return; if (!seed) { const f = firstFit(q.b); if (f) { q.X = f[0]; q.Y = f[1]; } } pos[q.u.key] = { x: r1(q.X), y: r1(q.Y), r: 0 }; rects.push({ x: q.X, y: q.Y, w: q.b.w, h: q.b.h }); });
        nSheets = 1;
        us.forEach(q => { const k = Math.min(59, Math.max(0, Math.floor((q.X + q.b.w / 2) / pitch))), x0 = k * pitch; nSheets = Math.max(nSheets, k + 1); if (q.X < x0 + mg - 0.05 || q.X + q.b.w > x0 + sw - mg + 0.05 || q.Y < mg - 0.05 || q.Y + q.b.h > shh - mg + 0.05) { out++; q.out = true; } });
      }
      us.forEach(q => {
        const u = q.u, b = q.b, dx = q.X - b.minx, dy = -q.Y - b.maxy;
        res.pieces.push({ key: u.key, out: !!q.out, name: u.name + (u.col ? ' ' + u.col : ''), layers: shift(u.layers, dx, dy), cut: u.cut.map(R => R.map(p => [p[0] + dx, p[1] + dy])) });
      });
      for (let k = 0; k < nSheets; k++) res.frames.push([[k * pitch, 0], [k * pitch + sw, 0], [k * pitch + sw, -shh], [k * pitch, -shh]]);
      res.free = free; res.sheetArr = true;
      if (free && out) res.warn = out + ' ' + T('Decal(s) liegen nicht ganz im bedruckbaren Bereich eines Bogens.');
      else if (big) res.warn = big + ' ' + T('Decal(s) größer als der Bogen — größeren Bogen wählen oder „wie platziert" ausgeben.');
    }
    const all = [].concat.apply([], res.pieces.map(p => allRings(p.layers).concat(p.cut))).concat(res.frames), bb = bbOf(all);
    if (o.scale && !forSil) { const y = bb.miny - 8; res.scale = [[bb.minx, y], [bb.minx + 100, y]]; bb.miny = y - 6; bb.maxx = Math.max(bb.maxx, bb.minx + 100); }
    // Ursprung links unten
    const mv = R => R.map(q => [q[0] - bb.minx, q[1] - bb.miny]);
    res.pieces.forEach(p => { p.layers = p.layers.map(l => ({ c: l.c, rule: l.rule, rings: l.rings.map(mv) })); p.cut = p.cut.map(mv); });
    res.frames = res.frames.map(mv); if (res.scale) res.scale = mv(res.scale);
    res.pieces.forEach(p => { p.bb = bbOf(allRings(p.layers).concat(p.cut)); });
    res.W = bb.maxx - bb.minx; res.H = bb.maxy - bb.miny;
    return res;
  }
  // Ebenen je Farbe (Plot): [{ c, rings }]
  function byColor(m) { const map = new Map(); m.pieces.forEach(p => p.layers.forEach(l => { if (!map.has(l.c)) map.set(l.c, []); l.rings.forEach(R => map.get(l.c).push(R)); })); return Array.from(map, ([c, rings]) => ({ c, rings })); }
  let sheetM = null, sheetSel = '';
  function sheetHit(wx, wy) { const P = sheetM && sheetM.sheetArr ? sheetM.pieces : []; for (let k = P.length - 1; k >= 0; k--) { const b = P[k].bb, m = 3 / V.s; if (wx >= b.minx - m && wx <= b.maxx + m && wy >= b.miny - m && wy <= b.maxy + m) return P[k]; } return null; }
  // Wechsel auf freie Platzierung: beginnt mit der gerade sichtbaren automatischen Anordnung.
  function sheetFree() { const o = cfg().out; if (o.place === 'free' && o.pos) return o.pos; o.place = 'free'; o.pos = {}; exportModel(false); return o.pos; }
  function renderSheet(ctx, w, h) {
    const m = exportModel(false), c = cfg();
    if (!m.pieces.length) { info(0); ctx.fillStyle = '#9fb0c0'; ctx.font = '13px system-ui'; ctx.fillText(T('Keine Decals für die Ausgabe.'), 20, 60); return; }
    sheetM = m;
    const fk = 'e|' + Math.round(m.W) + '|' + Math.round(m.H) + '|' + Math.round(w) + '|' + Math.round(h); if (fitted !== fk) { if (!(drag && drag.mode === 'sheet')) fit({ minx: 0, miny: 0, maxx: m.W, maxy: m.H, w: m.W, h: m.H }, w, h); fitted = fk; }
    ctx.fillStyle = RAW('#f4f6f8'); ctx.strokeStyle = '#7f8c99';
    (m.frames.length ? m.frames : [[[0, 0], [m.W, 0], [m.W, m.H], [0, m.H]]]).forEach(R => { ctx.beginPath(); R.forEach((q, i) => i ? ctx.lineTo(SX(q[0]), SY(q[1])) : ctx.moveTo(SX(q[0]), SY(q[1]))); ctx.closePath(); ctx.fill(); ctx.stroke(); });
    m.pieces.forEach(p => { if (m.plot) paint(ctx, p.layers.map(l => ({ c: lum(l.c) > 0.8 ? '#778' : l.c, rule: l.rule, rings: l.rings })), false, 1.2); else paint(ctx, p.layers, true); paint(ctx, [{ c: '#e0109c', rings: p.cut }], false, 1.2); });
    m.pieces.forEach(p => {
      const s0 = p.key === sheetSel && m.sheetArr; if (!s0 && !p.out) return; const b = p.bb;
      ctx.strokeStyle = p.out ? '#e5484d' : '#ff9d2e'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.strokeRect(SX(b.minx) - 3, SY(b.maxy) - 3, V.s * b.w + 6, V.s * b.h + 6); ctx.setLineDash([]);
      if (s0 && c.view.dims) { ctx.font = '12px system-ui'; ctx.fillStyle = '#c96a00'; ctx.fillText(r1(b.w) + ' × ' + r1(b.h) + ' mm', SX(b.minx), SY(b.miny) + 17); }
    });
    if (m.scale) { ctx.strokeStyle = RAW('#333'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(SX(m.scale[0][0]), SY(m.scale[0][1])); ctx.lineTo(SX(m.scale[1][0]), SY(m.scale[1][1])); ctx.stroke(); ctx.fillStyle = '#9fb0c0'; ctx.font = '11px system-ui'; ctx.fillText('100 mm', SX(m.scale[0][0]), SY(m.scale[0][1]) + 14); }
    const el = document.getElementById('decalInfo');
    if (el) el.innerHTML = T('Ausgabe-Vorschau') + ': ' + m.n + ' ' + T('Teile') + ' · ' + r1(m.W) + ' × ' + r1(m.H) + ' mm' + (m.frames.length ? ' · ' + m.frames.length + ' ' + T('Bogen') : '') + ' · ' + T(m.plot ? 'Plot (Konturen je Farbe)' : 'Druck (farbig)') + (m.sheetArr ? ' · ' + T(m.free ? 'frei platziert' : 'automatisch geschachtelt') : '') + (m.warn ? '<br><span style="color:#fb8">' + m.warn + '</span>' : '')
      + (m.sheetArr ? '<br><span style="opacity:.7">' + T('Decal ziehen = frei auf dem Bogen platzieren (auch auf einen weiteren Bogen rechts) · R = um 90° drehen · Pfeiltasten = verschieben (Umschalt: 10 mm) · Rad = Zoom') + '</span>' : '');
  }

  // ---------- Ausgabe: SVG / DXF ---------------------------------------------------------------------------
  const f3 = v => (Math.round(v * 1000) / 1000).toString();
  function svgText(m) {
    const d = (rings, H) => rings.map(R => 'M' + R.map(q => f3(q[0]) + ' ' + f3(H - q[1])).join('L') + 'Z').join('');
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<!-- AI Foam Cut — Decals, Maße in mm (1 Einheit = 1 mm) -->',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="' + f3(m.W) + 'mm" height="' + f3(m.H) + 'mm" viewBox="0 0 ' + f3(m.W) + ' ' + f3(m.H) + '">'];
    const grp = (id, body, attr) => out.push('<g id="' + esc(id) + '" inkscape:groupmode="layer" inkscape:label="' + esc(id) + '"' + (attr || '') + '>', body, '</g>');
    if (cfg().out.frame && m.frames.length) grp('Bogen', '<path d="' + d(m.frames, m.H) + '"/>', ' fill="none" stroke="#9aa3ad" stroke-width="0.2" stroke-dasharray="3 2"');
    if (m.plot) byColor(m).forEach((g, i) => grp('Farbe_' + (i + 1) + '_' + g.c.replace('#', ''), '<path d="' + d(g.rings, m.H) + '"/>', ' fill="none" stroke="' + (lum(g.c) > 0.85 ? '#808080' : g.c) + '" stroke-width="0.1"'));
    else m.pieces.forEach((p, i) => grp('Decal_' + (i + 1) + '_' + p.name.replace(/[^\w\-]+/g, '_'), p.layers.map(l => '<path fill="' + l.c + '" fill-rule="' + (l.rule === 'nonzero' ? 'nonzero' : 'evenodd') + '" d="' + d(l.rings, m.H) + '"/>').join('\n'), ''));
    const cut = [].concat.apply([], m.pieces.map(p => p.cut));
    if (cut.length) grp('Schneidekontur', '<path d="' + d(cut, m.H) + '"/>', ' fill="none" stroke="#ff00ff" stroke-width="0.1"');
    if (m.scale) grp('Massstab_100mm', '<path d="M' + f3(m.scale[0][0]) + ' ' + f3(m.H - m.scale[0][1]) + 'L' + f3(m.scale[1][0]) + ' ' + f3(m.H - m.scale[1][1]) + '"/>', ' fill="none" stroke="#000000" stroke-width="0.2"');
    out.push('</svg>'); return out.join('\n');
  }
  const ACI = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [7, 255, 255, 255], [8, 128, 128, 128], [30, 255, 127, 0], [250, 20, 20, 20]];
  function aci(hex) { const n = parseInt(String(hex).replace('#', ''), 16) || 0, r = n >> 16, g = (n >> 8) & 255, b = n & 255; let best = 7, bd = Infinity; ACI.forEach(a => { const d = (a[1] - r) ** 2 + (a[2] - g) ** 2 + (a[3] - b) ** 2; if (d < bd) { bd = d; best = a[0]; } }); return best; }
  // DXF R12 (POLYLINE/VERTEX — liest jedes Programm), Ebene je Farbe; k = Maßstab (1 = mm, 1/25,4 = Zoll).
  function dxfText(m, k, sil) {
    const lay = [], ent = [];
    const pl = (name, R, closed) => { ent.push('0', 'POLYLINE', '8', name, '66', '1', '70', closed ? '1' : '0'); R.forEach(q => ent.push('0', 'VERTEX', '8', name, '10', (q[0] * k).toFixed(4), '20', (q[1] * k).toFixed(4))); ent.push('0', 'SEQEND', '8', name); };
    byColor(m).forEach((g, i) => { const name = 'FARBE_' + (i + 1) + '_' + g.c.replace('#', '').toUpperCase(); lay.push([name, aci(g.c)]); g.rings.forEach(R => pl(name, R, true)); });
    const cut = [].concat.apply([], m.pieces.map(p => p.cut)); if (cut.length) { lay.push(['SCHNITT', 6]); cut.forEach(R => pl('SCHNITT', R, true)); }
    if (!sil && cfg().out.frame && m.frames.length) { lay.push(['BOGEN', 8]); m.frames.forEach(R => pl('BOGEN', R, true)); }
    if (!sil && m.scale) { lay.push(['MASSSTAB_100MM', 7]); pl('MASSSTAB_100MM', m.scale, false); }
    const L = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', k === 1 ? '4' : '1', '9', '$MEASUREMENT', '70', k === 1 ? '1' : '0',
      '9', '$EXTMIN', '10', '0', '20', '0', '9', '$EXTMAX', '10', (m.W * k).toFixed(4), '20', (m.H * k).toFixed(4), '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(lay.length)];
    lay.forEach(l => L.push('0', 'LAYER', '2', l[0], '70', '0', '62', String(l[1]), '6', 'CONTINUOUS'));
    L.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'); ent.forEach(e => L.push(e)); L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\r\n') + '\r\n';
  }
  const fileBase = () => (((state.projectName || 'decals').replace(/[^\w\-]+/g, '_')) || 'decals') + '_decals';
  function save(name, data, mime, which) { if (typeof App.download === 'function') App.download(name, data, mime, which); else if (App.anchorDownload) App.anchorDownload(name, data, mime); }
  function ready(forSil) { embedFonts(); const m = exportModel(forSil); if (!m.pieces.length) { alert(T('Keine Decals für die Ausgabe.')); return null; } if (m.warn) (App.toast || alert)(m.warn); return m; }
  function exportSvg() { const m = ready(false); if (m) save(fileBase() + '.svg', svgText(m), 'image/svg+xml', 'save'); }
  function exportDxf() { const m = ready(false); if (m) save(fileBase() + '.dxf', dxfText(m, 1, false), 'application/dxf', 'svDxf'); }
  function exportSilhouette() {
    const m = ready(true); if (!m) return;
    const ov = overlay(T('Ausgabe für Silhouette Studio'), 620), p = document.createElement('div'); p.style.cssText = 'font-size:13px;line-height:1.5';
    p.innerHTML = T('Das eigene Dateiformat von Silhouette Studio (.studio3) ist nicht offengelegt und lässt sich nicht direkt schreiben. Alle Ausgaben von Silhouette Studio öffnen aber DXF — diese Datei ist dafür aufbereitet (nur geschlossene Polylinien, eine Ebene je Farbe, ohne Bogenrahmen).')
      + '<br><br><b>' + T('Damit die Größe stimmt:') + '</b> ' + T('in Silhouette Studio vor dem Öffnen unter Einstellungen → Importieren → DXF „Wie vorhanden" (As-is) wählen, nicht „An Seite anpassen". Danach die Breite eines Decals mit dem hier angezeigten Maß vergleichen.')
      + '<br><br>' + T('Mit der Designer Edition (oder höher) lässt sich auch die SVG-Datei öffnen — sie enthält die Farben und echte Millimeter.') + '<br><br>' + T('Größe der Ausgabe') + ': <b>' + r1(m.W) + ' × ' + r1(m.H) + ' mm</b>';
    ov.box.appendChild(p);
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap';
    const mk = (t, k) => { const b = document.createElement('button'); b.textContent = t; b.className = 'primary'; b.onclick = () => { ov.close(); save(fileBase() + '_silhouette.dxf', dxfText(m, k, true), 'application/dxf', 'svDxf'); }; bar.appendChild(b); };
    mk(T('DXF in Millimetern speichern…'), 1); mk(T('DXF in Zoll speichern… (falls zu groß importiert)'), 1 / 25.4);
    ov.box.appendChild(bar);
  }

  // ---------- Decals anlegen / ändern ----------------------------------------------------------------------
  function viewCentre() { const cv = document.getElementById('cDecal'); if (!cv) return [0, 0]; const r = cv.getBoundingClientRect(); return [r1(WX(r.width / 2)), r1(WY(r.height / 2))]; }
  function addItem(it) {
    const c = cfg(), ctr = viewCentre(), n = c.items.filter(q => q.surf === c.surf).length;
    Object.assign(it, { id: ++c.seq, surf: c.surf, x: ctr[0] + (n % 5) * 6, y: ctr[1] - (n % 5) * 6, rot: 0, flip: false, rep: 1, repGap: 5, wrap: false });
    // Motive, die um den Rumpf herumlaufen (Haifischmaul rundum): auf die Bauchlinie nahe der Nase legen
    const f = it.kind === 'motif' && (LIB.BY[it.key] || {}).fus3d ? fus() : null;
    if (f) {      // Größe aus dem Umfang; so weit hinter die Nasenspitze, dass das ganze Motiv auf dem Rumpf liegt
      const L = f.x1 - f.x0, len = +it.p.len || 1.7; it.size = Math.max(5, Math.round(fusG(f, f.x0 + L * 0.1) * 0.5));
      c.surf = it.surf = 'fus:3d'; it.x = r1(f.x0 + len * it.size / 2 + L * 0.012); it.y = r1(unY(fusG(f, it.x) / 2, fusG(f, it.x))); fitted = '';
    }
    c.items.push(it); c.sel = it.id; c.view.sheet = false; layout(); changed(true);
  }
  // Design, das der Form folgt (Zierlinie, Nasenkappe, Warnfeld …) aus einer Vorlage anlegen.
  function addDesign(pr) {
    const c = cfg(); if (!DES) return;
    if (pr.kind === 'fdes') { if (!fus()) { alert(T('Für Decals auf dem Rumpf zuerst im Reiter „Rumpf" oder „Rumpf" einen Rumpf anlegen.')); return; } c.surf = 'fus:3d'; }
    else if (String(c.surf).indexOf('wing:') !== 0) { if (!wingGeom(0)) return; c.surf = 'wing:0:top'; }
    const it = { kind: pr.kind, key: pr.key, name: T(pr.name), p: DES.defaults(pr.key, pr.p), id: ++c.seq, surf: c.surf, x: 0, y: 0, rot: 0, flip: false, rep: 1, repGap: 0, wrap: false };
    c.items.push(it); c.sel = it.id; c.view.sheet = false; fitted = ''; layout(); changed(true);
  }
  const addMotif = id => { const m = LIB.BY[id]; if (m) addItem({ kind: 'motif', key: id, p: LIB.defaults(id), size: m.size || 50 }); };
  const addText = txt => addItem({ kind: 'text', key: 'text', p: { text: txt || 'D-1234', font: 'skel', weight: 16, track: 0, slant: 0, width: 100, line: 135, col: '#111111', outline: 0, outCol: '#ffffff' }, size: 25 });
  function delItem(it) { const c = cfg(), k = c.items.indexOf(it); if (k >= 0) c.items.splice(k, 1); if (c.sel === it.id) c.sel = 0; changed(true); }
  function dupItem(it, mirror) {
    const c = cfg(), n = clone(it); n.id = ++c.seq;
    if (mirror) { n.x = -it.x; n.flip = !it.flip; n.rot = -(+it.rot || 0); } else { n.x += 10; n.y -= 10; }
    c.items.push(n); c.sel = n.id; changed(true);
  }
  function gallery() {
    const ov = overlay(T('Motiv wählen'), 860), wrap = document.createElement('div'); wrap.style.cssText = 'overflow:auto;flex:1'; ov.box.appendChild(wrap);
    if (DES) [['fdes', 'Rumpf-Design (folgt der Rumpfform, in 3D)', !!fus()], ['wdes', 'Tragflächen-Design (folgt dem Flügelumriss)', !!wingGeom(0)]].forEach(([kind, title, ok]) => {
      if (!ok) return;
      const h = document.createElement('div'); h.textContent = T(title); h.style.cssText = 'font-weight:700;margin:8px 0 6px'; wrap.appendChild(h);
      const g = document.createElement('div'); g.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px'; wrap.appendChild(g);
      DES.PRESETS.filter(pr => pr.kind === kind).forEach(pr => {
        const b = document.createElement('button'); b.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;height:auto;padding:5px 8px;white-space:normal;text-align:left';
        const p = DES.defaults(pr.key, pr.p), sw = document.createElement('span'), n = Math.max(1, Math.min(8, +p.n || 1));
        sw.style.cssText = 'flex:none;width:34px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.4);background:' + (p.c2 && n > 1 ? 'linear-gradient(90deg,' + p.c1 + ',' + p.c2 + ')' : p.c1);
        b.appendChild(sw); b.appendChild(document.createTextNode(T(pr.name))); b.onclick = () => { ov.close(); addDesign(pr); }; g.appendChild(b);
      });
    });
    const cats = []; LIB.MOTIFS.forEach(m => { if (cats.indexOf(m.cat) < 0) cats.push(m.cat); });
    cats.forEach(cat => {
      const h = document.createElement('div'); h.textContent = T(cat); h.style.cssText = 'font-weight:700;margin:8px 0 6px'; wrap.appendChild(h);
      const g = document.createElement('div'); g.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px'; wrap.appendChild(g);
      LIB.MOTIFS.filter(m => m.cat === cat).forEach(m => {
        const b = document.createElement('button'); b.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;height:auto;white-space:normal;font-size:11.5px';
        const cv = document.createElement('canvas'); cv.width = 260; cv.height = 150; cv.style.cssText = 'width:130px;height:75px;background:#cfd6de;border-radius:4px';
        try {
          const L = LIB.build(m.id, null), bb = bbOf(allRings(L)), s = Math.min(230 / bb.w, 126 / bb.h), ctx = cv.getContext('2d'), sv = V;
          V = { s, ox: 130 - s * (bb.minx + bb.maxx) / 2, oy: 75 + s * (bb.miny + bb.maxy) / 2 }; paint(ctx, L, true); V = sv;
        } catch (e) { console.error(e); }
        b.appendChild(cv); b.appendChild(document.createTextNode(T(m.name))); b.onclick = () => { ov.close(); addMotif(m.id); }; g.appendChild(b);
      });
    });
  }

  // ---------- Zeichnen / Zustand ----------------------------------------------------------------------------
  function render() { render2d(); render3d(); }
  function changed(rebuild) { if (rebuild) App.buildSidebar(); render(); }
  function layout() {
    const p3 = document.getElementById('decalPane3d'), on = isFus(cfg().surf) && !!fus() && !cfg().view.sheet;
    if (p3 && (p3.style.display === 'none') === on) { p3.style.display = on ? '' : 'none'; fitted = ''; }
  }
  let wired = false;
  function show() {
    fusCache = null; mcache.clear();          // Rumpf kann sich im anderen Reiter geändert haben
    const c = cfg(); if (!surfaces().some(s => s[0] === c.surf)) c.surf = 'free';
    if (!wired) {
      wired = true; wire2d();
      const bind = (id, key) => { const el = document.getElementById(id); if (el) { el.checked = !!c.view[key]; el.onchange = () => { cfg().view[key] = el.checked; fitted = ''; layout(); changed(key === 'sheet'); }; } };
      bind('decalFill', 'fill'); bind('decalDims', 'dims'); bind('decalSheet', 'sheet');
      const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
      on('decalFit', () => { fitted = ''; render2d(); }); on('decalSvg', exportSvg); on('decalDxf', exportDxf); on('decalSil', exportSilhouette); on('decalAdd', gallery);
    }
    ['decalFill', 'decalDims', 'decalSheet'].forEach((id, i) => { const el = document.getElementById(id); if (el) el.checked = !!c.view[['fill', 'dims', 'sheet'][i]]; });
    layout(); render();
  }
  function reset() { delete state.cfg.decals; fitted = ''; lcache.clear(); mcache.clear(); fusCache = null; setTimeout(() => { if (state.activeTab === 'decal') show(); }, 0); }

  // ---------- Seitenleiste ------------------------------------------------------------------------------------
  function decalSidebar(side) {
    const { grp, hint, numRow, boolRow, selectRow, mkMini, subhead } = App;
    const c = cfg(), RD = () => { layout(); render(); }, RB = () => { layout(); changed(true); };
    const row = (body, label, el) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = T(label); r.appendChild(l); r.appendChild(el); body.appendChild(r); return r; };
    const colRow = (body, label, get, set) => { const i = document.createElement('input'); i.type = 'color'; i.value = get(); i.oninput = () => { set(i.value); RD(); }; row(body, label, i); };
    const bar = body => { const b = document.createElement('div'); b.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:5px 0'; body.appendChild(b); return b; };

    const g0 = grp('Decals — Fläche', true, 'decal', { key: 'decalSurf' });
    hint(g0.body, 'Schriftzüge und Abbildungen maßgetreu für Folienplotter und Drucker. Fläche wählen, Motive platzieren, als SVG, DXF oder für Silhouette Studio ausgeben.');
    selectRow(g0.body, 'Fläche', surfaces(), () => c.surf, v => { c.surf = v; c.sel = 0; fitted = ''; RB(); });
    if (c.surf === 'free') {
      numRow(g0.body, 'Breite (mm)', () => c.freeW, v => { c.freeW = Math.max(10, v); fitted = ''; RD(); }, { step: 10, min: 10, norender: true });
      numRow(g0.body, 'Höhe (mm)', () => c.freeH, v => { c.freeH = Math.max(10, v); fitted = ''; RD(); }, { step: 10, min: 10, norender: true });
    }
    if (isFus(c.surf)) {
      if (c.surf === 'fus:3d') selectRow(g0.body, 'Mittellinie der Abwicklung', [['top', T('Rückenlinie (oben)')], ['bot', T('Bauchlinie (unten)')]], () => c.fusMid || 'top', v => { setFusMid(v); RB(); });
      hint(g0.body, 'In der 3D-Ansicht: Klick auf den Rumpf setzt das gewählte Decal an diese Stelle, Umschalt+Ziehen schiebt es über die Oberfläche. „Rundum in 3D“ zeigt links die Abwicklung des ganzen Rumpfs — dort lassen sich Decals auch über Bauch und Rücken legen (z. B. das Haifischmaul rundum) und Designs anlegen, die der Rumpfform folgen.');
      hint(g0.body, 'Rumpf: Das Decal liegt auf der gekrümmten Oberfläche (rechts die 3D-Ansicht: Ziehen = drehen, Rad = Zoom). Der Zuschnitt wird abgewickelt — entlang der Rumpflängsrichtung und um den Umfang in wahrer Länge. Auf stark doppelt gekrümmten Stellen (Nase) Folie in mehrere schmale Decals teilen.');
    } else if (!fus()) hint(g0.body, 'Für Decals auf dem Rumpf zuerst im Reiter „Rumpf" oder „Rumpf" einen Rumpf anlegen — oder unten ein eigenes STL-Modell laden.');
    // Rumpfquelle: Reiter „Rumpf" / „Rumpf" oder ein eigenes STL-Modell (stlbody.js)
    {
      const fusNew = () => { fusCache = null; mcache.clear(); fitted = ''; if (!surfaces().some(s => s[0] === c.surf)) c.surf = 'free'; RB(); };
      const srcs = [['auto', 'automatisch (Rumpf, sonst STL)']];
      if (window.RumpfPro) srcs.push(['rpro', 'Reiter „Rumpf"']);
      if (window.StlBody) srcs.push(['stl', 'eigenes STL-Modell']);
      if (srcs.length > 2) selectRow(g0.body, 'Rumpf aus', srcs, () => c.fusSrc || 'auto', v => { c.fusSrc = v; fusNew(); App.buildSidebar(); });
      const f = fus();
      if (window.StlBody && (c.fusSrc === 'stl' || !f || f.src === 'stl')) StlBody.rows(g0.body, fusNew);
    }
    colRow(g0.body, 'Farbe der Fläche (nur Ansicht)', () => c.surfCol, v => { c.surfCol = v; });
    side.appendChild(g0.g);

    const here = c.items.filter(it => it.surf === c.surf);
    const g1 = grp(T('Decals') + ' (' + here.length + ')', true, 'decal', { key: 'decalList' });
    const b1 = bar(g1.body);
    b1.appendChild(mkMini(T('+ Motiv…'), gallery));
    if (SF) b1.appendChild(mkMini(T('+ Schriftzug'), () => addText()));
    if (SF) { const sel = document.createElement('select'); sel.innerHTML = '<option value="">' + T('+ Hinweistext / Kennzeichen …') + '</option>' + LIB.TEXTS.map(t => '<option>' + esc(t) + '</option>').join(''); sel.onchange = () => { if (sel.value) addText(sel.value); }; g1.body.appendChild(sel); }
    else hint(g1.body, 'Schriftzüge brauchen die Funktion „Schriften" (schrift_fonts.js) — sie fehlt in dieser Ausgabe.');
    here.forEach(it => {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:4px;align-items:center;margin:2px 0;padding:2px 4px;border-radius:4px;cursor:pointer;' + (it.id === c.sel ? 'background:rgba(255,157,46,.18)' : '');
      const n = document.createElement('span'); n.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px'; n.textContent = itemName(it) + (isDes(it) ? '' : ' · ' + r1(it.size) + ' mm');
      r.onclick = () => { c.sel = it.id; RB(); }; r.appendChild(n);
      const mk = (t, title, fn) => { const b = mkMini(t, e => { if (e && e.stopPropagation) e.stopPropagation(); fn(); }); b.title = T(title); b.addEventListener('click', e => e.stopPropagation()); r.appendChild(b); };
      mk('▲', 'nach vorne (über die anderen)', () => { const k = c.items.indexOf(it); c.items.splice(k, 1); c.items.push(it); RB(); });
      mk('⧉', 'duplizieren', () => dupItem(it)); mk('✕', 'löschen', () => delItem(it));
      g1.body.appendChild(r);
    });
    side.appendChild(g1.g);

    const it = selItem();
    // Parameterzeilen aus einer Beschreibung (Motive und Designs): Zahl, Auswahl, Schalter, Farbe
    const prow = (body, q, p, after) => {
      if (q.t === 'sel') selectRow(body, q.n, q.o, () => p[q.k], v => { p[q.k] = v; after(); RB(); });
      else if (q.t === 'bool') boolRow(body, q.n, () => !!p[q.k], v => { p[q.k] = v; RB(); });
      else if (q.t === 'col') colRow(body, q.n, () => p[q.k], v => { p[q.k] = v; });
      else numRow(body, q.n, () => p[q.k], v => { p[q.k] = clamp(v, q.min, q.max); if (q.rb) RB(); else RD(); }, { step: q.step, min: q.min, max: q.max, norender: true });
    };
    if (it && it.surf === c.surf && isDes(it)) {
      const g2 = grp(T('Ausgewählt') + ': ' + itemName(it), true, 'decal', { key: 'decalSel' }), sp = DES && DES.BY[it.key];
      hint(g2.body, it.kind === 'fdes' ? 'Dieses Design folgt der Rumpfform (beide Seiten, rundum). Lage und Maße über die Werte unten; der Zuschnitt je Seite wird abgewickelt ausgegeben — bei großen Flächen als Abklebe-Schablone für die Lackierung gedacht. Viele Verlaufsstufen = Farbverlauf für den Druck, wenige = einzelne Folienbänder.'
        : 'Dieses Design folgt dem Flügelumriss. Viele Verlaufsstufen = Farbverlauf für den Druck, wenige = einzelne Folienbänder.');
      const p = it.p = DES.defaults(it.key, it.p);
      (sp ? sp.params : []).forEach(q => { if (!q.show || q.show(p)) prow(g2.body, q, p, () => {}); });
      const b2 = bar(g2.body); b2.appendChild(mkMini(T('duplizieren'), () => dupItem(it))); b2.appendChild(mkMini(T('löschen'), () => delItem(it)));
      side.appendChild(g2.g);
    } else if (it && it.surf === c.surf) {
      const g2 = grp(T('Ausgewählt') + ': ' + itemName(it), true, 'decal', { key: 'decalSel' });
      if (it.kind === 'text') {
        const ta = document.createElement('textarea'); ta.rows = 2; ta.value = it.p.text; ta.style.cssText = 'width:100%;box-sizing:border-box'; ta.oninput = () => { it.p.text = ta.value; render(); }; ta.onchange = () => RB(); g2.body.appendChild(ta);
        selectRow(g2.body, 'Schrift', [['skel', 'Linienschrift (eingebaut)']].concat(fontKeys().map(k => ['f:' + k, k])), () => it.p.font, v => { it.p.font = v; RB(); });
        const fb = bar(g2.body); fb.appendChild(mkMini(T('Systemschrift…'), pickSystemFont)); fb.appendChild(mkMini(T('Schriftdatei laden…'), loadFontFile));
        numRow(g2.body, 'Versalhöhe (mm)', () => it.size, v => { it.size = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
        if (it.p.font === 'skel') numRow(g2.body, 'Strichstärke (% der Höhe)', () => it.p.weight, v => { it.p.weight = clamp(v, 3, 40); RD(); }, { step: 1, min: 3, max: 40, norender: true });
        numRow(g2.body, 'Breite (%)', () => it.p.width, v => { it.p.width = clamp(v, 30, 300); RD(); }, { step: 5, min: 30, max: 300, norender: true });
        numRow(g2.body, 'Neigung (°)', () => it.p.slant, v => { it.p.slant = clamp(v, -40, 40); RD(); }, { step: 1, min: -40, max: 40, norender: true });
        numRow(g2.body, 'Laufweite (% der Höhe)', () => it.p.track, v => { it.p.track = v; RD(); }, { step: 1, norender: true });
        colRow(g2.body, 'Farbe', () => it.p.col, v => { it.p.col = v; });
        numRow(g2.body, 'Umrandung (mm, 0 = ohne)', () => it.p.outline, v => { it.p.outline = Math.max(0, v); RB(); }, { step: 0.5, min: 0, norender: true });
        if (+it.p.outline > 0) colRow(g2.body, 'Farbe der Umrandung', () => it.p.outCol, v => { it.p.outCol = v; });
      } else {
        const m = LIB.BY[it.key];
        numRow(g2.body, 'Bezugshöhe / Durchmesser (mm)', () => it.size, v => { it.size = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true, hint: 'Maßgebende Höhe des Motivs (bei Kokarden der Durchmesser der Scheibe). Die tatsächliche Breite × Höhe steht in der Ansicht.' });
        (m ? m.params : []).forEach(q => { if (it.p[q.k] === undefined) it.p[q.k] = q.d; prow(g2.body, q, it.p, () => { it.cm = null; }); });
        // Farben: jede Farbe des Motivs einzeln tauschbar
        const cols = []; LIB.build(it.key, it.p).forEach(l => { if (cols.indexOf(l.c) < 0) cols.push(l.c); });
        if (cols.length) subhead(g2.body, 'Farben');
        cols.forEach((c0, i) => colRow(g2.body, T('Farbe') + ' ' + (i + 1), () => (it.cm && it.cm[c0]) || c0, v => { it.cm = it.cm || {}; it.cm[c0] = v; }));
        if (it.cm && Object.keys(it.cm).length) bar(g2.body).appendChild(mkMini(T('Farben zurücksetzen'), () => { it.cm = null; RB(); }));
      }
      subhead(g2.body, 'Verzerren');
      { const D = k => (it.ds && it.ds[k] != null ? +it.ds[k] : (k === 'sx' || k === 'sy' ? 100 : 0)), S = (k, v) => { it.ds = it.ds || {}; it.ds[k] = v; RD(); };
        numRow(g2.body, 'Breite strecken (%)', () => D('sx'), v => S('sx', clamp(v, 5, 2000)), { step: 5, min: 5, max: 2000, norender: true, hint: 'Auch mit der Maus: die Rauten an den Kantenmitten des Auswahlrahmens ziehen.' });
        numRow(g2.body, 'Höhe strecken (%)', () => D('sy'), v => S('sy', clamp(v, 5, 2000)), { step: 5, min: 5, max: 2000, norender: true });
        numRow(g2.body, 'Verjüngen (%, + = rechts höher)', () => D('tp'), v => S('tp', clamp(v, -98, 98)), { step: 5, min: -98, max: 98, norender: true });
        numRow(g2.body, 'Scheren (°)', () => D('sh'), v => S('sh', clamp(v, -75, 75)), { step: 5, min: -75, max: 75, norender: true });
        numRow(g2.body, 'Im Bogen biegen (°)', () => D('bn'), v => S('bn', clamp(v, -340, 340)), { step: 10, min: -340, max: 340, norender: true, hint: 'Biegt das Motiv zu einem Kreisbogen (z. B. Schriftzug im Bogen um eine Kokarde); negativ = nach unten.' });
        if (it.ds && Object.keys(it.ds).length) bar(g2.body).appendChild(mkMini(T('Verzerrung zurücksetzen'), () => { it.ds = null; RB(); })); }
      subhead(g2.body, 'Lage');
      numRow(g2.body, 'X (mm)', () => it.x, v => { it.x = v; RD(); }, { step: 1, norender: true });
      numRow(g2.body, 'Y (mm)', () => it.y, v => { it.y = v; RD(); }, { step: 1, norender: true });
      numRow(g2.body, 'Drehung (°)', () => it.rot, v => { it.rot = v; RD(); }, { step: 5, norender: true });
      boolRow(g2.body, 'gespiegelt (für die andere Seite)', () => !!it.flip, v => { it.flip = v; RD(); });
      numRow(g2.body, 'Wiederholen (Anzahl nebeneinander)', () => it.rep, v => { it.rep = clamp(Math.round(v), 1, 60); RB(); }, { step: 1, min: 1, max: 60, norender: true, hint: 'z. B. Abschuss- oder Einsatzmarken in einer Reihe.' });
      if (it.rep > 1) numRow(g2.body, 'Abstand der Wiederholungen (mm)', () => it.repGap, v => { it.repGap = v; RD(); }, { step: 1, norender: true });
      if (it.surf === 'fus:3d') hint(g2.body, midBot() ? 'X = Lage entlang des Rumpfs, Y = Lage im Umfang (0 = Bauchlinie, Rand = Rückenlinie). Das Decal wird maßgetreu um den Rumpf gelegt. In der 3D-Ansicht: Klick auf den Rumpf setzt es dorthin, Umschalt+Ziehen schiebt es über die Oberfläche.' : 'X = Lage entlang des Rumpfs, Y = Lage im Umfang (0 = Rückenlinie, Rand = Bauchlinie). Das Decal wird maßgetreu um den Rumpf gelegt. In der 3D-Ansicht: Klick auf den Rumpf setzt es dorthin, Umschalt+Ziehen schiebt es über die Oberfläche.');
      else if (isFus(it.surf)) selectRow(g2.body, 'Auf dem Rumpf', [['proj', 'projiziert — aus dieser Ansicht unverzerrt, Zuschnitt abgewickelt'], ['wrap', 'maßgetreu aufgelegt — Zuschnitt = Motiv']], () => it.wrap ? 'wrap' : 'proj', v => { it.wrap = v === 'wrap'; RD(); },
        'Projiziert: Das Decal sieht aus der gewählten Ansicht genau wie gezeichnet aus; der Zuschnitt wird um die Rumpfwölbung länger. Maßgetreu: Das Motiv wird unverändert ausgegeben und legt sich um den Rumpf (für Schriftzüge und Kokarden auf schwach gewölbten Stellen).');
      const b2 = bar(g2.body);
      if (it.surf.indexOf('wing:') === 0) b2.appendChild(mkMini(T('auf die andere Flügelhälfte spiegeln'), () => dupItem(it, true)));
      b2.appendChild(mkMini(T('duplizieren'), () => dupItem(it))); b2.appendChild(mkMini(T('löschen'), () => delItem(it)));
      side.appendChild(g2.g);
    }

    const o = c.out, g3 = grp('Ausgabe (Plotten / Drucken)', true, 'decal', { key: 'decalOut' });
    selectRow(g3.body, 'Umfang', [['surf', 'nur diese Fläche'], ['all', 'alle Decals des Projekts']], () => o.scope, v => { o.scope = v; fitted = ''; RD(); });
    selectRow(g3.body, 'Art', [['print', 'Drucken — farbig gefüllt (SVG)'], ['plot', 'Plotten — Schnittkonturen je Farbe']], () => o.mode, v => { o.mode = v; RB(); },
      'Drucken: farbige Flächen für Decal-Papier (Weiß druckt ein Tintenstrahler nicht — weißes Decal-Papier verwenden). Plotten: je Farbe eine Ebene mit den Schnittkonturen; die Folien werden in der Reihenfolge der Ebenen übereinander geklebt. DXF enthält immer nur Konturen.');
    selectRow(g3.body, 'Anordnung', [['sheet', 'auf Bögen geschachtelt (ungedreht)'], ['placed', 'wie platziert']], () => o.arr, v => { o.arr = v; fitted = ''; RB(); });
    if (o.arr === 'sheet') {
      selectRow(g3.body, 'Bogen', Object.keys(SHEETS).map(k => [k, SHEETS[k][0]]), () => o.sheet, v => { o.sheet = v; fitted = ''; RB(); });
      if (o.sheet === 'own') { numRow(g3.body, 'Bogenbreite (mm)', () => o.sheetW, v => { o.sheetW = Math.max(20, v); fitted = ''; RD(); }, { step: 10, min: 20, norender: true }); numRow(g3.body, 'Bogenhöhe (mm)', () => o.sheetH, v => { o.sheetH = Math.max(20, v); fitted = ''; RD(); }, { step: 10, min: 20, norender: true }); }
      selectRow(g3.body, 'Platzierung auf dem Bogen', [['auto', 'automatisch geschachtelt'], ['free', 'frei — in der Bogen-Vorschau ziehen']], () => o.place, v => { if (v === 'free') { o.place = 'auto'; sheetFree(); } else o.place = 'auto'; fitted = ''; RB(); },
        'Automatisch: Die Decals werden bei jeder Änderung neu auf die Bögen verteilt. Frei: Ausgangspunkt ist die automatische Anordnung; danach jedes Decal in der Bogen-Vorschau mit der Maus ziehen (auch auf einen weiteren Bogen), mit R um 90° drehen. Neue Decals bekommen einen freien Platz.');
      if (o.place === 'free') bar(g3.body).appendChild(mkMini(T('neu automatisch anordnen'), () => { o.pos = {}; fitted = ''; RD(); }));
      numRow(g3.body, 'Rand (mm)', () => o.margin, v => { o.margin = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
      numRow(g3.body, 'Abstand der Decals (mm)', () => o.gap, v => { o.gap = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
      if (o.mode === 'plot') boolRow(g3.body, 'Farben getrennt anordnen (ein Bogen je Folienfarbe)', () => !!o.sep, v => { o.sep = v; fitted = ''; RD(); });
      boolRow(g3.body, 'Bogenrahmen mit ausgeben', () => !!o.frame, v => { o.frame = v; });
    }
    if (o.mode === 'print') numRow(g3.body, 'Schneidekontur um jedes Decal (mm, 0 = ohne)', () => o.cut, v => { o.cut = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true, hint: 'Für Print & Cut: eigene Ebene „Schneidekontur" im gewählten Abstand um das gedruckte Motiv.' });
    boolRow(g3.body, 'Kontrollstrecke 100 mm mitgeben', () => !!o.scale, v => { o.scale = v; RD(); }, 'Ein 100 mm langer Strich unter den Decals — nach dem Import im Plot-/Druckprogramm nachmessen, ob der Maßstab stimmt.');
    const b3 = bar(g3.body);
    b3.appendChild(mkMini(T('SVG speichern…'), exportSvg)); b3.appendChild(mkMini(T('DXF speichern…'), exportDxf)); b3.appendChild(mkMini(T('Silhouette Studio…'), exportSilhouette));
    b3.appendChild(mkMini(T(c.view.sheet ? 'Bogen-Vorschau schließen' : 'Bogen-Vorschau'), () => { c.view.sheet = !c.view.sheet; const el = document.getElementById('decalSheet'); if (el) el.checked = c.view.sheet; fitted = ''; RB(); }));
    hint(g3.body, 'Bogen-Vorschau: zeigt die Bögen so, wie sie ausgegeben werden. Dort lassen sich die Decals auch frei mit der Maus platzieren.');
    side.appendChild(g3.g);
  }

  Object.assign(App, { decalSidebar });
  window.Decals = { show, render, reset, resize: render, exportSvg, exportDxf, exportSilhouette, addMotif, addText,
    _test: { loadFontBuffer, cam3d: () => G3.cam, desGroups, wdesLayers, pick3d, addDesign, field, contour, offsetLayers, simplify, textLayers, baseLayers, localLayers, exportModel, svgText, dxfText, fus, fusPt, fusHit, fusMap, cfg, bbOf, allRings } };
})();
