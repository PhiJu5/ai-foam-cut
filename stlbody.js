/* stlbody.js — eigenes STL-Modell als Rumpfquelle (Kern, kein eigener Reiter).
 * Die Reiter „Decals", „Rumpf Formenbau" und „Rumpf Spanten" arbeiten alle auf Halbspanten
 * [[y, z], …] (oben -> unten, z >= 0) je Längslage x — bisher nur aus RumpfPro.api(). Dieses Modul
 * liefert dieselbe Schnittstelle aus einer STL-Datei:
 *   laden -> ausrichten (Längsachse = X, Hochachse = Y, Nase bei X = 0) -> je Spalte x = const die
 *   Dreiecke schneiden -> Außenkontur per Strahlen um die Spaltmitte (größter Abstand, beide Seiten)
 *   -> nach Bogenlänge auf K Punkte abgetastet.
 * Im Projekt liegt nur dieses Schnittgitter (state.cfg.stlBody.grid), nicht das Dreiecksnetz — zum
 * Ändern der Ausrichtung nach dem Laden eines Projekts die STL-Datei neu laden.
 * Andere Module rufen nur geschützt (window.StlBody && …).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (App.T ? App.T(s) : s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10;
  const NX0 = 121, K0 = 97, K = K0, M = 720;   // Spalten längs, Punkte je Halbspant, Strahlen rundum (slice: feiner per res)

  const DEF = { name: '', len: 'auto', up: 'auto', flipX: false, flipUp: false, unit: 1, scale: 1, mid: 'auto', nFr: 10, frEnds: 4, frList: '', grid: null };
  function cfg() {
    const st = App.state; let c = st.cfg.stlBody;
    if (!c || typeof c !== 'object') c = st.cfg.stlBody = Object.assign({}, DEF);
    for (const k in DEF) if (c[k] === undefined) c[k] = DEF[k];
    return c;
  }

  // ---------- STL lesen: Float32Array, 9 Werte je Dreieck -------------------------------------
  function parseSTL(buf) {
    const dv = new DataView(buf);
    const bin = n => {
      n = Math.min(n, Math.floor((buf.byteLength - 84) / 50)); const v = new Float32Array(n * 9);
      for (let i = 0, o = 84; i < n; i++, o += 50) for (let k = 0; k < 9; k++) v[i * 9 + k] = dv.getFloat32(o + 12 + 4 * k, true);
      return v;
    };
    if (buf.byteLength >= 84 && buf.byteLength === 84 + dv.getUint32(80, true) * 50) return bin(dv.getUint32(80, true));
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 1024)));
    if (/^\s*solid/i.test(head) && /facet|endsolid/i.test(head)) {
      const out = [], re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, txt = new TextDecoder().decode(buf); let m;
      while ((m = re.exec(txt))) out.push(+m[1], +m[2], +m[3]);
      return new Float32Array(out.slice(0, Math.floor(out.length / 9) * 9));
    }
    if (buf.byteLength >= 84) return bin(dv.getUint32(80, true));
    throw new Error(T('Keine gültige STL-Datei.'));
  }

  // ---------- Ausrichten -----------------------------------------------------------------------
  // raw (STL-Achsen) -> { len, up, lat } Achsindizes; „auto": Längsachse = größte Ausdehnung,
  // Querachse = die symmetrischere der beiden übrigen (Flächenschwerpunkt nahe der Mitte).
  let raw = null;   // Dreiecke der zuletzt geladenen Datei (nur im Speicher)
  function axes(c, v) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], cen = [0, 0, 0]; let A = 0;
    for (let i = 0; i < v.length; i += 9) {
      for (let q = 0; q < 9; q++) { const k = q % 3, w = v[i + q]; if (w < mn[k]) mn[k] = w; if (w > mx[k]) mx[k] = w; }
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      const a = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
      A += a; for (let k = 0; k < 3; k++) cen[k] += a * (v[i + k] + v[i + 3 + k] + v[i + 6 + k]) / 3;
    }
    const ext = [0, 1, 2].map(k => mx[k] - mn[k]), ix = { x: 0, y: 1, z: 2 };
    let len = ix[c.len]; if (len == null) len = ext.indexOf(Math.max(...ext));
    const rest = [0, 1, 2].filter(k => k !== len);
    let up = ix[c.up]; if (up == null || up === len) {
      const asym = k => (ext[k] > 1e-9 && A > 0 ? Math.abs(cen[k] / A - (mn[k] + mx[k]) / 2) / ext[k] : 0);
      up = asym(rest[0]) > asym(rest[1]) + 1e-4 ? rest[0] : asym(rest[1]) > asym(rest[0]) + 1e-4 ? rest[1] : (rest.indexOf(2) >= 0 ? 2 : rest[1]);
    }
    return { len, up, lat: rest.find(k => k !== up), mn, mx };
  }

  // ---------- Schnittgitter ----------------------------------------------------------------------
  // -> { xs [NX], cols [NX] (Float32Array 2K: y, z je Punkt), tri, dim [L, H, B] }
  function slice(c, v, res) {
    const NX = (res && res.nx) || NX0, K = (res && res.k) || K0;
    const ax = axes(c, v), s = (+c.unit || 1) * (+c.scale > 0 ? +c.scale : 1);
    const sx = c.flipX ? -1 : 1, sy = c.flipUp ? -1 : 1;
    const xA = sx > 0 ? ax.mn[ax.len] : ax.mx[ax.len], L = (ax.mx[ax.len] - ax.mn[ax.len]) * s;
    const zM = c.mid === 'zero' ? 0 : (ax.mn[ax.lat] + ax.mx[ax.lat]) / 2;
    if (!(L > 1e-6)) throw new Error(T('Das STL-Modell hat keine Ausdehnung.'));
    const X = i => (v[i + ax.len] - xA) * sx * s, Y = i => v[i + ax.up] * sy * s, Z = i => (v[i + ax.lat] - zM) * s;
    const xs = []; for (let i = 0; i < NX; i++) xs.push(L * (0.5 - 0.5 * Math.cos(Math.PI * i / (NX - 1))));
    const segs = xs.map(() => []);
    const lower = x => { let lo = 0, hi = NX; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m + 1; else hi = m; } return lo; };
    for (let i = 0; i < v.length; i += 9) {
      const px = [X(i), X(i + 3), X(i + 6)], lo = Math.min(px[0], px[1], px[2]), hi = Math.max(px[0], px[1], px[2]);
      if (!(hi > lo)) continue;
      const py = [Y(i), Y(i + 3), Y(i + 6)], pz = [Z(i), Z(i + 3), Z(i + 6)];
      for (let col = lower(lo); col < NX && xs[col] < hi; col++) {
        const x = xs[col], S = segs[col]; let n = 0;
        for (let e = 0; e < 3 && n < 2; e++) {
          const a = e, b = (e + 1) % 3;
          if ((px[a] > x) === (px[b] > x)) continue;
          const t = (x - px[a]) / (px[b] - px[a]); S.push(py[a] + (py[b] - py[a]) * t, pz[a] + (pz[b] - pz[a]) * t); n++;
        }
        if (n === 1) S.length -= 2;
      }
    }
    const dA = 2 * Math.PI / M, CS = [], SN = []; for (let j = 0; j < M; j++) { CS.push(Math.cos(j * dA)); SN.push(Math.sin(j * dA)); }
    const cols = [], H = M / 2; let yPrev = 0, zMax = 0, yLo = Infinity, yHi = -Infinity;
    for (let col = 0; col < NX; col++) {
      const S = segs[col], out = new Float32Array(2 * K);
      let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < S.length; i += 2) { if (S[i] < y0) y0 = S[i]; if (S[i] > y1) y1 = S[i]; }
      if (!(y1 > y0)) { cols.push(null); continue; }
      const yc = (y0 + y1) / 2, R = new Float64Array(M);
      for (let i = 0; i < S.length; i += 4) {
        const Ay = S[i] - yc, Az = S[i + 1], By = S[i + 2] - yc, Bz = S[i + 3], dy = By - Ay, dz = Bz - Az;
        let a0 = Math.atan2(Az, Ay), d = Math.atan2(Bz, By) - a0;
        while (d <= -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI;
        if (d < 0) { a0 += d; d = -d; }
        const num = Ay * dz - Az * dy;
        for (let j = Math.ceil(a0 / dA - 1e-9), je = Math.floor((a0 + d) / dA + 1e-9); j <= je; j++) {
          const q = ((j % M) + M) % M, den = CS[q] * dz - SN[q] * dy;
          if (Math.abs(den) < 1e-12) continue;
          const r = num / den; if (r > R[q]) R[q] = r;
        }
      }
      // Halbspant: je Winkel der größere Abstand beider Seiten; Lücken (offenes Netz) linear schließen
      const rr = new Float64Array(H + 1); let any = false;
      for (let j = 0; j <= H; j++) { rr[j] = Math.max(R[j], R[(M - j) % M]); if (rr[j] > 0) any = true; }
      if (!any) { cols.push(null); continue; }
      for (let j = 0; j <= H; j++) if (!(rr[j] > 0)) {
        let a = j - 1, b = j + 1; while (a >= 0 && !(rr[a] > 0)) a--; while (b <= H && !(rr[b] > 0)) b++;
        rr[j] = a < 0 ? rr[b] : b > H ? rr[a] : rr[a] + (rr[b] - rr[a]) * (j - a) / (b - a);
      }
      const P = []; for (let j = 0; j <= H; j++) P.push([yc + rr[j] * CS[j], j === 0 || j === H ? 0 : rr[j] * SN[j]]);
      const cum = [0]; for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
      const tot = cum[H]; let j = 0;
      for (let k = 0; k < K; k++) {
        const sl = tot * k / (K - 1); while (j < H - 1 && cum[j + 1] < sl) j++;
        const dd = cum[j + 1] - cum[j], t = dd > 1e-12 ? clamp((sl - cum[j]) / dd, 0, 1) : 0;
        out[2 * k] = P[j][0] + (P[j + 1][0] - P[j][0]) * t; out[2 * k + 1] = Math.max(0, P[j][1] + (P[j + 1][1] - P[j][1]) * t);
        if (out[2 * k + 1] > zMax) zMax = out[2 * k + 1];
      }
      out[1] = 0; out[2 * K - 1] = 0; yPrev = yc;
      if (out[0] > yHi) yHi = out[0]; if (out[2 * K - 2] < yLo) yLo = out[2 * K - 2];
      cols.push(out);
    }
    // Nase/Heck und leere Spalten: auf einen Punkt in Höhe der nächsten gültigen Spalte zusammenziehen
    const mid = o => (o[0] + o[2 * K - 2]) / 2, valid = cols.map(o => !!o);
    if (!valid.some(Boolean)) throw new Error(T('Im STL-Modell wurden keine Querschnitte gefunden.'));
    for (let col = 0; col < NX; col++) if (!cols[col]) {
      let a = col - 1, b = col + 1; while (a >= 0 && !valid[a]) a--; while (b < NX && !valid[b]) b++;
      const y = a < 0 ? mid(cols[b]) : b >= NX ? mid(cols[a]) : (mid(cols[a]) + mid(cols[b])) / 2, o = new Float32Array(2 * K);
      for (let k = 0; k < K; k++) o[2 * k] = y; cols[col] = o;
    }
    void yPrev;
    return { xs, cols, tri: v.length / 9, dim: [L, yHi - yLo, 2 * zMax] };
  }
  // Gitter <-> Projekt (je Spalte eine Zeichenkette, 0,01 mm)
  const pack = g => ({ xs: g.xs.map(x => +x.toFixed(3)), k: K, d: g.cols.map(o => Array.from(o, w => Math.round(w * 100)).join(',')), tri: g.tri, dim: g.dim.map(r1) });
  let memo = null;   // { ref (cfg.grid), g }
  function grid() {
    const c = cfg(), p = c.grid;
    if (!p || !p.xs || !p.d || p.d.length !== p.xs.length || p.xs.length < 3) return null;
    if (memo && memo.ref === p) return memo.g;
    let g = null;
    try {
      const k = p.k | 0, cols = p.d.map(s => { const a = String(s).split(','), o = new Float32Array(2 * k); for (let i = 0; i < 2 * k; i++) o[i] = (+a[i] || 0) / 100; return o; });
      g = { xs: p.xs.slice(), cols, K: k, NB: p.xs.length, tri: p.tri || 0, dim: p.dim || [0, 0, 0] };
    } catch (e) { g = null; }
    memo = { ref: p, g, api: null };
    return g;
  }
  function rebuild() {
    const c = cfg(); if (!raw) return false;
    c.grid = pack(slice(c, raw)); memo = null; return true;
  }

  // ---------- Schnittstelle wie RumpfPro.api() ---------------------------------------------------
  function formerXs(c, x0, x1) {
    const own = String(c.frList || '').split(/[;,\s]+/).map(s => parseFloat(s.replace(',', '.'))).filter(x => isFinite(x) && x > x0 && x < x1).sort((a, b) => a - b);
    if (own.length) return own.filter((x, i) => i === 0 || x - own[i - 1] > 1e-3);
    const n = clamp(Math.round(+c.nFr || 0), 1, 80), e = clamp(+c.frEnds || 0, 0.5, 45) / 100 * (x1 - x0), out = [];
    for (let i = 0; i < n; i++) out.push(n === 1 ? (x0 + x1) / 2 : x0 + e + (x1 - x0 - 2 * e) * i / (n - 1));
    return out;
  }
  function api() {
    const g = grid(); if (!g) return null;
    if (memo.api) return memo.api;
    const { xs, cols, NB } = g, KK = g.K, x0 = xs[0], x1 = xs[NB - 1];
    const half = x => {
      x = clamp(x, x0, x1);
      let lo = 0, hi = NB - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
      const d = xs[hi] - xs[lo], t = d > 1e-12 ? (x - xs[lo]) / d : 0, A = cols[lo], B = cols[hi], out = new Array(KK);
      for (let a = 0; a < KK; a++) out[a] = [A[2 * a] + (B[2 * a] - A[2 * a]) * t, Math.max(0, A[2 * a + 1] + (B[2 * a + 1] - A[2 * a + 1]) * t)];
      return out;
    };
    const box = x => { const P = half(x); let w = 0; for (const q of P) if (q[1] > w) w = q[1]; return { top: P[0][0], bot: P[KK - 1][0], w, h: P[0][0] - P[KK - 1][0] }; };
    const G = []; for (let a = 0; a < KK; a++) { const row = new Array(NB); for (let b = 0; b < NB; b++) row[b] = [xs[b], cols[b][2 * a], cols[b][2 * a + 1]]; G.push(row); }
    return (memo.api = {
      src: 'stl', model: { G }, x0, x1, canopy: null,
      formers: () => formerXs(cfg(), x0, x1).map((x, i) => ({ i, x, type: 'stl', bad: '' })),
      bodyHalf: half, fullHalf: half, box,
      outline: (line, x) => { const b = box(x); return line === 'top' ? b.top : line === 'bot' ? b.bot : b.w; }
    });
  }
  const has = () => !!grid();

  // ---------- Laden ---------------------------------------------------------------------------------
  async function pick() {
    if (window.showOpenFilePicker) {
      const opts = Object.assign({ id: 'stl' }, App.pickerOpts ? App.pickerOpts('ldStl', '.stl') : {}, { types: [{ description: 'STL', accept: { 'model/stl': ['.stl'] } }] });
      const [fh] = await window.showOpenFilePicker(opts);
      if (App.markDirUsed) App.markDirUsed('ldStl', '.stl');
      const f = await fh.getFile(); return { name: f.name, buf: await f.arrayBuffer() };
    }
    return await new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.stl';
      inp.onchange = async () => { const f = inp.files && inp.files[0]; res(f ? { name: f.name, buf: await f.arrayBuffer() } : null); };
      inp.click();
    });
  }
  function loadBuffer(buf, name) {
    const v = parseSTL(buf); if (v.length < 36) throw new Error(T('Das STL-Modell enthält keine Dreiecke.'));
    for (let i = 0; i < v.length; i++) if (!isFinite(v[i])) throw new Error(T('Keine gültige STL-Datei.'));
    const c = cfg(), old = raw; raw = v;
    try { rebuild(); } catch (e) { raw = old; throw e; }
    c.name = name || 'modell.stl';
    return true;
  }
  async function load(onChange) {
    let f; try { f = await pick(); } catch (e) { if (e && e.name === 'AbortError') return; alert(T('Datei nicht lesbar: ') + (e && e.message ? e.message : e)); return; }
    if (!f) return;
    try { loadBuffer(f.buf, f.name); } catch (e) { alert(T('STL-Modell nicht verwendbar: ') + (e && e.message ? e.message : e)); return; }
    if (App.buildSidebar) App.buildSidebar();
    if (onChange) onChange();
  }
  function clear() { raw = null; memo = null; const c = cfg(); c.grid = null; c.name = ''; }
  function reset() { raw = null; memo = null; if (App.state && App.state.cfg) delete App.state.cfg.stlBody; }

  // ---------- Zeilen für die Seitenleisten der nutzenden Reiter -----------------------------------
  // opt.formers: zusätzlich die Spantlagen (Reiter „Rumpf Spanten")
  function rows(body, onChange, opt) {
    const { hint, numRow, boolRow, selectRow, mkMini, buildSidebar } = App, c = cfg(), g = grid();
    const RB = () => { if (buildSidebar) buildSidebar(); if (onChange) onChange(); };
    const re = () => { try { rebuild(); } catch (e) { alert(T('STL-Modell nicht verwendbar: ') + e.message); } RB(); };
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:5px 0';
    bar.appendChild(mkMini(T(g ? 'anderes STL laden…' : 'STL laden…'), () => load(onChange)));
    if (g) bar.appendChild(mkMini(T('STL entfernen'), () => { clear(); RB(); }));
    body.appendChild(bar);
    if (!g) { hint(body, 'Eigenes Rumpfmodell als STL-Datei (binär oder Text). Am besten nur der Rumpf ohne Tragflächen und Leitwerke — aus dem Modell werden Querschnitte quer zur Längsachse abgeleitet, die Außenkontur gilt beidseitig gespiegelt.'); return; }
    const info = document.createElement('div'); info.className = 'hint';
    info.textContent = (c.name || 'STL') + ' — ' + T('Länge') + ' ' + r1(g.dim[0]) + ' · ' + T('Höhe') + ' ' + r1(g.dim[1]) + ' · ' + T('Breite') + ' ' + r1(g.dim[2]) + ' mm' + (g.tri ? ' · ' + g.tri + ' ' + T('Dreiecke') : '');
    body.appendChild(info);
    if (raw) {
      selectRow(body, 'Längsachse im STL', [['auto', 'automatisch (größte Ausdehnung)'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], () => c.len, v => { c.len = v; re(); });
      selectRow(body, 'Hochachse im STL', [['auto', 'automatisch'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], () => c.up, v => { c.up = v; re(); });
      boolRow(body, 'Nase und Heck tauschen', () => !!c.flipX, v => { c.flipX = v; re(); });
      boolRow(body, 'oben und unten tauschen', () => !!c.flipUp, v => { c.flipUp = v; re(); });
      selectRow(body, 'Einheit im STL', [['1', 'Millimeter'], ['10', 'Zentimeter'], ['1000', 'Meter'], ['25.4', 'Zoll']], () => String(c.unit), v => { c.unit = +v || 1; re(); });
      numRow(body, 'Maßstab (Faktor)', () => c.scale, v => { c.scale = v > 0 ? v : 1; re(); }, { step: 0.1, min: 0.001, norender: true });
      selectRow(body, 'Symmetrieebene', [['auto', 'Mitte des Modells'], ['zero', 'Nullpunkt des STL (z. B. Halbmodell)']], () => c.mid, v => { c.mid = v; re(); });
      hint(body, 'Die Nase liegt bei X = 0. Stimmt die Lage nicht (Ansicht im Reiter prüfen), Achsen hier umstellen.');
    } else hint(body, 'Aus dem Projekt geladen. Zum Ändern von Ausrichtung, Einheit oder Maßstab die STL-Datei neu laden.');
    if (opt && opt.formers) {
      numRow(body, 'Anzahl Spanten', () => c.nFr, v => { c.nFr = clamp(Math.round(v), 1, 80); memo && (memo.api = null); RB(); }, { step: 1, min: 1, max: 80, int: true, norender: true });
      numRow(body, 'Abstand erster/letzter Spant von Nase/Heck (%)', () => c.frEnds, v => { c.frEnds = clamp(v, 0.5, 45); RB(); }, { step: 0.5, min: 0.5, max: 45, norender: true });
      const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = T('Eigene Spantlagen X (mm)');
      const i = document.createElement('input'); i.type = 'text'; i.value = c.frList || ''; i.placeholder = '50; 120; 200 …'; i.onchange = () => { c.frList = i.value; RB(); };
      r.appendChild(l); r.appendChild(i); body.appendChild(r);
      hint(body, 'Ohne eigene Lagen werden die Spanten gleichmäßig verteilt. Eigene Lagen: X-Werte ab der Nase, durch Semikolon getrennt.');
    }
  }

  window.StlBody = { has, api, load, loadBuffer, clear, reset, rows, slice, _test: { parseSTL, slice, axes, grid, cfg, NX: NX0, K } };
})();
