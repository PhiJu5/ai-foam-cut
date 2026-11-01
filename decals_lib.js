/* decals_lib.js — Motiv-Bibliothek für den Reiter „Decals" (Funktion „decals").
 *
 * Jedes Motiv wird aus wenigen Maßen KONSTRUIERT (keine Bilddateien): Hoheitszeichen, Flaggen,
 * Haifischmaul, Streifen, Warnzeichen, Grundformen. Ergebnis je Motiv:
 *   { layers: [ { c: '#rrggbb', rings: [ [[x,y],…], … ], rule?: 'nonzero' } ] }
 * in Einheiten der Bezugshöhe (1 = Höhe bzw. Durchmesser des Motivs), Ursprung in der Mitte, y nach oben.
 * Die Ebenen liegen in Malreihenfolge übereinander (unten zuerst); gleiche Farbe = gleiche Folie beim Plotten.
 * Ringe einer Ebene überlappen sich nicht (saubere Schnittkonturen).
 *
 * Keine Abhängigkeit von App — die Datei läuft auch in Node (Tests).
 * Proportionen und Farbtöne sind den Vorschriften angenähert; vor dem Druck mit dem Vorbild vergleichen.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2, rad = d => d * Math.PI / 180;

  // ---------- Farben -------------------------------------------------------------------------
  const W = '#ffffff', K = '#111111', RED = '#c8102e', BLUE = '#00247d', YEL = '#ffd100', GREY = '#8a9097';

  // ---------- Grundformen ---------------------------------------------------------------------
  function circle(cx, cy, r, n) { n = n || 96; const o = []; for (let i = 0; i < n; i++) o.push([cx + r * Math.cos(TAU * i / n), cy + r * Math.sin(TAU * i / n)]); return o; }
  function ellipse(cx, cy, rx, ry, n) { n = n || 96; const o = []; for (let i = 0; i < n; i++) o.push([cx + rx * Math.cos(TAU * i / n), cy + ry * Math.sin(TAU * i / n)]); return o; }
  function rect(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
  // Stern mit n Zacken, eine Zacke oben; k = Innenradius / Außenradius (5 Zacken: 0,382).
  function star(cx, cy, R, n, k, rot) {
    n = n || 5; if (k == null) k = 0.381966; const o = [], a0 = Math.PI / 2 + (rot || 0);
    for (let i = 0; i < 2 * n; i++) { const r = i % 2 ? R * k : R, a = a0 + Math.PI * i / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return o;
  }
  function sector(cx, cy, r, a0, a1, n) { n = n || 40; const o = [[cx, cy]]; for (let i = 0; i <= n; i++) { const a = rad(a0 + (a1 - a0) * i / n); o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; }
  // Griechisches Kreuz (Plus) als EIN Ring: Länge L, Balkenbreite w.
  function plus(L, w) { const a = L / 2, b = w / 2; return [[-a, -b], [-b, -b], [-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b]]; }
  // Vier Winkel zwischen zwei Kreuzen (Balkenbreite w0 … w1), Länge L — Flanken des Balkenkreuzes.
  function angles(L, w0, w1) {
    const a = L / 2, i = w0 / 2, o = w1 / 2, q = [[i, a], [o, a], [o, o], [a, o], [a, i], [i, i]], out = [];
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) out.push(q.map(p => [p[0] * sx, p[1] * sy]));
    return out;
  }
  function quad(p0, c, p1, n) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); } return o; }
  function tf(ring, o) {
    const s = o.s == null ? 1 : o.s, sx = (o.fx ? -1 : 1) * s, c = Math.cos(o.rot || 0), sn = Math.sin(o.rot || 0), dx = o.dx || 0, dy = o.dy || 0;
    return ring.map(p => { const x = p[0] * sx, y = p[1] * s; return [x * c - y * sn + dx, x * sn + y * c + dy]; });
  }
  // Ring an einem konvexen Ring (gegen den Uhrzeigersinn) beschneiden (Sutherland–Hodgman).
  function clipConvex(ring, clip) {
    let out = ring;
    for (let i = 0; i < clip.length && out.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length], f = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), inp = out; out = [];
      for (let k = 0; k < inp.length; k++) {
        const p = inp[k], q = inp[(k + 1) % inp.length], fp = f(p), fq = f(q);
        if (fp >= 0) out.push(p);
        if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
    }
    return out;
  }
  function area(L) { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  // Einfacher Parallelversatz (Gehrung, begrenzt) für gutmütige Konturen; d > 0 nach außen.
  function offsetPoly(L, d) {
    const n = L.length, sg = area(L) > 0 ? 1 : -1, out = [];
    for (let i = 0; i < n; i++) {
      const a = L[(i - 1 + n) % n], p = L[i], b = L[(i + 1) % n];
      const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]], l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
      const n1 = [e1[1] / l1 * sg, -e1[0] / l1 * sg], n2 = [e2[1] / l2 * sg, -e2[0] / l2 * sg];
      let m = [n1[0] + n2[0], n1[1] + n2[1]]; const lm = Math.hypot(m[0], m[1]);
      if (lm < 1e-9) m = n1; else { m[0] /= lm; m[1] /= lm; }
      const c = Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]);
      out.push([p[0] + m[0] * d / c, p[1] + m[1] * d / c]);
    }
    return out;
  }
  const Ly = (c, rings, rule) => rule ? { c, rings, rule } : { c, rings };
  // Konzentrische Scheiben von außen nach innen: [[Durchmesser-Anteil, Farbe], …]
  function discs(list) { return list.map(([d, c]) => Ly(c, [circle(0, 0, d / 2)])); }

  // Ahornblatt (rechte Hälfte, Höhe 1), gespiegelt zum ganzen Blatt.
  const LEAF = [[0, 50], [7, 36], [15, 40], [11, 13], [25, 27], [28, 19], [43, 23], [38, 7], [46, 2], [23, -17], [26, -28], [2, -25], [2, -50]];
  function leaf(s, dx, dy) {
    const r = LEAF.map(p => [p[0] / 100, p[1] / 100]), l = LEAF.slice(1, -1).reverse().map(p => [-p[0] / 100, p[1] / 100]);
    return tf(r.concat([[-0.02, -0.5], [-0.02, -0.25]], l), { s: s || 1, dx: dx || 0, dy: dy || 0 });
  }
  // Tatzenkreuz: E = halbe Ausdehnung, w = halbe Breite am Armende, q = halbe Taille.
  function pattee(E, w, q) {
    const out = [];
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2, arm = quad([q, -q], [E * 0.62, -q * 1.05], [E, -w], 14).concat(quad([E, w], [E * 0.62, q * 1.05], [q, q], 14).slice(0, -1));
      arm.forEach(p => out.push([p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)]));
    }
    return out;
  }
  function heart() { const o = []; for (let i = 0; i < 120; i++) { const t = TAU * i / 120, s = Math.sin(t); o.push([16 * s * s * s / 32, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5) / 32]); } return o; }
  function spade() {
    const h = heart().map(p => [p[0], -p[1] + 0.06]), yc = Math.min.apply(null, h.filter(p => Math.abs(p[0]) < 0.05).map(p => p[1]));
    const body = h.filter(p => !(Math.abs(p[0]) < 0.035 && p[1] < yc + 0.12));     // Kerbe unten öffnen
    let k = 0; for (let i = 0; i < body.length; i++) if (body[i][0] > 0 && body[i][1] < body[k][1] + 1e-9 && Math.abs(body[i][0]) < 0.08) k = i;
    // Ring so drehen, dass er rechts der Kerbe beginnt und links davon endet; Stiel anfügen.
    const i0 = body.findIndex(p => p[0] > 0), rot = body.slice(i0).concat(body.slice(0, i0));
    return rot.concat([[-0.035, yc + 0.1], [-0.17, -0.5], [0.17, -0.5], [0.035, yc + 0.1]]);
  }

  // ---------- Kokarden ------------------------------------------------------------------------
  const ROUNDELS = {
    gb_a: ['Großbritannien Typ A (rot-weiß-blau 1:3:5)', [[1, BLUE], [0.6, W], [0.2, RED]]],
    gb_a1: ['Großbritannien Typ A1 (mit gelbem Ring)', [[1, YEL], [5 / 7, BLUE], [3 / 7, W], [1 / 7, RED]]],
    gb_b: ['Großbritannien Typ B (rot-blau, Nacht)', [[1, BLUE], [0.4, RED]]],
    gb_c: ['Großbritannien Typ C (schmaler weißer Ring)', [[1, BLUE], [0.5, W], [0.375, RED]]],
    gb_c1: ['Großbritannien Typ C1 (mit gelbem Rand)', [[1, YEL], [8 / 9, BLUE], [4 / 9, W], [3 / 9, RED]]],
    gb_d: ['Großbritannien Typ D (ab 1947, 1:2:3)', [[1, BLUE], [2 / 3, W], [1 / 3, RED]]],
    fr: ['Frankreich', [[1, '#ef4135'], [2 / 3, W], [1 / 3, '#0055a4']]],
    fr_y: ['Frankreich (mit gelbem Rand)', [[1, YEL], [0.9, '#ef4135'], [0.6, W], [0.3, '#0055a4']]],
    it: ['Italien', [[1, '#ce2b37'], [2 / 3, W], [1 / 3, '#009246']]],
    be: ['Belgien', [[1, '#ef3340'], [2 / 3, '#fdda24'], [1 / 3, K]]],
    es: ['Spanien', [[1, '#c60b1e'], [2 / 3, '#ffc400'], [1 / 3, '#c60b1e']]],
    dk: ['Dänemark', [[1, '#c8102e'], [0.5, W]]],
    gr: ['Griechenland', [[1, '#0d5eaf'], [2 / 3, W], [1 / 3, '#0d5eaf']]],
    tr: ['Türkei', [[1, '#e30a17'], [2 / 3, W], [1 / 3, '#e30a17']]],
    ro: ['Rumänien', [[1, '#ce1126'], [2 / 3, '#fcd116'], [1 / 3, '#002b7f']]],
    ind: ['Indien', [[1, '#ff9933'], [2 / 3, W], [1 / 3, '#138808']]],
    ar: ['Argentinien', [[1, '#74acdf'], [2 / 3, W], [1 / 3, '#74acdf']]],
    eg: ['Ägypten', [[1, '#ce1126'], [2 / 3, W], [1 / 3, K]]],
    jp: ['Japan (Hinomaru)', [[1, '#bc002d']]],
    jp_w: ['Japan (Hinomaru mit weißem Rand)', [[1, W], [0.86, '#bc002d']]]
  };
  const SECTORS = {
    nl: ['Niederlande', [[90, 210, '#ae1c28'], [210, 330, '#21468b'], [330, 450, W]], [1 / 3, '#ff7f00']],
    cz: ['Tschechien / Tschechoslowakei', [[30, 150, W], [150, 270, '#11457e'], [270, 390, '#d7141a']], null]
  };

  // ---------- Flaggen ---------------------------------------------------------------------------
  const FLAGS = {
    de: ['Deutschland', 'h', [K, '#dd0000', '#ffce00'], 5 / 3], at: ['Österreich', 'h', ['#ed2939', W, '#ed2939'], 1.5],
    ch: ['Schweiz', 'ch'], fr: ['Frankreich', 'v', ['#0055a4', W, '#ef4135'], 1.5], it: ['Italien', 'v', ['#009246', W, '#ce2b37'], 1.5],
    gb: ['Großbritannien (Union Jack)', 'gb'], us: ['USA', 'us'], ca: ['Kanada', 'ca'], jp: ['Japan', 'jp'], eu: ['Europa', 'eu'],
    nl: ['Niederlande', 'h', ['#ae1c28', W, '#21468b'], 1.5], be: ['Belgien', 'v', [K, '#fdda24', '#ef3340'], 1.5],
    lu: ['Luxemburg', 'h', ['#ed2939', W, '#00a1de'], 5 / 3], pl: ['Polen', 'h', [W, '#dc143c'], 1.6], cz: ['Tschechien', 'cz'],
    hu: ['Ungarn', 'h', ['#ce2939', W, '#477050'], 1.5], es: ['Spanien (ohne Wappen)', 'h', ['#c60b1e', '#ffc400', '#c60b1e'], 1.5, [1, 2, 1]],
    ie: ['Irland', 'v', ['#169b62', W, '#ff883e'], 2], ro: ['Rumänien', 'v', ['#002b7f', '#fcd116', '#ce1126'], 1.5],
    bg: ['Bulgarien', 'h', [W, '#00966e', '#d62612'], 5 / 3], ru: ['Russland', 'h', [W, '#0039a6', '#d52b1e'], 1.5],
    ua: ['Ukraine', 'h', ['#0057b7', '#ffd700'], 1.5], ee: ['Estland', 'h', ['#0072ce', K, W], 11 / 7], lt: ['Litauen', 'h', ['#fdb913', '#006a44', '#c1272d'], 5 / 3],
    lv: ['Lettland', 'h', ['#9e3039', W, '#9e3039'], 2, [2, 1, 2]],
    dk: ['Dänemark', 'n', ['#c8102e', W], [12, 4, 21], [12, 4, 12]], se: ['Schweden', 'n', ['#006aa7', '#fecc00'], [5, 2, 9], [4, 2, 4]],
    fi: ['Finnland', 'n', [W, '#003580'], [5, 3, 10], [4, 3, 4]], no: ['Norwegen', 'n', ['#ba0c2f', W, '#00205b'], [6, 1, 2, 1, 12], [6, 1, 2, 1, 6]],
    is: ['Island', 'n', ['#02529c', W, '#dc1e35'], [7, 1, 2, 1, 14], [7, 1, 2, 1, 7]]
  };
  function flag(id) {
    const f = FLAGS[id] || FLAGS.de, kind = f[1], L = [];
    if (kind === 'h' || kind === 'v') {
      const cols = f[2], a = f[3], wt = f[4] || cols.map(() => 1), sum = wt.reduce((s, v) => s + v, 0); let acc = 0;
      cols.forEach((c, i) => {
        const t0 = acc / sum, t1 = (acc += wt[i]) / sum;
        L.push(Ly(c, [kind === 'h' ? rect(-a / 2, 0.5 - t1, a / 2, 0.5 - t0) : rect(-a / 2 + a * t0, -0.5, -a / 2 + a * t1, 0.5)]));
      });
      return L;
    }
    if (kind === 'n') {
      const cols = f[2], hx = f[3], hy = f[4], Wd = hx.reduce((s, v) => s + v, 0), H = hy.reduce((s, v) => s + v, 0), s = 1 / H;
      const cross = (x0, x1, y0, y1) => [[0, y0], [x0, y0], [x0, 0], [x1, 0], [x1, y0], [Wd, y0], [Wd, y1], [x1, y1], [x1, H], [x0, H], [x0, y1], [0, y1]].map(p => [(p[0] - Wd / 2) * s, (p[1] - H / 2) * s]);
      L.push(Ly(cols[0], [rect(-Wd * s / 2, -0.5, Wd * s / 2, 0.5)]));
      if (hx.length === 3) L.push(Ly(cols[1], [cross(hx[0], hx[0] + hx[1], hy[0], hy[0] + hy[1])]));
      else {
        L.push(Ly(cols[1], [cross(hx[0], hx[0] + hx[1] + hx[2] + hx[3], hy[0], hy[0] + hy[1] + hy[2] + hy[3])]));
        L.push(Ly(cols[2], [cross(hx[0] + hx[1], hx[0] + hx[1] + hx[2], hy[0] + hy[1], hy[0] + hy[1] + hy[2])]));
      }
      return L;
    }
    if (kind === 'ch') return [Ly('#da291c', [rect(-0.5, -0.5, 0.5, 0.5)]), Ly(W, [plus(0.625, 0.1875)])];
    if (kind === 'jp') return [Ly(W, [rect(-0.75, -0.5, 0.75, 0.5)]), Ly('#bc002d', [circle(0, 0, 0.3)])];
    if (kind === 'eu') {
      const st = []; for (let i = 0; i < 12; i++) { const a = TAU * i / 12; st.push(star(Math.cos(a) / 3, Math.sin(a) / 3, 1 / 18)); }
      return [Ly('#003399', [rect(-0.75, -0.5, 0.75, 0.5)]), Ly('#ffcc00', st)];
    }
    if (kind === 'ca') return [Ly('#d80621', [rect(-1, -0.5, -0.5, 0.5), rect(0.5, -0.5, 1, 0.5)]), Ly(W, [rect(-0.5, -0.5, 0.5, 0.5)]), Ly('#d80621', [leaf(0.82)])];
    if (kind === 'cz') return [Ly(W, [[[-0.75, 0.5], [-0.75 + 0.0001, 0.5], [0.75, 0.5], [0.75, 0], [0, 0]].slice(1)]), Ly('#d7141a', [[[0, 0], [0.75, 0], [0.75, -0.5], [-0.75, -0.5]]]), Ly('#11457e', [[[-0.75, -0.5], [0, 0], [-0.75, 0.5]]])];
    if (kind === 'us') {
      const Wd = 1.9, x0 = -Wd / 2, cw = 0.76, ch = 7 / 13, wh = [], st = [];
      for (let i = 1; i < 13; i += 2) { const yt = 0.5 - i / 13, left = i < 7 ? x0 + cw : x0; wh.push(rect(left, yt - 1 / 13, Wd / 2, yt)); }
      for (let r = 1; r <= 9; r++) for (let c = (r % 2 ? 1 : 2); c <= 11; c += 2) st.push(star(x0 + cw * c / 12, 0.5 - ch * r / 10, 0.0308));
      return [Ly('#b22234', [rect(x0, -0.5, Wd / 2, 0.5)]), Ly(W, wh), Ly('#3c3b6e', [rect(x0, 0.5 - ch, x0 + cw, 0.5)]), Ly(W, st)];
    }
    if (kind === 'gb') {
      const blue = '#012169', red = '#c8102e', c = 1 / 6, wq = [], rq = [];
      for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        const d = [sx * 2 / Math.sqrt(5), sy / Math.sqrt(5)], n = [-d[1], d[0]];
        const q = rect(sx > 0 ? c : -1, sy > 0 ? c : -0.5, sx > 0 ? 1 : -c, sy > 0 ? 0.5 : -c);
        const band = (o0, o1) => clipConvex([[n[0] * o0, n[1] * o0], [d[0] * 3 + n[0] * o0, d[1] * 3 + n[1] * o0], [d[0] * 3 + n[0] * o1, d[1] * 3 + n[1] * o1], [n[0] * o1, n[1] * o1]], q);
        const a = band(-0.1, 0.1), b = band(0, 2 / 30);
        if (a.length > 2) wq.push(a); if (b.length > 2) rq.push(b);
      }
      return [Ly(blue, [rect(-1, -0.5, 1, 0.5)]), Ly(W, wq), Ly(red, rq),
        Ly(W, [[[-1, -c], [-c, -c], [-c, -0.5], [c, -0.5], [c, -c], [1, -c], [1, c], [c, c], [c, 0.5], [-c, 0.5], [-c, c], [-1, c]]]),
        Ly(red, [[[-1, -0.1], [-0.1, -0.1], [-0.1, -0.5], [0.1, -0.5], [0.1, -0.1], [1, -0.1], [1, 0.1], [0.1, 0.1], [0.1, 0.5], [-0.1, 0.5], [-0.1, 0.1], [-1, 0.1]]])];
    }
    return L;
  }

  // ---------- Haifischmaul ------------------------------------------------------------------------
  // Zahn auf der Lippe A (Punkte k0 … k1), Spitze zur Gegenlippe B. Formen: Dreieck, nach hinten geneigt (Säge),
  // abwechselnd lang/kurz, Reißzähne (vorn lang, nach hinten kürzer), gestutzt (stumpfe Spitze).
  function tooth(A, B, k0, k1, i, n, th, form) {
    const ka = form === 'lean' ? k1 : form === 'fwd' ? k0 : Math.round((k0 + k1) / 2);
    const f = form === 'alt' ? (i % 2 ? 0.55 : 1) : form === 'fang' ? 1 - 0.65 * i / Math.max(1, n - 1) : 1, o = B[ka], ring = A.slice(k0, k1 + 1);
    if (form === 'blunt') { const a = A[k0 + Math.round((k1 - k0) * 0.3)], b = A[k0 + Math.round((k1 - k0) * 0.7)], oa = B[k0 + Math.round((k1 - k0) * 0.3)], ob = B[k0 + Math.round((k1 - k0) * 0.7)]; ring.push([b[0] + (ob[0] - b[0]) * th * 0.8, b[1] + (ob[1] - b[1]) * th * 0.8], [a[0] + (oa[0] - a[0]) * th * 0.8, a[1] + (oa[1] - a[1]) * th * 0.8]); return ring; }
    const m = A[ka]; ring.push([m[0] + (o[0] - m[0]) * th * f, m[1] + (o[1] - m[1]) * th * f]);
    return ring;
  }
  // Auge: rund oder grimmig (schräges Lid, zur Nase hin tiefer); liefert [schwarz, weiß, Pupille].
  function sharkEye(ex, ey, s, kind) {
    let o = ellipse(ex, ey, s * 1.25, s * 0.8), i = ellipse(ex, ey, s * 1.05, s * 0.62);
    if (kind === 'angry') { const lid = d => [[ex - 3, ey - 3], [ex + 3, ey - 3], [ex + 3, ey + s * (0.85 - d)], [ex - 3, ey + s * (0.1 - d)]]; o = clipConvex(o, lid(0)); i = clipConvex(i, lid(0.2)); }
    return [o, i, circle(ex - s * 0.25, ey - (kind === 'angry' ? s * 0.12 : 0), s * 0.36)];
  }
  const eyeKind = p => p.eye === true ? 'round' : (p.eye === 'round' || p.eye === 'angry') ? p.eye : 'none';
  const TOOTH = [['tri', 'spitz (Dreieck)'], ['lean', 'Säge, nach hinten geneigt'], ['fwd', 'Säge, nach vorn geneigt'], ['alt', 'abwechselnd lang und kurz'], ['fang', 'Reißzähne (vorn lang, hinten kurz)'], ['blunt', 'gestutzt (stumpf)']];
  const JAWS = [['both', 'beide Kiefer'], ['up', 'nur oben'], ['lo', 'nur unten'], ['none', 'ohne Zähne']];
  const EYES = [['none', 'ohne'], ['round', 'rund'], ['angry', 'grimmig (schräges Lid)']];
  function shark(p) {
    const a = Math.max(1.2, +p.len || 2.6), n = Math.max(3, Math.round(+p.teeth || 9)), th = Math.min(0.49, Math.max(0.1, (+p.th || 42) / 100)), lip = Math.max(0, (+p.lip || 5) / 100);
    const g = Math.min(0.5, Math.max(0, (p.open == null ? 10 : +p.open) / 100));
    const N = 60, up = quad([-a / 2, 0.12], [-a * 0.02, 0.62], [a / 2, 0.2 + g / 2], N), lo = quad([-a / 2, -0.5], [a * 0.3, -0.52], [a / 2, 0.2 - g / 2], N);
    const arc = []; for (let i = 1; i < 12; i++) { const ph = Math.PI / 2 - Math.PI * i / 12; arc.push([a / 2 + g / 2 * Math.cos(ph), 0.2 + g / 2 * Math.sin(ph)]); }
    const front = quad([-a / 2, -0.5], [-a / 2 - 0.12, -0.2], [-a / 2, 0.12], 10).slice(1, -1);
    const mouth = up.concat(arc, lo.slice().reverse(), front);
    const teeth = [], mk = (A, B) => {
      const t0 = 0.03, t1 = 0.84;
      for (let i = 0; i < n; i++) {
        const k0 = Math.round((t0 + (t1 - t0) * i / n) * N), k1 = Math.round((t0 + (t1 - t0) * (i + 1) / n) * N), km = Math.round((k0 + k1) / 2);
        if (k1 - k0 < 1) continue;
        void km; teeth.push(tooth(A, B, k0, k1, i, n, th, p.tooth));
      }
    };
    if (p.jaws !== 'lo' && p.jaws !== 'none') mk(up, lo); if (p.jaws !== 'up' && p.jaws !== 'none') mk(lo, up);
    const L = [];
    if (lip > 0) L.push(Ly(K, [offsetPoly(mouth, lip)]));
    L.push(Ly(p.black ? K : '#c8102e', [mouth])); if (teeth.length) L.push(Ly(W, teeth));
    if (eyeKind(p) !== 'none') { const e = sharkEye(-a * 0.2, 0.78, 0.2, eyeKind(p)); L.push(Ly(K, [e[0]]), Ly(W, [e[1]]), Ly(K, [e[2]])); }
    return L;
  }

  // Haifischmaul rundum: Abwicklung um die Rumpfnase. x = Rumpflängsrichtung (Nase bei −a/2), y = Umfang,
  // y = 0 liegt auf der Bauchlinie; das Maul läuft als Hufeisen von einer Rumpfseite unter dem Kinn zur anderen.
  function shark3d(p) {
    const a = Math.max(0.8, +p.len || 1.7), n = Math.max(3, Math.round(+p.teeth || 8)), th = Math.min(0.49, Math.max(0.1, (+p.th || 40) / 100)), lip = Math.max(0, (+p.lip || 4) / 100);
    const c = Math.min(0.48, Math.max(0.1, (+p.corner || 34) / 100)), d = Math.min(0.6, Math.max(0.05, (+p.chin || 22) / 100)), M = 90;
    const g = Math.min(2 * c - 0.02, Math.max(0, (p.open == null ? 12 : +p.open) / 100)), ks = Math.min(1, Math.max(0, (+p.sharp || 0) / 100));     // Öffnung am Mundwinkel, Kinn rund … spitz
    const up = t => { const r = Math.min(1, t / 0.35), k = t > 0.35 ? (t - 0.35) / 0.65 : 0; return 0.5 * Math.sqrt(Math.max(0, 1 - (1 - r) * (1 - r))) - (0.5 - c - g / 2) * k * k * (3 - 2 * k); };
    const lo = t => { if (t <= d) return 0; const r = (t - d) / (1 - d); return (c - g / 2) * ((1 - ks) * Math.sqrt(Math.max(0, 1 - (1 - r) * (1 - r))) + ks * Math.pow(r, 0.85)); };
    const U = [], Lw = []; for (let i = 0; i <= M; i++) { const t = i / M, x = -a / 2 + a * t; U.push([x, up(t)]); Lw.push([x, lo(t)]); }
    const id = Math.floor(d * M), mir = q => [q[0], -q[1]];
    const arc = []; for (let i = 1; i < 12; i++) { const ph = Math.PI / 2 - Math.PI * i / 12; arc.push([a / 2 + g / 2 * Math.cos(ph), c + g / 2 * Math.sin(ph)]); }      // Mundwinkel ausgerundet
    const chin = []; for (let i = 0; i <= 70; i++) { const r = 1 - Math.cos(Math.PI / 2 * i / 70), t = d + (1 - d) * r; chin.push([-a / 2 + a * t, lo(t)]); }      // Unterlippe ab dem Kinn, vorn dicht abgetastet
    const mouth = U.concat(arc, chin.slice().reverse(), chin.slice(1).map(mir), arc.slice().reverse().map(mir), U.slice(1, M + 1).reverse().map(mir));
    const teeth = [], mk = (A, B, t0, t1) => {
      for (let i = 0; i < n; i++) {
        const k0 = Math.round((t0 + (t1 - t0) * i / n) * M), k1 = Math.round((t0 + (t1 - t0) * (i + 1) / n) * M), km = Math.round((k0 + k1) / 2); if (k1 - k0 < 1) continue;
        void km; const ring = tooth(A, B, k0, k1, i, n, th, p.tooth);
        teeth.push(ring, ring.map(mir));
      }
    };
    if (p.jaws !== 'lo' && p.jaws !== 'none') mk(U, Lw, 0.05, 0.9); if (p.jaws !== 'up' && p.jaws !== 'none') mk(Lw, U, d + 0.04, 0.9);
    const L = [];
    if (lip > 0) L.push(Ly(K, [offsetPoly(mouth, lip)]));
    L.push(Ly(p.black ? K : '#c8102e', [mouth])); if (teeth.length) L.push(Ly(W, teeth));
    if (eyeKind(p) !== 'none') { const e = sharkEye(-a * 0.1, 0.74, 0.15, eyeKind(p)); L.push(Ly(K, [e[0], e[0].map(mir)]), Ly(W, [e[1], e[1].map(mir)]), Ly(K, [e[2], e[2].map(mir)])); }
    return L;
  }
  const hx = h => { const v = parseInt(String(h).replace('#', ''), 16) || 0; return [v >> 16, (v >> 8) & 255, v & 255]; };
  const mixc = (a, b, t) => { const A = hx(a), B = hx(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

  // Klinge entlang einer Mittellinie P(t) mit Breite w(t); fray > 0: Ende in Zacken ausgefranst (Speed-Linien).
  function blade(P, w, n, fray) {
    const up = [], lo = [], tc = fray ? 0.7 : 1, at = t => { const p = P(t), q = P(t + 1e-3), dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return { p, nx: -dy / l, ny: dx / l }; };
    for (let i = 0; i <= n; i++) { const t = tc * i / n, f = at(t), h = w(t) / 2; up.push([f.p[0] + f.nx * h, f.p[1] + f.ny * h]); lo.push([f.p[0] - f.nx * h, f.p[1] - f.ny * h]); }
    const tail = [];
    if (fray) {
      const k = Math.max(2, Math.round(fray)), LEN = [1, 0.55, 0.8, 0.45, 0.9], f0 = at(tc), h0 = w(tc);
      for (let j = 0; j < k; j++) {
        const te = tc + (1 - tc) * LEN[j % 5], f = at(te), o = (0.5 - (j + 0.5) / k) * h0 * 0.9; tail.push([f.p[0] + f.nx * o, f.p[1] + f.ny * o]);
        if (j < k - 1) { const fv = at(tc + 0.02), ov = (0.5 - (j + 1) / k) * h0; tail.push([fv.p[0] + fv.nx * ov, fv.p[1] + fv.ny * ov]); }
      }
      void f0;
    }
    return up.concat(tail, lo.reverse());
  }
  // Schwung-Dekor: mehrere gestaffelte, spitz zulaufende Streifen (wie die Folien-Dekore an Rumpfnasen).
  function swoosh(p) {
    const a = +p.asp || 5, n = Math.max(1, Math.min(8, Math.round(+p.n || 3))), th = Math.max(0.03, (+p.th || 24) / 100), stag = Math.max(0, (+p.stag || 16) / 100), shr = Math.max(0, Math.min(0.6, (+p.shrink || 12) / 100));
    const rise = (+p.rise || 0) / 100, bul = (+p.bulge || 0) / 100, cols = [p.c1, p.c2, p.c3], L = [], fr = p.fray ? Math.max(2, Math.round(+p.spikes || 3)) : 0;
    for (let k = 0; k < n; k++) {
      const xs = -a / 2 + k * stag * a, xe = Math.min(a / 2, xs + a * (1 - stag * (n - 1)) * Math.pow(1 - shr, k) + k * stag * a * 0.5), yk = n > 1 ? (0.5 - th / 2) - k * (1 - th) / (n - 1) : 0;
      const P = t => [xs + (xe - xs) * t, yk + rise * (t - 0.5) + bul * 4 * t * (1 - t)];
      const w = t => th * Math.pow(Math.sin(Math.PI / 2 * Math.min(1, t / 0.45)), 0.8) * (fr ? 1 : Math.pow(Math.sin(Math.PI / 2 * Math.min(1, (1 - t) / 0.55)), 0.8));
      L.push(Ly(cols[k % 3], [blade(P, w, 50, fr)]));
    }
    return L;
  }
  function flames(p) {
    const a = +p.asp || 3, n = Math.max(2, Math.min(15, Math.round(+p.n || 5))), LEN = [1, 0.6, 0.85, 0.5, 0.93, 0.7], hw = 0.5 / n, L = [];
    const set = (c, kl, kw) => {
      const R = [];
      for (let j = 0; j < n; j++) {
        const y0 = 0.5 - (j + 0.5) / n, len = a * LEN[j % 6] * kl, ph = j * 1.7;
        R.push(blade(t => [-a / 2 + len * t, y0 + 0.5 / n * 0.9 * Math.sin(2 * Math.PI * 1.15 * t + ph) * t], t => 2 * hw * kw * (1 - Math.pow(t, 1.4)), 40, 0));
      }
      if (kw === 1) R.push(rect(-a / 2 - 0.12, -0.5, -a / 2, 0.5));
      L.push(Ly(c, R));
    };
    set(p.c1, 1, 1); if (p.inner) set(p.c2, 0.6, 0.5);
    return L;
  }
  function waves(p) {
    const a = +p.asp || 6, n = Math.max(1, Math.min(12, Math.round(+p.n || 3))), m = Math.max(0.25, +p.waves || 2), th = Math.max(0.02, (+p.th || 12) / 100), amp = Math.max(0, (+p.amp || 30) / 100) * 0.5, L = [];
    for (let k = 0; k < n; k++) {
      const y0 = n > 1 ? (0.5 - amp - th / 2) - k * (1 - 2 * amp - th) / (n - 1) : 0;
      L.push(Ly(n > 1 ? mixc(p.c1, p.c2, k / (n - 1)) : p.c1, [blade(t => [-a / 2 + a * t, y0 + amp * Math.sin(2 * Math.PI * m * t)], () => th, 120, 0)]));
    }
    return L;
  }

  // ---------- Motive ----------------------------------------------------------------------------
  // params: { k, n: Bezeichnung, t: 'num'|'sel'|'bool', d: Vorgabe, min, max, step, o: [[Wert, Text], …] }
  const opt = M => Object.keys(M).map(k => [k, M[k][0]]);
  const MOTIFS = [
    // ---- Hoheitszeichen ----
    { id: 'roundel', cat: 'Hoheitszeichen', name: 'Kokarde (Ringe)', size: 60, params: [{ k: 'land', n: 'Land / Typ', t: 'sel', d: 'gb_a', o: opt(ROUNDELS) }],
      build: p => discs((ROUNDELS[p.land] || ROUNDELS.gb_a)[1]) },
    { id: 'sectors', cat: 'Hoheitszeichen', name: 'Kokarde (Sektoren)', size: 60, params: [{ k: 'land', n: 'Land', t: 'sel', d: 'nl', o: opt(SECTORS) }],
      build: p => { const s = SECTORS[p.land] || SECTORS.nl, L = s[1].map(q => Ly(q[2], [sector(0, 0, 0.5, q[0], q[1])])); if (s[2]) L.push(Ly(s[2][1], [circle(0, 0, s[2][0] / 2)])); return L; } },
    { id: 'balken', cat: 'Hoheitszeichen', name: 'Balkenkreuz (Luftwaffe 1935–45)', size: 60,
      params: [{ k: 'typ', n: 'Ausführung', t: 'sel', d: 'full', o: [['full', 'schwarz mit weißen Winkeln und schwarzem Rand'], ['narrow', 'schmale weiße Winkel (Flügeloberseite)'], ['core', 'schwarzer Kern mit weißen Winkeln (ohne Rand)'], ['white', 'nur weiße Winkel (vereinfacht, ab 1943)'], ['black', 'nur schwarze Winkel (auf hellem Grund)']] }],
      build: p => {
        const t = p.typ, w1 = t === 'narrow' ? 0.3125 : 0.5, L = [];
        if (t === 'white') return [Ly(W, angles(1, 0.25, 0.5))];
        if (t === 'black') return [Ly(K, angles(1, 0.3, 0.42))];
        L.push(Ly(K, [plus(1, 0.25)]), Ly(W, angles(1, 0.25, w1)));
        if (t !== 'core') L.push(Ly(K, angles(1, w1, w1 + 0.0625)));
        return L;
      } },
    { id: 'ek', cat: 'Hoheitszeichen', name: 'Eisernes Kreuz / Tatzenkreuz', size: 60,
      params: [{ k: 'typ', n: 'Ausführung', t: 'sel', d: 'bw', o: [['bw', 'Bundeswehr (schwarz, weißer Rand)'], ['bw2', 'Bundeswehr mit schwarzer Außenlinie'], ['ww1', '1914–18 auf weißem Feld'], ['plain', 'nur Kreuz']] },
        { k: 'wd', n: 'Breite am Armende (%)', t: 'num', d: 52, min: 30, max: 95, step: 2 }, { k: 'q', n: 'Taille (%)', t: 'num', d: 7, min: 3, max: 20, step: 1 }],
      build: p => {
        const w = (+p.wd || 52) / 200, q = (+p.q || 7) / 100, t = p.typ, b = 0.045, L = [];
        if (t === 'ww1') return [Ly(W, [rect(-0.5, -0.5, 0.5, 0.5)]), Ly(K, [pattee(0.44, Math.max(w, 0.36) * 0.88 / 0.5 * 0.5, q)])];
        if (t === 'plain') return [Ly(K, [pattee(0.5, w, q)])];
        const e = 0.5 - b - (t === 'bw2' ? 0.015 : 0);
        if (t === 'bw2') L.push(Ly(K, [pattee(0.5, w + b + 0.015, q + b * 0.9 + 0.012)]));
        L.push(Ly(W, [pattee(e + b, w + b, q + b * 0.9)]), Ly(K, [pattee(e, w, q)]));
        return L;
      } },
    { id: 'usstar', cat: 'Hoheitszeichen', name: 'USA Stern (Star and Bar)', size: 60,
      params: [{ k: 'typ', n: 'Ausführung', t: 'sel', d: 'y47', o: [['y41', 'bis Mai 1942 (Stern mit rotem Punkt)'], ['y42', '1942–43 (Stern im Kreis)'], ['y43r', 'Sommer 1943 (Balken, roter Rand)'], ['y43', '1943–47 (Balken, blauer Rand)'], ['y47', 'ab 1947 (Balken mit rotem Streifen)'], ['low', 'Tarnausführung (grau)']] }],
      build: p => {
        const t = p.typ, R = 0.5, bl = t === 'low' ? '#5b6168' : '#002664', wh = t === 'low' ? '#aeb4ba' : W, rd = '#bf0a30', L = [];
        if (t === 'y41' || t === 'y42') { L.push(Ly(bl, [circle(0, 0, R)]), Ly(wh, [star(0, 0, R)])); if (t === 'y41') L.push(Ly(rd, [circle(0, 0, R * 0.3)])); return L; }
        const yt = R * Math.sin(rad(18)), yb = yt - R / 2, b = R / 8, bc = t === 'y43r' ? rd : bl;
        L.push(Ly(bc, [circle(0, 0, R + b), rect(-2 * R - b, yb - b, -R * 0.9, yt + b), rect(R * 0.9, yb - b, 2 * R + b, yt + b)]));
        L[0].rule = 'nonzero';
        L.push(Ly(wh, [rect(-2 * R, yb, -R * 0.95, yt), rect(R * 0.95, yb, 2 * R, yt)]));
        if (t === 'y47') L.push(Ly(rd, [rect(-2 * R, yb + R / 6, -R * 0.95, yt - R / 6), rect(R * 0.95, yb + R / 6, 2 * R, yt - R / 6)]));
        L.push(Ly(bl, [circle(0, 0, R)]), Ly(wh, [star(0, 0, R)]));
        return L;
      } },
    { id: 'redstar', cat: 'Hoheitszeichen', name: 'Roter Stern (UdSSR / Russland)', size: 60,
      params: [{ k: 'typ', n: 'Ausführung', t: 'sel', d: 'out', o: [['plain', 'einfach rot'], ['k', 'rot mit schwarzem Rand (bis 1942)'], ['out', 'rot mit weiß-rotem Rand (ab 1943)'], ['ru', 'Russland (rot-blau-weißer Rand)']] }],
      build: p => {
        const r = '#d52b1e', t = p.typ;
        if (t === 'plain') return [Ly(r, [star(0, 0, 0.5)])];
        if (t === 'k') return [Ly(K, [star(0, 0, 0.5)]), Ly(r, [star(0, 0, 0.43)])];
        if (t === 'ru') return [Ly(r, [star(0, 0, 0.5)]), Ly('#0039a6', [star(0, 0, 0.455)]), Ly(W, [star(0, 0, 0.41)]), Ly(r, [star(0, 0, 0.365)])];
        return [Ly(r, [star(0, 0, 0.5)]), Ly(W, [star(0, 0, 0.455)]), Ly(r, [star(0, 0, 0.385)])];
      } },
    { id: 'swiss', cat: 'Hoheitszeichen', name: 'Schweiz', size: 60, params: [{ k: 'typ', n: 'Feld', t: 'sel', d: 'disc', o: [['disc', 'rote Scheibe'], ['sq', 'rotes Quadrat'], ['band', 'nur Kreuz (auf rotem Band)']] }],
      build: p => { const c = Ly(W, [plus(0.625, 0.1875)]); return p.typ === 'band' ? [c] : [Ly('#da291c', [p.typ === 'sq' ? rect(-0.5, -0.5, 0.5, 0.5) : circle(0, 0, 0.5)]), c]; } },
    { id: 'austria', cat: 'Hoheitszeichen', name: 'Österreich', size: 60, params: [],
      build: () => [Ly('#ed2939', [circle(0, 0, 0.5)]), Ly(W, [[0, 1, 2].map(i => { const a = rad(-90 + 120 * i); return [0.5 * Math.cos(a), 0.5 * Math.sin(a)]; })])] },
    { id: 'poland', cat: 'Hoheitszeichen', name: 'Polen (Szachownica)', size: 60, params: [{ k: 'old', n: 'Anordnung vor 1993 (rot oben links)', t: 'bool', d: false }],
      build: p => {
        const r = '#d4213d', b = 1 / 12, red = [], wh = [];
        for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
          const fieldWhite = (sx * sy < 0) !== !!p.old;      // oben links / unten rechts weiß (seit 1993)
          const o = rect(Math.min(0, sx * 0.5), Math.min(0, sy * 0.5), Math.max(0, sx * 0.5), Math.max(0, sy * 0.5));
          const f = rect(sx > 0 ? 0 : -0.5 + b, sy > 0 ? 0 : -0.5 + b, sx > 0 ? 0.5 - b : 0, sy > 0 ? 0.5 - b : 0);
          // Rand = L-förmiger Rest des Quadranten (als ein Ring), Feld in der Gegenfarbe
          const X = sx * 0.5, Y = sy * 0.5, xi = sx * (0.5 - b), yi = sy * (0.5 - b), ell = [[0, Y], [X, Y], [X, 0], [xi, 0], [xi, yi], [0, yi]];
          (fieldWhite ? red : wh).push(ell); (fieldWhite ? wh : red).push(f); void o;
        }
        return [Ly(r, red), Ly(W, wh)];
      } },
    { id: 'canada', cat: 'Hoheitszeichen', name: 'Kanada (Ahornblatt)', size: 60, params: [{ k: 'typ', n: 'Ausführung', t: 'sel', d: 'rcaf', o: [['rcaf', 'RCAF-Kokarde (blauer Ring)'], ['leaf', 'nur Ahornblatt']] }],
      build: p => p.typ === 'leaf' ? [Ly('#d80621', [leaf(1)])] : [Ly('#00247d', [circle(0, 0, 0.5)]), Ly(W, [circle(0, 0, 0.34)]), Ly('#d80621', [leaf(0.56)])] },
    { id: 'israel', cat: 'Hoheitszeichen', name: 'Israel', size: 60, params: [],
      build: () => [Ly(W, [circle(0, 0, 0.5)]), Ly('#0038b8', [star(0, 0, 0.44, 6, 1 / Math.sqrt(3))])] },
    { id: 'roc', cat: 'Hoheitszeichen', name: 'Republik China (Sonne)', size: 60, params: [],
      build: () => [Ly(W, [circle(0, 0, 0.5)]), Ly('#000095', [circle(0, 0, 0.46)]), Ly(W, [star(0, 0, 0.38, 12, 0.58)]), Ly('#000095', [circle(0, 0, 0.2)]), Ly(W, [circle(0, 0, 0.17)])] },
    { id: 'finflash', cat: 'Hoheitszeichen', name: 'Leitwerksstreifen (Fin Flash)', size: 40,
      params: [{ k: 'land', n: 'Land', t: 'sel', d: 'gb', o: [['gb', 'Großbritannien (gleich breit)'], ['gbc', 'Großbritannien Typ C (schmal weiß)'], ['fr', 'Frankreich'], ['it', 'Italien'], ['be', 'Belgien']] }, { k: 'asp', n: 'Breite : Höhe', t: 'num', d: 0.9, min: 0.3, max: 3, step: 0.05 }],
      build: p => {
        const a = +p.asp || 0.9, S = { gb: [[RED, W, BLUE], [1, 1, 1]], gbc: [[RED, W, BLUE], [11, 2, 11]], fr: [['#0055a4', W, '#ef4135'], [1, 1, 1]], it: [['#009246', W, '#ce2b37'], [1, 1, 1]], be: [[K, '#fdda24', '#ef3340'], [1, 1, 1]] }[p.land] || [[RED, W, BLUE], [1, 1, 1]];
        const sum = S[1].reduce((s, v) => s + v, 0); let acc = 0;
        return S[0].map((c, i) => { const t0 = acc / sum, t1 = (acc += S[1][i]) / sum; return Ly(c, [rect(-a / 2 + a * t0, -0.5, -a / 2 + a * t1, 0.5)]); });
      } },
    // ---- Flaggen ----
    { id: 'flag', cat: 'Flaggen', name: 'Flagge', size: 30, params: [{ k: 'land', n: 'Land', t: 'sel', d: 'de', o: opt(FLAGS) }], build: p => flag(p.land) },
    // ---- Nose-Art & Bemalung ----
    { id: 'shark', cat: 'Nose-Art & Bemalung', name: 'Haifischmaul', size: 50,
      params: [{ k: 'len', n: 'Länge : Höhe', t: 'num', d: 2.6, min: 1.2, max: 5, step: 0.1 }, { k: 'teeth', n: 'Zähne je Kiefer', t: 'num', d: 9, min: 3, max: 24, step: 1 }, { k: 'th', n: 'Zahnlänge (% der Maulöffnung)', t: 'num', d: 42, min: 10, max: 49, step: 1 },
        { k: 'tooth', n: 'Zahnform', t: 'sel', d: 'tri', o: TOOTH }, { k: 'jaws', n: 'Zahnreihen', t: 'sel', d: 'both', o: JAWS },
        { k: 'open', n: 'Mundwinkel: 0 = spitz … ausgerundet (%)', t: 'num', d: 0, min: 0, max: 40, step: 1 }, { k: 'lip', n: 'Lippe / Rand (% der Höhe)', t: 'num', d: 5, min: 0, max: 15, step: 1 }, { k: 'black', n: 'Maul schwarz statt rot', t: 'bool', d: false }, { k: 'eye', n: 'Auge', t: 'sel', d: 'round', o: EYES }],
      build: shark },
    { id: 'shark3d', cat: 'Nose-Art & Bemalung', name: 'Haifischmaul rundum (um die Rumpfnase, 3D)', size: 120, fus3d: true,
      params: [{ k: 'len', n: 'Länge : Umfangsbreite', t: 'num', d: 1.7, min: 0.8, max: 5, step: 0.1 }, { k: 'teeth', n: 'Zähne je Kiefer und Seite', t: 'num', d: 8, min: 3, max: 24, step: 1 }, { k: 'th', n: 'Zahnlänge (% der Maulöffnung)', t: 'num', d: 40, min: 10, max: 49, step: 1 },
        { k: 'corner', n: 'Höhe der Mundwinkel (%)', t: 'num', d: 34, min: 10, max: 48, step: 1 }, { k: 'chin', n: 'Beginn des Kinns (% der Länge)', t: 'num', d: 22, min: 5, max: 60, step: 1 },
        { k: 'tooth', n: 'Zahnform', t: 'sel', d: 'tri', o: TOOTH }, { k: 'jaws', n: 'Zahnreihen', t: 'sel', d: 'both', o: JAWS },
        { k: 'open', n: 'Mundwinkel: 0 = spitz … ausgerundet (%)', t: 'num', d: 0, min: 0, max: 40, step: 1 }, { k: 'sharp', n: 'Kinn: 0 = rund … 100 = spitz', t: 'num', d: 0, min: 0, max: 100, step: 10 },
        { k: 'lip', n: 'Lippe / Rand (% der Höhe)', t: 'num', d: 4, min: 0, max: 15, step: 1 }, { k: 'black', n: 'Maul schwarz statt rot', t: 'bool', d: false }, { k: 'eye', n: 'Augen', t: 'sel', d: 'round', o: EYES }],
      build: shark3d },
    { id: 'eye', cat: 'Nose-Art & Bemalung', name: 'Auge', size: 25, params: [{ k: 'angry', n: 'grimmig (schräges Lid)', t: 'bool', d: true }],
      build: p => {
        let o = ellipse(0, 0, 0.78, 0.5), i = ellipse(0, 0, 0.68, 0.4);
        if (p.angry) { const lid = d => [[-2, -2], [2, -2], [2, 0.34 - d], [-2, -0.02 - d]]; o = clipConvex(o, lid(0)); i = clipConvex(i, lid(0.09)); }
        return [Ly(K, [o]), Ly(W, [i]), Ly(K, [circle(0.12, -0.08, 0.2)])];
      } },
    { id: 'invasion', cat: 'Nose-Art & Bemalung', name: 'Invasionsstreifen (D-Day 1944)', size: 120,
      params: [{ k: 'n', n: 'Streifen', t: 'sel', d: '5', o: [['5', '5 (weiß-schwarz-weiß-schwarz-weiß)'], ['3', '3 (schwarz-weiß-schwarz)']] }, { k: 'w', n: 'Streifenbreite (% der Länge)', t: 'num', d: 15, min: 3, max: 60, step: 1 }],
      build: p => {
        const n = +p.n === 3 ? 3 : 5, w = (+p.w || 15) / 100, x0 = -n * w / 2, wh = [], bk = [];
        for (let i = 0; i < n; i++) ((i % 2 === 0) === (n === 5) ? wh : bk).push(rect(x0 + i * w, -0.5, x0 + (i + 1) * w, 0.5));
        return [Ly(W, wh), Ly(K, bk)];
      } },
    { id: 'stripes', cat: 'Nose-Art & Bemalung', name: 'Streifen (abwechselnd)', size: 40,
      params: [{ k: 'n', n: 'Anzahl', t: 'num', d: 6, min: 2, max: 40, step: 1 }, { k: 'asp', n: 'Breite : Höhe', t: 'num', d: 3, min: 0.1, max: 30, step: 0.1 }, { k: 'skew', n: 'Schräge (°)', t: 'num', d: 0, min: -60, max: 60, step: 5 }],
      build: p => {
        const n = Math.max(2, Math.round(+p.n || 6)), a = +p.asp || 3, sh = Math.tan(rad(+p.skew || 0)) * 0.5, A = [], B = [], w = a / n;
        for (let i = 0; i < n; i++) { const x = -a / 2 + i * w; (i % 2 ? B : A).push([[x - sh, -0.5], [x + w - sh, -0.5], [x + w + sh, 0.5], [x + sh, 0.5]]); }
        return [Ly(YEL, A), Ly(K, B)];
      } },
    { id: 'checker', cat: 'Nose-Art & Bemalung', name: 'Schachbrett', size: 40,
      params: [{ k: 'cols', n: 'Spalten', t: 'num', d: 6, min: 1, max: 40, step: 1 }, { k: 'rows', n: 'Zeilen', t: 'num', d: 3, min: 1, max: 40, step: 1 }],
      build: p => {
        const c = Math.max(1, Math.round(+p.cols || 6)), r = Math.max(1, Math.round(+p.rows || 3)), s = 1 / r, A = [], B = [];
        for (let i = 0; i < c; i++) for (let j = 0; j < r; j++) ((i + j) % 2 ? B : A).push(rect(-c * s / 2 + i * s, -0.5 + j * s, -c * s / 2 + (i + 1) * s, -0.5 + (j + 1) * s));
        return [Ly(K, A), Ly(W, B)];
      } },
    { id: 'sunburst', cat: 'Nose-Art & Bemalung', name: 'Sonnenstrahlen (Kunstflug)', size: 150,
      params: [{ k: 'n', n: 'Strahlen', t: 'num', d: 7, min: 2, max: 30, step: 1 }, { k: 'asp', n: 'Breite : Höhe', t: 'num', d: 2.5, min: 0.3, max: 10, step: 0.1 }, { k: 'fan', n: 'Fächerwinkel (°)', t: 'num', d: 60, min: 10, max: 180, step: 5 },
        { k: 'apex', n: 'Ursprung', t: 'sel', d: 'l', o: [['l', 'links Mitte'], ['lb', 'links unten'], ['b', 'unten Mitte']] }, { k: 'bg', n: 'mit Grundfläche', t: 'bool', d: true }],
      build: p => {
        const a = +p.asp || 2.5, n = Math.max(2, Math.round(+p.n || 7)), fan = +p.fan || 60, R = rect(-a / 2, -0.5, a / 2, 0.5), rays = [];
        const ap = p.apex === 'b' ? [0, -0.5] : p.apex === 'lb' ? [-a / 2, -0.5] : [-a / 2, 0], mid = p.apex === 'b' ? 90 : p.apex === 'lb' ? fan / 2 : 0, far = a + 2;
        for (let i = 0; i < 2 * n - 1; i += 2) {
          const a0 = rad(mid - fan / 2 + fan * i / (2 * n - 1)), a1 = rad(mid - fan / 2 + fan * (i + 1) / (2 * n - 1));
          const r = clipConvex([ap, [ap[0] + far * Math.cos(a0), ap[1] + far * Math.sin(a0)], [ap[0] + far * Math.cos(a1), ap[1] + far * Math.sin(a1)]], R);
          if (r.length > 2) rays.push(r);
        }
        return (p.bg ? [Ly(W, [R])] : []).concat([Ly('#d4213d', rays)]);
      } },
    { id: 'cheat', cat: 'Nose-Art & Bemalung', name: 'Zierstreifen (spitz zulaufend)', size: 15,
      params: [{ k: 'asp', n: 'Länge : Höhe', t: 'num', d: 20, min: 2, max: 200, step: 1 }, { k: 'end', n: 'Höhe am Ende (%)', t: 'num', d: 0, min: 0, max: 100, step: 5 }, { k: 'line', n: 'mit Begleitlinie', t: 'bool', d: true }],
      build: p => {
        const a = +p.asp || 20, e = Math.max(0, Math.min(100, +p.end || 0)) / 200, L = [Ly(RED, [[[-a / 2, -0.5], [a / 2, -e], [a / 2, e], [-a / 2, 0.5]].filter((q, i, A) => !(i === 2 && e === 0))])];
        if (p.line) { const f = x => 0.5 - (0.5 - e) * (x + a / 2) / a, x1 = a / 2 * 0.86; L.push(Ly(K, [[[-a / 2, -0.5 - 0.3], [x1, -f(x1) - 0.3 * f(x1) * 2], [x1, -f(x1) - 0.3 * f(x1) * 2 - 0.16 * f(x1) * 2], [-a / 2, -0.5 - 0.46]]])); }
        return L;
      } },
    { id: 'bolt', cat: 'Nose-Art & Bemalung', name: 'Blitz', size: 30, params: [{ k: 'rand', n: 'mit Rand', t: 'bool', d: true }],
      build: p => { const b = [[-1.25, 0.25], [0.15, 0.42], [-0.02, 0.1], [1.25, -0.42], [-0.2, -0.08], [-0.05, 0.2]].reverse(); return (p.rand ? [Ly(K, [offsetPoly(b, 0.06)])] : []).concat([Ly(YEL, [b])]); } },
    { id: 'suit', cat: 'Nose-Art & Bemalung', name: 'Spielkartenfarbe (Pik-As, Herz-As)', size: 50,
      params: [{ k: 'suit', n: 'Farbe', t: 'sel', d: 'spade', o: [['spade', 'Pik'], ['heart', 'Herz'], ['diamond', 'Karo']] }, { k: 'field', n: 'Feld', t: 'sel', d: 'diamond', o: [['none', 'ohne'], ['diamond', 'weiße Raute mit Rand'], ['disc', 'weiße Scheibe mit Rand']] }],
      build: p => {
        const s = p.suit, sh = s === 'heart' ? heart() : s === 'diamond' ? [[0, 0.5], [0.34, 0], [0, -0.5], [-0.34, 0]] : spade(), col = s === 'spade' ? K : '#d4213d', L = [];
        if (p.field === 'diamond') L.push(Ly(K, [[[0, 0.5], [0.5, 0], [0, -0.5], [-0.5, 0]]]), Ly(W, [[[0, 0.44], [0.44, 0], [0, -0.44], [-0.44, 0]]]));
        if (p.field === 'disc') L.push(Ly(K, [circle(0, 0, 0.5)]), Ly(W, [circle(0, 0, 0.46)]));
        L.push(Ly(col, [tf(sh, { s: p.field === 'none' ? 1 : 0.5 })]));
        return L;
      } },
    { id: 'bomb', cat: 'Nose-Art & Bemalung', name: 'Bombe (Einsatzmarke)', size: 15, params: [],
      build: () => {
        const h = quad([0, -0.5], [0.2, -0.42], [0.16, -0.12], 10).concat(quad([0.16, -0.12], [0.14, 0.12], [0.05, 0.27], 8).slice(1), [[0.17, 0.38], [0.17, 0.5], [0, 0.5]]);
        return [Ly(K, [h.concat(h.slice(1, -1).reverse().map(q => [-q[0], q[1]]))])];
      } },
    { id: 'swoosh', cat: 'Dekore', name: 'Schwung-Dekor (gestaffelte Streifen)', size: 30,
      params: [{ k: 'asp', n: 'Länge : Höhe', t: 'num', d: 5, min: 1, max: 30, step: 0.5 }, { k: 'n', n: 'Streifen', t: 'num', d: 3, min: 1, max: 8, step: 1 }, { k: 'th', n: 'Streifenstärke (% der Höhe)', t: 'num', d: 26, min: 3, max: 100, step: 1 },
        { k: 'stag', n: 'Versatz nach hinten (% der Länge)', t: 'num', d: 16, min: 0, max: 45, step: 1 }, { k: 'shrink', n: 'Verkürzung je Streifen (%)', t: 'num', d: 10, min: 0, max: 60, step: 1 },
        { k: 'rise', n: 'Anstieg nach hinten (% der Höhe)', t: 'num', d: -30, min: -300, max: 300, step: 5 }, { k: 'bulge', n: 'Schwung / Bogen (% der Höhe)', t: 'num', d: 35, min: -300, max: 300, step: 5 },
        { k: 'fray', n: 'Ende in Zacken (Speed-Linien)', t: 'bool', d: true }, { k: 'spikes', n: 'Zacken je Streifen', t: 'num', d: 3, min: 2, max: 8, step: 1 },
        { k: 'c1', n: 'Farbe 1', t: 'col', d: '#ffc400' }, { k: 'c2', n: 'Farbe 2', t: 'col', d: '#d4213d' }, { k: 'c3', n: 'Farbe 3', t: 'col', d: '#1f3f8f' }],
      build: swoosh },
    { id: 'flames', cat: 'Dekore', name: 'Flammen', size: 40,
      params: [{ k: 'asp', n: 'Länge : Höhe', t: 'num', d: 3, min: 1, max: 12, step: 0.1 }, { k: 'n', n: 'Zungen', t: 'num', d: 5, min: 2, max: 15, step: 1 }, { k: 'inner', n: 'mit innerer Flamme', t: 'bool', d: true },
        { k: 'c1', n: 'Farbe außen', t: 'col', d: '#d4213d' }, { k: 'c2', n: 'Farbe innen', t: 'col', d: '#ffc400' }],
      build: flames },
    { id: 'waves', cat: 'Dekore', name: 'Wellenlinien', size: 30,
      params: [{ k: 'asp', n: 'Länge : Höhe', t: 'num', d: 6, min: 1, max: 40, step: 0.5 }, { k: 'n', n: 'Linien', t: 'num', d: 3, min: 1, max: 12, step: 1 }, { k: 'waves', n: 'Wellen', t: 'num', d: 2, min: 0.25, max: 20, step: 0.25 },
        { k: 'amp', n: 'Wellenhöhe (% der Höhe)', t: 'num', d: 30, min: 0, max: 90, step: 5 }, { k: 'th', n: 'Strichstärke (% der Höhe)', t: 'num', d: 12, min: 2, max: 60, step: 1 },
        { k: 'c1', n: 'Farbe 1', t: 'col', d: '#1f3f8f' }, { k: 'c2', n: 'Farbe 2', t: 'col', d: '#4fb3e8' }],
      build: waves },
    // ---- Markierungen & Warnzeichen ----
    { id: 'arrow', cat: 'Markierungen & Warnzeichen', name: 'Pfeil (Rettung / Hinweis)', size: 20,
      params: [{ k: 'asp', n: 'Länge : Höhe', t: 'num', d: 3, min: 1, max: 20, step: 0.1 }, { k: 'head', n: 'Spitze (% der Länge)', t: 'num', d: 35, min: 5, max: 95, step: 5 }, { k: 'shaft', n: 'Schaft (% der Höhe)', t: 'num', d: 50, min: 10, max: 100, step: 5 }, { k: 'rand', n: 'mit Rand', t: 'bool', d: true }],
      build: p => {
        const a = +p.asp || 3, hx = a / 2 - a * (+p.head || 35) / 100, s = (+p.shaft || 50) / 200, r = [[-a / 2, -s], [hx, -s], [hx, -0.5], [a / 2, 0], [hx, 0.5], [hx, s], [-a / 2, s]];
        return (p.rand ? [Ly(K, [offsetPoly(r, 0.07)])] : []).concat([Ly(YEL, [r])]);
      } },
    { id: 'warntri', cat: 'Markierungen & Warnzeichen', name: 'Warndreieck (Schleudersitz / Gefahr)', size: 30,
      params: [{ k: 'down', n: 'Spitze nach unten', t: 'bool', d: true }, { k: 'rand', n: 'Rand (% der Höhe)', t: 'num', d: 8, min: 0, max: 25, step: 1 }],
      build: p => {
        const h = 1, w = 2 / Math.sqrt(3), t = [[-w / 2, -h / 2], [w / 2, -h / 2], [0, h / 2]].map(q => p.down ? [q[0], -q[1]] : q), b = (+p.rand || 0) / 100;
        if (p.down) t.reverse();
        return b > 0 ? [Ly('#d4213d', [t]), Ly(W, [offsetPoly(t, -b)]), Ly('#d4213d', [offsetPoly(t, -2 * b)])] : [Ly('#d4213d', [t])];
      } },
    { id: 'chevron', cat: 'Markierungen & Warnzeichen', name: 'Winkel (Lufteinlauf-Warnung)', size: 40,
      params: [{ k: 'ang', n: 'Öffnungswinkel (°)', t: 'num', d: 70, min: 20, max: 160, step: 5 }, { k: 'th', n: 'Strichstärke (% der Höhe)', t: 'num', d: 18, min: 3, max: 45, step: 1 }],
      build: p => {
        const t = (+p.th || 18) / 100, tn = Math.tan(rad((+p.ang || 70) / 2)), ww = 0.5 * tn, dx = t / Math.cos(rad((+p.ang || 70) / 2));
        return [Ly('#d4213d', [[[0, -0.5], [ww * 2, 0.5], [ww * 2 - dx, 0.5], [0, -0.5 + dx / tn], [-(ww * 2 - dx), 0.5], [-ww * 2, 0.5]]])];
      } },
    { id: 'frame', cat: 'Markierungen & Warnzeichen', name: 'Rahmen (für Hinweistext)', size: 15,
      params: [{ k: 'asp', n: 'Breite : Höhe', t: 'num', d: 4, min: 0.3, max: 30, step: 0.1 }, { k: 'th', n: 'Strichstärke (% der Höhe)', t: 'num', d: 6, min: 1, max: 30, step: 1 }],
      build: p => { const a = +p.asp || 4, t = (+p.th || 6) / 100; return [Ly(K, [rect(-a / 2, -0.5, a / 2, 0.5), rect(-a / 2 + t, -0.5 + t, a / 2 - t, 0.5 - t)])]; } },
    // ---- Grundformen ----
    { id: 'band', cat: 'Grundformen', name: 'Band / Rechteck / Trapez', size: 40,
      params: [{ k: 'asp', n: 'Breite : Höhe', t: 'num', d: 3, min: 0.05, max: 60, step: 0.1 }, { k: 'tap', n: 'Höhe rechts (%)', t: 'num', d: 100, min: 0, max: 300, step: 5 }, { k: 'skew', n: 'Schräge (°)', t: 'num', d: 0, min: -70, max: 70, step: 5 }],
      build: p => { const a = +p.asp || 3, e = (p.tap == null ? 100 : +p.tap) / 200, sh = Math.tan(rad(+p.skew || 0)); return [Ly('#ff5a00', [[[-a / 2 - sh * 0.5, -0.5], [a / 2 - sh * e, -e], [a / 2 + sh * e, e], [-a / 2 + sh * 0.5, 0.5]]])]; } },
    { id: 'gradband', cat: 'Grundformen', name: 'Farbverlauf / Bänder in Stufen', size: 40,
      params: [{ k: 'asp', n: 'Breite : Höhe', t: 'num', d: 4, min: 0.05, max: 60, step: 0.1 }, { k: 'n', n: 'Bänder / Verlaufsstufen', t: 'num', d: 12, min: 2, max: 60, step: 1 },
        { k: 'dir', n: 'Richtung', t: 'sel', d: 'x', o: [['x', 'Verlauf von links nach rechts'], ['y', 'Bänder übereinander']] }, { k: 'tap', n: 'Höhe rechts (%)', t: 'num', d: 100, min: 0, max: 300, step: 5 },
        { k: 'c1', n: 'Farbe 1', t: 'col', d: '#ffd100' }, { k: 'c2', n: 'Farbe 2', t: 'col', d: '#c8102e' }],
      build: p => {
        const a = +p.asp || 4, n = Math.max(2, Math.round(+p.n || 12)), e = (p.tap == null ? 100 : +p.tap) / 100, L = [], hh = x => 0.5 * (1 + (e - 1) * (x + a / 2) / a);
        for (let k = 0; k < n; k++) {
          const c = mixc(p.c1, p.c2, k / (n - 1));
          if (p.dir === 'y') { const y0 = 1 - 2 * k / n, y1 = 1 - 2 * (k + 1) / n; L.push(Ly(c, [[[-a / 2, 0.5 * y1], [a / 2, 0.5 * e * y1], [a / 2, 0.5 * e * y0], [-a / 2, 0.5 * y0]]])); }
          else { const x0 = -a / 2 + a * k / n, x1 = -a / 2 + a * (k + 1) / n; L.push(Ly(c, [[[x0, -hh(x0)], [x1, -hh(x1)], [x1, hh(x1)], [x0, hh(x0)]]])); }
        }
        return L;
      } },
    { id: 'disc', cat: 'Grundformen', name: 'Kreis / Ring / Ellipse', size: 40,
      params: [{ k: 'asp', n: 'Breite : Höhe', t: 'num', d: 1, min: 0.1, max: 10, step: 0.1 }, { k: 'hole', n: 'Innenöffnung (%)', t: 'num', d: 0, min: 0, max: 98, step: 2 }],
      build: p => { const a = +p.asp || 1, h = Math.max(0, Math.min(98, +p.hole || 0)) / 100, r = [ellipse(0, 0, a / 2, 0.5)]; if (h > 0) r.push(ellipse(0, 0, a / 2 * h, 0.5 * h)); return [Ly(K, r)]; } },
    { id: 'star', cat: 'Grundformen', name: 'Stern', size: 40,
      params: [{ k: 'n', n: 'Zacken', t: 'num', d: 5, min: 3, max: 32, step: 1 }, { k: 'k', n: 'Innenradius (%)', t: 'num', d: 38, min: 5, max: 95, step: 1 }, { k: 'rand', n: 'mit Rand', t: 'bool', d: false }],
      build: p => { const n = Math.max(3, Math.round(+p.n || 5)), k = (+p.k || 38) / 100; return p.rand ? [Ly(K, [star(0, 0, 0.5, n, k)]), Ly(YEL, [star(0, 0, 0.42, n, k)])] : [Ly(YEL, [star(0, 0, 0.5, n, k)])]; } },
    { id: 'shield', cat: 'Grundformen', name: 'Wappenschild', size: 50, params: [{ k: 'rand', n: 'Rand (% der Höhe)', t: 'num', d: 5, min: 0, max: 15, step: 1 }],
      build: p => {
        const h = [[0, 0.5], [0.4, 0.5]].concat(quad([0.4, 0.5], [0.42, 0], [0.38, -0.1], 6).slice(1), quad([0.38, -0.1], [0.3, -0.36], [0, -0.5], 12).slice(1));
        const s = h.concat(h.slice(1, -1).reverse().map(q => [-q[0], q[1]])).reverse(), b = (+p.rand || 0) / 100;
        return b > 0 ? [Ly(K, [s]), Ly(W, [offsetPoly(s, -b)])] : [Ly(W, [s])];
      } }
  ];
  const BY = {}; MOTIFS.forEach(m => { BY[m.id] = m; });
  function defaults(id) { const m = BY[id], p = {}; if (m) m.params.forEach(q => { p[q.k] = q.d; }); return p; }
  function build(id, p) {
    const m = BY[id]; if (!m) return [];
    const q = defaults(id); if (p) for (const k in p) if (p[k] != null) q[k] = p[k];
    return m.build(q).filter(l => l.rings && l.rings.length).map(l => ({ c: l.c, rule: l.rule || 'evenodd', rings: l.rings.filter(r => r.length > 2) }));
  }
  // Fertige Hinweistexte (Stencils) zum schnellen Einfügen.
  const TEXTS = ['NO STEP', 'RESCUE', 'DANGER', 'JET INTAKE', 'EJECTION SEAT', 'LIFT HERE', 'NICHT BETRETEN', 'HIER ANHEBEN', 'HIER NICHT SCHIEBEN', 'D-1234', 'D-EABC', 'D-KXYZ', 'N1234A', 'G-ABCD', 'HB-1234', 'OE-1234'];

  root.DecalLib = { MOTIFS, BY, build, defaults, TEXTS, _g: { circle, rect, star, plus, clipConvex, offsetPoly, area, quad, tf } };
})(typeof window !== 'undefined' ? window : globalThis);
