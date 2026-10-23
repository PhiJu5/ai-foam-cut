/* cadpdf.js — PDF-Export des Reiters „CAD-Bearbeitung" (Feature cad)
 *
 * Echte Vektor-PDF (eigener kleiner PDF-Schreiber, reines ASCII, Schrift Helvetica) im gewählten
 * Maßstab. Passt die Zeichnung nicht auf ein Blatt, wird sie auf mehrere Blätter des gewählten
 * Formats (A4 … A0, Letter, Tabloid) aufgeteilt: Überlappung zwischen Nachbarblättern, Passkreuze
 * in der Mitte jeder Überlappung (gleiche Modellstelle auf beiden Blättern), Blattbezeichnung
 * (Zeile Buchstabe, Spalte Zahl: A1, A2 … B1 …), Nachbarn, 100-mm-Prüfmaß und ein Übersichtsblatt
 * mit dem Klebeplan. Leere Blätter werden (wahlweise) weggelassen.
 *
 * Exportiert wird wie beim DXF: sichtbare Layer ohne Hilfslinien, Konturen + Texte.
 * Einstellungen: state.cad.pdf (im Projekt). Schnittstelle: window.CadPdf — cad.js ruft nur geschützt.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const PT = 72 / 25.4;   // pt je mm
  const SHEETS = { a4: ['A4', 210, 297], a3: ['A3', 297, 420], a2: ['A2', 420, 594], a1: ['A1', 594, 841], a0: ['A0', 841, 1189],
    letter: ['Letter', 215.9, 279.4], tabloid: ['Tabloid', 279.4, 431.8] };
  const DEF = { sheet: 'a4', orient: 'auto', scale: 100, margin: 10, overlap: 10, marks: true, skipEmpty: true, overview: true,
    color: false, lw: 0.25, show: false };
  function cfg() {
    const c = state.cad.pdf || (state.cad.pdf = {});
    for (const k in DEF) if (c[k] == null) c[k] = DEF[k];
    if (!SHEETS[c.sheet]) c.sheet = 'a4';
    return c;
  }

  // ---------- Inhalt ----------
  function content() {
    const ents = App.cadEntities().filter(e => App.cadVisible(e.layer) && !App.CAD_NOEXPORT[e.layer] && e.loop.length);
    const texts = (state.cad.texts || []).filter(t => App.cadVisible(t.layer || 'TEXT') && t.text);
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const add = (x, y) => { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; };
    const items = [];
    ents.forEach(e => {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      e.loop.forEach(p => { if (p.x < a) a = p.x; if (p.x > c) c = p.x; if (p.y < b) b = p.y; if (p.y > d) d = p.y; });
      if (e.loop.pt) { a -= 1; b -= 1; c += 1; d += 1; }
      add(a, b); add(c, d); items.push({ e, bb: [a, b, c, d] });
    });
    texts.forEach(t => {
      const h = t.h || 3, r = textW(t.text, h) / 2 + h;
      add(t.x - r, t.y - r); add(t.x + r, t.y + r); items.push({ t, bb: [t.x - r, t.y - r, t.x + r, t.y + r] });
    });
    if (!items.length) return null;
    return { items, bb: { minx, miny, maxx, maxy } };
  }

  // ---------- Blattaufteilung ----------
  // Raster in „Papier-mm" (Inhalt bereits skaliert): Blatt (r, c) deckt X ∈ [X0, X0+pw], Y ∈ [Y0, Y0+ph];
  // Zeile 0 = oben. Inhalt im Raster zentriert.
  function plan(ct) {
    const c = cfg(), sh = SHEETS[c.sheet], k = c.scale / 100, m = c.margin;
    const W = (ct.bb.maxx - ct.bb.minx) * k, H = (ct.bb.maxy - ct.bb.miny) * k;
    const one = land => {
      const sw = land ? sh[2] : sh[1], shh = land ? sh[1] : sh[2];
      const pw = sw - 2 * m, ph = shh - 2 * m, o = Math.min(c.overlap, pw / 3, ph / 3);
      if (pw < 20 || ph < 20) return null;
      const cols = Math.max(1, Math.ceil((W - o) / (pw - o) - 1e-9)), rows = Math.max(1, Math.ceil((H - o) / (ph - o) - 1e-9));
      if (cols * rows > 2000) return null;
      const GW = cols * pw - (cols - 1) * o, GH = rows * ph - (rows - 1) * o;
      const offX = (GW - W) / 2, offY = (GH - H) / 2;
      const P = { land, sw, sh: shh, pw, ph, o, m, k, cols, rows, GW, GH, offX, offY, bb: ct.bb, all: cols * rows };
      // Modell → Raster-mm
      P.X = x => (x - ct.bb.minx) * k + offX; P.Y = y => (y - ct.bb.miny) * k + offY;
      const list = [];
      for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
        const X0 = cc * (pw - o), Y0 = GH - r * (ph - o) - ph;
        list.push({ r, c: cc, X0, Y0, label: rowName(r) + (cc + 1) });
      }
      list.forEach(p => { p.used = !c.skipEmpty || ct.items.some(it => hits(P, it, p)); });
      P.list = list.filter(p => p.used); P.n = P.list.length;
      P.has = (r, cc) => P.list.some(q => q.r === r && q.c === cc);
      return P;
    };
    const a = one(false), b = one(true);
    if (c.orient === 'p') return a; if (c.orient === 'l') return b;
    if (!a) return b; if (!b) return a;
    return b.n < a.n ? b : a;
  }
  function rowName(r) { let s = ''; r++; while (r > 0) { const q = (r - 1) % 26; s = String.fromCharCode(65 + q) + s; r = Math.floor((r - 1) / 26); } return s; }
  // Liegt ein Element (wirklich) auf dem Blatt? Konturen segmentweise (Liang–Barsky), Texte über die Box.
  function hits(P, it, p) {
    const x0 = p.X0, y0 = p.Y0, x1 = p.X0 + P.pw, y1 = p.Y0 + P.ph;
    const b = it.bb;
    if (P.X(b[2]) < x0 || P.X(b[0]) > x1 || P.Y(b[3]) < y0 || P.Y(b[1]) > y1) return false;
    if (!it.e || it.e.loop.pt) return true;
    const L = it.e.loop, n = L.length, closed = !!L.closed;
    if (n === 1) return true;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = L[i], q = L[(i + 1) % n];
      if (segInRect(P.X(a.x), P.Y(a.y), P.X(q.x), P.Y(q.y), x0, y0, x1, y1)) return true;
    }
    return false;
  }
  function segInRect(ax, ay, bx, by, x0, y0, x1, y1) {
    let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay;
    const clip = (p, q) => { if (Math.abs(p) < 1e-12) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
    return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay);
  }

  // ---------- Schrift (Helvetica, WinAnsi) ----------
  const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
    278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
    667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
    333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const WIN = { '€': 128, '‚': 130, '„': 132, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153 };
  const SUB = { '↑': '^', '↓': 'v', '←': '<', '→': '>', '≈': '~', '≤': '<=', '≥': '>=', '−': '-', '⌀': 'Ø' };
  function winCodes(s) {
    const out = [];
    for (const ch of String(s)) {
      if (SUB[ch]) { for (const c2 of SUB[ch]) out.push(c2.charCodeAt(0)); continue; }
      const c = ch.codePointAt(0);
      if (c >= 32 && c < 127) out.push(c); else if (c >= 160 && c <= 255) out.push(c); else if (WIN[ch]) out.push(WIN[ch]); else out.push(63);
    }
    return out;
  }
  function textW(s, size) { return winCodes(s).reduce((a, c) => a + (c >= 32 && c < 127 ? HW[c - 32] : 556), 0) * size / 1000; }
  function pdfStr(s) {
    return '(' + winCodes(s).map(c => c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c < 127 ? String.fromCharCode(c) : '\\' + c.toString(8).padStart(3, '0')).join('') + ')';
  }

  // ---------- Zeichnen in PDF-Operatoren ----------
  const f = v => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
  const rgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return [0, 0, 0]; const n = parseInt(m[1], 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  // Druckfarbe: Layerfarbe, aber zu helle Töne abdunkeln (weißes Papier).
  function inkOf(layer) {
    if (!cfg().color) return [0, 0, 0];
    let [r, g, b] = rgb(App.cadLayerColor(layer));
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 0.55) { const s = 0.55 / lum; r *= s; g *= s; b *= s; }
    return [r, g, b];
  }
  const DASH = { dashed: [4, 2], dotted: [0.4, 1.4], dashdot: [5, 1.5, 0.5, 1.5] };
  // Inhalt im Modellkoordinatensystem (die cm-Matrix davor bildet Modell-mm → Papier-mm ab).
  function drawContent(ct, k, lw, test) {
    const o = [];
    let cur = null;
    const style = (layer) => {
      const key = layer;
      if (cur === key) return; cur = key;
      const c = inkOf(layer), d = DASH[App.cadLayerStyle(layer)];
      o.push(c.map(f).join(' ') + ' RG ' + c.map(f).join(' ') + ' rg');
      o.push((d ? '[' + d.map(v => f(v / k)).join(' ') + '] 0 d' : '[] 0 d'));
    };
    o.push(f(lw / k) + ' w 1 J 1 j');
    ct.items.forEach(it => {
      if (test && !test(it)) return;
      if (it.e) {
        const L = it.e.loop; style(it.e.layer);
        if (L.pt) { const p = L[0], r = 1.5 / k; o.push('[] 0 d ' + f(p.x - r) + ' ' + f(p.y) + ' m ' + f(p.x + r) + ' ' + f(p.y) + ' l ' + f(p.x) + ' ' + f(p.y - r) + ' m ' + f(p.x) + ' ' + f(p.y + r) + ' l S'); cur = null; return; }
        const s = [f(L[0].x) + ' ' + f(L[0].y) + ' m'];
        for (let i = 1; i < L.length; i++) s.push(f(L[i].x) + ' ' + f(L[i].y) + ' l');
        o.push(s.join(' ') + (L.closed ? ' s' : ' S'));
      } else {
        const t = it.t, h = t.h || 3, a = (t.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        style(t.layer || 'TEXT');
        o.push('q ' + [ca, sa, -sa, ca, t.x, t.y].map(f).join(' ') + ' cm BT /F1 ' + f(h) + ' Tf ' + f(-textW(t.text, h) / 2) + ' ' + f(-0.35 * h) + ' Td ' + pdfStr(t.text) + ' Tj ET Q');
      }
    });
    return o.join('\n');
  }
  // Text in Papier-mm (Seitenkoordinaten, y oben = sh).
  const ptxt = (x, y, size, s, gray) => (gray != null ? f(gray) + ' g ' : '0 g ') + 'BT /F1 ' + f(size) + ' Tf ' + f(x) + ' ' + f(y) + ' Td ' + pdfStr(s) + ' Tj ET';

  function tilePage(ct, P, p, name) {
    const c = cfg(), { pw, ph, o, m, k, sw, sh } = P, o2 = [];
    o2.push(f(PT) + ' 0 0 ' + f(PT) + ' 0 0 cm');   // ab hier: Papier-mm
    // Überlappungen leicht getönt
    if (o > 0) {
      const z = [];
      if (p.c > 0) z.push([m, m, o, ph]); if (p.c < P.cols - 1) z.push([m + pw - o, m, o, ph]);
      if (p.r > 0) z.push([m, m + ph - o, pw, o]); if (p.r < P.rows - 1) z.push([m, m, pw, o]);
      if (z.length) o2.push('0.94 g ' + z.map(r => r.map(f).join(' ') + ' re').join(' ') + ' f');
    }
    // Druckbereich
    o2.push('0.6 G 0.15 w [2 2] 0 d ' + [m, m, pw, ph].map(f).join(' ') + ' re S [] 0 d');
    // Inhalt, beschnitten auf den Druckbereich
    const X0 = p.X0, Y0 = p.Y0;
    o2.push('q ' + [m, m, pw, ph].map(f).join(' ') + ' re W n');
    o2.push('1 0 0 1 ' + f(m - X0) + ' ' + f(m - Y0) + ' cm');     // Raster-mm
    o2.push(f(k) + ' 0 0 ' + f(k) + ' ' + f(P.offX - P.bb.minx * k) + ' ' + f(P.offY - P.bb.miny * k) + ' cm');   // Modell-mm
    o2.push(drawContent(ct, k, c.lw, it => hits(P, it, p)));
    o2.push('Q');
    // Passkreuze (Raster-mm → Seite)
    if (c.marks && (P.cols > 1 || P.rows > 1)) {
      const S = (X, Y) => [m + X - X0, m + Y - Y0];
      const cross = (X, Y) => {
        const [x, y] = S(X, Y), r = 4;
        if (x < m - 0.01 || y < m - 0.01 || x > m + pw + 0.01 || y > m + ph + 0.01) return;
        const cr = 2, kk = 0.5523 * cr;
        o2.push('0 G 0.2 w ' + f(x - r) + ' ' + f(y) + ' m ' + f(x + r) + ' ' + f(y) + ' l ' + f(x) + ' ' + f(y - r) + ' m ' + f(x) + ' ' + f(y + r) + ' l S');
        o2.push(f(x + cr) + ' ' + f(y) + ' m ' + [x + cr, y + kk, x + kk, y + cr, x, y + cr].map(f).join(' ') + ' c ' + [x - kk, y + cr, x - cr, y + kk, x - cr, y].map(f).join(' ') + ' c '
          + [x - cr, y - kk, x - kk, y - cr, x, y - cr].map(f).join(' ') + ' c ' + [x + kk, y - cr, x + cr, y - kk, x + cr, y].map(f).join(' ') + ' c S');
      };
      const along = (a, b, n) => { const out = []; for (let i = 0; i < n; i++) out.push(a + (b - a) * (i + 0.5) / n); return out; };
      for (let cc = 1; cc < P.cols; cc++) {   // senkrechte Fugen
        const X = cc * (pw - o) + o / 2;
        for (let r = 0; r < P.rows; r++) { const Yt = P.GH - r * (ph - o); along(Yt - ph + o, Yt - o, 3).forEach(Y => cross(X, Y)); }
      }
      for (let r = 1; r < P.rows; r++) {      // waagrechte Fugen
        const Y = P.GH - r * (ph - o) - o / 2;
        for (let cc = 0; cc < P.cols; cc++) { const X1 = cc * (pw - o); along(X1 + o, X1 + pw - o, 3).forEach(X => cross(X, Y)); }
      }
    }
    // Beschriftung: Blatt, Nachbarn, Maßstab; unten Prüfmaß
    const nb = [];
    if (P.has(p.r - 1, p.c)) nb.push('↑ ' + rowName(p.r - 1) + (p.c + 1)); if (P.has(p.r + 1, p.c)) nb.push('↓ ' + rowName(p.r + 1) + (p.c + 1));
    if (P.has(p.r, p.c - 1)) nb.push('← ' + rowName(p.r) + p.c); if (P.has(p.r, p.c + 1)) nb.push('→ ' + rowName(p.r) + (p.c + 2));
    const ty = sh - m + Math.min(3, m * 0.35);
    o2.push(ptxt(m, ty, 3.4, T('Blatt') + ' ' + p.label + '  (' + (P.list.indexOf(p) + 1) + '/' + P.n + ')  ·  ' + name + '  ·  ' + T('Maßstab') + ' ' + scaleTxt(k) + (nb.length ? '  ·  ' + nb.join('   ') : '')));
    const L = pw >= 110 ? 100 : 50, bx = m + 2, by = Math.max(2.5, m - Math.min(5, m * 0.5));
    o2.push('0 G 0.25 w ' + f(bx) + ' ' + f(by) + ' m ' + f(bx + L) + ' ' + f(by) + ' l ' + f(bx) + ' ' + f(by - 1.5) + ' m ' + f(bx) + ' ' + f(by + 1.5) + ' l '
      + f(bx + L) + ' ' + f(by - 1.5) + ' m ' + f(bx + L) + ' ' + f(by + 1.5) + ' l S');
    o2.push(ptxt(bx + L + 2, by - 1, 2.8, T('Prüfmaß') + ' ' + L + ' mm — ' + T('drucken mit „Tatsächliche Größe“ / 100 %')));
    return o2.join('\n');
  }
  function scaleTxt(k) {
    if (Math.abs(k - 1) < 1e-9) return '1:1';
    if (k < 1 && Math.abs(1 / k - Math.round(1 / k)) < 1e-6) return '1:' + Math.round(1 / k);
    if (k > 1 && Math.abs(k - Math.round(k)) < 1e-6) return Math.round(k) + ':1';
    return Math.round(k * 1000) / 10 + ' %';
  }
  // Übersichtsblatt: ganze Zeichnung mit Blattraster (Klebeplan), auf das Papierformat eingepasst.
  function overviewPage(ct, P, name) {
    const c = cfg(), m = 12, sw = P.sw, sh = P.sh, top = 18;
    const aw = sw - 2 * m, ah = sh - m - top - 8;
    const s = Math.min(aw / P.GW, ah / P.GH), ox = m + (aw - P.GW * s) / 2, oy = m + 8 + (ah - P.GH * s) / 2;
    const o = [f(PT) + ' 0 0 ' + f(PT) + ' 0 0 cm'];
    o.push(ptxt(m, sh - m, 5, T('Übersicht') + ' — ' + name));
    o.push(ptxt(m, sh - m - 6.5, 3.2, P.n + ' ' + T('Blätter') + ' ' + SHEETS[c.sheet][0] + ' ' + (P.land ? T('quer') : T('hoch')) + ' (' + P.cols + ' × ' + P.rows
      + ')  ·  ' + T('Maßstab') + ' ' + scaleTxt(P.k) + '  ·  ' + T('Überlappung') + ' ' + f(P.o) + ' mm  ·  ' + T('Zeichnung') + ' ' + Math.round((P.bb.maxx - P.bb.minx) * P.k) + ' × ' + Math.round((P.bb.maxy - P.bb.miny) * P.k) + ' mm', 0.25));
    // Inhalt
    o.push('q 1 0 0 1 ' + f(ox) + ' ' + f(oy) + ' cm ' + f(s) + ' 0 0 ' + f(s) + ' 0 0 cm');
    o.push('q ' + f(P.k) + ' 0 0 ' + f(P.k) + ' ' + f(P.offX - P.bb.minx * P.k) + ' ' + f(P.offY - P.bb.miny * P.k) + ' cm');
    o.push(drawContent(ct, P.k * s, 0.2));
    o.push('Q');
    // Blattraster: gedruckte Blätter durchgezogen + Bezeichnung, leere gestrichelt
    const all = [];
    for (let r = 0; r < P.rows; r++) for (let cc = 0; cc < P.cols; cc++) all.push({ r, c: cc, X0: cc * (P.pw - P.o), Y0: P.GH - r * (P.ph - P.o) - P.ph, label: rowName(r) + (cc + 1) });
    all.forEach(p => {
      const used = P.has(p.r, p.c);
      o.push((used ? '0.85 0.2 0.1 RG [] 0 d ' : '0.6 G [' + f(1.5 / s) + ' ' + f(1.5 / s) + '] 0 d ') + f(0.25 / s) + ' w ' + [p.X0, p.Y0, P.pw, P.ph].map(f).join(' ') + ' re S');
      if (used) {
        const fs = Math.min(P.pw, P.ph) * 0.12, cx = p.X0 + P.pw / 2, cy = p.Y0 + P.ph / 2;
        o.push('0.85 0.2 0.1 rg BT /F1 ' + f(fs) + ' Tf ' + f(cx - textW(p.label, fs) / 2) + ' ' + f(cy - 0.35 * fs) + ' Td ' + pdfStr(p.label) + ' Tj ET');
      }
    });
    o.push('[] 0 d Q');
    o.push(ptxt(m, m - 4, 2.8, T('Blätter in der Überlappung übereinanderlegen, bis sich die Passkreuze decken, dann kleben. Leere Blätter (gestrichelt) werden nicht gedruckt.'), 0.25));
    return o.join('\n');
  }

  // ---------- PDF-Datei ----------
  function buildPdf(pages, title) {
    // pages: [{w, h (pt), body}] — reines ASCII, daher Bytes = Zeichen.
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    const kids = [];
    pages.forEach((pg, i) => {
      const po = 5 + i * 2, co = po + 1;
      kids.push(po + ' 0 R');
      objs[po] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(pg.w) + ' ' + f(pg.h) + '] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + co + ' 0 R >>';
      objs[co] = '<< /Length ' + pg.body.length + ' >>\nstream\n' + pg.body + '\nendstream';
    });
    objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';
    objs[4] = '<< /Title ' + pdfStr(title) + ' /Producer (AI Foam Cut) /Creator (AI Foam Cut CAD) >>';
    let out = '%PDF-1.4\n%AIFC\n';
    const off = [];
    for (let i = 1; i < objs.length; i++) { off[i] = out.length; out += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
    const xref = out.length;
    out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
    for (let i = 1; i < objs.length; i++) out += String(off[i]).padStart(10, '0') + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R /Info 4 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return out;
  }
  // Seiten (PDF-Operatoren je Seite) — gemeinsame Quelle für Datei und Druckvorschau.
  function makePages(name) {
    const ct = content(); if (!ct) return { err: 'Nichts zu exportieren.' };
    const P = plan(ct); if (!P) return { err: 'Rand zu groß für das Papierformat.' };
    if (!P.n) return { err: 'Nichts zu exportieren.' };
    const pages = [];
    if (cfg().overview && P.n > 1) pages.push({ w: P.sw * PT, h: P.sh * PT, label: T('Übersicht'), body: overviewPage(ct, P, name) });
    P.list.forEach(p => pages.push({ w: P.sw * PT, h: P.sh * PT, label: p.label, body: tilePage(ct, P, p, name) }));
    return { P, pages };
  }
  function makePdf(name) {
    const r = makePages(name); if (r.err) return r;
    return { text: buildPdf(r.pages, name), P: r.P, pages: r.pages.length };
  }
  function exportPdf() {
    if (window.DEMO && DEMO.blocked && DEMO.blocked()) return;
    const r = makePdf(T('CAD-Zeichnung'));
    if (r.err) { App.cadFlash(r.err); return; }
    App.exportViaPicker('cad-zeichnung.pdf', r.text, 'application/pdf', 'save');
    App.cadFlash(T('PDF: ') + r.P.n + ' ' + T('Blatt') + ' ' + SHEETS[cfg().sheet][0] + (r.pages > r.P.n ? ' + ' + T('Übersicht') : ''));
  }

  // ---------- Vorschau der Blattaufteilung im CAD-Fenster ----------
  let cache = { key: null, P: null };
  function curPlan() {
    const ct = content(); if (!ct) return null;
    let n = 0; ct.items.forEach(it => { n += it.e ? it.e.loop.length : 1; });
    const b = ct.bb, key = JSON.stringify(cfg()) + '|' + [b.minx, b.miny, b.maxx, b.maxy, ct.items.length, n].join(',');
    if (cache.key !== key) cache = { key, P: plan(ct) };
    return cache.P;
  }
  function drawTiles(ctx, V) {
    updInfo();
    const c = cfg(); if (!c.show || state.activeTab !== 'cad') return;
    const P = curPlan(); if (!P) return;
    const toM = (X, Y) => ({ x: P.bb.minx + (X - P.offX) / P.k, y: P.bb.miny + (Y - P.offY) / P.k });
    ctx.save(); ctx.lineWidth = 1.2; ctx.font = '600 13px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const col = App.PAL && App.PAL.accent2 || '#ffb454';
    for (let r = 0; r < P.rows; r++) for (let cc = 0; cc < P.cols; cc++) {
      const X0 = cc * (P.pw - P.o), Y0 = P.GH - r * (P.ph - P.o) - P.ph, used = P.has(r, cc);
      const a = toM(X0, Y0), b = toM(X0 + P.pw, Y0 + P.ph);
      const x0 = V.X(a.x), x1 = V.X(b.x), y0 = V.Y(a.y), y1 = V.Y(b.y);
      ctx.strokeStyle = used ? col : App.hexA ? App.hexA('#8899aa', 0.5) : 'rgba(136,153,170,.5)';
      ctx.setLineDash(used ? [] : [5, 4]);
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      if (used) { ctx.fillStyle = col; ctx.fillText(rowName(r) + (cc + 1), (x0 + x1) / 2, (y0 + y1) / 2); }
    }
    ctx.restore();
  }

  // ---------- Seitenleiste (im Block „Export" des CAD-Reiters) ----------
  // Hinweiszeile (Blattzahl) — wird auch bei jedem Neuzeichnen des CAD-Fensters aufgefrischt,
  // weil die Seitenleiste nicht bei jeder Geometrieänderung neu aufgebaut wird.
  let info = null;
  function updInfo() {
    if (!info || !info.isConnected) return;
    const c = cfg(), P = curPlan();
    const t = !P ? T('Nichts zu exportieren.')
      : P.n + ' ' + T('Blatt') + (P.all > P.n ? ' (' + (P.all - P.n) + ' ' + T('leere weggelassen') + ')' : '') + ' · ' + P.cols + ' × ' + P.rows + ', ' + SHEETS[c.sheet][0] + ' '
        + (P.land ? T('quer') : T('hoch')) + ' · ' + T('Zeichnung') + ' ' + Math.round((P.bb.maxx - P.bb.minx) * P.k) + ' × ' + Math.round((P.bb.maxy - P.bb.miny) * P.k) + ' mm';
    if (info.textContent !== t) info.textContent = t;
  }
  function sidebar(body) {
    const upd = () => { cache.key = null; updInfo(); };
    App.subhead ? App.subhead(body, 'PDF (gekachelt)') : null;
    App.selectRow(body, 'Papierformat', Object.keys(SHEETS).map(k => [k, SHEETS[k][0] + ' (' + SHEETS[k][1] + ' × ' + SHEETS[k][2] + ' mm)']), () => cfg().sheet, v => { cfg().sheet = v; upd(); });
    App.selectRow(body, 'Ausrichtung', [['auto', 'automatisch (wenigste Blätter)'], ['p', 'hoch'], ['l', 'quer']], () => cfg().orient, v => { cfg().orient = v; upd(); });
    App.numRow(body, 'Maßstab (%)', () => cfg().scale, v => { cfg().scale = clamp(v, 1, 10000); upd(); }, { step: 10, enter: true, hint: '100 % = 1:1 (Originalgröße). Größere Zeichnungen werden auf mehrere Blätter aufgeteilt.' });
    App.numRow(body, 'Rand (mm)', () => cfg().margin, v => { cfg().margin = clamp(v, 4, 40); upd(); }, { step: 1, enter: true });
    App.numRow(body, 'Überlappung (mm)', () => cfg().overlap, v => { cfg().overlap = clamp(v, 0, 60); upd(); }, { step: 1, enter: true, hint: 'So weit zeigen benachbarte Blätter dasselbe. In der Überlappung liegen die Passkreuze — Blätter so übereinanderlegen, dass sie sich decken, dann kleben.' });
    App.numRow(body, 'Linienbreite (mm)', () => cfg().lw, v => { cfg().lw = clamp(v, 0.05, 2); upd(); }, { step: 0.05, enter: true });
    App.boolRow(body, 'Passkreuze', () => cfg().marks, v => { cfg().marks = v; upd(); });
    App.boolRow(body, 'Übersichtsblatt (Klebeplan)', () => cfg().overview, v => { cfg().overview = v; upd(); });
    App.boolRow(body, 'Leere Blätter weglassen', () => cfg().skipEmpty, v => { cfg().skipEmpty = v; upd(); });
    App.boolRow(body, 'Layerfarben drucken', () => cfg().color, v => { cfg().color = v; upd(); }, 'Aus = alles schwarz. Helle Layerfarben werden zum Drucken abgedunkelt.');
    App.boolRow(body, 'Blattaufteilung in der Ansicht zeigen', () => cfg().show, v => { cfg().show = v; upd(); });
    const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('Als PDF exportieren');
    b.title = T('Vektor-PDF im Maßstab; beim Drucken „Tatsächliche Größe“ / 100 % wählen, nicht „Anpassen“.');
    b.onclick = exportPdf; if (window.DEMO && DEMO.btn) DEMO.btn(b);
    const bp = document.createElement('button'); bp.textContent = T('🔍 Druckvorschau…');
    bp.title = T('Alle Blätter so ansehen, wie sie in der PDF stehen — Papierformat, Ausrichtung und Maßstab lassen sich dort direkt umstellen.');
    bp.onclick = () => preview();
    body.appendChild(bp); body.appendChild(b);
    info = document.createElement('div'); info.style.cssText = 'font-size:12px;opacity:.85;margin-top:2px'; body.appendChild(info); updInfo();
  }


  // ---------- Druckvorschau ----------
  // Zeichnet die fertigen Seiten-Operatoren auf ein Canvas (Interpreter für genau den Befehlsumfang,
  // den dieser Schreiber erzeugt) — die Vorschau zeigt also, was in der Datei steht.
  const WIN_REV = {}; Object.keys(WIN).forEach(ch => { WIN_REV[WIN[ch]] = ch; });
  function tokenize(body) {
    const out = [], n = body.length; let i = 0;
    while (i < n) {
      const ch = body[i];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') { i++; continue; }
      if (ch === '(') {   // String mit Escapes (\ddd oktal, \( \) \\)
        let str = ''; i++;
        while (i < n && body[i] !== ')') {
          if (body[i] === '\\') {
            const d = /^[0-7]{1,3}/.exec(body.substr(i + 1, 3));
            if (d) { const c = parseInt(d[0], 8); str += WIN_REV[c] || String.fromCharCode(c); i += 1 + d[0].length; }
            else { str += body[i + 1]; i += 2; }
          } else str += body[i++];
        }
        i++; out.push({ s: str }); continue;
      }
      if (ch === '[') { out.push({ a: '[' }); i++; continue; }
      if (ch === ']') { out.push({ a: ']' }); i++; continue; }
      let j = i; while (j < n && !/[\s()[\]]/.test(body[j])) j++;
      const w = body.slice(i, j); i = j;
      if (/^[-+.\d]/.test(w)) out.push(+w); else if (w[0] === '/') out.push({ nm: w.slice(1) }); else out.push({ op: w });
    }
    return out;
  }
  const colStr = (a, gray) => 'rgb(' + (gray ? [a[0], a[0], a[0]] : a).map(v => Math.round(v * 255)).join(',') + ')';
  // Seite auf ctx zeichnen; scale = Pixel je pt, (ox, oy) = linke obere Ecke der Seite in Pixeln.
  function paintPage(ctx, pg, scale, ox, oy) {
    if (!pg.tok) pg.tok = tokenize(pg.body);
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, pg.w * scale, pg.h * scale);
    ctx.beginPath(); ctx.rect(ox, oy, pg.w * scale, pg.h * scale); ctx.clip();
    ctx.transform(scale, 0, 0, -scale, ox, oy + pg.h * scale);
    ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.setLineDash([]);
    let st = [], arr = null, clipPending = false, fs = 12, tx = 0, ty = 0;
    const fsStack = [];
    const devScale = () => { const m = ctx.getTransform(); return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1; };
    // Haarlinien in der Verkleinerung sichtbar halten (mind. 0,6 Pixel)
    const stroke = () => { const lw = ctx.lineWidth, min = 0.6 / devScale(); if (lw < min) ctx.lineWidth = min; ctx.stroke(); ctx.lineWidth = lw; };
    const endPath = () => { if (clipPending) { ctx.clip(); clipPending = false; } ctx.beginPath(); };
    ctx.beginPath();
    for (const t of pg.tok) {
      if (typeof t === 'number') { (arr || st).push(t); continue; }
      if (t.a === '[') { arr = []; continue; }
      if (t.a === ']') { st.push(arr); arr = null; continue; }
      if (t.s != null || t.nm != null) { st.push(t); continue; }
      const a = st;
      switch (t.op) {
        case 'q': ctx.save(); fsStack.push(fs); break;
        case 'Q': ctx.restore(); if (fsStack.length) fs = fsStack.pop(); break;
        case 'cm': ctx.transform(a[0], a[1], a[2], a[3], a[4], a[5]); break;
        case 'w': ctx.lineWidth = a[0]; break;
        case 'J': ctx.lineCap = ['butt', 'round', 'square'][a[0]] || 'butt'; break;
        case 'j': ctx.lineJoin = ['miter', 'round', 'bevel'][a[0]] || 'miter'; break;
        case 'd': ctx.setLineDash(a[0] || []); ctx.lineDashOffset = a[1] || 0; break;
        case 'RG': ctx.strokeStyle = colStr(a); break;
        case 'rg': ctx.fillStyle = colStr(a); break;
        case 'G': ctx.strokeStyle = colStr(a, true); break;
        case 'g': ctx.fillStyle = colStr(a, true); break;
        case 'm': ctx.moveTo(a[0], a[1]); break;
        case 'l': ctx.lineTo(a[0], a[1]); break;
        case 'c': ctx.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]); break;
        case 're': ctx.rect(a[0], a[1], a[2], a[3]); break;
        case 'h': ctx.closePath(); break;
        case 's': ctx.closePath(); stroke(); endPath(); break;
        case 'S': stroke(); endPath(); break;
        case 'f': ctx.fill(); endPath(); break;
        case 'W': clipPending = true; break;
        case 'n': endPath(); break;
        case 'BT': tx = 0; ty = 0; break;
        case 'Tf': fs = a[1]; break;
        case 'Td': tx += a[0]; ty += a[1]; break;
        case 'Tj':   // in 100-px-Schrift zeichnen und herunterskalieren (winzige Schriftgrößen rendern sonst schlecht)
          ctx.save(); ctx.transform(fs / 100, 0, 0, -fs / 100, tx, ty);
          ctx.font = '100px Helvetica, Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.fillText(a[0].s, 0, 0); ctx.restore(); break;
      }
      st = [];
    }
    ctx.restore();
  }

  let pv = null;   // Zustand der offenen Vorschau
  function pvCss() {
    if (document.getElementById('cadPdfPrevCss')) return;
    const st = document.createElement('style'); st.id = 'cadPdfPrevCss';
    st.textContent = '#cadPdfPrev .modal{width:min(1300px,100%);height:min(860px,92vh);display:flex;flex-direction:column}'
      + '#cadPdfPrev .pp-bar{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:7px 13px;border-bottom:1px solid var(--line);font-size:12px}'
      + '#cadPdfPrev .pp-bar label{color:var(--muted);display:flex;align-items:center;gap:5px;white-space:nowrap}'
      + '#cadPdfPrev .pp-bar select{width:auto}#cadPdfPrev .pp-bar input[type=text]{width:60px}'
      + '#cadPdfPrev .pp-main{flex:1;min-height:0;display:flex}'
      + '#cadPdfPrev .pp-thumbs{width:150px;flex:none;overflow:auto;border-right:1px solid var(--line);padding:8px;display:flex;flex-direction:column;gap:8px}'
      + '#cadPdfPrev .pp-th{cursor:pointer;border:2px solid transparent;border-radius:4px;padding:3px;text-align:center;font-size:11px;color:var(--muted);flex:none}'
      + '#cadPdfPrev .pp-th.sel{border-color:var(--accent,#4aa3ff);color:var(--txt)}'
      + '#cadPdfPrev .pp-th canvas{display:block;margin:0 auto 3px;box-shadow:0 1px 4px rgba(0,0,0,.5)}'
      + '#cadPdfPrev .pp-view{flex:1;min-width:0;position:relative;overflow:hidden;background:#555c66;cursor:grab}'
      + '#cadPdfPrev .pp-view canvas{position:absolute;inset:0;width:100%;height:100%;display:block}'
      + '#cadPdfPrev .pp-hint{position:absolute;left:8px;bottom:8px;color:#eee;font-size:11px;pointer-events:none;background:rgba(0,0,0,.55);padding:2px 7px;border-radius:4px}'
      + '#cadPdfPrev .foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}'
      + '#cadPdfPrev .pp-sum{flex:1;color:var(--muted);font-size:12px}'
      + '@media (max-width:700px){#cadPdfPrev .pp-main{flex-direction:column-reverse}#cadPdfPrev .pp-thumbs{width:auto;flex-direction:row;height:130px;border-right:0;border-top:1px solid var(--line)}}';
    document.head.appendChild(st);
  }
  function pvBuild() {
    if (pv) return pv;
    pvCss();
    const bd = document.createElement('div'); bd.className = 'modal-backdrop'; bd.id = 'cadPdfPrev';
    bd.innerHTML = '<div class="modal"><div class="head"><h2 class="pp-title"></h2><span style="flex:1"></span><button class="close-x pp-x">×</button></div>'
      + '<div class="pp-bar"></div><div class="pp-main"><div class="pp-thumbs"></div><div class="pp-view"><canvas></canvas><div class="pp-hint"></div></div></div>'
      + '<div class="foot"><button class="pp-prev">◀</button><button class="pp-next">▶</button><span class="pp-sum"></span><button class="pp-close"></button><button class="primary pp-save"></button></div></div>';
    document.body.appendChild(bd);
    const q = s => bd.querySelector(s);
    pv = { bd, title: q('.pp-title'), bar: q('.pp-bar'), thumbs: q('.pp-thumbs'), view: q('.pp-view'), cv: q('.pp-view canvas'), hint: q('.pp-hint'), sum: q('.pp-sum'),
      pages: [], P: null, cur: 0, z: 1, fit: 1, px: 0, py: 0, changed: false };
    q('.pp-x').title = T('Schließen (Esc)');
    q('.pp-x').onclick = q('.pp-close').onclick = () => pvClose();
    q('.pp-prev').onclick = () => pvGo(pv.cur - 1); q('.pp-next').onclick = () => pvGo(pv.cur + 1);
    q('.pp-prev').title = T('Vorheriges Blatt (←)'); q('.pp-next').title = T('Nächstes Blatt (→)');
    const sv = q('.pp-save'); sv.onclick = () => { pvClose(); exportPdf(); }; if (window.DEMO && DEMO.btn) DEMO.btn(sv);
    bd.addEventListener('mousedown', e => { if (e.target === bd) pvClose(); });
    window.addEventListener('keydown', e => {
      if (!bd.classList.contains('open')) return;
      const inField = document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName);
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'Escape') { stop(); pvClose(); }
      else if (inField) return;
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { stop(); pvGo(pv.cur - 1); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { stop(); pvGo(pv.cur + 1); }
      else if (e.key === 'Home') { stop(); pvFit(); }
    }, true);
    // Rad = Zoom zum Cursor, Ziehen = verschieben, Doppelklick = ganzes Blatt
    const cv = pv.cv;
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const z2 = clamp(pv.z * Math.exp(-e.deltaY * 0.0015), 0.2, 80), k2 = z2 / pv.z;
      pv.px = mx - (mx - pv.px) * k2; pv.py = my - (my - pv.py) * k2; pv.z = z2; pvDraw();
    }, { passive: false });
    let drag = null;
    cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, px: pv.px, py: pv.py }; cv.style.cursor = 'grabbing'; e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (!drag) return; pv.px = drag.px + e.clientX - drag.x; pv.py = drag.py + e.clientY - drag.y; pvDraw(); });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; cv.style.cursor = ''; } });
    cv.addEventListener('dblclick', () => pvFit());
    window.addEventListener('resize', () => { if (bd.classList.contains('open')) pvFit(); });
    return pv;
  }
  // Schnell-Einstellungen oben in der Vorschau (dieselben Werte wie in der Seitenleiste)
  function pvToolbar() {
    const bar = pv.bar; bar.innerHTML = '';
    const sel = (label, opts, get, set) => {
      const l = document.createElement('label'); l.textContent = T(label);
      const s2 = document.createElement('select');
      opts.forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = T(o[1]); s2.appendChild(e); });
      s2.value = get(); s2.onchange = () => { set(s2.value); pvChanged(); };
      l.appendChild(s2); bar.appendChild(l);
    };
    const num = (label, get, set) => {
      const l = document.createElement('label'); l.textContent = T(label);
      const i = document.createElement('input'); i.type = 'text'; i.inputMode = 'decimal'; i.value = get();
      const go = () => { const v = parseFloat(String(i.value).replace(',', '.')); if (isFinite(v) && v !== get()) { set(v); i.value = get(); pvChanged(); } };
      i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }; i.onblur = go;
      l.appendChild(i); bar.appendChild(l);
    };
    const chk = (label, get, set) => {
      const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!get();
      i.onchange = () => { set(i.checked); pvChanged(); }; l.appendChild(i); l.appendChild(document.createTextNode(T(label))); bar.appendChild(l);
    };
    sel('Papierformat', Object.keys(SHEETS).map(k => [k, SHEETS[k][0]]), () => cfg().sheet, v => { cfg().sheet = v; });
    sel('Ausrichtung', [['auto', 'automatisch (wenigste Blätter)'], ['p', 'hoch'], ['l', 'quer']], () => cfg().orient, v => { cfg().orient = v; });
    num('Maßstab (%)', () => cfg().scale, v => { cfg().scale = clamp(v, 1, 10000); });
    num('Überlappung (mm)', () => cfg().overlap, v => { cfg().overlap = clamp(v, 0, 60); });
    chk('Passkreuze', () => cfg().marks, v => { cfg().marks = v; });
    chk('Übersichtsblatt (Klebeplan)', () => cfg().overview, v => { cfg().overview = v; });
    chk('Layerfarben drucken', () => cfg().color, v => { cfg().color = v; });
  }
  function pvChanged() { pv.changed = true; cache.key = null; pvLoad(); if (App.renderCad) App.renderCad(); }
  function pvLoad() {
    const r = makePages(T('CAD-Zeichnung'));
    pv.thumbs.innerHTML = '';
    if (r.err) { pv.pages = []; pv.P = null; pv.sum.textContent = T(r.err); pvDraw(); return; }
    pv.pages = r.pages; pv.P = r.P; pv.cur = Math.min(pv.cur, pv.pages.length - 1);
    const TW = 120, dpr = window.devicePixelRatio || 1;
    pv.pages.forEach((pg, i) => {
      const d = document.createElement('div'); d.className = 'pp-th';
      const s2 = Math.min(TW / pg.w, TW / pg.h);
      const c2 = document.createElement('canvas'); c2.width = Math.round(pg.w * s2 * dpr); c2.height = Math.round(pg.h * s2 * dpr);
      c2.style.width = Math.round(pg.w * s2) + 'px'; c2.style.height = Math.round(pg.h * s2) + 'px';
      paintPage(c2.getContext('2d'), pg, s2 * dpr, 0, 0);
      d.appendChild(c2); d.appendChild(document.createTextNode(pg.label));
      d.onclick = () => pvGo(i); pv.thumbs.appendChild(d);
    });
    pvGo(pv.cur);
  }
  function pvGo(i) {
    if (!pv.pages.length) return;
    pv.cur = clamp(i, 0, pv.pages.length - 1);
    [...pv.thumbs.children].forEach((el, k) => el.classList.toggle('sel', k === pv.cur));
    const el = pv.thumbs.children[pv.cur]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const P = pv.P, pg = pv.pages[pv.cur];
    pv.sum.textContent = pg.label + '  ·  ' + (pv.cur + 1) + '/' + pv.pages.length + '  ·  ' + P.n + ' ' + T('Blatt') + ' ' + SHEETS[cfg().sheet][0] + ' ' + (P.land ? T('quer') : T('hoch'))
      + ' (' + P.cols + ' × ' + P.rows + ')  ·  ' + T('Maßstab') + ' ' + scaleTxt(P.k) + '  ·  ' + T('Zeichnung') + ' ' + Math.round((P.bb.maxx - P.bb.minx) * P.k) + ' × ' + Math.round((P.bb.maxy - P.bb.miny) * P.k) + ' mm';
    pvFit();
  }
  function pvFit() {
    const r = pv.view.getBoundingClientRect(), pg = pv.pages[pv.cur];
    if (pg && r.width) {
      pv.fit = Math.min((r.width - 30) / pg.w, (r.height - 30) / pg.h); pv.z = 1;
      pv.px = (r.width - pg.w * pv.fit) / 2; pv.py = (r.height - pg.h * pv.fit) / 2;
    }
    pvDraw();
  }
  function pvDraw() {
    const cv = pv.cv, r = pv.view.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    const pg = pv.pages[pv.cur]; if (!pg) { pv.hint.textContent = ''; return; }
    const s2 = pv.fit * pv.z;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect((pv.px + 4) * dpr, (pv.py + 4) * dpr, pg.w * s2 * dpr, pg.h * s2 * dpr);   // Schatten
    paintPage(ctx, pg, s2 * dpr, pv.px * dpr, pv.py * dpr);
    pv.hint.textContent = T('Zoom') + ' ' + Math.round(pv.z * 100) + ' %  ·  ' + T('Rad = Zoom, Ziehen = verschieben, Doppelklick = ganzes Blatt, ←/→ = Blatt wechseln');
  }
  function preview() {
    pvBuild(); pv.changed = false; pv.cur = 0;
    pv.title.textContent = T('Druckvorschau');
    pv.bd.querySelector('.pp-close').textContent = T('Schließen');
    pv.bd.querySelector('.pp-save').textContent = T('Als PDF exportieren');
    pv.bd.classList.add('open');
    pvToolbar(); pvLoad();
  }
  function pvClose() {
    if (!pv) return;
    pv.bd.classList.remove('open');
    if (pv.changed && App.buildSidebar) App.buildSidebar();   // geänderte Werte auch in der Seitenleiste zeigen
  }

  window.CadPdf = { sidebar, drawTiles, exportPdf, preview, _test: { cfg, content, plan, makePdf, makePages, paintPage, SHEETS } };
})();
