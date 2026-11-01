/* rproSchnitte.js — Reiter „Rumpf Schnittspanten" (Feature „rproSchnitte", braucht „rumpfpro").
 * Leitet aus dem Rumpf (window.RumpfPro.api()) bzw. einem eigenen STL-Rumpf (StlBody) Bauteile aus FREI
 * gelegten Schnittebenen ab — Kiel, Seitenwände, Böden, Decks, schräge Spanten, Kreuzgitter:
 *   - Schnittlage „senkrecht längs" (parallel zur Seitenansicht, Linie in der Draufsicht) oder „waagrecht"
 *     (parallel zur Draufsicht, Linie in der Seitenansicht), jeweils mit Winkel (±90° = Querschnitt/Spant);
 *     in beiden Ansichten mit der Maus verschieben (Linie ziehen) und drehen (runder Griff)
 *   - Abzug für die Rumpfwand: geschnitten wird die um die Wandstärke nach innen versetzte Rumpffläche
 *     (Versatz senkrecht zur Oberfläche — auch bei schleifendem Schnitt maßhaltig)
 *   - Überschneidungen zweier Teile: Kreuzverzapfung (Steckschlitze je halbe Länge) oder „stößt an":
 *     Teil gestutzt an der Fläche des anderen, mit Zapfen und Zapfenlöchern; Überstände fallen dabei weg
 *   - Ausschnitte je Teil in der CAD-Bearbeitung zeichnen (alle CAD-Werkzeuge) und zurückübernehmen
 *   - Ausgabe: geschachteltes DXF, Stückliste (CSV), Übergabe aller Teile in die CAD-Bearbeitung
 * Teilekoordinaten: Ebene mit Ursprung O und Achsen e1/e2 (planeOf); die Bauteilstärke liegt mittig zur Ebene.
 * Andere Module rufen nur geschützt (App.rpssSidebar && …, window.RproSchnitte).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10;
  const RAD = Math.PI / 180;
  const PAL = ['#ffb454', '#57d38c', '#c78bff', '#ff6b6b', '#3ad2c9', '#f5c35c', '#ff7aa8', '#8fd14f', '#6fa8ff'];

  // ---------- Konfiguration --------------------------------------------------------------
  const DEF = {
    from: 'rpro',              // 'rpro' Reiter „Rumpf" | 'stl' eigenes STL-Modell
    src: 'body',               // 'body' nur Rumpf | 'all' mit Anbauten
    wall: 1.5,                 // Abzug für die Rumpfwand (mm, senkrecht zur Oberfläche)
    thick: 3,                  // Materialstärke (mm), je Schnitt überschreibbar
    play: 0.1,                 // Spiel in Schlitzen und Zapfenlöchern (mm)
    mat: 'Pappelsperrholz',    // Werkstoff (Stückliste)
    cuts: [],                  // Schnittlagen {id, name, on, pl 'v'|'h', x, c, ang, mir, thick, wall, holes}
    joints: {},                // je Teilepaar „idA|idB": {mode none|cross|a|b, flip, keep auto|+|-, n, w, over}
    nextId: 1,
    skin: true,                // Rumpfaußenkontur in den Teilen zeigen
    lower: 'all',              // untere Ansicht: 'all' alle Teile | 'sel' nur gewählter
    label: { on: true, h: 5 },
    sheetW: 600, gap: 6
  };
  const JDEF = { mode: 'cross', flip: false, keep: 'auto', n: 2, w: 10, over: 0, both: false, keepO: 'auto' };
  function cfg() {
    let c = state.cfg.rpss;
    if (!c || typeof c !== 'object') c = state.cfg.rpss = JSON.parse(JSON.stringify(DEF));
    for (const k in DEF) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEF[k]));
    for (const q in DEF.label) if (c.label[q] === undefined) c.label[q] = DEF.label[q];
    if (!Array.isArray(c.cuts)) c.cuts = [];
    if (!c.joints || typeof c.joints !== 'object' || Array.isArray(c.joints)) c.joints = {};
    let mx = 0;
    for (const k of c.cuts) { if (!Array.isArray(k.holes)) k.holes = []; if (k.id == null) k.id = 0; mx = Math.max(mx, k.id); }
    for (const k of c.cuts) if (!k.id) k.id = ++mx;
    if (!(c.nextId > mx)) c.nextId = mx + 1;
    return c;
  }
  const thickOf = k => k.thick != null && k.thick > 0 ? +k.thick : Math.max(0.1, +cfg().thick || 3);
  const wallOf = k => k.wall != null && k.wall >= 0 ? +k.wall : Math.max(0, +cfg().wall || 0);

  // ---------- Vektoren / Polygone ([{x,y}], geschlossen, ohne Wiederholung des Startpunkts) ----------
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const P = (x, y) => ({ x, y });
  function area(L) { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
  function dedupe(L, eps) { const o = []; for (const p of L) { const q = o[o.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) > eps) o.push(p); } while (o.length > 2 && Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y) <= eps) o.pop(); return o; }
  function bbox(list) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const L of list) for (const p of L) { a = Math.min(a, p.x); b = Math.min(b, p.y); c = Math.max(c, p.x); d = Math.max(d, p.y); } return { minx: a, miny: b, maxx: c, maxy: d, w: c - a, h: d - b }; }
  function inPoly(p, L) { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; }
  function inRegion(p, R) { let c = false; for (const L of R) if (inPoly(p, L)) c = !c; return c; }
  // Offene Halbkontur [[y,z],…] nach Bogenlänge auf n Punkte verteilen.
  function resampleOpen(H, n) {
    const cum = [0]; for (let i = 1; i < H.length; i++) cum.push(cum[i - 1] + Math.hypot(H[i][0] - H[i - 1][0], H[i][1] - H[i - 1][1]));
    const tot = cum[cum.length - 1], out = []; let j = 0;
    for (let k = 0; k < n; k++) {
      const s = tot * k / (n - 1); while (j < H.length - 2 && cum[j + 1] < s) j++;
      const d = cum[j + 1] - cum[j], t = d > 1e-12 ? clamp((s - cum[j]) / d, 0, 1) : 0, p = H[j], q = H[Math.min(j + 1, H.length - 1)];
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
    return out;
  }
  function segX(a, b, c, d) {
    const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y }, den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den, u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
    return (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) ? { t, p: P(a.x + r.x * t, a.y + r.y * t) } : null;
  }
  // Selbstüberschneidungen (Falten der Innenfläche) entfernen: an jeder Kreuzung die kleinere Schlaufe weg.
  function deloop(L) {
    for (let guard = 0; guard < 200; guard++) {
      const n = L.length; let hit = null;
      outer: for (let i = 0; i < n; i++) {
        const a = L[i], b = L[(i + 1) % n], x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const c = L[j], d = L[(j + 1) % n];
          if (Math.max(c.x, d.x) < x0 || Math.min(c.x, d.x) > x1 || Math.max(c.y, d.y) < y0 || Math.min(c.y, d.y) > y1) continue;
          const x = segX(a, b, c, d); if (x) { hit = { i, j, p: x.p }; break outer; }
        }
      }
      if (!hit) return L;
      const A = [hit.p].concat(L.slice(hit.i + 1, hit.j + 1)), B = L.slice(hit.j + 1).concat(L.slice(0, hit.i + 1), [hit.p]);
      L = Math.abs(area(A)) > Math.abs(area(B)) ? A : B;
    }
    return L;
  }
  // Halbebene f(p) >= 0 (nur für Flächenvergleiche)
  function clipHalf(L, f) {
    const out = [];
    for (let i = 0; i < L.length; i++) {
      const p = L[i], q = L[(i + 1) % L.length], fp = f(p), fq = f(q);
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push(P(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t)); }
    }
    return out;
  }
  // Douglas-Peucker auf einer geschlossenen Kontur
  function rdp(L, tol) {
    const n = L.length; if (n < 8) return L;
    let far = 0, fd = -1; for (let i = 1; i < n; i++) { const d = Math.hypot(L[i].x - L[0].x, L[i].y - L[0].y); if (d > fd) { fd = d; far = i; } }
    const keep = new Uint8Array(n); keep[0] = keep[far] = 1;
    const run = (i0, i1) => {
      const st = [[i0, i1]];
      while (st.length) {
        const [a, b] = st.pop(), A = L[a % n], B = L[b % n], dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy) || 1e-12;
        let bi = -1, bd = tol;
        for (let i = a + 1; i < b; i++) { const p = L[i % n], d = Math.abs((p.x - A.x) * dy - (p.y - A.y) * dx) / l; if (d > bd) { bd = d; bi = i; } }
        if (bi >= 0) { keep[bi % n] = 1; st.push([a, bi], [bi, b]); }
      }
    };
    run(0, far); run(far, n);
    return L.filter((p, i) => keep[i]);
  }
  // Umlaufsinn nach Verschachtelung: außen gegen den Uhrzeigersinn, Löcher im Uhrzeigersinn
  function orient(R) {
    return R.map((L, i) => {
      let depth = 0; for (let j = 0; j < R.length; j++) if (j !== i && inPoly(L[0], R[j])) depth++;
      const want = depth % 2 ? -1 : 1;
      return Math.sign(area(L)) === want ? L : L.slice().reverse();
    });
  }

  // ---------- Polygon-Boolean (Kantenzerlegung + Klassifizierung, gerade/ungerade-Regel) -------------
  // Region = Liste geschlossener Konturen. op: 'diff' (A − B) | 'and' | 'or'. B wird um wenige µm versetzt,
  // damit keine Ecke genau auf einer Kante liegt (die einzige Entartung, die diese Methode stört).
  function boolOp(A, B, op) {
    A = orient(A.filter(L => L.length >= 3 && Math.abs(area(L)) > 1e-9));
    B = orient(B.filter(L => L.length >= 3 && Math.abs(area(L)) > 1e-9)).map(L => L.map(p => P(p.x + 1.7e-5, p.y + 1.1e-5)));
    if (!B.length) return op === 'and' ? [] : A;
    if (!A.length) return op === 'or' ? B : [];
    const ba = bbox(A), bb = bbox(B);
    if (ba.maxx < bb.minx || bb.maxx < ba.minx || ba.maxy < bb.miny || bb.maxy < ba.miny) return op === 'and' ? [] : op === 'or' ? A.concat(B) : A;
    const edges = R => { const E = []; for (const L of R) for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; E.push({ a, b, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), cuts: [] }); } return E; };
    const EA = edges(A), EB = edges(B);
    for (const ea of EA) for (const eb of EB) {
      if (ea.x1 < eb.x0 || eb.x1 < ea.x0 || ea.y1 < eb.y0 || eb.y1 < ea.y0) continue;
      const r = { x: ea.b.x - ea.a.x, y: ea.b.y - ea.a.y }, s = { x: eb.b.x - eb.a.x, y: eb.b.y - eb.a.y }, den = r.x * s.y - r.y * s.x;
      if (Math.abs(den) < 1e-15) continue;
      const t = ((eb.a.x - ea.a.x) * s.y - (eb.a.y - ea.a.y) * s.x) / den, u = ((eb.a.x - ea.a.x) * r.y - (eb.a.y - ea.a.y) * r.x) / den;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;   // halboffen: Kreuzung genau in einer Ecke zählt einmal
      const p = P(ea.a.x + r.x * t, ea.a.y + r.y * t);
      ea.cuts.push({ t, p }); eb.cuts.push({ t: u, p });
    }
    const pieces = E => { const out = []; for (const e of E) { const pts = [e.a].concat(e.cuts.sort((m, n) => m.t - n.t).map(q => q.p), [e.b]); for (let i = 0; i + 1 < pts.length; i++) if (pts[i] !== pts[i + 1] && Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) > 1e-12) out.push([pts[i], pts[i + 1]]); } return out; };
    const mid = s => P((s[0].x + s[1].x) / 2, (s[0].y + s[1].y) / 2);
    const keep = [];
    for (const s of pieces(EA)) { const inB = inRegion(mid(s), B); if (op === 'and' ? inB : !inB) keep.push(s); }
    for (const s of pieces(EB)) { const inA = inRegion(mid(s), A); if (op === 'diff') { if (inA) keep.push([s[1], s[0]]); } else if (op === 'and' ? inA : !inA) keep.push(s); }
    // gerichtet verketten
    const key = p => Math.round(p.x * 1e6) + ',' + Math.round(p.y * 1e6), from = new Map();
    keep.forEach((s, i) => { const k = key(s[0]); let l = from.get(k); if (!l) from.set(k, (l = [])); l.push(i); });
    const used = new Uint8Array(keep.length), loops = [];
    for (let i = 0; i < keep.length; i++) {
      if (used[i]) continue; used[i] = 1;
      const L = [keep[i][0]], k0 = key(keep[i][0]); let cur = keep[i];
      for (let g = 0; g < keep.length; g++) {
        L.push(cur[1]); const k = key(cur[1]); if (k === k0) break;
        const j = (from.get(k) || []).find(q => !used[q]); if (j == null) break;
        used[j] = 1; cur = keep[j];
      }
      if (L.length > 2 && key(L[L.length - 1]) === k0) L.pop();
      const D = dedupe(L, 1e-7); if (D.length >= 3 && Math.abs(area(D)) > 1e-6) loops.push(D);
    }
    return orient(loops);
  }

  // ---------- Rumpfoberfläche: Gitter, Innenfläche (Wandabzug), Dreiecke, ebener Schnitt ---------------
  const memo = { m: null, src: '', G: null, inner: new Map(), tris: new Map(), sec: new Map() };
  function srcApi() {
    if (cfg().from === 'stl') return (window.StlBody && StlBody.api && StlBody.api()) || null;
    return (window.RumpfPro && RumpfPro.api && RumpfPro.api()) || null;
  }
  // Gitter G[a][b] = [x, y, z] (a = Umfang oben -> unten, z >= 0; b = Längsrichtung)
  function outerGrid(api, src) {
    const m = api.model || api;
    if (memo.m !== m || memo.src !== src) { memo.m = m; memo.src = src; memo.G = null; memo.inner = new Map(); memo.tris = new Map(); memo.sec = new Map(); }
    if (memo.G) return memo.G;
    let G = null;
    if (src === 'all' && api.model && Array.isArray(api.model.G) && api.model.G.length > 2) G = api.model.G;
    else {
      const NB = 181, K = 97; G = []; for (let a = 0; a < K; a++) G.push(new Array(NB));
      for (let b = 0; b < NB; b++) {
        const x = api.x0 + (api.x1 - api.x0) * (1 - Math.cos(Math.PI * b / (NB - 1))) / 2;
        let H = null; try { H = api.bodyHalf(x); } catch (e) { H = null; }
        if (!H || H.length < 2) { const bx = api.box(x), y = (bx.top + bx.bot) / 2; H = [[y, 0], [y, 0]]; }
        const R = resampleOpen(H, K);
        for (let a = 0; a < K; a++) G[a][b] = [x, R[a][0], a === 0 || a === K - 1 ? 0 : Math.max(0, R[a][1])];
      }
    }
    return (memo.G = G);
  }
  // Innenfläche: jeder Gitterpunkt um w entlang der Flächennormalen nach innen (Nase/Heck: zur Nachbarspalte).
  function innerGrid(G, w) {
    if (!(w > 1e-6)) return G;
    const key = Math.round(w * 1000); if (memo.inner.has(key)) return memo.inner.get(key);
    const K = G.length, NB = G[0].length;
    const nrm = (a, b) => {
      const A = G[Math.min(a + 1, K - 1)][b], B = G[Math.max(a - 1, 0)][b], C = G[a][Math.min(b + 1, NB - 1)], D = G[a][Math.max(b - 1, 0)];
      return cross3(sub3(A, B), sub3(C, D));
    };
    // Vorzeichen „außen" einmal an der breitesten Stelle bestimmen (Gitter ist einheitlich parametrisiert)
    let ra = 0, rb = 0, rz = -1;
    for (let b = 0; b < NB; b++) for (let a = 0; a < K; a++) if (G[a][b][2] > rz) { rz = G[a][b][2]; ra = a; rb = b; }
    const sgn = nrm(ra, rb)[2] >= 0 ? 1 : -1;
    const out = [];
    for (let a = 0; a < K; a++) {
      const row = new Array(NB);
      for (let b = 0; b < NB; b++) {
        const p = G[a][b], n = nrm(a, b), l = Math.hypot(n[0], n[1], n[2]);
        let d;
        if (l > 1e-10) d = [-sgn * n[0] / l, -sgn * n[1] / l, -sgn * n[2] / l];
        else {
          const bb = b < NB / 2 ? Math.min(b + 1, NB - 1) : Math.max(b - 1, 0), yc = (G[0][bb][1] + G[K - 1][bb][1]) / 2;
          d = norm3(sub3([G[a][bb][0], yc, 0], p));
        }
        const q = [p[0] + w * d[0], p[1] + w * d[1], p[2] + w * d[2]];
        q[2] = a === 0 || a === K - 1 ? 0 : Math.max(0, q[2]);
        row[b] = q;
      }
      out.push(row);
    }
    memo.inner.set(key, out);
    return out;
  }
  // Dreiecksnetz beider Rumpfhälften (gespiegelt an z = 0)
  function trisOf(G) {
    if (memo.tris.has(G)) return memo.tris.get(G);
    const K = G.length, NB = G[0].length, v = new Float64Array((K - 1) * (NB - 1) * 36); let o = 0;
    const put = (p, s) => { v[o++] = p[0]; v[o++] = p[1]; v[o++] = p[2] * s; };
    for (const s of [1, -1]) for (let a = 0; a + 1 < K; a++) for (let b = 0; b + 1 < NB; b++) {
      const p00 = G[a][b], p01 = G[a][b + 1], p10 = G[a + 1][b], p11 = G[a + 1][b + 1];
      put(p00, s); put(p10, s); put(p11, s); put(p00, s); put(p11, s); put(p01, s);
    }
    memo.tris.set(G, v);
    return v;
  }
  // Schnittstrecken Netz × Ebene (3D). Kantenpunkte in fester Reihenfolge gerechnet -> bitgleich in beiden Nachbardreiecken.
  function slice(v, pl) {
    const n = pl.n, d0 = dot3(n, pl.O), segs = [];
    const pt = (ia, ib, da, db) => {
      if (da === 0) return [v[ia], v[ia + 1], v[ia + 2]];
      if (db === 0) return [v[ib], v[ib + 1], v[ib + 2]];
      if (v[ia] > v[ib] || (v[ia] === v[ib] && (v[ia + 1] > v[ib + 1] || (v[ia + 1] === v[ib + 1] && v[ia + 2] > v[ib + 2])))) { const t = ia; ia = ib; ib = t; const u = da; da = db; db = u; }
      const t = da / (da - db);
      return [v[ia] + (v[ib] - v[ia]) * t, v[ia + 1] + (v[ib + 1] - v[ia + 1]) * t, v[ia + 2] + (v[ib + 2] - v[ia + 2]) * t];
    };
    const d = [0, 0, 0], ng = [false, false, false];
    for (let i = 0; i < v.length; i += 9) {
      for (let e = 0; e < 3; e++) { const o = i + 3 * e; d[e] = n[0] * v[o] + n[1] * v[o + 1] + n[2] * v[o + 2] - d0; ng[e] = d[e] < 0; }
      if (ng[0] === ng[1] && ng[1] === ng[2]) continue;
      const Q = [];
      for (let e = 0; e < 3; e++) { const f = (e + 1) % 3; if (ng[e] !== ng[f]) Q.push(pt(i + 3 * e, i + 3 * f, d[e], d[f])); }
      if (Q.length === 2 && (Q[0][0] !== Q[1][0] || Q[0][1] !== Q[1][1] || Q[0][2] !== Q[1][2])) segs.push(Q);
    }
    return segs;
  }
  // Strecken zu Linienzügen verketten (ungerichtet); offene Züge (offenes Heck) werden gerade geschlossen.
  function chain3(segs) {
    const K = p => Math.round(p[0] * 1e5) + ',' + Math.round(p[1] * 1e5) + ',' + Math.round(p[2] * 1e5);
    const keys = segs.map(s => [K(s[0]), K(s[1])]), adj = new Map();
    segs.forEach((s, i) => { if (keys[i][0] === keys[i][1]) return; for (const e of [0, 1]) { let l = adj.get(keys[i][e]); if (!l) adj.set(keys[i][e], (l = [])); l.push(i); } });
    const used = new Uint8Array(segs.length), loops = [];
    const walk = (startKey, acc) => {
      let cur = startKey;
      for (;;) {
        const j = (adj.get(cur) || []).find(q => !used[q]); if (j == null) return cur;
        used[j] = 1; const e = keys[j][0] === cur ? 1 : 0; acc.push(segs[j][e]); cur = keys[j][e];
      }
    };
    for (let i = 0; i < segs.length; i++) {
      if (used[i] || keys[i][0] === keys[i][1]) continue; used[i] = 1;
      const fwd = [segs[i][1]], bwd = [];
      const end = walk(keys[i][1], fwd);
      if (end !== keys[i][0]) walk(keys[i][0], bwd);
      const L = bwd.reverse().concat([segs[i][0]], fwd);
      if (L.length > 2 && K(L[0]) === K(L[L.length - 1])) L.pop();
      if (L.length >= 3) loops.push(L);
    }
    return loops;
  }
  // Ebene einer Schnittlage: Ursprung O, Normale n, Teileachsen e1/e2 (Teil liegt „natürlich": längs wie in der
  // Ansicht, steile Lagen wie ein Spant mit Y nach oben). mir = an der Symmetrieebene gespiegelt.
  function planeOf(k, mir) {
    const ang = clamp(+k.ang || 0, -90, 90), a = ang * RAD, ca = Math.cos(a), sa = Math.sin(a), steep = Math.abs(ang) > 45;
    let O, n, e1, e2, D;
    if (k.pl === 'h') {
      O = [+k.x || 0, +k.c || 0, 0]; D = [ca, sa, 0]; n = [-sa, ca, 0];
      if (steep) { e1 = [0, 0, 1]; e2 = sa >= 0 ? D : [-ca, -sa, 0]; } else { e1 = D; e2 = [0, 0, 1]; }
    } else {
      O = [+k.x || 0, 0, +k.c || 0]; D = [ca, 0, sa]; n = [-sa, 0, ca];
      e1 = steep && sa < 0 ? [-ca, 0, -sa] : D; e2 = [0, 1, 0];
    }
    if (mir) { const M = v => [v[0], v[1], -v[2]]; O = M(O); D = M(D); n = M(n); e1 = M(e1); e2 = M(e2); }
    return { O, n, e1, e2, D };
  }
  const to2 = (pl, p) => { const q = sub3(p, pl.O); return P(dot3(q, pl.e1), dot3(q, pl.e2)); };
  const to3 = (pl, p) => [pl.O[0] + p.x * pl.e1[0] + p.y * pl.e2[0], pl.O[1] + p.x * pl.e1[1] + p.y * pl.e2[1], pl.O[2] + p.x * pl.e1[2] + p.y * pl.e2[2]];
  // Querschnitt einer Schnittlage in Teilekoordinaten (Rumpf symmetrisch -> gespiegelte Lage hat dieselbe 2D-Kontur)
  function sectionOf(G, k, wall) {
    const key = [k.pl, +k.x || 0, +k.c || 0, +k.ang || 0, Math.round(wall * 1000)].join('|');
    if (memo.sec.has(key)) return memo.sec.get(key);
    const pl = planeOf(k, false), Gi = innerGrid(G, wall);
    let R = chain3(slice(trisOf(Gi), pl)).map(L => L.map(p => to2(pl, p)));
    R = R.map(L => deloop(dedupe(rdp(dedupe(L, 1e-6), 0.01), 1e-4))).filter(L => L.length >= 3 && Math.abs(area(L)) > 1);
    R = orient(R);
    if (memo.sec.size > 400) memo.sec.clear();
    memo.sec.set(key, R);
    return R;
  }

  // ---------- Verbindungen: Schnittgerade zweier Ebenen, Intervalle, Schlitze/Zapfen ----------------------
  function jointLine(pa, pb) {
    const dir = cross3(pa.n, pb.n), s = Math.hypot(dir[0], dir[1], dir[2]); if (s < 0.02) return null;   // (nahezu) parallel
    const d = [dir[0] / s, dir[1] / s, dir[2] / s], da = dot3(pa.n, pa.O), db = dot3(pb.n, pb.O), nn = dot3(pa.n, pb.n), den = 1 - nn * nn;
    const c1 = (da - db * nn) / den, c2 = (db - da * nn) / den;
    return { P0: [c1 * pa.n[0] + c2 * pb.n[0], c1 * pa.n[1] + c2 * pb.n[1], c1 * pa.n[2] + c2 * pb.n[2]], d, sin: s };
  }
  // Rahmen der Schnittgeraden im Teil p (Partner q): Punkt bei Parameter t (3D-Länge längs der Geraden) und
  // Abstand h quer dazu in der Teilebene, + in Richtung der Normalen des Partners. 3D-Abstand zur Partnerebene = h·sin.
  function frameOf(p, q, jl) {
    const o = to2(p.pl, jl.P0), d = P(dot3(jl.d, p.pl.e1), dot3(jl.d, p.pl.e2));
    let m = P(dot3(p.pl.e1, q.pl.n), dot3(p.pl.e2, q.pl.n)); const lm = Math.hypot(m.x, m.y) || 1; m = P(m.x / lm, m.y / lm);
    return { o, d, m, at: (t, h) => P(o.x + d.x * t + m.x * h, o.y + d.y * t + m.y * h) };
  }
  const rectTH = (F, t0, t1, h0, h1) => [F.at(t0, h0), F.at(t1, h0), F.at(t1, h1), F.at(t0, h1)];
  // Abschnitte der Geraden innerhalb der Region (Parameter t)
  function lineIv(R, F) {
    const ts = [];
    for (const L of R) for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length];
      const sa = F.d.x * (a.y - F.o.y) - F.d.y * (a.x - F.o.x), sb = F.d.x * (b.y - F.o.y) - F.d.y * (b.x - F.o.x);
      if ((sa > 0) === (sb > 0)) continue;
      const u = sa / (sa - sb), px = a.x + (b.x - a.x) * u, py = a.y + (b.y - a.y) * u;
      ts.push((px - F.o.x) * F.d.x + (py - F.o.y) * F.d.y);
    }
    ts.sort((a, b) => a - b);
    const out = []; for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 1e-6) out.push([ts[i], ts[i + 1]]);
    return out;
  }
  function overlaps(IA, IB, minLen) {
    const out = [];
    for (const a of IA) for (const b of IB) { const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]); if (hi - lo > (minLen || 0.5)) out.push({ lo, hi, a, b }); }
    return out;
  }
  const baseId = p => p.k.id;
  const ordered = (A, B) => (A.k.id < B.k.id || (A.k.id === B.k.id && !A.mir)) ? [A, B] : [B, A];
  const jointKey = (A, B) => { const [a, b] = ordered(A, B); return a.k.id + '|' + b.k.id; };
  function jointCfg(key) { return Object.assign({}, JDEF, cfg().joints[key] || {}); }
  function jointCfgW(key) { const c = cfg(); if (!c.joints[key]) c.joints[key] = Object.assign({}, JDEF); return c.joints[key]; }
  // Seite der Partnerebene benennen (für „verbleibende Seite")
  function sideName(q, s) {
    const n = q.pl.n.map(v => v * s), ax = [0, 1, 2].reduce((m, i) => Math.abs(n[i]) > Math.abs(n[m]) ? i : m, 0), pos = n[ax] > 0;
    return T(ax === 0 ? (pos ? 'hinten (+X)' : 'vorne (−X)') : ax === 1 ? (pos ? 'oben (+Y)' : 'unten (−Y)') : (pos ? 'Seite +Z' : 'Seite −Z'));
  }

  // ---------- Bauteile aufbauen ---------------------------------------------------------------------
  let cache = null, cacheKey = null;
  function parts() {
    const api = srcApi(); if (!api) return null;
    const c = cfg(), G = outerGrid(api, c.from !== 'stl' && c.src === 'all' ? 'all' : 'body'), warn = [];
    // Umrisse für Seiten-/Draufsicht
    const K = G.length, NB = G[0].length, sil = { side: { up: [], lo: [] }, top: { up: [], lo: [] } };
    for (let b = 0; b < NB; b++) {
      let y0 = Infinity, y1 = -Infinity, z1 = 0; const x = G[0][b][0];
      for (let a = 0; a < K; a++) { const p = G[a][b]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; if (p[2] > z1) z1 = p[2]; }
      sil.side.up.push(P(x, y1)); sil.side.lo.push(P(x, y0)); sil.top.up.push(P(x, z1)); sil.top.lo.push(P(x, -z1));
    }
    const list = [];
    c.cuts.forEach((k, idx) => {
      if (!k.on) return;
      for (const mir of (k.mir && k.pl === 'v' ? [false, true] : [false]))
        list.push({ k, idx, mir, key: k.id + (mir ? 'm' : ''), name: (k.name || ('#' + k.id)) + (mir ? '′' : ''), pl: planeOf(k, mir), col: PAL[idx % PAL.length], t: thickOf(k), wall: wallOf(k), marks: [], add: [], sub: [], info: [] });
    });
    for (const p of list) {
      p.R0 = sectionOf(G, p.k, p.wall); p.R1 = p.R0;
      p.skin = c.skin && p.wall > 0 ? sectionOf(G, p.k, 0) : null;
      if (!p.R0.length) warn.push(p.name + ': ' + T('Schnittebene trifft den Rumpf nicht (oder nur die Wand).'));
    }
    // Paare mit Überschneidung
    const J = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [A, B] = ordered(list[i], list[j]);
      if (!A.R0.length || !B.R0.length) continue;
      const jl = jointLine(A.pl, B.pl); if (!jl) continue;
      const FA = frameOf(A, B, jl), FB = frameOf(B, A, jl);
      const ov = overlaps(lineIv(A.R0, FA), lineIv(B.R0, FB));
      if (!ov.length) continue;
      const key = jointKey(A, B);
      J.push({ A, B, jl, FA, FB, key, cj: jointCfg(key), len: ov.reduce((s, o) => s + o.hi - o.lo, 0) });
    }
    // Phase 1: stutzen („stößt an"): Teil P endet an der Fläche des Partners Q
    const BIG = 1e5;
    for (const j of J) {
      if (j.cj.mode !== 'a' && j.cj.mode !== 'b') continue;
      const [Pp, Q, F] = j.cj.mode === 'a' ? [j.A, j.B, j.FA] : [j.B, j.A, j.FB];
      const sideOf = (R, Fr, keep) => {
        if (keep === '+') return 1; if (keep === '-') return -1;
        const f = p => (p.x - Fr.o.x) * Fr.m.x + (p.y - Fr.o.y) * Fr.m.y;
        const ap = R.reduce((t, L) => t + area(clipHalf(L, f)), 0), an = R.reduce((t, L) => t + area(clipHalf(L, p => -f(p))), 0);
        return ap >= an ? 1 : -1;
      };
      const FQ = Pp === j.A ? j.FB : j.FA, s = sideOf(Pp.R0, F, j.cj.keep);
      const hf = Q.t / 2 / j.jl.sin;
      Pp.R1 = boolOp(Pp.R1, [rectTH(F, -BIG, BIG, s > 0 ? hf : -BIG, s > 0 ? BIG : -hf)], 'and');
      j.trim = { P: Pp, Q, s, F, FQ };
      if (!Pp.R1.length) warn.push(Pp.name + ': ' + T('nach dem Stutzen bleibt nichts übrig — andere Seite wählen.'));
      // Partner ebenfalls stutzen (Kastenecke): Q endet bündig mit der Außenseite von P, die Zapfenlöcher werden zu Kerben
      if (j.cj.both) {
        const sq = sideOf(Q.R0, FQ, j.cj.keepO), hp = Pp.t / 2 / j.jl.sin;
        Q.R1 = boolOp(Q.R1, [rectTH(FQ, -BIG, BIG, sq > 0 ? -hp : -BIG, sq > 0 ? BIG : hp)], 'and');
        if (!Q.R1.length) warn.push(Q.name + ': ' + T('nach dem Stutzen bleibt nichts übrig — andere Seite wählen.'));
      }
    }
    // Phase 2: Schlitze, Zapfen, Zapfenlöcher, Markierungen
    const play = Math.max(0, +c.play || 0);
    const markBand = (p, F, lo, hi, tq, sin) => { const h = tq / 2 / sin; p.marks.push([F.at(lo, -h), F.at(hi, -h)], [F.at(lo, h), F.at(hi, h)]); };
    for (const j of J) {
      const { A, B, cj } = j;
      if (j.trim) {
        const { P: Pp, Q, s, F, FQ } = j.trim, sin = j.jl.sin;
        const ov = overlaps(lineIv(Pp.R0, F), lineIv(Q.R1, FQ), 1);
        const w = Math.max(1, +cj.w || 10), nmax = Math.max(0, Math.round(+cj.n || 0)), over = Math.max(0, +cj.over || 0);
        let nT = 0;
        for (const o of ov) {
          markBand(Q, FQ, o.lo, o.hi, Pp.t, sin);
          const L = o.hi - o.lo; let nk = Math.min(nmax, Math.floor(L / (2 * w))); if (nmax > 0 && nk < 1 && L >= 1.3 * w) nk = 1;
          for (let i = 0; i < nk; i++) {
            const tk = o.lo + L * (i + 0.5) / nk;
            const g0 = s * (Q.t / 2 + 1), g1 = -s * (Q.t / 2 + over);
            Pp.add.push(rectTH(F, tk - w / 2, tk + w / 2, Math.min(g0, g1) / sin, Math.max(g0, g1) / sin));
            const hq = (Pp.t + play) / 2 / sin;
            Q.sub.push(rectTH(FQ, tk - (w + play) / 2, tk + (w + play) / 2, -hq, hq));
            nT++;
          }
        }
        j.info = nT ? nT + ' ' + T('Zapfen') : T('nur gestutzt');
        continue;
      }
      const ov = overlaps(lineIv(A.R1, j.FA), lineIv(B.R1, j.FB));
      for (const o of ov) { markBand(A, j.FA, o.lo, o.hi, B.t, j.jl.sin); markBand(B, j.FB, o.lo, o.hi, A.t, j.jl.sin); }
      if (cj.mode !== 'cross') { j.info = ov.length ? T('ohne Verbindung — Teile durchdringen sich') : ''; continue; }
      let n = 0;
      for (const o of ov) {
        const m = (o.lo + o.hi) / 2, wA = (B.t + play) / 2 / j.jl.sin, wB = (A.t + play) / 2 / j.jl.sin;
        const eA = 2 + 4 * wA, eB = 2 + 4 * wB;
        // Schlitz öffnet am Rand des Teils; Richtung mit dem kleineren Verschnitt (oder getauscht)
        let dir = ((o.lo - o.a[0]) + (o.b[1] - o.hi)) <= ((o.a[1] - o.hi) + (o.lo - o.b[0])) ? 1 : 2;
        if (cj.flip) dir = 3 - dir;
        if (dir === 1) { A.sub.push(rectTH(j.FA, o.a[0] - eA, m, -wA, wA)); B.sub.push(rectTH(j.FB, m, o.b[1] + eB, -wB, wB)); }
        else { A.sub.push(rectTH(j.FA, m, o.a[1] + eA, -wA, wA)); B.sub.push(rectTH(j.FB, o.b[0] - eB, m, -wB, wB)); }
        n++;
      }
      j.info = n ? T('Kreuzverzapfung') + (n > 1 ? ' ×' + n : '') : '';
    }
    // Phase 3: zusammensetzen — Zapfen dazu, Schlitze/Löcher/Ausschnitte weg
    for (const p of list) {
      let R = p.R1;
      for (const r of p.add) R = boolOp(R, [r], 'or');
      for (const r of p.sub) R = boolOp(R, [r], 'diff');
      p.Rj = R;
      const holes = (p.k.holes || []).filter(L => L.length >= 3).map(L => L.map(q => P(+q.x, +q.y)));
      if (holes.length) R = boolOp(R, holes, 'diff');
      p.R = R;
      if (p.R0.length && !R.length) warn.push(p.name + ': ' + T('kein Material übrig.'));
      const nOut = R.filter(L => area(L) > 0).length;
      if (nOut > 1) warn.push(p.name + ': ' + T('zerfällt in') + ' ' + nOut + ' ' + T('Stücke — Verbindung ändern (z. B. „stößt an")'));
      p.area = R.reduce((s, L) => s + area(L), 0);
    }
    return { api, G, sil, parts: list, joints: J, warn };
  }
  // Regal-Anordnung auf Plattenbreite sheetW.
  function layout(list) {
    const c = cfg(), W = Math.max(50, +c.sheetW || 600), gap = Math.max(0, +c.gap || 0), lab = c.label.on ? (+c.label.h || 5) + 3 : 0;
    const items = list.filter(p => p.R.length).map(p => ({ p, bb: bbox(p.R) })).sort((a, b) => b.bb.h - a.bb.h);
    let x = 0, y = 0, rowH = 0;
    for (const it of items) {
      if (x > 0 && x + it.bb.w > W) { x = 0; y -= rowH + gap + lab; rowH = 0; }
      it.p.ox = x - it.bb.minx; it.p.oy = y - it.bb.maxy; it.p.bb = it.bb;
      x += it.bb.w + gap; rowH = Math.max(rowH, it.bb.h);
    }
    return { W, H: -y + rowH + lab };
  }
  const place = (p, L) => L.map(q => P(q.x + p.ox, q.y + p.oy));
  function build() {
    try {
      const api = srcApi(), key = api ? JSON.stringify(cfg()) : '';
      if (api && cache && cacheKey && cacheKey.m === (api.model || api) && cacheKey.s === key) return cache;
      const r = parts(); if (r) r.lay = layout(r.parts); cache = r; cacheKey = api ? { m: api.model || api, s: key } : null;
    } catch (e) { console.error(e); cache = { err: e.message }; cacheKey = null; }
    return cache;
  }

  // ---------- Ausgabe ------------------------------------------------------------------------------
  const partLabel = p => p.name + '  ' + r1(p.t) + ' mm';
  const planeText = k => (k.pl === 'v' ? T('senkrecht längs') + ' Z ' : T('waagrecht') + ' Y ') + r1(+k.c || 0) + ' · X ' + r1(+k.x || 0) + (k.ang ? ' · ' + r1(k.ang) + '°' : '');
  function dxf(r) {
    const c = cfg(), L = ['0', 'SECTION', '2', 'ENTITIES'];
    const pl = (lay, pts, closed) => { L.push('0', 'LWPOLYLINE', '8', lay, '90', String(pts.length), '70', closed ? '1' : '0'); for (const q of pts) L.push('10', q.x.toFixed(4), '20', q.y.toFixed(4)); };
    for (const p of r.parts) {
      if (!p.R.length) continue;
      p.R.forEach(R => pl(area(R) > 0 ? 'TEIL' : 'AUSSCHNITT', place(p, R), true));
      p.marks.forEach(M => pl('MARKIERUNG', place(p, M), false));
      if (c.label.on) L.push('0', 'TEXT', '8', 'BESCHRIFTUNG', '10', (p.bb.minx + p.ox).toFixed(3), '20', (p.bb.miny + p.oy - (+c.label.h || 5) - 2).toFixed(3), '40', String(+c.label.h || 5), '1', partLabel(p));
    }
    L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\n');
  }
  function base() { return ((state.projectName || 'rumpf').replace(/[^\w\-]+/g, '_')) || 'rumpf'; }
  function save(name, data, mime, which) { if (typeof App.download === 'function') App.download(name, data, mime, which); else if (App.anchorDownload) App.anchorDownload(name, data, mime); }
  const toast = m => (App.toast || alert)(m);
  function exportDxf() { const r = build(); if (!r || !r.parts || !r.parts.some(p => p.R.length)) { alert(T('Keine Teile.')); return; } save(base() + '_rumpf_schnittspanten.dxf', dxf(r), 'application/dxf', 'svDxf'); }
  function exportCsv() {
    const r = build(); if (!r || !r.parts) return;
    const c = cfg(), rows = [[T('Teil'), T('Schnittlage'), T('Breite (mm)'), T('Höhe (mm)'), T('Fläche (cm²)'), T('Stärke (mm)'), T('Werkstoff')].join(';')];
    for (const p of r.parts) if (p.R.length) rows.push([p.name, planeText(p.k).replace(/;/g, ','), r1(p.bb.w), r1(p.bb.h), (p.area / 100).toFixed(1), p.t, c.mat].join(';').replace(/(\d)\.(\d)/g, '$1,$2'));
    save(base() + '_rumpf_schnittspanten.csv', '﻿' + rows.join('\r\n'), 'text/csv', 'svCsv');
  }
  const mkLoop = (pts, closed) => { const a = pts.map(p => ({ x: p.x, y: p.y })); a.closed = !!closed; return a; };
  function cadReset() {
    const d = state.cad; d.layers = {}; d.order = []; d.texts = []; d.layerColors = {}; d.layerHidden = {}; d.lineStyles = {};
    return d;
  }
  function cadFinish(active) {
    const d = state.cad; d.edit.active = active || d.order[0] || null; d.edit.sel = []; d.edit.draft = null; d.view = null;
    if (App.nav && App.nav.cad) { App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; }
  }
  function toCad() {
    if (!App.cadEnsureLayer || !App.cadAddEntity) { toast(T('CAD-Bearbeitung nicht verfügbar.')); return; }
    const r = build(); if (!r || !r.parts || !r.parts.some(p => p.R.length)) { toast(T('Keine Teile.')); return; }
    if (App.cadClearAsk && !App.cadClearAsk()) return;
    if (App.cadPushUndo) App.cadPushUndo();
    const d = cadReset(), cf = cfg(), LT = T('Schnittspanten'), LH = T('Ausschnitte'), LM = T('Markierung');
    App.cadEnsureLayer(LT); d.layerColors[LT] = '#ffb454';
    for (const p of r.parts) {
      if (!p.R.length) continue;
      p.R.forEach(R => { const lay = area(R) > 0 ? LT : LH; App.cadEnsureLayer(lay); if (lay === LH) d.layerColors[LH] = '#57d38c'; App.cadAddEntity(lay, mkLoop(place(p, R), true)); });
      if (p.marks.length) { App.cadEnsureLayer(LM); d.lineStyles[LM] = 'dashed'; p.marks.forEach(M => App.cadAddEntity(LM, mkLoop(place(p, M), false))); }
      if (cf.label.on) d.texts.push({ x: p.bb.minx + p.ox, y: p.bb.miny + p.oy - (+cf.label.h || 5) - 2, h: +cf.label.h || 5, text: partLabel(p), rot: 0, layer: T('Beschriftung') });
    }
    if (cf.label.on) App.cadEnsureLayer(T('Beschriftung'));
    cadFinish(LT);
    App.buildSidebar(); if (App.renderCad) App.renderCad();
    (App.cadFlash || toast)(T('Rumpf Schnittspanten geladen: ') + r.parts.filter(p => p.R.length).length + ' ' + T('Teile.'));
  }
  // Ausschnitte eines Teils im CAD zeichnen: Kontur als Bezug, Layer „Ausschnitte" aktiv; Rückweg über takeFromCad.
  function editInCad(id) {
    if (!App.cadEnsureLayer || !App.cadAddEntity || !App.switchView) { toast(T('CAD-Bearbeitung nicht verfügbar.')); return; }
    const r = build(), p = r && r.parts && r.parts.find(q => q.k.id === id && !q.mir);
    if (!p) { toast(T('Schnittlage ist abgeschaltet oder trifft den Rumpf nicht.')); return; }
    if (App.cadClearAsk && !App.cadClearAsk()) return;
    if (App.cadPushUndo) App.cadPushUndo();
    const d = cadReset(), LK = T('Kontur') + ' ' + p.name, LA = T('Ausschnitte'), LM = T('Markierung'), LS = T('Rumpfwand außen');
    App.cadEnsureLayer(LA); d.layerColors[LA] = '#57d38c';
    App.cadEnsureLayer(LK); d.layerColors[LK] = '#ffb454';
    p.Rj.forEach(R => App.cadAddEntity(LK, mkLoop(R, true)));
    if (p.skin) { App.cadEnsureLayer(LS); d.layerColors[LS] = '#8b98a8'; d.lineStyles[LS] = 'dashdot'; p.skin.forEach(R => App.cadAddEntity(LS, mkLoop(R, true))); }
    if (p.marks.length) { App.cadEnsureLayer(LM); d.layerColors[LM] = '#c9a46a'; d.lineStyles[LM] = 'dashed'; p.marks.forEach(M => App.cadAddEntity(LM, mkLoop(M, false))); }
    (p.k.holes || []).forEach(L => App.cadAddEntity(LA, mkLoop(L, true)));
    cadFinish(LA);
    ed.cadLink = { id, layer: LA, name: p.name };
    App.buildSidebar(); App.switchView('cad'); if (App.renderCad) App.renderCad();
    (App.cadFlash || toast)(T('Ausschnitte als geschlossene Konturen auf dem Layer „Ausschnitte" zeichnen, dann links „Ausschnitte übernehmen".'));
  }
  function takeFromCad() {
    const lk = ed.cadLink; if (!lk) return;
    const k = cfg().cuts.find(q => q.id === lk.id);
    if (!k) { ed.cadLink = null; App.buildSidebar(); toast(T('Schnittlage gibt es nicht mehr.')); return; }
    const L = (state.cad && state.cad.layers[lk.layer]) || [];
    const closed = L.filter(l => l.closed && !l.pt && l.length >= 3), open = L.length - closed.length;
    k.holes = closed.map(l => l.map(p => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 })));
    ed.cadLink = null; ed.sel = k.id;
    App.buildSidebar(); App.switchView('rpss'); render();
    toast(k.holes.length + ' ' + T('Ausschnitte übernommen') + (open ? ' · ' + open + ' ' + T('offene Linien ignoriert') : '') + '.');
  }

  // ---------- Darstellung --------------------------------------------------------------------------
  const ed = { sel: null, drag: null, views: {}, partHit: [], cadLink: null };
  const nav = key => (App.nav[key] || (App.nav[key] = { z: 1, ox: 0, oy: 0 }));
  const NAVK = { side: 'rpssSide', top: 'rpssTop' }, CVID = { side: 'cRpssSide', top: 'cRpssTop' };
  const lineView = k => k.pl === 'h' ? 'side' : 'top';   // Ansicht, in der die Lage als Linie erscheint
  const view2 = (which, p3) => which === 'side' ? P(p3[0], p3[1]) : P(p3[0], p3[2]);
  // Gerade C + t·dir an Rechteck b beschneiden (Liang–Barsky)
  function clipLine(C, dir, b) {
    let t0 = -Infinity, t1 = Infinity;
    for (const [p, q] of [[-dir.x, C.x - b.minx], [dir.x, b.maxx - C.x], [-dir.y, C.y - b.miny], [dir.y, b.maxy - C.y]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
      const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    }
    return t1 > t0 ? [t0, t1] : null;
  }
  function renderView(r, which) {
    const cv = document.getElementById(CVID[which]); if (!cv || !App.fitCanvas) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    ed.views[which] = null;
    if (!r || r.err || !r.sil) return;
    const S = r.sil[which], B0 = App.bounds(S.up, S.lo);
    const V = App.makeView(w, h, B0, 34, nav(NAVK[which]));
    if (App.grid) App.grid(ctx, w, h, V);
    const sil = S.up.concat(S.lo.slice().reverse());
    ctx.fillStyle = 'rgba(79,195,247,.07)'; ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1.6; App.poly(ctx, V, sil, true); ctx.fill(); ctx.stroke();
    // Teile der anderen Lagerichtung als Projektion
    for (const p of r.parts) {
      if (lineView(p.k) === which || !p.R.length) continue;
      const sel = ed.sel === p.k.id;
      ctx.strokeStyle = App.hexA ? App.hexA(p.col, sel ? 0.95 : 0.55) : p.col; ctx.fillStyle = App.hexA ? App.hexA(p.col, sel ? 0.16 : 0.07) : 'transparent'; ctx.lineWidth = sel ? 1.8 : 1;
      p.R.forEach(L => { App.poly(ctx, V, L.map(q => view2(which, to3(p.pl, q))), true); ctx.fill(); ctx.stroke(); });
    }
    // Lagen dieser Ansicht als Linien
    const bx = { minx: B0.minx - 0.08 * (B0.maxx - B0.minx), maxx: B0.maxx + 0.08 * (B0.maxx - B0.minx), miny: B0.miny - 0.3 * (B0.maxy - B0.miny), maxy: B0.maxy + 0.3 * (B0.maxy - B0.miny) };
    const lines = [];
    ctx.font = '11px system-ui';
    for (const p of r.parts) {
      if (lineView(p.k) !== which) continue;
      const k = p.k, sg = p.mir ? -1 : 1, a = clamp(+k.ang || 0, -90, 90) * RAD, C = P(+k.x || 0, sg * (+k.c || 0)), dir = P(Math.cos(a), sg * Math.sin(a));
      const sel = ed.sel === k.id, tt = clipLine(C, dir, bx);
      let LN = null;
      if (tt) {
        const A = P(C.x + dir.x * tt[0], C.y + dir.y * tt[0]), Bq = P(C.x + dir.x * tt[1], C.y + dir.y * tt[1]);
        ctx.strokeStyle = App.hexA ? App.hexA(p.col, sel ? 0.9 : 0.5) : p.col; ctx.lineWidth = sel ? 1.4 : 1; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(V.X(A.x), V.Y(A.y)); ctx.lineTo(V.X(Bq.x), V.Y(Bq.y)); ctx.stroke(); ctx.setLineDash([]);
        lines.push(LN = { id: k.id, mir: p.mir, C, dir, A: P(V.X(A.x), V.Y(A.y)), B: P(V.X(Bq.x), V.Y(Bq.y)) });
      }
      // Ausdehnung des Teils (liegt in der Ebene -> Strecke auf der Linie)
      ctx.strokeStyle = p.col; ctx.lineWidth = sel ? 4 : 3;
      p.R.forEach(L => { App.poly(ctx, V, L.map(q => view2(which, to3(p.pl, q))), true); ctx.stroke(); });
      const cx = V.X(C.x), cy = V.Y(C.y);
      ctx.fillStyle = sel ? '#fff' : p.col; ctx.fillText(p.name, cx + 7, cy - 7);
      if (sel) {
        const hx = cx + 70 * dir.x, hy = cy - 70 * dir.y;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = p.col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(cx - 5, cy - 5, 10, 10); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        if (LN) LN.H = { c: P(cx, cy), r: P(hx, hy) }; else lines.push({ id: k.id, mir: p.mir, C, dir, A: P(cx, cy), B: P(cx, cy), H: { c: P(cx, cy), r: P(hx, hy) } });
      }
    }
    ed.views[which] = { V, lines };
    // Achsen
    ctx.fillStyle = 'rgba(160,175,195,.8)'; ctx.font = '11px system-ui';
    ctx.fillText(which === 'side' ? 'X →   ↑ Y' : 'X →   ↑ Z', 10, h - 10);
  }
  function renderParts(r) {
    const cv = document.getElementById('cRpssParts'), info = document.getElementById('rpssInfo'); if (!cv || !App.fitCanvas) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    ed.partHit = [];
    const c = cfg();
    if (!r) { if (info) info.textContent = c.from === 'stl' ? T('Kein STL-Modell geladen.') : T('Kein Rumpf — erst im Reiter „Rumpf" einen Rumpf anlegen.'); return; }
    if (r.err) { if (info) info.textContent = T('Fehler beim Aufbau: ') + r.err; return; }
    const shown = r.parts.filter(p => p.R.length && (c.lower !== 'sel' || p.k.id === ed.sel));
    if (!shown.length) {
      if (info) info.innerHTML = (c.cuts.length ? T('Keine Teile.') : T('Noch keine Schnittlage — in der Seitenleiste „+ senkrecht längs", „+ waagrecht" oder „+ quer" wählen.'))
        + (r.warn.length ? '<br><span style="color:#fb8">' + r.warn.join(' · ') + '</span>' : '');
      return;
    }
    const all = []; shown.forEach(p => p.R.forEach(R => all.push(place(p, R))));
    const BB = App.bounds([].concat.apply([], all)); BB.maxy += 0.3 * (BB.maxy - BB.miny) + 1;   // Platz für den Infokasten
    const V = App.makeView(w, h, BB, 40, nav('rpssParts'));
    if (App.grid) App.grid(ctx, w, h, V);
    if (c.lower !== 'sel') { ctx.strokeStyle = '#3a4657'; ctx.setLineDash([6, 5]); App.poly(ctx, V, [P(0, 0), P(r.lay.W, 0), P(r.lay.W, -r.lay.H), P(0, -r.lay.H)], true); ctx.stroke(); ctx.setLineDash([]); }
    for (const p of shown) {
      const sel = p.k.id === ed.sel;
      if (p.skin) { ctx.strokeStyle = 'rgba(160,175,195,.45)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); p.skin.forEach(R => { App.poly(ctx, V, place(p, R), true); ctx.stroke(); }); ctx.setLineDash([]); }
      ctx.beginPath();
      p.R.forEach(R => place(p, R).forEach((q, i) => i ? ctx.lineTo(V.X(q.x), V.Y(q.y)) : ctx.moveTo(V.X(q.x), V.Y(q.y))));
      ctx.closePath(); ctx.fillStyle = App.hexA ? App.hexA(p.col, sel ? 0.22 : 0.1) : 'rgba(255,180,84,.1)'; ctx.fill('evenodd');
      p.R.forEach(R => { ctx.strokeStyle = area(R) > 0 ? p.col : '#57d38c'; ctx.lineWidth = sel ? 2.2 : 1.5; App.poly(ctx, V, place(p, R), true); ctx.stroke(); });
      ctx.strokeStyle = 'rgba(255,200,120,.75)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); p.marks.forEach(M => { App.poly(ctx, V, place(p, M), false); ctx.stroke(); }); ctx.setLineDash([]);
      if (c.label.on || sel) { ctx.fillStyle = sel ? '#fff' : '#c9d6e3'; ctx.font = (sel ? 'bold ' : '') + '11px system-ui'; ctx.fillText(partLabel(p), V.X(p.bb.minx + p.ox), V.Y(p.bb.miny + p.oy) + 13); }
      ed.partHit.push({ id: p.k.id, x0: V.X(p.bb.minx + p.ox), x1: V.X(p.bb.maxx + p.ox), y0: V.Y(p.bb.maxy + p.oy), y1: V.Y(p.bb.miny + p.oy) });
    }
    if (info) {
      const nP = r.parts.filter(p => p.R.length).length, nJ = r.joints.length;
      info.innerHTML = nP + ' ' + T('Teile') + ' · ' + nJ + ' ' + T('Überschneidungen') + ' · ' + T('Wandabzug') + ' ' + r1(c.wall) + ' mm · ' + T('Stärke') + ' ' + r1(c.thick) + ' mm'
        + (r.warn.length ? '<br><span style="color:#fb8">' + r.warn.join(' · ') + '</span>' : '')
        + '<br><span style="opacity:.7">' + T('Grün = Ausschnitt, gestrichelt = Lage des Partnerteils, gepunktet = Rumpfaußenkontur · Teil anklicken = wählen · Rad = Zoom, Ziehen = schieben') + '</span>';
    }
  }
  function render() {
    const r = build();
    renderView(r, 'side'); renderView(r, 'top'); renderParts(r);
  }

  // ---------- Maus: Lagen verschieben/drehen, Teile wählen ----------------------------------------------
  function selectCut(id, rebuild) { ed.sel = id; if (rebuild !== false) App.buildSidebar(); render(); }
  function hitView(which, m) {
    const v = ed.views[which]; if (!v) return null;
    let best = null;
    for (const L of v.lines) {
      if (L.H) {
        if (Math.hypot(L.H.r.x - m.x, L.H.r.y - m.y) < 9) return { L, type: 'rot' };
        if (Math.hypot(L.H.c.x - m.x, L.H.c.y - m.y) < 9) return { L, type: 'move' };
      }
      const dx = L.B.x - L.A.x, dy = L.B.y - L.A.y, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? clamp(((m.x - L.A.x) * dx + (m.y - L.A.y) * dy) / l2, 0, 1) : 0, d = Math.hypot(L.A.x + dx * t - m.x, L.A.y + dy * t - m.y);
      if (d < 7 && (!best || d < best.d)) best = { L, type: 'move', d };
    }
    return best;
  }
  function wireMouse() {
    const pos = (e, el) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    for (const which of ['side', 'top']) {
      const cv = document.getElementById(CVID[which]);
      cv.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const m = pos(e, cv), H = hitView(which, m); if (!H) return;
        const k = cfg().cuts.find(q => q.id === H.L.id); if (!k) return;
        const v = ed.views[which], w0 = v.V.inv(m.x, m.y);
        ed.sel = k.id;
        ed.drag = { which, k, type: H.type, sg: H.L.mir ? -1 : 1, w0, x0: +k.x || 0, c0: +k.c || 0, moved: false };
        e.stopImmediatePropagation(); e.preventDefault(); render();
      });
      cv.addEventListener('mousemove', e => {
        if (ed.drag) return;
        const H = hitView(which, pos(e, cv));
        cv.style.cursor = H ? (H.type === 'rot' ? 'alias' : 'move') : 'grab';
      });
    }
    window.addEventListener('mousemove', e => {
      const dg = ed.drag; if (!dg) return;
      const v = ed.views[dg.which]; if (!v) return;
      const cv = document.getElementById(CVID[dg.which]), m = pos(e, cv), w = v.V.inv(m.x, m.y), k = dg.k;
      if (dg.type === 'rot') {
        const C = P(+k.x || 0, dg.sg * (+k.c || 0));
        let a = Math.atan2(w.y - C.y, w.x - C.x) / RAD * dg.sg;
        if (a > 90) a -= 180; if (a <= -90) a += 180;
        a = e.shiftKey ? Math.round(a / 5) * 5 : Math.round(a * 2) / 2;
        if (Math.abs(a) < 1.5) a = 0; if (Math.abs(Math.abs(a) - 90) < 1.5) a = 90;
        k.ang = a;
      } else {
        let dx = w.x - dg.w0.x, dy = w.y - dg.w0.y;
        if (e.shiftKey) {   // nur quer zur Linie
          const a = (+k.ang || 0) * RAD, nx = -Math.sin(a) * dg.sg, ny = Math.cos(a), s = dx * nx + dy * ny; dx = s * nx; dy = s * ny;
        }
        k.x = Math.round((dg.x0 + dx) * 10) / 10; k.c = Math.round((dg.c0 + dg.sg * dy) * 10) / 10;
      }
      dg.moved = true; render();
    });
    window.addEventListener('mouseup', () => { if (ed.drag) { ed.drag = null; App.buildSidebar(); render(); } });
    const pc = document.getElementById('cRpssParts');
    pc.addEventListener('click', e => {
      if (nav('rpssParts').moved) return;
      const m = pos(e, pc), hit = ed.partHit.find(q => m.x >= q.x0 && m.x <= q.x1 && m.y >= q.y0 && m.y <= q.y1);
      if (hit) selectCut(hit.id);
    });
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'rpss' || ed.sel == null) return;
      const tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
      const k = cfg().cuts.find(q => q.id === ed.sel); if (!k) return;
      const st = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      if (e.key === 'ArrowLeft') k.x = r1((+k.x || 0) - st);
      else if (e.key === 'ArrowRight') k.x = r1((+k.x || 0) + st);
      else if (e.key === 'ArrowUp') k.c = r1((+k.c || 0) + st);
      else if (e.key === 'ArrowDown') k.c = r1((+k.c || 0) - st);
      else if (e.key === 'PageUp') k.ang = clamp((+k.ang || 0) + (e.shiftKey ? 5 : 1), -90, 90);
      else if (e.key === 'PageDown') k.ang = clamp((+k.ang || 0) - (e.shiftKey ? 5 : 1), -90, 90);
      else return;
      e.preventDefault(); clearTimeout(ed.kt); ed.kt = setTimeout(() => App.buildSidebar(), 400); render();
    });
  }
  let wired = false;
  function show() {
    if (!wired && App.setupNav) {
      wired = true; wireMouse();
      App.setupNav('cRpssSide', 'rpssSide', render); App.setupNav('cRpssTop', 'rpssTop', render); App.setupNav('cRpssParts', 'rpssParts', render);
    }
    render();
  }

  // ---------- Seitenleiste ---------------------------------------------------------------------
  function newCut(kind) {
    const c = cfg(), api = srcApi(); if (!api) return;
    const xm = (api.x0 + api.x1) / 2, L = api.x1 - api.x0, b = api.box(xm), ym = r1((b.top + b.bot) / 2);
    const cnt = pre => c.cuts.filter(k => (k.name || '').indexOf(pre) === 0).length + 1;
    let k;
    if (kind === 'v') { const used = c.cuts.some(q => q.pl === 'v' && !+q.c && !+q.ang); k = { pl: 'v', x: r1(xm), c: used ? r1(0.3 * b.w) : 0, ang: 0, mir: used, name: 'L' + cnt('L') }; }
    else if (kind === 'h') k = { pl: 'h', x: r1(xm), c: ym, ang: 0, mir: false, name: 'W' + cnt('W') };
    else { const xb = api.x0 + 0.3 * L, bb = api.box(xb); k = { pl: 'h', x: r1(xb), c: r1((bb.top + bb.bot) / 2), ang: 90, mir: false, name: 'Q' + cnt('Q') }; }
    Object.assign(k, { id: c.nextId++, on: true, thick: null, wall: null, holes: [] });
    c.cuts.push(k); ed.sel = k.id; App.buildSidebar(); render();
  }
  function removeCut(id) {
    const c = cfg(), i = c.cuts.findIndex(q => q.id === id); if (i < 0) return;
    c.cuts.splice(i, 1);
    for (const key of Object.keys(c.joints)) if (key.split('|').some(s => +s === id)) delete c.joints[key];
    if (ed.sel === id) ed.sel = c.cuts.length ? c.cuts[Math.min(i, c.cuts.length - 1)].id : null;
    App.buildSidebar(); render();
  }
  function rpssSidebar(side) {
    const { grp, hint, boolRow, selectRow, mkMini, subhead, buildSidebar } = App, numRow = App.numRowEnter || App.numRow;   // Zahlen erst bei Enter/Verlassen/Pfeil (Setter bauen die Leiste neu)
    // Rückweg aus der CAD-Bearbeitung (Gruppe nur im Reiter „CAD-Bearbeitung", ganz oben)
    if (ed.cadLink) {
      const gc = grp('Rumpf Schnittspanten — Ausschnitte', true, 'cad', { key: 'rpssCad', alwaysOpen: true });
      hint(gc.body, T('Ausschnitte für') + ' „' + ed.cadLink.name + '": ' + T('als geschlossene Konturen auf dem Layer „Ausschnitte" zeichnen (Kreis, Rechteck, Polylinie mit C schließen, Spline, Versatz …). Die Kontur des Teils liegt als Bezug auf eigenem Layer.'));
      const b = document.createElement('div'); b.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
      b.appendChild(mkMini(T('↩ Ausschnitte übernehmen'), takeFromCad));
      b.appendChild(mkMini(T('Abbrechen'), () => { ed.cadLink = null; buildSidebar(); App.switchView('rpss'); render(); }));
      gc.body.appendChild(b);
      side.appendChild(gc.g);
    }
    const c = cfg(), RD = () => render(), RB = () => { buildSidebar(); render(); };
    const txt = (body, label, get, set) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = T(label); const i = document.createElement('input'); i.type = 'text'; i.value = get(); i.onchange = () => { const v = i.value; setTimeout(() => set(v), 0); }; r.appendChild(l); r.appendChild(i); body.appendChild(r); };
    const bar = body => { const b = document.createElement('div'); b.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px'; body.appendChild(b); return b; };
    const g0 = grp('Rumpf Schnittspanten', true, 'rpss', { key: 'rpssMain' });
    hint(g0.body, 'Bauteile aus frei gelegten Schnittebenen durch den Rumpf (Kiel, Seitenwände, Böden, Decks, schräge Spanten). Schnittlagen in der Seiten- bzw. Draufsicht mit der Maus verschieben (Linie ziehen, Umschalt = nur quer) und drehen (runder Griff, Umschalt = 5°-Schritte).');
    if (window.StlBody) {
      selectRow(g0.body, 'Rumpf aus', [['rpro', 'Reiter „Rumpf"'], ['stl', 'eigenes STL-Modell']], () => c.from || 'rpro', v => { c.from = v; RB(); });
      if (c.from === 'stl') StlBody.rows(g0.body, () => render(), {});
    }
    const api = srcApi();
    if (!api) { hint(g0.body, c.from === 'stl' ? 'Kein STL-Modell geladen.' : 'Kein Rumpf vorhanden.'); side.appendChild(g0.g); return; }
    if (c.from !== 'stl') selectRow(g0.body, 'Kontur', [['body', 'nur Rumpf'], ['all', 'mit Anbauten (Tragflächenübergang, Leitwerk)']], () => c.src, v => { c.src = v; RD(); });
    numRow(g0.body, 'Abzug Rumpfwand (mm)', () => c.wall, v => { c.wall = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true, hint: 'Geschnitten wird die um die Wandstärke nach innen versetzte Rumpffläche (senkrecht zur Oberfläche gemessen) — die Teile passen so auch bei flach geschnittenen Bereichen genau in die Schale.' });
    numRow(g0.body, 'Materialstärke (mm)', () => c.thick, v => { c.thick = Math.max(0.1, v); RD(); }, { step: 0.5, min: 0.1, norender: true });
    numRow(g0.body, 'Spiel in Schlitzen/Zapfenlöchern (mm)', () => c.play, v => { c.play = Math.max(0, v); RD(); }, { step: 0.05, min: 0, norender: true });
    txt(g0.body, 'Werkstoff (Stückliste)', () => c.mat, v => { c.mat = v; });
    boolRow(g0.body, 'Rumpfaußenkontur in den Teilen zeigen', () => !!c.skin, v => { c.skin = v; RD(); });
    side.appendChild(g0.g);

    // --- Schnittlagen
    const gL = grp('Schnittlagen', true, 'rpss', { key: 'rpssCuts' });
    hint(gL.body, '„Senkrecht längs" = parallel zur Seitenansicht (Linie in der Draufsicht), „waagrecht" = parallel zur Draufsicht (Linie in der Seitenansicht). Mit Winkel schräg, bei ±90° ein Querschnitt (Spant).');
    const ba = bar(gL.body);
    ba.appendChild(mkMini(T('+ senkrecht längs'), () => newCut('v')));
    ba.appendChild(mkMini(T('+ waagrecht'), () => newCut('h')));
    ba.appendChild(mkMini(T('+ quer (Spant)'), () => newCut('q')));
    const r = build();
    c.cuts.forEach((k, idx) => {
      const d = document.createElement('div'); d.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:11px;margin-top:3px;padding:3px 4px;border-radius:4px;cursor:pointer' + (k.id === ed.sel ? ';background:rgba(255,224,102,.14)' : '');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!k.on; cb.title = T('Teil erzeugen'); cb.onclick = e => e.stopPropagation(); cb.onchange = () => { k.on = cb.checked; RB(); }; d.appendChild(cb);
      const dot = document.createElement('span'); dot.style.cssText = 'width:10px;height:10px;border-radius:50%;flex:0 0 auto;background:' + PAL[idx % PAL.length]; d.appendChild(dot);
      const lab = document.createElement('span'); lab.style.flex = '1';
      const nb = document.createElement('b'); nb.textContent = (k.name || '#' + k.id) + (k.mir && k.pl === 'v' ? ' ×2' : ''); lab.appendChild(nb);
      const ns = document.createElement('span'); ns.style.opacity = '.7'; ns.textContent = ' ' + planeText(k); lab.appendChild(ns); d.appendChild(lab);
      const x = mkMini('✕', () => { if (confirm(T('Schnittlage löschen?'))) removeCut(k.id); }); x.title = T('löschen'); d.appendChild(x);
      d.onclick = () => selectCut(k.id);
      gL.body.appendChild(d);
    });
    side.appendChild(gL.g);

    // --- gewählte Schnittlage
    const k = c.cuts.find(q => q.id === ed.sel);
    if (k) {
      const gS = grp('Gewählte Schnittlage', true, 'rpss', { key: 'rpssSel' });
      txt(gS.body, 'Name', () => k.name || '', v => { k.name = v; RB(); });
      selectRow(gS.body, 'Ebene', [['v', 'senkrecht längs (parallel Seitenansicht)'], ['h', 'waagrecht (parallel Draufsicht)']], () => k.pl, v => {
        if (v === k.pl) return; const b = api.box(clamp(+k.x || 0, api.x0, api.x1)); k.pl = v; k.c = v === 'v' ? 0 : r1((b.top + b.bot) / 2); if (v === 'h') k.mir = false; RB();
      });
      numRow(gS.body, 'Drehpunkt X (mm)', () => k.x, v => { k.x = v; RD(); }, { step: 1, norender: true });
      numRow(gS.body, k.pl === 'v' ? 'Lage Z (mm, 0 = Mitte)' : 'Lage Y (Höhe, mm)', () => k.c, v => { k.c = v; RD(); }, { step: 1, norender: true });
      numRow(gS.body, k.pl === 'v' ? 'Winkel in der Draufsicht (°)' : 'Winkel in der Seitenansicht (°)', () => k.ang, v => { k.ang = clamp(v, -90, 90); RD(); }, { step: 1, min: -90, max: 90, norender: true, hint: '0° = längs, ±90° = quer (Spant). Drehpunkt ist der Punkt X / Lage.' });
      if (k.pl === 'v') boolRow(gS.body, 'gespiegelt (Teil links und rechts)', () => !!k.mir, v => { k.mir = v; RB(); }, 'Erzeugt dasselbe Teil zusätzlich an der Symmetrieebene gespiegelt (z. B. zwei Seitenwände) — nur sinnvoll außerhalb der Mitte oder schräg.');
      boolRow(gS.body, 'eigene Materialstärke', () => k.thick != null, v => { k.thick = v ? thickOf(k) : null; RB(); });
      if (k.thick != null) numRow(gS.body, 'Materialstärke (mm)', () => k.thick, v => { k.thick = Math.max(0.1, v); RD(); }, { step: 0.5, min: 0.1, norender: true });
      boolRow(gS.body, 'eigener Wandabzug', () => k.wall != null, v => { k.wall = v ? wallOf(k) : null; RB(); });
      if (k.wall != null) numRow(gS.body, 'Abzug Rumpfwand (mm)', () => k.wall, v => { k.wall = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true });
      subhead(gS.body, 'Ausschnitte');
      hint(gS.body, 'Ausschnitte (Leichterung, Durchbrüche, Servo-/Akkuschacht) mit allen Werkzeugen der CAD-Bearbeitung zeichnen: das Teil wird dort als Bezug geladen, gezeichnet wird auf dem Layer „Ausschnitte". Danach „Ausschnitte übernehmen".');
      const bs = bar(gS.body), nH = (k.holes || []).length;
      const info = document.createElement('span'); info.style.cssText = 'font-size:11px;opacity:.8;align-self:center'; info.textContent = nH + ' ' + T('Ausschnitte'); bs.appendChild(info);
      if (App.cadEnsureLayer && App.switchView) bs.appendChild(mkMini(T('✎ Im CAD zeichnen'), () => editInCad(k.id)));
      else hint(gS.body, 'CAD-Bearbeitung ist in dieser Ausgabe nicht enthalten.');
      if (nH) bs.appendChild(mkMini(T('Ausschnitte löschen'), () => { if (confirm(T('Alle Ausschnitte dieses Teils löschen?'))) { k.holes = []; RB(); } }));
      const b2 = bar(gS.body);
      b2.appendChild(mkMini(T('Duplizieren'), () => { const n = JSON.parse(JSON.stringify(k)); n.id = c.nextId++; n.name = (k.name || '') + '+'; if (k.pl === 'v') n.c = r1((+k.c || 0) + 20); else n.c = r1((+k.c || 0) + 10); c.cuts.push(n); ed.sel = n.id; RB(); }));
      b2.appendChild(mkMini(T('Schnittlage löschen'), () => { if (confirm(T('Schnittlage löschen?'))) removeCut(k.id); }));
      side.appendChild(gS.g);
    }

    // --- Verbindungen
    const gJ = grp('Verbindungen (Überschneidungen)', true, 'rpss', { key: 'rpssJoints' });
    if (!r || r.err || !r.joints || !r.joints.length) hint(gJ.body, 'Keine Überschneidungen. Sobald sich zwei Teile kreuzen oder treffen, erscheinen sie hier — mit Wahl der Verzapfung bzw. welches Teil am anderen gestutzt wird.');
    else {
      hint(gJ.body, 'Kreuzverzapfung: beide Teile bekommen einen Schlitz bis zur Mitte der Überschneidung (Steckverbindung wie ein Eierkarton-Gitter). „… stößt an …": das Teil wird an der Fläche des anderen gestutzt (Überstand weg) und greift mit Zapfen in Zapfenlöcher. Gespiegelte Teile übernehmen die Einstellung ihres Gegenstücks.');
      const seen = new Map();
      for (const j of r.joints) { if (!seen.has(j.key)) seen.set(j.key, []); seen.get(j.key).push(j); }
      for (const [key, js] of seen) {
        const j = js[0], A = j.A, B = j.B, cj = jointCfg(key), W = () => jointCfgW(key);
        const an = A.k.name || '#' + A.k.id, bn = B.k.name || '#' + B.k.id;
        const phi = Math.round(Math.asin(clamp(j.jl.sin, 0, 1)) / RAD);
        subhead(gJ.body, an + ' × ' + bn + (js.length > 1 ? '  (' + js.length + '×)' : ''));
        const inf = document.createElement('div'); inf.className = 'hint'; inf.textContent = T('Winkel') + ' ' + phi + '° · ' + T('Länge') + ' ' + r1(j.len) + ' mm' + (j.info ? ' · ' + j.info : ''); gJ.body.appendChild(inf);
        selectRow(gJ.body, 'Verbindung', [['none', 'keine (Teile durchdringen sich)'], ['cross', 'Kreuzverzapfung (Steckschlitze)'], ['a', an + ' ' + T('stößt an') + ' ' + bn], ['b', bn + ' ' + T('stößt an') + ' ' + an]], () => cj.mode, v => { W().mode = v; RB(); });
        if (cj.mode === 'cross') boolRow(gJ.body, 'Schlitzrichtung tauschen', () => !!cj.flip, v => { W().flip = v; RD(); });
        if (cj.mode === 'a' || cj.mode === 'b') {
          const Q = cj.mode === 'a' ? B : A, pn = cj.mode === 'a' ? an : bn;
          selectRow(gJ.body, T('verbleibende Seite von') + ' ' + pn, [['auto', 'automatisch (größerer Teil)'], ['+', sideName(Q, 1)], ['-', sideName(Q, -1)]], () => cj.keep, v => { W().keep = v; RD(); });
          const Pq = cj.mode === 'a' ? A : B, qn = cj.mode === 'a' ? bn : an;
          boolRow(gJ.body, T('ebenfalls stutzen:') + ' ' + qn + ' → ' + pn, () => !!cj.both, v => { W().both = v; RB(); }, 'Kastenecke: auch das Partnerteil endet am stoßenden Teil (bündig mit dessen Außenseite); die Zapfen sitzen dann in Kerben am Rand.');
          if (cj.both) selectRow(gJ.body, T('verbleibende Seite von') + ' ' + qn, [['auto', 'automatisch (größerer Teil)'], ['+', sideName(Pq, 1)], ['-', sideName(Pq, -1)]], () => cj.keepO, v => { W().keepO = v; RD(); });
          numRow(gJ.body, 'Zapfen (Anzahl, 0 = nur stutzen)', () => cj.n, v => { W().n = clamp(Math.round(v), 0, 20); RD(); }, { step: 1, min: 0, max: 20, int: true, norender: true });
          if (cj.n > 0) {
            numRow(gJ.body, 'Zapfenbreite (mm)', () => cj.w, v => { W().w = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
            numRow(gJ.body, 'Zapfen-Überstand (mm)', () => cj.over, v => { W().over = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true });
          }
        }
      }
    }
    side.appendChild(gJ.g);

    const g4 = grp('Teile & Ausgabe', false, 'rpss', { key: 'rpssOut' });
    selectRow(g4.body, 'Untere Ansicht', [['all', 'alle Teile (wie im DXF angeordnet)'], ['sel', 'nur gewählte Schnittlage']], () => c.lower, v => { c.lower = v; RD(); });
    numRow(g4.body, 'Plattenbreite für die Anordnung (mm)', () => c.sheetW, v => { c.sheetW = Math.max(50, v); RD(); }, { step: 10, min: 50, norender: true });
    numRow(g4.body, 'Abstand der Teile (mm)', () => c.gap, v => { c.gap = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
    boolRow(g4.body, 'Beschriftung', () => !!c.label.on, v => { c.label.on = v; RB(); });
    if (c.label.on) numRow(g4.body, 'Schrifthöhe (mm)', () => c.label.h, v => { c.label.h = Math.max(1, v); RD(); }, { step: 0.5, min: 1, norender: true });
    const bb = bar(g4.body);
    bb.appendChild(mkMini(T('DXF speichern…'), exportDxf));
    bb.appendChild(mkMini(T('Stückliste (CSV)…'), exportCsv));
    if (App.cadEnsureLayer) bb.appendChild(mkMini(T('→ In die CAD-Bearbeitung übernehmen'), toCad));
    side.appendChild(g4.g);
  }

  Object.assign(App, { rpssSidebar });
  window.RproSchnitte = { show, render, build, exportDxf, exportCsv, toCad, editInCad, takeFromCad,
    _test: { boolOp, planeOf, sectionOf, slice, chain3, innerGrid, outerGrid, jointLine, lineIv, frameOf, orient, area, deloop, ed, memo } };
})();
