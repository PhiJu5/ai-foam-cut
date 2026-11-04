/* stegh.js — Ableitung der Steghöhen für Holm- und Ruderstege (Feature steghoehe)
 *
 * Eigener Reiter „Steghöhen“ (id stegh), einzige Quelle ist das Tragflächendesign (App.wing).
 * Daten in cfg.stegH (WING_CFG_KEYS, je Tragfläche). Seitenleiste: Einstellungen; Ansicht: Draufsicht +
 * Stege untereinander, darunter umschaltbar Höhenliste oder Schnitte in Spannweite.
 *
 * Höhe = senkrechter Schnitt durch die Außenkontur (Paneel zwischen den Rippen, inkl. Schränkung
 * und V-Form). Holmsteg: minus 2 × (Schale + Gurt), Rudersteg: minus 2 × Schale.
 * Steg-Form = (Länge entlang des Stegs, Höhe) — wahre Form in der senkrechten Stegebene.
 * Randbogen/Winglet und glatter .pc2-Grundriss des Formenbaus zählen nicht, nur die Segmente.
 * Andere Module rufen nur geschützt (App.stegHSidebar && …).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const COL = { holm: '#5aa9ff', ruder: '#ffa94d' };

  let sel = null, capOpen = false, stkOpen = false, stkBox = null;

  function cfg() {
    let c = state.cfg.stegH;
    if (!c || typeof c !== 'object') {
      // Altstand: getrennte Angaben aus Negativdesign/Formenbau, die erste mit Stegen wird übernommen
      const has = q => q && typeof q === 'object' && ((q.holm && q.holm.length) || (q.ruder && q.ruder.length));
      const n = state.cfg.negStegH, f = state.cfg.formStegH, old = has(n) ? n : has(f) ? f : (n || f);
      c = state.cfg.stegH = old && typeof old === 'object' ? JSON.parse(JSON.stringify(old)) : { shell: 1, step: 50, holm: [], ruder: [] };
    }
    if (!Array.isArray(c.holm)) c.holm = [];
    if (!Array.isArray(c.ruder)) c.ruder = [];
    if (!(+c.step > 0)) c.step = 50;
    // Holmgurt gilt für alle Holmstege; Altstand (je Steg) einmalig vom ersten Holmsteg übernehmen
    if (c.capMode !== 'mm' && c.capMode !== 'pct' && c.capT0 != null) c.capMode = 'pct';   // Gurt ist fest definiert, nicht mehr am Steg
    if (c.capT0 == null) {
      const h = c.holm[0] || {};
      c.capT0 = h.cap0 != null ? h.cap0 : 1; c.capT1 = h.cap1 != null ? h.cap1 : 1;
      c.capW0 = h.capW0 != null ? h.capW0 : 40; c.capW1 = h.capW1 != null ? h.capW1 : 10;
      c.capMode = 'pct'; c.capP0 = 30; c.capP1 = 30; c.capPerJoint = true;
    }
    return c;
  }

  // ---------- Geometrie ----------
  // Segmente in Gesamt-Koordinaten: z = Spannweite ab Wurzel, x = Rücklage (Wurzel-Nase = 0).
  function geo() {
    const W = App.wing; if (!W || !W.cuts || !W.cuts.length) return null;
    let z = 0, le = 0; const segs = [];
    W.cuts.forEach((cut, k) => {
      const sp = +cut.span || 0, sw = +cut.tip.pl.leOffset || 0, sg = state.segments[k] || {};
      segs.push({ k, cut, z0: z, z1: z + sp, le0: le, sw, sg }); z += sp; le += sw;
    });
    return z > 0 ? { segs, L: z } : null;
  }
  function locate(G, z) {
    let s = G.segs[0];
    for (const q of G.segs) { s = q; if (z <= q.z1) break; }
    const d = s.z1 - s.z0;
    return { s, t: d > 0 ? clamp((z - s.z0) / d, 0, 1) : 0 };
  }
  function frame(G, z) {
    const { s, t } = locate(G, z), a = s.cut.root.pl.chord, b = s.cut.tip.pl.chord;
    const pa = s.sg.hingePct != null ? +s.sg.hingePct : 25, pb = s.sg.hingePctTip != null ? +s.sg.hingePctTip : 25;
    return { le: s.le0 + s.sw * t, c: a + (b - a) * t, hp: pa + (pb - pa) * t };
  }
  // Senkrechter Schnitt durch die Außenkontur bei (x, z) → { top, bot } oder null (außerhalb des Profils)
  function section(G, x, z) {
    const { s, t } = locate(G, z), A = s.cut.root.pts, B = s.cut.tip.pts, n = Math.min(A.length, B.length);
    const lx = x - s.le0, sgn = state.cfg.flipY ? -1 : 1;
    let top = -Infinity, bot = Infinity;
    let px = A[n - 1].x + (B[n - 1].x - A[n - 1].x) * t, py = A[n - 1].y + (B[n - 1].y - A[n - 1].y) * t;
    for (let i = 0; i < n; i++) {
      const qx = A[i].x + (B[i].x - A[i].x) * t, qy = A[i].y + (B[i].y - A[i].y) * t;
      if ((px - lx) * (qx - lx) <= 0 && px !== qx) { const y = sgn * (py + (qy - py) * (lx - px) / (qx - px)); if (y > top) top = y; if (y < bot) bot = y; }
      px = qx; py = qy;
    }
    return top > bot ? { top, bot } : null;
  }
  // Stöße innerhalb des Stegs: { k, z } (k = Index des Segments innen am Stoß)
  const jointsIn = (G, a, b) => G.segs.slice(0, -1).map(q => ({ k: q.k, z: q.z1 })).filter(q => q.z > a + 1e-6 && q.z < b - 1e-6);
  const lerpPts = (P, z) => {
    for (let i = 1; i < P.length; i++) if (z <= P[i][0]) { const d = P[i][0] - P[i - 1][0]; return d > 0 ? P[i - 1][1] + (P[i][1] - P[i - 1][1]) * (z - P[i - 1][0]) / d : P[i][1]; }
    return P[P.length - 1][1];
  };
  // Lage entlang des Stegs: Stützstellen Anfang, ggf. eigene Lage je Segmentstoß, Ende; dazwischen gerade.
  function xFn(G, st, a, b) {
    const hinge = st.unit === 'hinge', pj = !!st.perJoint;
    const valAt = (z, v) => { if (hinge) return +v || 0; const f = frame(G, z); return f.le + (st.unit === 'mm' ? (+v || 0) : f.c * (+v || 0) / 100); };
    const v0 = hinge ? st.off : st.pos0, v1 = hinge ? (pj && st.off1 != null ? st.off1 : st.off) : st.pos1;
    const P = [[a, valAt(a, v0)]];
    if (pj) jointsIn(G, a, b).forEach(q => { const v = st.jpos && st.jpos[q.k]; if (v != null) P.push([q.z, valAt(q.z, v)]); });
    P.push([b, valAt(b, v1)]);
    if (hinge) return z => { const f = frame(G, z); return f.le + f.c * (1 - f.hp / 100) - lerpPts(P, z); };   // Abstand > 0 = vor dem Scharnier
    return z => lerpPts(P, z);
  }
  // Fehlende Stoß-Lagen mit dem bisherigen Verlauf vorbelegen (beim Einschalten, nach Ändern von Von/Bis)
  function fillJoints(G, st) {
    const a = clamp(Math.min(+st.from || 0, +st.to || 0), 0, G.L), b = clamp(Math.max(+st.from || 0, +st.to || 0), 0, G.L);
    if (!st.jpos) st.jpos = {};
    if (st.unit === 'hinge' && st.off1 == null) st.off1 = +st.off || 0;
    const hinge = st.unit === 'hinge', v0 = +(hinge ? st.off : st.pos0) || 0, v1 = +(hinge ? st.off1 : st.pos1) || 0;
    jointsIn(G, a, b).forEach(q => { if (st.jpos[q.k] == null) st.jpos[q.k] = Math.round((v0 + (v1 - v0) * (q.z - a) / (b - a)) * 100) / 100; });
    return jointsIn(G, a, b);
  }
  // Holmstege „auf dem Gurt verteilt“: erster bündig an der Vorderkante, letzter an der Hinterkante, dazwischen
  // gleichmäßig (einer allein mittig). Reicht die Gurtbreite nicht mehr, läuft nur der gewählte durch, die anderen enden.
  const distGroup = c => c.holm.filter(q => q.unit === 'gurt');
  const distThrough = g => g.find(q => q.through) || g[Math.floor((g.length - 1) / 2)];
  function distX(G, c, st, z) {
    const g = distGroup(c), i = g.indexOf(st), f = g.length > 1 ? i / (g.length - 1) : 0.5, B = capAt(G, c, 'capW', z), w = webOf(st, 'holm');
    return capCenter(G, c, z) - B / 2 + w / 2 + f * (B - w);
  }
  const rangeOf = (G, st) => [clamp(Math.min(+st.from || 0, +st.to || 0), 0, G.L), clamp(Math.max(+st.from || 0, +st.to || 0), 0, G.L)];
  function distFits(G, c, z) {
    const act = distGroup(c).filter(q => { const r = rangeOf(G, q); return z >= r[0] && z <= r[1]; });
    for (let i = 1; i < act.length; i++) {
      if (distX(G, c, act[i], z) - distX(G, c, act[i - 1], z) < (webOf(act[i], 'holm') + webOf(act[i - 1], 'holm')) / 2 - 1e-9) return false;
    }
    return true;
  }
  // Ende eines nicht durchlaufenden Stegs: erste Stelle (1-mm-Raster), an der die Stege nicht mehr nebeneinander passen
  function distEnd(G, c, st, a, b) {
    if (distThrough(distGroup(c)) === st) return b;
    for (let z = a; z < b; z += 1) if (!distFits(G, c, z)) return z;
    return distFits(G, c, b) ? b : Math.max(a, b - 1);
  }
  // Vorderer Rudersteg automatisch: gemeinsamer Versatz nach vorne (0,5-mm-Schritte), bis die am Ruder befestigte Lippe
  // über den ganzen Steg und bis zum gewählten Ausschlag in beide Richtungen den Mindestabstand hat. → { s, fail } oder null
  const autoCache = new WeakMap();
  function autoShift(G, c, st, a, b, xAt) {
    if (!c.lipOn || !c.lipAuto || c.lipFix === 'wing' || !(b > a)) return null;
    let M = autoCache.get(App.wing); if (!M) autoCache.set(App.wing, M = new Map());
    const key = JSON.stringify([st, a, b, c.shell, c.layOn, c.layA, c.layS, c.layI, c.ruderOn, c.lipSide, c.lipLen, c.lipOver, c.lipT, c.lipGap, c.lipR, c.lipSlot, c.lipAuto, c.lipMax, c.lipMargin, G.segs.map(q => q.sg.hingeSide + q.sg.hingePct + '/' + q.sg.hingePctTip)]);
    if (M.has(key)) return M.get(key);
    const mx = Math.max(0, +c.lipMax || 0), margin = Math.max(0, +c.lipMargin || 0), web = webOf(st, 'ruder'), angs = [0];
    for (let d = 5; d < mx; d += 5) angs.push(d, -d);
    if (mx > 0) angs.push(mx, -mx);
    const zs = jointsIn(G, a, b).map(q => q.z).concat([a, b]);
    for (let z = a + 25; z < b; z += 25) zs.push(z);
    let sh = 0, fail = false, front = false;
    for (const z of zs) {
      const R = ruderAt(G, c, z, []); if (!R || !R.lip || R.lip.length < 2 || xAt(z) >= R.xh) continue;
      front = true;
      const f = frame(G, z), inset = insetOf(G, c, 'ruder', z);
      const ok = q => {
        const x = xAt(z) - q, sL = section(G, x - web / 2, z), sR = section(G, x + web / 2, z); if (!sL || !sR) return true;
        const Q = [[x - web / 2, sL.top - inset], [x + web / 2, sR.top - inset], [x + web / 2, sR.bot + inset], [x - web / 2, sL.bot + inset]];
        return angs.every(d => R.clearQ(Q, d) >= margin);
      };
      while (!ok(sh)) { sh += 0.5; if (xAt(z) - sh - web / 2 <= f.le) { fail = true; break; } }
      if (fail) break;
    }
    const res = front ? { s: sh, fail } : null;
    M.set(key, res);
    return res;
  }
  // Alles zu einem Steg: Bahn, Länge, Stationen (Raster + Segmentstöße), Umriss
  function stegData(G, c, st, kind) {
    const dist = kind === 'holm' && st.unit === 'gurt';
    if (st.perJoint && !dist) fillJoints(G, st);
    const a0 = rangeOf(G, st)[0], b0 = rangeOf(G, st)[1], b = dist ? distEnd(G, c, st, a0, b0) : b0;
    const xBase = dist ? z => distX(G, c, st, z) : xFn(G, st, a0, b), auto = kind === 'ruder' ? autoShift(G, c, st, a0, b, xBase) : null, xAt = auto && auto.s ? z => xBase(z) - auto.s : xBase;
    // Trifft der Steg die Steckungshülse, beginnt er erst hinter ihrer letzten Berührung; seine Lage bleibt
    const a = stkTrim(G, c, st, kind, a0, b, xAt), joints = G.segs.slice(0, -1).map(q => q.z1).filter(z => z > a + 1e-6 && z < b - 1e-6);
    const zs = []; const N = Math.max(2, Math.ceil((b - a) / 2));
    for (let i = 0; i <= N; i++) zs.push(a + (b - a) * i / N);
    zs.push(...joints); zs.sort((p, q) => p - q);
    const path = []; let s = 0;
    zs.forEach((z, i) => { const x = xAt(z); if (i) s += Math.hypot(z - zs[i - 1], x - path[i - 1].x); path.push({ z, x, s }); });
    const len = s;
    const zOf = q => { for (let i = 1; i < path.length; i++) if (q <= path[i].s) { const p0 = path[i - 1], p1 = path[i], d = p1.s - p0.s; return d > 0 ? p0.z + (p1.z - p0.z) * (q - p0.s) / d : p0.z; } return b; };
    const sOf = z => { for (let i = 1; i < path.length; i++) if (z <= path[i].z + 1e-9) return path[i].s - (path[i].z - z) * (path[i].s - path[i - 1].s) / ((path[i].z - path[i - 1].z) || 1); return len; };
    const at = (z, q) => {
      const x = xAt(z), sec = section(G, x, z), inset = insetOf(G, c, kind, z);
      return sec ? { z, s: q, x, H: sec.top - sec.bot, ded: 2 * inset, h: sec.top - sec.bot - 2 * inset, top: sec.top - inset, bot: sec.bot + inset } : { z, s: q, x, H: null, ded: 2 * inset, h: null };
    };
    // Liste: alle x mm Steglänge + Anfang/Ende + jeder Segmentstoß
    const step = Math.max(1, +c.step || 50), marks = [];
    for (let q = 0; q < len - 0.5; q += step) marks.push({ s: q, z: zOf(q), note: q === 0 ? 'Anfang' : '' });
    joints.forEach(z => {
      const q = sOf(z), k = G.segs.findIndex(g => Math.abs(g.z1 - z) < 1e-6), hit = marks.findIndex(m => Math.abs(m.s - q) < 0.5);
      const note = T('Segmentstoß') + ' ' + (k + 1) + '|' + (k + 2);
      if (hit >= 0) { marks[hit].z = z; marks[hit].s = q; marks[hit].note = note; } else marks.push({ s: q, z, note });
    });
    marks.push({ s: len, z: b, note: 'Ende' });
    marks.sort((p, q) => p.s - q.s);
    const rows = marks.map(m => Object.assign(at(m.z, m.s), { note: m.note }));
    // Umriss fein abgetastet; Lücken (außerhalb des Profils, Höhe ≤ 0) trennen die Teilstücke
    const M = Math.max(2, Math.ceil(len / 5)), sm = [];
    for (let i = 0; i <= M; i++) sm.push(len * i / M);
    joints.forEach(z => sm.push(sOf(z))); rows.forEach(r => sm.push(r.s)); sm.sort((p, q) => p - q);
    const runs = []; let cur = null;
    sm.forEach(q => { const r = at(zOf(q), q); if (r.h != null && r.h > 0) { if (!cur) runs.push(cur = []); cur.push(r); } else cur = null; });
    const polys = runs.filter(R => R.length >= 2 && len > 1e-6).map(R => R.map(r => [r.s, r.top]).concat(R.slice().reverse().map(r => [r.s, r.bot])));
    return { st, kind, a, b, len, path, rows, polys, at, auto, cut: b < b0 - 1e-6, stkCut: a > a0 + 1e-6 };
  }
  const webOf = (st, kind) => st.web != null ? Math.max(0, +st.web || 0) : (kind === 'holm' ? 3 : 2);
  // Gurtwerte: Wurzel → Außenende der Tragfläche linear
  function capAt(G, c, key, z) { const a = +c[key + '0'] || 0, b = +c[key + '1'] || 0; return Math.max(0, a + (b - a) * (G.L > 0 ? z / G.L : 0)); }
  // Gurtmitte (Gesamt-x) an der Stelle z, unabhängig von den Stegen: Stützstellen Wurzel, ggf. je Segmentstoß, außen;
  // dazwischen im Grundriss gerade.
  // Schale: eine Dicke oder Aufbau aus Außenlage, Stützstoff, Innenlage (je Seite)
  const layA = c => Math.max(0, +c.layA || 0), layS = c => Math.max(0, +c.layS || 0), layI = c => Math.max(0, +c.layI || 0);
  const shellOf = c => (c.layOn ? layA(c) + layS(c) + layI(c) : Math.max(0, +c.shell || 0));
  const capOnOuter = c => !!c.layOn && c.capOn === 'outer';
  // Abstand der Gurt-Außenfläche von der Profilkontur
  const capFace = c => (capOnOuter(c) ? layA(c) : shellOf(c) - capEmbed(c));
  // Abzug je Seite an der Stelle z: von der Profilkontur bis zur Auflage des Stegs
  function insetOf(G, c, kind, z) {
    if (kind !== 'holm') return c.layOn && c.ruderOn === 'outer' ? layA(c) : shellOf(c);
    const cap = capAt(G, c, 'capT', z);
    if (capOnOuter(c)) return layA(c) + cap + (c.capOver !== false ? layI(c) : 0);
    return shellOf(c) + Math.max(0, cap - capEmbed(c));
  }
  // Wie tief der Gurt in die Schale eingelassen ist (höchstens die Schalendicke), 0 = liegt innen auf der Schale
  const capEmbed = c => (c.capIn ? clamp(+c.capInMM || 0, 0, shellOf(c)) : 0);
  function capCenter(G, c, z) {
    const val = (q, v) => { const f = frame(G, q); return f.le + (c.capMode === 'mm' ? (+v || 0) : f.c * (+v || 0) / 100); };
    const P = [[0, val(0, c.capP0)]];
    if (c.capOrtho) return P[0][1];   // von oben gesehen rechtwinklig zur Wurzelrippe: gleiche Rücklage über die ganze Spannweite
    if (c.capPerJoint) jointsIn(G, 0, G.L).forEach(q => { const v = c.capJ && c.capJ[q.k]; if (v != null) P.push([q.z, val(q.z, v)]); });
    P.push([G.L, val(G.L, c.capP1)]);
    return lerpPts(P, z);
  }
  // Mitte der Steckung: folgt dem Gurt oder steht für sich rechtwinklig zur Wurzelrippe
  const stkCenter = (G, c, z) => capCenter(G, c, c.stkOrtho ? 0 : z);
  function fillCapJoints(G, c) {
    if (!c.capJ) c.capJ = {};
    const J = jointsIn(G, 0, G.L);
    J.forEach(q => { if (c.capJ[q.k] == null) c.capJ[q.k] = Math.round(((+c.capP0 || 0) + ((+c.capP1 || 0) - (+c.capP0 || 0)) * q.z / G.L) * 100) / 100; });
    return J;
  }
  // Steckung: gerades Rohr zwischen den Gurten, ab Wurzel über die Einbindetiefe, entlang der Gurtmitte.
  // Maßgebend ist die engste Stelle über Länge und Breite (Gurt-Innenflächen, bei Rund auf der sicheren Seite).
  const stkCache = new WeakMap();
  function stkData(G, c) {
    if (!c.stkOn) return null;
    let M = stkCache.get(App.wing); if (!M) stkCache.set(App.wing, M = new Map());
    const key = JSON.stringify(Object.keys(c).filter(k => k !== 'holm' && k !== 'ruder' && k !== 'step' && !/^lip/.test(k)).sort().map(k => [k, c[k]]));
    if (!M.has(key)) { if (M.size > 50) M.clear(); M.set(key, stkCalc(G, c)); }
    return M.get(key);
  }
  function stkTrim(G, c, st, kind, a, b, xAt) {
    const S = stkData(G, c); if (!S || S.cy == null || !(S.oW > 0)) return a;
    const e = Math.min(b, S.len), web = webOf(st, kind), hit = z => Math.abs(xAt(z) - stkCenter(G, c, z)) < S.oW / 2 + web / 2;
    let last = null;
    for (let z = a; z < e; z += 1) if (hit(z)) last = z;
    if (e >= a && hit(e)) last = e;
    return last == null ? a : Math.min(b, Math.min(last + 1, S.len));
  }
  function stkCalc(G, c) {
    const len = clamp(+c.stkLen || 0, 0, G.L), wall = Math.max(0, +c.stkWall || 0), round = c.stkForm === 'round', zs = [];
    // V-Form nur bei Rund: positiver Winkel = Hülse fällt nach außen gegen die Profilebene (Höhe y = cy + z·tan, tan < 0)
    const vDeg = round ? clamp(+c.stkV || 0, -45, 45) : 0, tan = -Math.tan(vDeg * Math.PI / 180), cos = Math.cos(vDeg * Math.PI / 180);
    const N = Math.max(1, Math.min(40, Math.ceil(len / 10)));
    for (let i = 0; i <= N; i++) zs.push(len * i / N);
    jointsIn(G, 0, len).forEach(q => zs.push(q.z));
    const capMin = Math.min(...zs.map(z => capAt(G, c, 'capW', z)));
    const box = w => {
      let top = Infinity, bot = -Infinity;
      for (const z of zs) {
        const xc = stkCenter(G, c, z), ins = insetOf(G, c, 'holm', z);
        for (let i = 0; i <= 8; i++) { const s = section(G, xc - w / 2 + w * i / 8, z); if (!s) return null; top = Math.min(top, s.top - ins - z * tan); bot = Math.max(bot, s.bot + ins - z * tan); }
      }
      return { top, bot, H: (top - bot) * cos };
    };
    // Mögliches Maß; bei Vierkant ist die Breite vorgegeben
    let pOW, pOH;
    if (round) {
      let lo = 0, hi = capMin;
      for (let i = 0; i < 24; i++) { const d = (lo + hi) / 2, q = box(d); if (q && q.H >= d) lo = d; else hi = d; }
      pOW = pOH = lo;
    } else { pOW = Math.max(0, +c.stkW || 0) + 2 * wall; const q = box(pOW); pOH = q ? q.H : 0; }
    const pH = Math.max(0, pOH - 2 * wall), pW = Math.max(0, pOW - 2 * wall);
    // Festes Maß: Hülse ergibt sich daraus, die Prüfung meldet, wenn es nicht passt
    const fix = !!c.stkFix && +c.stkD > 0, D = fix ? +c.stkD : 0;
    const oW = fix && round ? D + 2 * wall : pOW, oH = fix ? D + 2 * wall : pOH, b = box(oW), warn = [];
    if (!b) return { round, wall, len, fix, vDeg, tan: 0, pH, pW, inW: 0, inH: 0, oW, oH: 0, warn: [T('Die Hülse ragt aus dem Profil.')] };
    if (fix && oH > b.H + 1e-6) warn.push(T('Passt nicht: Hülse außen') + ' ' + f1(oH) + ' mm, ' + T('Platz zwischen den Gurten') + ' ' + f1(b.H) + ' mm');
    if (oW > capMin + 1e-6) warn.push(T('Die Hülse ist breiter als der Gurt an der schmalsten Stelle:') + ' ' + f1(capMin) + ' mm');
    const inH = oH - 2 * wall, inW = oW - 2 * wall;
    if (inH <= 0 || inW <= 0) warn.push(T('Zwischen den Gurten bleibt kein Platz für die Steckung.'));
    return { round, wall, len, fix, vDeg, tan, pH, pW, oW, oH, inW: Math.max(0, inW), inH: Math.max(0, inH), cy: (b.top + b.bot) / 2, warn };
  }
  // Abgerundet: die Steckung muss hineinpassen
  const fl1 = v => (Math.floor(v * 10 + 1e-6) / 10).toFixed(1);
  function stkResult() {
    if (!stkBox) return;
    const G = geo(), S = G ? stkData(G, cfg()) : null; stkBox.innerHTML = ''; if (!S) return;
    const line = (t, col) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'font-size:12px;margin-top:3px' + (col ? ';color:' + col : ''); stkBox.appendChild(d); };
    if (S.round) line(T('Steckung möglich: Ø') + ' ' + fl1(S.pH) + ' mm', '#7ee0a0');
    else line(T('Steckung möglich: Dicke') + ' ' + fl1(S.pH) + ' mm × ' + T('Breite') + ' ' + fl1(S.pW) + ' mm', '#7ee0a0');
    if (S.fix) line(T('Eingetragen:') + ' ' + (S.round ? 'Ø ' + f1(S.inH) : f1(S.inH) + ' × ' + f1(S.inW)) + ' mm');
    line(S.round ? T('Hülse außen: Ø') + ' ' + f1(S.oH) + ' mm' : T('Hülse außen:') + ' ' + f1(S.oH) + ' × ' + f1(S.oW) + ' mm');
    S.warn.forEach(w => line(w, '#ffb454'));
  }
  function allStege(G, c) {
    return c.holm.map(st => stegData(G, c, st, 'holm')).concat(c.ruder.map(st => stegData(G, c, st, 'ruder')));
  }
  function newSteg(kind, i, L) {
    if (kind === 'holm') return { name: T('Holmsteg') + ' ' + (i + 1), from: 0, to: L, unit: 'pct', pos0: i === 1 ? 60 : 30, pos1: i === 1 ? 60 : 30, perJoint: true, web: 3 };
    return { name: T('Rudersteg') + ' ' + (i + 1), from: 0, to: L, unit: 'hinge', pos0: 75, pos1: 75, off: 5, web: 2 };
  }
  function setCount(kind, n) {
    const c = cfg(), G = geo(), L = G ? G.L : 1000, arr = c[kind];
    n = clamp(Math.round(n) || 0, 0, 20);
    while (arr.length < n) {
      const st = newSteg(kind, arr.length, Math.round(L));
      // Zweiter Rudersteg: gleicher Bereich wie der erste, gleicher Abstand, aber hinter dem Scharnier
      if (kind === 'ruder' && arr.length === 1) { const f = arr[0]; st.from = f.from; st.to = f.to; st.off = -Math.abs(f.unit === 'hinge' && +f.off ? +f.off : 5); }
      arr.push(st);
    }
    if (arr.length > n) { if (arr.indexOf(sel) >= n) sel = null; arr.length = n; }
    refresh(true); fitNext = autoFit = true; draw();
  }

  // ---------- Ansicht ----------
  let win = null, side = null, cv = null, cx = null, tbl = null, bottom = 'list', tabBtns = {}, view = { s: 1, ox: 0, oy: 0 }, fitNext = true, autoFit = true, drag = null, hits = [];
  const isOpen = () => !!win && state.activeTab === 'stegh';
  function show() {
    if (!win) build();
    if (App.recompute) App.recompute();
    fitNext = autoFit = true; refresh(true);
  }
  function setBottom(b) {
    bottom = b; sFit = true;
    tbl.style.display = b === 'list' ? '' : 'none'; secPane.style.display = b === 'sec' ? 'flex' : 'none';
    for (const k in tabBtns) tabBtns[k].className = k === b ? 'primary' : '';
    if (b === 'sec') { const G = geo(); if (G) secZ = clamp(secZ, 0, G.L); secBar(); }
    draw(); drawSec();
  }
  function build() {
    const host = document.getElementById('steghView');
    win = document.createElement('div');
    win.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;min-width:0';
    const cw = document.createElement('div'); cw.style.cssText = 'flex:3;position:relative;min-height:0';
    cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    cw.appendChild(cv);
    const strip = document.createElement('div'); strip.style.cssText = 'display:flex;gap:4px;padding:4px 10px;border-top:1px solid var(--border,#2a3038)';
    [['list', 'Höhenliste'], ['sec', 'Schnitte in Spannweite']].forEach(([k, t]) => { const b = document.createElement('button'); b.textContent = T(t); b.onclick = () => setBottom(k); tabBtns[k] = b; strip.appendChild(b); });
    const low = document.createElement('div'); low.style.cssText = 'flex:3;display:flex;min-height:0;position:relative';
    tbl = document.createElement('div'); tbl.style.cssText = 'flex:1;overflow:auto;min-height:0;padding:6px 10px;font-size:12px';
    buildSec();
    low.append(tbl, secPane); win.append(cw, strip, low); host.appendChild(win);
    cx = cv.getContext('2d');
    setBottom(bottom);
    new ResizeObserver(() => { if (autoFit) fitNext = true; draw(); }).observe(cw);
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      autoFit = false; const wx = (mx - view.ox) / view.s, wy = (view.oy - my) / view.s; view.s *= f; view.ox = mx - wx * view.s; view.oy = my + wy * view.s; draw();
    }, { passive: false });
    cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false }; });
    window.addEventListener('mousemove', e => { if (!drag) return; if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) { drag.moved = true; autoFit = false; } view.ox = drag.ox + e.clientX - drag.x; view.oy = drag.oy + e.clientY - drag.y; draw(); });
    window.addEventListener('mouseup', e => {
      if (!drag) return; const d = drag; drag = null; if (d.moved) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;   // Klick wählt den nächsten Steg
      let best = null, bd = 12;
      for (const h of hits) { const q = Math.hypot(h[0] - mx, h[1] - my) - (h[3] || 0); if (q < bd) { bd = q; best = h[2]; } }
      if (best && best !== sel) { sel = best; refresh(true); const nb = side.querySelector('[data-selsteg]'); if (nb) nb.scrollIntoView({ block: 'nearest' }); }
    });
    cv.addEventListener('dblclick', () => { fitNext = autoFit = true; draw(); });
  }

  // Seitenleiste des Reiters (Aufbau nur bei Strukturänderung, Zahlen rechnen ohne Neuaufbau)
  function buildSide() {
    if (!side) return;
    const { numRow, selectRow, hint, subhead, txtRow } = App, c = cfg(), G = geo(), L = G ? G.L : 0, scr = document.getElementById('side'), keep = scr ? scr.scrollTop : 0;
    side.innerHTML = '';
    const NR = { step: 0.5, min: 0, norender: true, enter: true };
    const upd = () => { update(); };
    hint(side, 'Höhen aus der Außenkontur der aktiven Tragfläche im Tragflächendesign, senkrecht gemessen. Holmsteg: Abzug 2 × (Schale + Gurt). Rudersteg: Abzug 2 × Schale. Ansicht: Rad = Zoom, Ziehen = verschieben, Klick = Steg wählen, Doppelklick = einpassen.');
    if (!G) { hint(side, 'Keine Tragfläche vorhanden.'); return; }
    App.boolRow(side, 'Schale aus Außenlage, Stützstoff, Innenlage', () => !!c.layOn, v => {
      c.layOn = v;
      if (v && c.layA == null) { c.layA = 0.2; c.layS = Math.max(0, (+c.shell || 0) - 0.4); c.layI = 0.2; c.capOn = 'inner'; c.ruderOn = 'inner'; c.capOver = true; }
      refresh(true);
    });
    if (c.layOn) {
      const NL = Object.assign({}, NR, { step: 0.1 });
      numRow(side, 'Außenlage je Seite (mm)', () => c.layA, v => { c.layA = Math.max(0, v); upd(); }, NL);
      numRow(side, 'Stützstoff je Seite (mm)', () => c.layS, v => { c.layS = Math.max(0, v); upd(); }, NL);
      numRow(side, 'Innenlage je Seite (mm)', () => c.layI, v => { c.layI = Math.max(0, v); upd(); }, NL);
      const ON = [['inner', 'Innenlage'], ['outer', 'Außenlage']];
      selectRow(side, 'Holmgurt liegt auf', ON, () => c.capOn || 'inner', v => { c.capOn = v; refresh(true); });
      if (c.capOn === 'outer') App.boolRow(side, 'Innenlage läuft über den Gurt', () => c.capOver !== false, v => { c.capOver = v; upd(); }, 'An: Der Steg steht auf der Innenlage über dem Gurt. Aus: Der Steg steht direkt auf dem Gurt.');
      selectRow(side, 'Ruderstege liegen auf', ON, () => c.ruderOn || 'inner', v => { c.ruderOn = v; upd(); });
    } else numRow(side, 'Schalendicke je Seite (mm)', () => c.shell, v => { c.shell = Math.max(0, v); upd(); }, NR);
    numRow(side, 'Höhe alle … mm Steglänge', () => c.step, v => { c.step = Math.max(1, v); upd(); }, Object.assign({}, NR, { step: 10, min: 1 }));
    // Holmgurt: aufklappbar, fest definiert und unabhängig von den Stegen
    const det = document.createElement('details'); det.open = capOpen; det.ontoggle = () => { capOpen = det.open; };
    const sum = document.createElement('summary'); sum.textContent = T('Holmgurt'); sum.style.cssText = 'cursor:pointer;font-weight:700;font-size:13px;margin-top:6px';
    det.appendChild(sum); side.appendChild(det);
    const GR = Object.assign({}, NR, { step: 0.1 }), GB = Object.assign({}, NR, { step: 1 });
    numRow(det, 'Gurtdicke je Seite Wurzel (mm)', () => c.capT0, v => { c.capT0 = Math.max(0, v); upd(); }, GR);
    numRow(det, 'Gurtdicke je Seite außen (mm)', () => c.capT1, v => { c.capT1 = Math.max(0, v); upd(); }, GR);
    numRow(det, 'Gurtbreite Wurzel (mm)', () => c.capW0, v => { c.capW0 = Math.max(0, v); upd(); }, GB);
    numRow(det, 'Gurtbreite außen (mm)', () => c.capW1, v => { c.capW1 = Math.max(0, v); upd(); }, GB);
    if (!capOnOuter(c)) App.boolRow(det, 'Gurt in die Schale eingelassen', () => !!c.capIn, v => { c.capIn = v; if (v && c.capInMM == null) c.capInMM = shellOf(c); refresh(true); });
    if (c.capIn && !capOnOuter(c)) numRow(det, 'Eingelassen um (mm, höchstens Schalendicke)', () => c.capInMM, v => { c.capInMM = Math.max(0, v); upd(); }, GR);
    selectRow(det, 'Gurtlage', [['pct', '% der Sehne ab Nase'], ['mm', 'mm ab Nase']], () => c.capMode, v => {
      // gleiche Lage behalten, nur die Einheit wechselt
      const conv = (z, val) => { const f = frame(G, z), x = f.le + (c.capMode === 'mm' ? (+val || 0) : f.c * (+val || 0) / 100), r = v === 'mm' ? x - f.le : (x - f.le) / f.c * 100; return Math.round(r * 100) / 100; };
      c.capP0 = conv(0, c.capP0); c.capP1 = conv(L, c.capP1);
      if (c.capJ) jointsIn(G, 0, L).forEach(q => { if (c.capJ[q.k] != null) c.capJ[q.k] = conv(q.z, c.capJ[q.k]); });
      c.capMode = v; refresh(true);
    });
    App.boolRow(det, 'Rechtwinklig zur Wurzelrippe (Draufsicht)', () => !!c.capOrtho, v => { c.capOrtho = v; refresh(true); }, 'Gurt und Steckung laufen von oben gesehen gerade, rechtwinklig zur Wurzelrippe: gleiche Rücklage wie an der Wurzel über die ganze Spannweite.');
    if (G.segs.length > 1 && !c.capOrtho) App.boolRow(det, 'Lage je Segmentstoß einzeln', () => !!c.capPerJoint, v => { c.capPerJoint = v; refresh(true); });
    {
      const u = c.capMode === 'mm' ? ' (mm)' : ' (%)', GP = Object.assign({}, NR, { step: 1 });
      numRow(det, T('Gurtmitte Wurzel') + u, () => c.capP0, v => { c.capP0 = v; upd(); }, GP);
      if (c.capPerJoint && !c.capOrtho && G.segs.length > 1) fillCapJoints(G, c).forEach(q => numRow(det, T('Gurtmitte') + ' ' + T('Segmentstoß') + ' ' + (q.k + 1) + '|' + (q.k + 2) + u, () => c.capJ[q.k], v => { c.capJ[q.k] = v; upd(); }, GP));
      if (!c.capOrtho) numRow(det, T('Gurtmitte außen') + u, () => c.capP1, v => { c.capP1 = v; upd(); }, GP);
    }
    // Steckung: aufklappbar, liegt immer zwischen den Gurten
    const dk = document.createElement('details'); dk.open = stkOpen; dk.ontoggle = () => { stkOpen = dk.open; };
    const sk = document.createElement('summary'); sk.textContent = T('Steckung'); sk.style.cssText = 'cursor:pointer;font-weight:700;font-size:13px;margin-top:6px';
    dk.appendChild(sk); side.appendChild(dk);
    App.boolRow(dk, 'Steckung vorsehen', () => !!c.stkOn, v => {
      c.stkOn = v;
      if (v && c.stkWall == null) { c.stkWall = 1; c.stkLen = Math.round(Math.min(200, L)); c.stkForm = 'square'; c.stkW = 15; }
      refresh(true);
    });
    stkBox = null;
    if (c.stkOn) {
      selectRow(dk, 'Form', [['square', 'Vierkant'], ['round', 'Rund']], () => c.stkForm || 'square', v => { c.stkForm = v; refresh(true); });
      if (!c.capOrtho) App.boolRow(dk, 'Rechtwinklig zur Wurzelrippe (Draufsicht)', () => !!c.stkOrtho, v => { c.stkOrtho = v; refresh(true); }, 'Nur die Steckung läuft von oben gesehen gerade, rechtwinklig zur Wurzelrippe, ab der Gurtmitte an der Wurzel. Der Gurt bleibt, wie er ist.');
      numRow(dk, 'Wandstärke Hülse (mm)', () => c.stkWall, v => { c.stkWall = Math.max(0, v); upd(); }, GR);
      numRow(dk, 'Einbindetiefe ab Wurzel (mm)', () => c.stkLen, v => { c.stkLen = clamp(v, 0, L); upd(); }, Object.assign({}, NR, { step: 10 }));
      if (c.stkForm !== 'round') numRow(dk, 'Breite Steckung (mm)', () => c.stkW, v => { c.stkW = Math.max(0, v); upd(); }, GB);
      if (c.stkForm === 'round') numRow(dk, 'V-Form der Steckung (° je Seite)', () => c.stkV || 0, v => { c.stkV = clamp(v, -45, 45); upd(); }, Object.assign({}, NR, { step: 0.5, min: -45, max: 45 }));
      App.boolRow(dk, 'Festes Maß eintragen', () => !!c.stkFix, v => { c.stkFix = v; if (v && !(+c.stkD > 0)) { const S0 = stkData(G, c); c.stkD = S0 ? Math.floor(S0.pH * 10) / 10 : 0; } refresh(true); });
      if (c.stkFix) numRow(dk, c.stkForm === 'round' ? 'Durchmesser Steckung (mm)' : 'Dicke Steckung (mm)', () => c.stkD, v => { c.stkD = Math.max(0, v); upd(); }, GR);
      stkBox = document.createElement('div'); dk.appendChild(stkBox);
    }
    if (!sel || (c.holm.indexOf(sel) < 0 && c.ruder.indexOf(sel) < 0)) sel = c.holm[0] || c.ruder[0] || null;
    for (const [kind, label] of [['holm', 'Holmstege'], ['ruder', 'Ruderstege']]) {
      subhead(side, label, COL[kind]);
      numRow(side, 'Anzahl', () => c[kind].length, v => setCount(kind, v), { step: 1, min: 0, max: 20, int: true, norender: true, enter: true });
      c[kind].forEach((st, i) => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center';
        const nb = document.createElement('button'); nb.textContent = st.name || (T(label) + ' ' + (i + 1)); nb.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left';
        if (st === sel) { nb.className = 'primary'; nb.dataset.selsteg = '1'; } nb.onclick = () => { sel = st; refresh(true); };
        const del = document.createElement('button'); del.textContent = '✕'; del.title = T('Steg löschen'); del.style.padding = '2px 7px';
        del.onclick = () => { c[kind].splice(i, 1); if (sel === st) sel = null; fitNext = autoFit = true; refresh(true); };
        row.append(nb, del); side.appendChild(row);
      });
    }
    if (sel) {
      const st = sel, kind = c.holm.indexOf(st) >= 0 ? 'holm' : 'ruder';
      subhead(side, 'Gewählter Steg');
      txtRow(side, 'Name', () => st.name || '', v => { st.name = v; upd(); });
      const lenNow = () => stegData(G, c, st, kind).len;
      let iFrom, iTo, iLen;
      const after = () => { if (st.perJoint) refresh(true); else upd(); };   // andere Stöße im Bereich -> neue Zeilen
      const sync = () => { if (iFrom) iFrom.value = f1(+st.from || 0); if (iTo) iTo.value = f1(+st.to || 0); if (iLen) iLen.value = f1(lenNow()); };
      iFrom = numRow(side, 'Von (mm ab Wurzel)', () => st.from, v => { st.from = clamp(v, 0, L); sync(); after(); }, Object.assign({}, NR, { step: 10 }));
      iTo = numRow(side, 'Bis (mm ab Wurzel)', () => st.to, v => { st.to = clamp(v, 0, L); sync(); after(); }, Object.assign({}, NR, { step: 10 }));
      iLen = numRow(side, 'Länge des Stegs (mm)', () => f1(lenNow()), v => {
        const l0 = lenNow(), d = Math.abs((+st.to || 0) - (+st.from || 0));
        st.to = clamp((+st.from || 0) + Math.max(0, v) * (l0 > 0 ? d / l0 : 1), 0, L); sync(); after();
      }, Object.assign({}, NR, { step: 10 }));
      hint(side, T('Spannweite gesamt: ') + f1(L) + ' mm');
      const units = [['pct', '% der Sehne ab Nase'], ['mm', 'mm ab Nase']];
      if (kind === 'ruder') units.push(['hinge', 'an der Scharnierlinie']);
      if (kind === 'holm') units.push(['gurt', 'auf dem Gurt verteilt']);
      selectRow(side, 'Lage angeben', units, () => st.unit || 'pct', v => { if (v === 'gurt') c.holm.forEach(q => { q.unit = 'gurt'; }); st.unit = v; fitNext = autoFit = true; refresh(true); });
      const onCap = st.unit === 'gurt', joints = G.segs.length > 1 && !onCap ? (st.perJoint ? fillJoints(G, st) : null) : null;
      if (G.segs.length > 1 && !onCap) App.boolRow(side, 'Lage je Segmentstoß einzeln', () => !!st.perJoint, v => { st.perJoint = v; refresh(true); }, 'An: eigene Lage an jedem Segmentstoß im Bereich des Stegs; dazwischen läuft er im Grundriss gerade.');
      const jName = q => T('Segmentstoß') + ' ' + (q.k + 1) + '|' + (q.k + 2);
      if (onCap) {
        const grp = distGroup(c), thr = distThrough(grp);
        hint(side, 'Erster Steg an der Vorderkante des Gurts, letzter an der Hinterkante, die übrigen gleichmäßig dazwischen. Reicht die Gurtbreite nicht mehr, läuft nur der gewählte durch, die anderen enden dort.');
        selectRow(side, 'Durchlaufender Steg', grp.map((q, i) => [String(i), q.name || String(i + 1)]), () => String(grp.indexOf(thr)), v => { grp.forEach((q, i) => { q.through = i === +v; }); refresh(true); });
      } else if (st.unit === 'hinge') {
        // Abstand zur Scharnierlinie: intern mit Vorzeichen (> 0 = vor dem Scharnier), Richtung als eigene Wahl
        const hRow = (name, get, set) => {
          let dir = get() < 0 ? -1 : 1;
          selectRow(side, name, [['1', 'vor der Scharnierlinie'], ['-1', 'nach der Scharnierlinie']], () => String(dir), v => { dir = +v; set(Math.abs(get()) * dir); upd(); });
          numRow(side, 'Abstand (mm)', () => Math.abs(get()), v => { set(Math.max(0, v) * dir); upd(); }, Object.assign({}, NR));
        };
        if (st.perJoint) {
          hRow(T('Anfang'), () => +st.off || 0, v => { st.off = v; });
          joints.forEach(q => hRow(jName(q), () => +st.jpos[q.k] || 0, v => { st.jpos[q.k] = v; }));
          hRow(T('Ende'), () => +st.off1 || 0, v => { st.off1 = v; });
        } else hRow('Lage', () => +st.off || 0, v => { st.off = v; });
      } else {
        const u = st.unit === 'mm' ? ' (mm)' : ' (%)', NP = Object.assign({}, NR, { step: 1 });
        numRow(side, T('Lage Anfang') + u, () => st.pos0, v => { st.pos0 = v; upd(); }, NP);
        if (st.perJoint) joints.forEach(q => numRow(side, T('Lage') + ' ' + jName(q) + u, () => st.jpos[q.k], v => { st.jpos[q.k] = v; upd(); }, NP));
        numRow(side, T('Lage Ende') + u, () => st.pos1, v => { st.pos1 = v; upd(); }, NP);
        if (!st.perJoint) hint(side, 'Zwischen Anfang und Ende läuft der Steg im Grundriss gerade.');
      }
      numRow(side, 'Stegbreite (mm)', () => webOf(st, kind), v => { st.web = Math.max(0, v); upd(); }, Object.assign({}, NR));
    }
    subhead(side, 'Ausgabe');
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
    if (App.cadImportDxfText) { const b = document.createElement('button'); b.textContent = T('In CAD übernehmen'); b.className = 'primary'; b.title = T('Alle Stege in den Reiter „CAD-Bearbeitung" laden, je Steg eine Ebene (ersetzt dessen Inhalt nach Rückfrage)'); b.onclick = toCad; bar.appendChild(b); }
    const cp = document.createElement('button'); cp.textContent = T('Liste kopieren'); cp.title = T('Höhenliste als Tabelle in die Zwischenablage (z. B. für Excel)'); cp.onclick = copyList; bar.appendChild(cp);
    side.appendChild(bar);
    if (scr) scr.scrollTop = keep;
  }

  function dxfText() {
    const G = geo(); if (!G || !window.Dxf) return null;
    const D = allStege(G, cfg()).filter(d => d.polys.length), used = {}, layers = [];
    let yc = 0;
    D.forEach((d, i) => {
      let lo = Infinity, hi = -Infinity;
      d.polys.forEach(P => P.forEach(p => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }));
      let nm = String(d.st.name || ('STEG' + (i + 1))).replace(/[^\wäöüÄÖÜß\- ]+/g, '_').trim() || ('STEG' + (i + 1));
      if (used[nm]) nm += '_' + (i + 1); used[nm] = 1;
      layers.push({ name: nm, color: d.kind === 'holm' ? 5 : 30, polys: d.polys.map(P => ({ closed: true, pts: P.map(p => ({ x: p[0], y: p[1] - hi + yc })) })) });
      yc -= (hi - lo) + 20;
    });
    return layers.length ? Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 3 }) : null;
  }
  function toCad() {
    const t = dxfText();
    if (!t) { App.toast && App.toast(T('Keine Stege mit Höhe vorhanden.')); return; }
    App.cadImportDxfText(t, T('Steghöhen'));
    if (App.switchView && document.getElementById('cadView')) App.switchView('cad');
  }
  function copyList() {
    const G = geo(); if (!G) return;
    const out = [[T('Steg'), T('ab Steganfang (mm)'), T('ab Wurzel (mm)'), T('ab Nase (mm)'), T('Profilhöhe (mm)'), T('Abzug (mm)'), T('Steghöhe (mm)'), T('Stelle')].join('\t')];
    allStege(G, cfg()).forEach(d => d.rows.forEach(r => out.push([d.st.name, f1(r.s), f1(r.z), f1(r.x - frame(G, r.z).le), r.H == null ? '' : f1(r.H), f1(r.ded), r.h == null ? '' : f1(r.h), r.note ? T(r.note) : ''].join('\t'))));
    const txt = out.join('\r\n');
    const ok = () => { App.toast && App.toast(T('Liste kopiert.')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => {});
  }

  // Liste
  function buildTable() {
    if (!tbl) return;
    const G = geo(), esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, q => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[q]));
    if (!G) { tbl.innerHTML = ''; return; }
    const cc = cfg(), D = allStege(G, cc);
    if (!D.length) { tbl.innerHTML = '<div class="hint">' + esc(T('Noch kein Steg — links die Anzahl eintragen.')) + '</div>'; return; }
    const keep = tbl.scrollTop, th = 'text-align:right;padding:2px 10px;border-bottom:1px solid var(--border,#2a3038);font-weight:600', td = 'text-align:right;padding:1px 10px';
    tbl.innerHTML = D.map(d => {
      const bad = d.rows.some(r => r.h == null || r.h <= 0);
      const off = d.kind === 'holm' && d.rows.some(r => Math.abs(capCenter(G, cc, r.z) - r.x) + webOf(d.st, d.kind) / 2 > capAt(G, cc, 'capW', r.z) / 2 + 1e-6);
      return '<div style="margin:6px 0 2px;font-weight:700;color:' + COL[d.kind] + '">' + esc(d.st.name) + ' — ' + esc(T('Länge')) + ' ' + f1(d.len) + ' mm · ' + esc(T('Stegbreite')) + ' ' + f1(webOf(d.st, d.kind)) + ' mm</div>'
        + (d.auto && (d.auto.s > 0 || d.auto.fail) ? '<div style="color:' + (d.auto.fail ? '#ffb454' : '#7ee0a0') + '">' + esc(d.auto.fail ? T('Automatik: bis zur Nase kein ausreichender Abstand zur Dichtlippe.') : T('Automatisch nach vorne versetzt um') + ' ' + f1(d.auto.s) + ' mm') + '</div>' : '')
        + (d.cut ? '<div style="color:#ffb454">' + esc(d.len > 0 ? T('Gurt zu schmal: endet bei') + ' ' + f1(d.b) + ' mm ' + T('ab Wurzel') : T('Passt nirgends auf den Gurt.')) + '</div>' : '')
        + (d.stkCut ? '<div style="color:#7ee0a0">' + esc(d.len > 0 ? T('Von der Steckung gekürzt: beginnt bei') + ' ' + f1(d.a) + ' mm ' + T('ab Wurzel') : T('Liegt ganz im Bereich der Steckung und entfällt.')) + '</div>' : '')
        + (off ? '<div style="color:#ffb454">' + esc(T('Der Steg steht stellenweise nicht ganz auf dem Gurt.')) + '</div>' : '')
        + (bad ? '<div style="color:#ffb454">' + esc(T('Stellenweise außerhalb des Profils oder ohne Resthöhe.')) + '</div>' : '')
        + '<table style="border-collapse:collapse"><tr><th style="' + th + '">' + [T('ab Steganfang (mm)'), T('ab Wurzel (mm)'), T('ab Nase (mm)'), T('Profilhöhe (mm)'), T('Abzug (mm)'), T('Steghöhe (mm)')].map(esc).join('</th><th style="' + th + '">') + '</th><th style="' + th + ';text-align:left"></th></tr>'
        + d.rows.map(r => {
          const j = /\|/.test(r.note);
          return '<tr' + (j ? ' style="background:rgba(255,255,255,.06)"' : '') + '><td style="' + td + '">' + f1(r.s) + '</td><td style="' + td + '">' + f1(r.z) + '</td><td style="' + td + '">' + f1(r.x - frame(G, r.z).le) + '</td><td style="' + td + '">' + (r.H == null ? '—' : f1(r.H)) + '</td><td style="' + td + '">' + f1(r.ded) + '</td><td style="' + td + ';font-weight:700' + (r.h == null || r.h <= 0 ? ';color:#ffb454' : '') + '">' + (r.h == null ? '—' : f1(r.h)) + '</td><td style="' + td + ';text-align:left">' + esc(r.note ? T(r.note) : '') + '</td></tr>';
        }).join('') + '</table>';
    }).join('');
    tbl.scrollTop = keep;
  }

  // ---------- Zeichnung: oben Draufsicht (Spannweite nach rechts, Nase oben), darunter die Stege ----------
  function draw() {
    if (!cv || !isOpen()) return;
    const r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = r.width, h = r.height;
    if (w < 2 || h < 2) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.fillStyle = '#10141a'; cx.fillRect(0, 0, w, h);
    hits = [];
    const G = geo(); if (!G) return;
    const D = allStege(G, cfg());
    // Planform
    const pl = [], tr = [];
    G.segs.forEach((q, i) => {
      if (!i) { pl.push([q.z0, q.le0]); tr.push([q.z0, q.le0 + q.cut.root.pl.chord]); }
      pl.push([q.z1, q.le0 + q.sw]); tr.push([q.z1, q.le0 + q.sw + q.cut.tip.pl.chord]);
    });
    let xmax = 0; tr.forEach(p => { xmax = Math.max(xmax, p[1]); }); pl.forEach(p => { xmax = Math.max(xmax, p[1]); });
    let xmin = 0; pl.forEach(p => { xmin = Math.min(xmin, p[1]); });
    // Stege: Welt-Lagen untereinander
    const gap = Math.max(14, (xmax - xmin) * 0.12);
    let yc = -xmax - gap * 1.6; const place = [];
    D.forEach(d => {
      let lo = Infinity, hi = -Infinity;
      d.polys.forEach(P => P.forEach(p => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }));
      if (!isFinite(lo)) { lo = 0; hi = 10; }
      place.push({ d, dy: yc - hi, hi: yc, lo: yc - (hi - lo) }); yc -= (hi - lo) + gap;
    });
    if (fitNext) {
      const ymin = yc + gap, ymax = -xmin, m = 34;
      const s = Math.max(1e-4, Math.min((w - 2 * m - 60) / Math.max(1, G.L), (h - 2 * m) / Math.max(1, ymax - ymin)));
      view.s = s; view.ox = m + 40 + (w - 2 * m - 60 - G.L * s) / 2; view.oy = m + ymax * s + (h - 2 * m - (ymax - ymin) * s) / 2; fitNext = false;
    }
    const X = u => view.ox + u * view.s, Y = v => view.oy - v * view.s;
    const line = (P, closed) => { cx.beginPath(); P.forEach((p, i) => { const sx = X(p[0]), sy = Y(p[1]); if (i) cx.lineTo(sx, sy); else cx.moveTo(sx, sy); }); if (closed) cx.closePath(); };
    cx.font = '12px sans-serif'; cx.textBaseline = 'alphabetic';
    // Grundriss
    const out = pl.map(p => [p[0], -p[1]]).concat(tr.slice().reverse().map(p => [p[0], -p[1]]));
    line(out, true); cx.fillStyle = 'rgba(160,180,210,.10)'; cx.fill(); cx.strokeStyle = '#c8d2e0'; cx.lineWidth = 1.2; cx.stroke();
    // Holmgurt (fest definiert) und Scharnierlinie
    {
      const cc = cfg(), Z = [0].concat(G.segs.slice(0, -1).map(q => q.z1), [G.L]);
      const up = Z.map(z => [z, -(capCenter(G, cc, z) - capAt(G, cc, 'capW', z) / 2)]), lo = Z.map(z => [z, -(capCenter(G, cc, z) + capAt(G, cc, 'capW', z) / 2)]);
      line(up.concat(lo.slice().reverse()), true); cx.fillStyle = 'rgba(255,60,220,.22)'; cx.fill(); cx.strokeStyle = 'rgba(255,60,220,.8)'; cx.lineWidth = 1; cx.stroke();
      cx.fillStyle = '#ff6ae6'; cx.fillText(T('Holmgurt'), X(G.L * 0.5), Y(up[0][1] + (up[up.length - 1][1] - up[0][1]) * 0.5) - 4);
      cx.setLineDash([9, 4]); cx.strokeStyle = '#7ee0a0'; cx.lineWidth = 1.4;
      G.segs.forEach(q => {
        const pa = q.sg.hingePct != null ? +q.sg.hingePct : 25, pb = q.sg.hingePctTip != null ? +q.sg.hingePctTip : 25;
        line([[q.z0, -(q.le0 + q.cut.root.pl.chord * (1 - pa / 100))], [q.z1, -(q.le0 + q.sw + q.cut.tip.pl.chord * (1 - pb / 100))]]); cx.stroke();
      });
      cx.setLineDash([]);
      const q = G.segs[G.segs.length - 1], pb = q.sg.hingePctTip != null ? +q.sg.hingePctTip : 25;
      cx.fillStyle = '#7ee0a0'; const tl = T('Scharnierlinie'); cx.fillText(tl, X(G.L) - cx.measureText(tl).width, Y(-(q.le0 + q.sw + q.cut.tip.pl.chord * (1 - pb / 100))) + 14);
    }
    // Steckung in der Draufsicht
    {
      const cc = cfg(), S = stkData(G, cc);
      if (S && S.len > 0 && S.oW > 0) {
        const Z = [0, S.len].concat(G.segs.slice(0, -1).map(q => q.z1).filter(z => z < S.len)).sort((p, q) => p - q);
        line(Z.map(z => [z, -(stkCenter(G, cc, z) - S.oW / 2)]).concat(Z.slice().reverse().map(z => [z, -(stkCenter(G, cc, z) + S.oW / 2)])), true);
        cx.fillStyle = 'rgba(255,240,106,.28)'; cx.fill(); cx.strokeStyle = '#fff06a'; cx.lineWidth = 1.3; cx.stroke();
        cx.fillStyle = '#fff06a'; cx.fillText(T('Steckung'), X(S.len) + 4, Y(-stkCenter(G, cc, S.len)) + 4);
      }
    }
    // Segmentstöße (durch Draufsicht und Stege)
    const yBottom = yc + gap;
    cx.setLineDash([5, 4]); cx.strokeStyle = 'rgba(200,210,224,.35)'; cx.lineWidth = 1;
    G.segs.slice(0, -1).forEach(q => { line([[q.z1, -xmin + gap * 0.2], [q.z1, yBottom]]); cx.stroke(); });
    cx.setLineDash([]);
    // Stelle des Schnitts aus dem Fenster „Schnitte in Spannweite“
    if (secOpen()) {
      const zs = secAll ? [0].concat(G.segs.map(q => q.z1)) : [clamp(secZ, 0, G.L)];
      cx.strokeStyle = '#ff5c8a'; cx.lineWidth = 2;
      zs.forEach(z => { const f = frame(G, z); line([[z, -f.le + gap * 0.12], [z, -(f.le + f.c) - gap * 0.12]]); cx.stroke(); });
      if (!secAll) { const f = frame(G, zs[0]); cx.fillStyle = '#ff5c8a'; const tx = f1(zs[0]) + ' mm'; cx.fillText(tx, clamp(X(zs[0]) - cx.measureText(tx).width / 2, 2, w - cx.measureText(tx).width - 2), Y(-f.le + gap * 0.12) - 4); }
    }
    cx.fillStyle = '#9aa7b8'; cx.fillText(T('Draufsicht'), X(0), Y(-xmin) - 8);
    if (place.length) cx.fillText(T('Stege (Vorderansicht, wahre Länge)'), X(0), Y(-xmax - gap * 0.75));
    place.forEach(({ d, dy, hi }) => {
      const on = d.st === sel, col = COL[d.kind];
      // Steg in seiner Breite
      const hw = webOf(d.st, d.kind) / 2;
      line(d.path.map(p => [p.z, -(p.x - hw)]).concat(d.path.slice().reverse().map(p => [p.z, -(p.x + hw)])), true);
      cx.fillStyle = col + (on ? '99' : '55'); cx.fill(); cx.strokeStyle = col; cx.lineWidth = on ? 2.5 : 1.2; cx.stroke();
      d.path.forEach(p => hits.push([X(p.z), Y(-p.x), d.st, hw * view.s]));
      const lab = d.path[0]; cx.fillStyle = col; cx.fillText(d.st.name || '', X(lab.z) + 4, Y(-lab.x) - 5);
      // Stationen in der Draufsicht
      cx.lineWidth = 1;
      d.rows.forEach(rw => { cx.beginPath(); cx.arc(X(rw.z), Y(-rw.x), on ? 3 : 2, 0, 7); cx.fill(); });
      // Vorderansicht; Anfang liegt unter der Wurzelseite des Stegs (Lage in Spannweite)
      const u0 = d.a;
      cx.lineWidth = on ? 2 : 1.3;
      d.polys.forEach(P => {
        line(P.map(p => [u0 + p[0], p[1] + dy]), true);
        cx.fillStyle = col + (on ? '44' : '22'); cx.fill(); cx.strokeStyle = col; cx.stroke();
        P.forEach(p => hits.push([X(u0 + p[0]), Y(p[1] + dy), d.st]));
      });
      cx.fillStyle = col; cx.fillText(d.st.name || '', X(u0), Y(hi) - 4);
      const first = d.rows.find(q => q.h != null), last = d.rows.slice().reverse().find(q => q.h != null);
      if (first && last) {
        cx.fillStyle = '#c8d2e0'; const tx = f1(first.h) + ' → ' + f1(last.h) + ' mm · ' + T('Länge') + ' ' + f1(d.len) + ' mm';
        cx.fillText(tx, X(u0) + cx.measureText(d.st.name || '').width + 12, Y(hi) - 4);
      }
    });
  }

  // ---------- Schnitte in Spannweitenrichtung: Profil an der Stelle z mit den Stegen ----------
  let secPane = null, scv = null, sTop = null, sv = { s: 1, ox: 0, oy: 0 }, sFit = true, sDrag = null, secZ = 0, secAll = false, secDelta = 0;
  const secOpen = () => isOpen() && bottom === 'sec';
  function buildSec() {
    secPane = document.createElement('div'); secPane.style.cssText = 'flex:1;display:none;flex-direction:column;min-width:0;min-height:0';
    sTop = document.createElement('div'); sTop.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border,#2a3038);font-size:12px';
    const cw = document.createElement('div'); cw.style.cssText = 'flex:1;position:relative;min-height:0';
    scv = document.createElement('canvas'); scv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    cw.appendChild(scv); secPane.append(sTop, cw);
    new ResizeObserver(() => { sFit = true; drawSec(); }).observe(cw);
    scv.addEventListener('wheel', e => {
      e.preventDefault(); const r = scv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      const wx = (mx - sv.ox) / sv.s, wy = (sv.oy - my) / sv.s; sv.s *= f; sv.ox = mx - wx * sv.s; sv.oy = my + wy * sv.s; drawSec();
    }, { passive: false });
    scv.addEventListener('mousedown', e => { sDrag = { x: e.clientX, y: e.clientY, ox: sv.ox, oy: sv.oy }; });
    window.addEventListener('mousemove', e => { if (sDrag) { sv.ox = sDrag.ox + e.clientX - sDrag.x; sv.oy = sDrag.oy + e.clientY - sDrag.y; drawSec(); } });
    window.addEventListener('mouseup', () => { sDrag = null; });
    scv.addEventListener('dblclick', () => { sFit = true; drawSec(); });
  }
  function secBar() {
    const G = geo(); sTop.innerHTML = ''; if (!G) return;
    const lab = t => { const l = document.createElement('span'); l.textContent = T(t); return l; };
    const num = document.createElement('input'); num.type = 'text'; num.inputMode = 'decimal'; num.style.width = '70px'; num.value = f1(secZ);
    const rg = document.createElement('input'); rg.type = 'range'; rg.min = 0; rg.max = G.L; rg.step = 1; rg.value = secZ; rg.style.cssText = 'flex:1;min-width:120px';
    rg.oninput = () => { secZ = +rg.value; num.value = f1(secZ); draw(); drawSec(); };
    num.onchange = () => { const v = parseFloat(num.value.replace(',', '.')); if (isNaN(v)) return; secZ = clamp(v, 0, G.L); num.value = f1(secZ); rg.value = secZ; draw(); drawSec(); };
    const js = document.createElement('select');
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; js.appendChild(o); };
    add('', T('Stelle wählen…')); add('0', T('Wurzel'));
    G.segs.slice(0, -1).forEach(q => add(q.z1, T('Segmentstoß') + ' ' + (q.k + 1) + '|' + (q.k + 2)));
    add(G.L, T('Außenende'));
    js.onchange = () => { if (js.value === '') return; secZ = +js.value; js.value = ''; secAll = false; secBar(); draw(); drawSec(); };
    const all = document.createElement('label'); all.style.cssText = 'display:flex;gap:4px;align-items:center';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = secAll; cb.onchange = () => { secAll = cb.checked; sFit = true; draw(); drawSec(); };
    all.append(cb, lab('alle Segmentstöße untereinander'));
    sTop.append(lab('mm ab Wurzel'), num, rg, js, all);
    // Ruderausschlag und Dichtlippe
    const c = cfg(), brk = document.createElement('div'); brk.style.cssText = 'flex-basis:100%;height:0'; sTop.appendChild(brk);
    const dn = document.createElement('input'); dn.type = 'text'; dn.inputMode = 'decimal'; dn.style.width = '50px'; dn.value = secDelta;
    const dr = document.createElement('input'); dr.type = 'range'; dr.min = -45; dr.max = 45; dr.step = 0.5; dr.value = secDelta; dr.style.cssText = 'flex:1;min-width:120px';
    dr.oninput = () => { secDelta = +dr.value; dn.value = secDelta; drawSec(); };
    dn.onchange = () => { const v = parseFloat(dn.value.replace(',', '.')); if (isNaN(v)) return; secDelta = clamp(v, -45, 45); dn.value = secDelta; dr.value = secDelta; drawSec(); };
    const z0 = document.createElement('button'); z0.textContent = '0°'; z0.style.padding = '2px 7px'; z0.onclick = () => { secDelta = 0; dn.value = 0; dr.value = 0; drawSec(); };
    sTop.append(lab('Ruderausschlag (°, + = nach unten)'), dn, dr, z0);
    const lc = document.createElement('label'); lc.style.cssText = 'display:flex;gap:4px;align-items:center';
    const lb = document.createElement('input'); lb.type = 'checkbox'; lb.checked = !!c.lipOn;
    lb.onchange = () => { c.lipOn = lb.checked; setTimeout(update, 0); if (c.lipLen == null) { c.lipLen = 25; c.lipOver = 10; c.lipT = 0.3; c.lipGap = 1; c.lipSide = 'opp'; c.lipFix = 'ruder'; }
      if (c.lipR == null) { c.lipR = 10; c.lipSlot = 0; } secBar(); drawSec(); };
    lc.append(lb, lab('Dichtlippe')); sTop.appendChild(lc);
    if (c.lipOn) {
      const brk2 = brk.cloneNode(); sTop.appendChild(brk2);
      const sel = (t, key, opts) => { const e = document.createElement('select'); opts.forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = T(n); e.appendChild(o); }); e.value = c[key]; e.onchange = () => { c[key] = e.value; secBar(); update(); }; sTop.append(lab(t), e); };
      if (c.lipR == null) { c.lipR = 10; c.lipSlot = 0; }
      const nm = (t, key, neg) => { const e = document.createElement('input'); e.type = 'text'; e.inputMode = 'decimal'; e.style.width = '50px'; e.value = c[key]; e.onchange = () => { const v = parseFloat(e.value.replace(',', '.')); if (!isNaN(v)) { c[key] = neg ? v : Math.max(0, v); update(); } }; sTop.append(lab(t), e); };
      sel('Seite', 'lipSide', [['opp', 'gegenüber Scharnier'], ['top', 'oben'], ['bot', 'unten']]);
      sel('befestigt an', 'lipFix', [['ruder', 'Ruder'], ['wing', 'Flügel']]);
      nm('Länge (mm)', 'lipLen'); nm('Dicke (mm)', 'lipT'); nm('Spalt (mm)', 'lipGap'); nm('Radius (mm, 0 = gerade)', 'lipR'); nm('Ruderschlitz zur Scharnierlinie (mm, + = hinten)', 'lipSlot', true);
      if (c.lipFix !== 'wing') {
        const brk3 = brk.cloneNode(); sTop.appendChild(brk3);
        const al = document.createElement('label'); al.style.cssText = 'display:flex;gap:4px;align-items:center';
        const ab = document.createElement('input'); ab.type = 'checkbox'; ab.checked = !!c.lipAuto;
        ab.onchange = () => { c.lipAuto = ab.checked; if (c.lipMax == null) { c.lipMax = 25; c.lipMargin = 0.5; } secBar(); update(); };
        al.append(ab, lab('Vorderen Rudersteg automatisch nach vorne setzen')); sTop.appendChild(al);
        if (c.lipAuto) { nm('bis Ausschlag ± (°)', 'lipMax'); nm('Mindestabstand (mm)', 'lipMargin'); }
      }
    }
  }
  // Ruder und Dichtlippe an der Stelle z: Drehung um den Scharnierpunkt auf der Scharnierseite (Ausschlag + = Ruder nach unten).
  // Die Lippe liegt starr unter der Schale und überlappt den Spalt; am Ruder befestigt dreht sie mit und kann den
  // vorderen Rudersteg treffen, am Flügel befestigt steht sie still und der hintere Steg dreht auf sie zu.
  function webQuad(G, d, z) {
    const a = d.at(z, 0); if (a.H == null || a.h <= 0) return null;
    const inset = a.ded / 2, web = webOf(d.st, d.kind), fb = { top: a.top + inset, bot: a.bot - inset };
    const sL = section(G, a.x - web / 2, z) || fb, sR = section(G, a.x + web / 2, z) || fb;
    return { x: a.x, Q: [[a.x - web / 2, sL.top - inset], [a.x + web / 2, sR.top - inset], [a.x + web / 2, sR.bot + inset], [a.x - web / 2, sL.bot + inset]] };
  }
  function ruderAt(G, c, z, D) {
    const f = frame(G, z), xh = f.le + f.c * (1 - f.hp / 100), sec = section(G, xh, z); if (!sec) return null;
    const hs = locate(G, z).s.sg.hingeSide === 'bottom' ? 'bot' : 'top', H = [xh, hs === 'top' ? sec.top : sec.bot];
    const rotBy = deg => { const a = -deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); return p => [H[0] + (p[0] - H[0]) * ca - (p[1] - H[1]) * sa, H[1] + (p[0] - H[0]) * sa + (p[1] - H[1]) * ca]; };
    const opp = hs === 'top' ? 'bot' : 'top', R = { xh, xs: xh + (c.lipOn ? +c.lipSlot || 0 : 0), H, hs, rotBy, lip: null, side: opp, gap: Math.max(0, +c.lipGap || 0) };
    if (!c.lipOn) return R;
    const side = c.lipSide === 'top' || c.lipSide === 'bot' ? c.lipSide : opp, t = Math.max(0, +c.lipT || 0), onRuder = c.lipFix !== 'wing';
    const len = Math.max(0, +c.lipLen || 0), root = onRuder ? R.xs + R.gap : R.xs, tip = onRuder ? root - len : root + len, sh = shellOf(c), rad = Math.max(0, +c.lipR || 0), lip = [];
    // Fuß genau an der Kante des Ruders (bzw. des Flügels), Außenfläche bündig mit der Kontur; von dort tangential, zur Spitze hin mit dem Radius nach innen gebogen (0 = gerade)
    for (let i = 0; i <= 40; i++) {
      const x = tip + (root - tip) * i / 40, sc = section(G, x, z), d = Math.abs(x - root); if (!sc) continue;
      if (rad > 0 && d > rad) continue;
      const bend = rad > 0 ? rad - Math.sqrt(rad * rad - d * d) : 0;
      lip.push([x, side === 'top' ? sc.top - t / 2 - bend : sc.bot + t / 2 + bend]);
    }
    const targets = D.filter(d => d.kind === 'ruder' && z >= d.a - 1e-6 && z <= d.b + 1e-6).map(d => webQuad(G, d, z)).filter(q => q && (onRuder ? q.x < xh : q.x > xh));
    const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], k = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ((dx * dx + dy * dy) || 1), 0, 1); return Math.hypot(p[0] - a[0] - dx * k, p[1] - a[1] - dy * k); };
    const inQ = (p, Q) => { let on = false; for (let i = 0, j = 3; i < 4; j = i++) if ((Q[i][1] > p[1]) !== (Q[j][1] > p[1]) && p[0] < Q[j][0] + (Q[i][0] - Q[j][0]) * (p[1] - Q[j][1]) / (Q[i][1] - Q[j][1])) on = !on; return on; };
    // kleinster Abstand Lippe – Steg bei einem Ausschlag (≤ 0 = streift); null = kein Steg zum Prüfen
    const clearQ = (Q0, deg) => {
      const r = rotBy(deg), L = onRuder ? lip.map(r) : lip, Q = onRuder ? Q0 : Q0.map(r); let m = Infinity;
      for (const p of L) { if (inQ(p, Q)) return -t / 2; for (let i = 0; i < 4; i++) m = Math.min(m, segD(p, Q[i], Q[(i + 1) % 4])); }
      return m - t / 2;
    };
    const clear = deg => {
      if (!targets.length || !lip.length) return null;
      let m = Infinity; for (const q of targets) m = Math.min(m, clearQ(q.Q, deg));
      return m;
    };
    const firstHit = sign => { for (let a = 0; a <= 45; a += 0.5) { const v = clear(sign * a); if (v != null && v <= 0) return sign * a; } return null; };
    const dG = R.gap, skin = onRuder && len > dG && (rad > 0 ? (dG < rad ? rad - Math.sqrt(rad * rad - dG * dG) : Infinity) : 0) + t < sh;   // an der Flügelkante noch in der Schale?
    return Object.assign(R, { lip, side, t, onRuder, clear, clearQ, firstHit, skin });
  }
  const CORE_COL = '#b9a98a';   // Stützstoff, Außen-/Innenlage bleiben grün
  function profOf(G, z) {
    const { s, t } = locate(G, z), A = s.cut.root.pts, B = s.cut.tip.pts, n = Math.min(A.length, B.length), sgn = state.cfg.flipY ? -1 : 1, le = frame(G, z).le, P = [];
    for (let i = 0; i < n; i++) P.push([s.le0 + A[i].x + (B[i].x - A[i].x) * t - le, sgn * (A[i].y + (B[i].y - A[i].y) * t)]);
    let lo = Infinity, hi = -Infinity, xr = 0; P.forEach(p => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); xr = Math.max(xr, p[0]); });
    return { z, le, P, lo, hi, xr };
  }
  function drawSec() {
    if (!secOpen()) return;
    const r = scv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = r.width, h = r.height;
    if (w < 2 || h < 2) return;
    scv.width = Math.round(w * dpr); scv.height = Math.round(h * dpr);
    const g = scv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#10141a'; g.fillRect(0, 0, w, h);
    const G = geo(); if (!G) return;
    const D = allStege(G, cfg());
    const zs = secAll ? [0].concat(G.segs.map(q => q.z1)) : [secZ];
    // Profil je Stelle in Gesamt-x, auf die Nase bezogen, damit die Schnitte untereinander fluchten
    const secs = zs.map(z => profOf(G, z));
    // Maßstab fest nach dem größten Profil der Tragfläche: beim Durchfahren bleiben die Größenverhältnisse sichtbar.
    // Einzelschnitt: um seine Höhenmitte, damit er nicht aus dem Bild wandert.
    const every = [0].concat(G.segs.map(q => q.z1)).map(z => profOf(G, z));
    const xr = Math.max(...every.map(q => q.xr)), hMax = Math.max(...every.map(q => q.hi - q.lo));
    const gap = Math.max(25, hMax * 0.9);
    let yc = 0;
    if (secAll) secs.forEach(q => { q.dy = yc - q.hi; yc -= (q.hi - q.lo) + gap; });
    else secs.forEach(q => { q.dy = -(q.hi + q.lo) / 2; });
    const ytop = secAll ? 0 : hMax / 2, ymin = secAll ? yc + gap : -hMax / 2;
    if (sFit) {
      const m = 40, sc = Math.max(1e-4, Math.min((w - 2 * m) / Math.max(1, xr), (h - 2 * m) / Math.max(1, ytop - ymin)));
      sv.s = sc; sv.ox = (w - xr * sc) / 2; sv.oy = h / 2 + (ytop + ymin) / 2 * sc; sFit = false;
    }
    const X = u => sv.ox + u * sv.s, Y = v => sv.oy - v * sv.s;
    g.font = '12px sans-serif';
    secs.forEach(q => secOne(g, G, D, q, X, Y, sv.s, secDelta));
  }
  // Ein Profilschnitt mit Schale, Gurt, Steckung, Stegen, Ruder; auch vom Reiter Flächenservos genutzt
  function secOne(g, G, D, q, X, Y, PX, delta) {
      g.beginPath(); q.P.forEach((p, i) => { const a = X(p[0]), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath();
      g.fillStyle = 'rgba(160,180,210,.10)'; g.fill(); g.strokeStyle = '#c8d2e0'; g.lineWidth = 1.2; g.stroke();
      // Schale: Innenkontur senkrecht um die Schalendicke versetzt (wie der Abzug der Steghöhen), Band gefüllt
      const shellT = shellOf(cfg());
      if (shellT > 0) {
        const up = [], dn = [];
        for (let i = 0; i <= 160; i++) {
          const u = q.xr * (1 - Math.cos(Math.PI * i / 160)) / 2, sc = section(G, q.le + u, q.z);
          if (sc && sc.top - sc.bot > 2 * shellT) { up.push([u, sc.top - shellT]); dn.push([u, sc.bot + shellT]); }
        }
        if (up.length > 1) {
          const inner = up.concat(dn.reverse());
          g.beginPath();
          q.P.forEach((p, i) => { const a = X(p[0]), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath();
          inner.forEach((p, i) => { const a = X(p[0]), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath();
          g.fillStyle = 'rgba(120,220,170,.45)'; g.fill('evenodd');
          g.beginPath(); inner.forEach((p, i) => { const a = X(p[0]), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath();
          g.strokeStyle = '#78dcaa'; g.lineWidth = 1; g.stroke();
        }
      }
      // Stützstoff in eigener Farbe
      if (cfg().layOn && layS(cfg()) > 0) {
        const ringAt = off => { const a = [], b = []; for (let i = 0; i <= 160; i++) { const u = q.xr * (1 - Math.cos(Math.PI * i / 160)) / 2, sc = section(G, q.le + u, q.z); if (sc && sc.top - sc.bot > 2 * off) { a.push([u, sc.top - off]); b.push([u, sc.bot + off]); } } return a.concat(b.reverse()); };
        const tr = P => P.forEach((p, i) => { const a = X(p[0]), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
        g.beginPath(); tr(ringAt(layA(cfg()))); g.closePath(); tr(ringAt(layA(cfg()) + layS(cfg()))); g.closePath();
        g.fillStyle = CORE_COL; g.fill('evenodd');
      }
      // Lagengrenzen im Schalenaufbau
      if (cfg().layOn) [layA(cfg()), layA(cfg()) + layS(cfg())].forEach(off => {
        if (off <= 0 || off >= shellT) return;
        const up = [], dn = [];
        for (let i = 0; i <= 160; i++) {
          const u = q.xr * (1 - Math.cos(Math.PI * i / 160)) / 2, sc = section(G, q.le + u, q.z);
          if (sc && sc.top - sc.bot > 2 * off) { up.push([u, sc.top - off]); dn.push([u, sc.bot + off]); }
        }
        g.beginPath(); up.concat(dn.reverse()).forEach((p, i) => { const a = X(p[0]), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath();
        g.strokeStyle = '#d6ffe8'; g.lineWidth = 0.7; g.stroke();
      });
      const shTxt = cfg().layOn ? f1(layA(cfg())) + ' + ' + f1(layS(cfg())) + ' + ' + f1(layI(cfg())) + ' mm' : f1(shellT) + ' mm';
      g.fillStyle = '#9aa7b8'; g.fillText(f1(q.z) + ' mm ' + T('ab Wurzel') + ' · ' + T('Schale') + ' ' + shTxt, X(0), Y(q.hi + q.dy) - 8);
      // Gurte oben/unten, fest definiert und unabhängig von den Stegen: folgen der Kontur, unter der Schale
      {
        const cc = cfg(), cap = capAt(G, cc, 'capT', q.z), bw = capAt(G, cc, 'capW', q.z), cm = capCenter(G, cc, q.z), go = capFace(cc), T1 = [], T2 = [], B1 = [], B2 = [];
        if (cap > 0 && bw > 0) {
          for (let i = 0; i <= 12; i++) {
            const xx = cm - bw / 2 + bw * i / 12, sc = section(G, xx, q.z);
            if (!sc || sc.top - sc.bot < 2 * (go + cap)) continue;
            T1.push([xx, sc.top - go]); T2.push([xx, sc.top - go - cap]); B1.push([xx, sc.bot + go]); B2.push([xx, sc.bot + go + cap]);
          }
          const pg = P => { g.beginPath(); P.forEach((p, i) => { const a = X(p[0] - q.le), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath(); g.fillStyle = 'rgba(255,60,220,.6)'; g.fill(); g.strokeStyle = '#ff3cdc'; g.lineWidth = 1; g.stroke(); };
          if (T1.length > 1) { pg(T1.concat(T2.reverse())); pg(B1.concat(B2.reverse())); }
        }
      }
      // Steckung im Schnitt: Hülse und Steckung, nur innerhalb der Einbindetiefe
      {
        const cc = cfg(), S = stkData(G, cc);
        if (S && S.cy != null && q.z <= S.len + 1e-6 && S.oH > 0) {
          const u = X(stkCenter(G, cc, q.z) - q.le), v = Y(S.cy + q.z * S.tan + q.dy), k = PX, shape = (w, h) => { g.beginPath(); if (S.round) g.arc(u, v, Math.max(0, w) / 2 * k, 0, 7); else g.rect(u - w / 2 * k, v - h / 2 * k, w * k, h * k); };
          shape(S.oW, S.oH); g.fillStyle = 'rgba(255,240,106,.25)'; g.fill(); g.strokeStyle = '#fff06a'; g.lineWidth = 1.2; g.stroke();
          if (S.inH > 0 && S.inW > 0) { shape(S.inW, S.inH); g.fillStyle = 'rgba(255,240,106,.65)'; g.fill(); g.stroke(); }
        }
      }
      // Ruder ausgeschlagen und Dichtlippe
      const RU = ruderAt(G, cfg(), q.z, D), rr = RU ? RU.rotBy(delta) : (p => p);
      const pgS = (P, fc, sc, lw) => { g.beginPath(); P.forEach((p, i) => { const a = X(p[0] - q.le), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); if (fc) { g.closePath(); g.fillStyle = fc; g.fill(); } g.strokeStyle = sc; g.lineWidth = lw; g.stroke(); };
      if (RU && (delta || cfg().lipOn)) {
        const xe = q.le + q.xr - 1e-3, xa = RU.side === 'top' ? RU.xs + RU.gap : RU.xh, xb = RU.side === 'bot' ? RU.xs + RU.gap : RU.xh, up = [], dn = [];
        for (let i = 0; i <= 60; i++) { const xt = xa + (xe - xa) * i / 60, st = section(G, xt, q.z), xd = xb + (xe - xb) * i / 60, sd = section(G, xd, q.z); if (st) up.push([xt, st.top]); if (sd) dn.push([xd, sd.bot]); }
        if (delta) {   // festen Hinterteil verdecken, Ruhelage nur noch gestrichelt
          // Der Flügel reicht immer bis zum Scharnier: verdeckt wird nur, was hinter der Linie Scharnier – Ruderschlitz liegt
          const mg = 3 / PX, topO = q.hi + mg, botO = q.lo - mg, xEnd = q.le + q.xr + mg, ySl = (s0 => (s0 ? (RU.side === 'top' ? s0.top : s0.bot) : RU.H[1]))(section(G, RU.xs, q.z));
          const hOut = RU.hs === 'top' ? topO : botO, lOut = RU.side === 'top' ? topO : botO;
          const cover = RU.side === RU.hs ? [[RU.xh, hOut], [xEnd, hOut], [xEnd, RU.hs === 'top' ? botO : topO], [RU.xh, RU.hs === 'top' ? botO : topO]]
            : [RU.H, [RU.xh, hOut], [xEnd, hOut], [xEnd, lOut], [RU.xs, lOut], [RU.xs, ySl]];
          g.beginPath(); cover.forEach((p, i) => { const a = X(p[0] - q.le), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath(); g.fillStyle = '#10141a'; g.fill();
          g.setLineDash([4, 4]); pgS(up.concat(dn.slice().reverse()), null, 'rgba(200,210,224,.4)', 1); g.setLineDash([]);
          // Flügelkante: vom Scharnierpunkt zum Ruderschlitz, Kontur bis dorthin
          const yS = x => { const sc = section(G, x, q.z); return sc ? (RU.side === 'top' ? sc.top : sc.bot) : null; }, ed = [];
          if (RU.xs > RU.xh) for (let i = 0; i <= 8; i++) { const x = RU.xh + (RU.xs - RU.xh) * i / 8, y = yS(x); if (y != null) ed.push([x, y]); } else { const y = yS(RU.xs); if (y != null) ed.push([RU.xs, y]); }
          if (ed.length) pgS([RU.H, ed[ed.length - 1]], null, '#c8d2e0', 1.2);
          if (ed.length > 1) pgS(ed, null, '#c8d2e0', 1.2);
        }
        pgS(up.concat(dn.slice().reverse()).map(rr), 'rgba(255,210,122,.14)', '#ffd27a', 1.4);
        // Schale und Lagen auch am ausgeschlagenen Ruder (mitgedreht), wie am Flügel senkrecht versetzt
        if (delta && shellT > 0) {
          const x0 = Math.max(xa, xb), offs = cfg().layOn ? [layA(cfg()), layA(cfg()) + layS(cfg()), shellT] : [shellT];
          const innerAt = off => { const t1 = [], t2 = []; for (let i = 0; i <= 60; i++) { const xx = x0 + (xe - x0) * i / 60, sc = section(G, xx, q.z); if (sc && sc.top - sc.bot > 2 * off) { t1.push([xx, sc.top - off]); t2.push([xx, sc.bot + off]); } } return t1.concat(t2.reverse()).map(rr); };
          const trace = P => P.forEach((p, i) => { const a = X(p[0] - q.le), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
          const inner = innerAt(shellT);
          if (inner.length > 2) {
            g.beginPath(); trace(up.concat(dn.slice().reverse()).map(rr)); g.closePath(); trace(inner); g.closePath();
            g.fillStyle = 'rgba(120,220,170,.45)'; g.fill('evenodd');
          }
          if (cfg().layOn && layS(cfg()) > 0) {
            g.beginPath(); trace(innerAt(layA(cfg()))); g.closePath(); trace(innerAt(layA(cfg()) + layS(cfg()))); g.closePath();
            g.fillStyle = CORE_COL; g.fill('evenodd');
          }
          offs.forEach(off => { const P = innerAt(off); if (P.length > 2 && off > 0) { g.beginPath(); trace(P); g.closePath(); g.strokeStyle = off === shellT ? '#78dcaa' : '#d6ffe8'; g.lineWidth = off === shellT ? 1 : 0.7; g.stroke(); } });
        }
        const hp = RU.H; g.fillStyle = '#7ee0a0'; g.beginPath(); g.arc(X(hp[0] - q.le), Y(hp[1] + q.dy), 4, 0, 7); g.fill();
        if (RU.lip && RU.lip.length > 1) {
          const v = RU.clear(delta), hit = v != null && v <= 0, col = hit ? '#ff4d4d' : '#fff06a';
          pgS(RU.onRuder ? RU.lip.map(rr) : RU.lip, null, col, Math.max(2, RU.t * PX));
          const a1 = RU.firstHit(1), a2 = RU.firstHit(-1), tgt = T(RU.onRuder ? 'vorderen Rudersteg' : 'hinteren Rudersteg');
          const txt = v == null ? T('Dichtlippe: kein Rudersteg zum Prüfen') : (hit ? T('Dichtlippe streift') + ' ' + tgt : T('Abstand Dichtlippe zum') + ' ' + tgt + ': ' + f1(v) + ' mm') + (v == null ? '' : ' · ' + T('streift ab') + ' ' + (a1 == null ? '> +45' : (a1 >= 0 ? '+' : '') + a1) + '° / ' + (a2 == null ? '< −45' : a2) + '°');
          g.fillStyle = col; g.fillText(txt, X(0), Y(q.lo + q.dy) + 62);
          if (RU.skin) { g.fillStyle = '#ffb454'; g.fillText(T('Hinweis: Die Lippe läuft an der Flügelkante durch die Schale.'), X(0), Y(q.lo + q.dy) + 78); }
        }
      }
      let n = 0;
      D.forEach(d => {
        if (q.z < d.a - 1e-6 || q.z > d.b + 1e-6) return;
        const a = d.at(q.z, 0); if (a.H == null) return;
        const col = COL[d.kind], u = X(a.x - q.le), inset = a.ded / 2;
        const web = webOf(d.st, d.kind);
        const fillPoly = (P, fc) => { g.beginPath(); P.forEach((p, i) => { const a2 = X(p[0] - q.le), b2 = Y(p[1] + q.dy); if (i) g.lineTo(a2, b2); else g.moveTo(a2, b2); }); g.closePath(); g.fillStyle = fc; g.fill(); g.strokeStyle = col; g.lineWidth = 1; g.stroke(); };
        // Steg mit seiner Breite; hinter dem Scharnier dreht er mit dem Ruder
        const wq = webQuad(G, d, q.z);
        if (wq) fillPoly(d.kind === 'ruder' && RU && wq.x > RU.xh ? wq.Q.map(rr) : wq.Q, col + '55');
        g.fillStyle = col; g.fillText((d.st.name || '') + ': ' + (a.h != null ? f1(a.h) : '—') + ' mm', u + 6, Y(q.lo + q.dy) + 16 + 14 * (n++ % 3));
      });
  }

  function update() { stkResult(); buildTable(); draw(); drawSec(); }
  function refresh(rebuild) {
    if (!isOpen()) return;
    if (rebuild) buildSide();
    if (rebuild && secOpen()) secBar();
    update();
  }

  // ---------- Seitenleiste ----------
  function stegHSidebar(side0) {
    const g = App.grp('Steghöhen', true, 'stegh', { key: 'stegH', alwaysOpen: true });
    if (App.wingSelectEl) {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = T('Tragfläche');
      const s = App.wingSelectEl(); s.style.cssText = '';
      row.append(l, s); g.body.appendChild(row);
    }
    side = document.createElement('div'); side.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    g.body.appendChild(side); side0.appendChild(g.g);
    if (isOpen()) refresh(true);   // Tragfläche/Geometrie gewechselt
  }

  App.stegHSidebar = stegHSidebar;
  App.StegApi = { capFace, cfg, geo, frame, section, capCenter, stkCenter, capAt, insetOf, shellOf, layA, webOf, allStege, stkData, ruderAt, secOne, profOf, f1, fl1, clamp };
  window.StegHoehen = { show, refresh, _test: { stkData, autoShift, ruderAt, distX, distFits, fillCapJoints, capAt, capCenter, webOf, setBottom, fillJoints, geo, section, stegData, allStege, dxfText, cfg } };
})();
