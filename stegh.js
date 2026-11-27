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

  let sel = null, stkBox = null;

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
  // ---------- Eingerückte / schräge Wurzelrippe ----------
  // c.rootInL / c.rootInT (mm in Spannweitenrichtung): um so viel rücken Nase bzw. Endleiste der Wurzelrippe nach
  // außen (ins Werkstück), beide frei; gleich = parallel eingerückt, verschieden = im Grundriss schräg (z. B. bei
  // einem Rumpf mit Einschnürung). Ebene im Grundriss: Gerade durch die Nasenleiste bei zL und die Endleiste bei zT,
  // z(x) = zL − (x − xL)·k, Winkel α = atan k (+ = Nase weiter außen). Was davor liegt, gehört nicht zum Werkstück:
  // Stege, Steckung und Listen beginnen an der Wurzelrippe.
  function rootIns(G, c) {
    if (c.rootSkew != null) rootMigrate(G, c);
    return [clamp(+c.rootInL || 0, 0, G.L), clamp(+c.rootInT || 0, 0, G.L)];
  }
  function rootPlane(G, c) {
    if (!G) return null;
    const [zL, zT] = rootIns(G, c);
    if (zL < 1e-6 && zT < 1e-6) return null;
    const xL = frame(G, zL).le, fT = frame(G, zT), xT = fT.le + fT.c;
    if (!(xT - xL > 1e-6)) return null;
    const k = (zL - zT) / (xT - xL), at = Math.atan(k);
    return { a: at * 180 / Math.PI, k, xL, zL, xT, zT, cos: Math.cos(at), z: x => Math.max(0, zL - (x - xL) * k), xAt: z => (Math.abs(k) > 1e-12 ? xL + (zL - z) / k : NaN) };
  }
  // Altstand (2026-11-14): nur ein Winkel c.rootSkew mit festem Ende an der Wurzel → beide Einrückmaße
  function rootMigrate(G, c) {
    const a = clamp(+c.rootSkew || 0, -45, 45); delete c.rootSkew;
    if (c.rootInL != null || c.rootInT != null || Math.abs(a) < 1e-6) return;
    const f0 = frame(G, 0), k = Math.tan(a * Math.PI / 180), xP = a > 0 ? f0.le + f0.c : f0.le, pz = x => Math.max(0, (xP - x) * k);
    const hit = X => {
      const h = z => z - pz(X(z)); if (h(0) >= 0) return 0; if (h(G.L) < 0) return G.L;
      let lo = 0, hi = G.L; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (h(m) < 0) lo = m; else hi = m; }
      return Math.round(hi * 1000) / 1000;
    };
    c.rootInL = hit(z => frame(G, z).le); c.rootInT = hit(z => { const f = frame(G, z); return f.le + f.c; });
  }
  // Wo eine Linie x = X(z) im Grundriss die Wurzelrippe trifft (z ab Wurzel); 0 ohne Schräge
  function rootZLine(G, c, X) {
    const P = rootPlane(G, c); if (!P) return 0;
    const h = z => z - P.z(X(z));
    if (h(0) >= 0) return 0;
    if (h(G.L) < 0) return G.L;
    let lo = 0, hi = G.L;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (h(m) < 0) lo = m; else hi = m; }
    return hi;
  }
  // Nase und Endleiste der Wurzelrippe im Grundriss
  function rootEnds(G, c) {
    const P = rootPlane(G, c); if (P) return { zL: P.zL, xL: P.xL, zT: P.zT, xT: P.xT };
    const f = frame(G, 0); return { zL: 0, xL: f.le, zT: 0, xT: f.le + f.c };
  }
  // Listen beginnen an der Wurzelrippe: Zeilen im abgeschnittenen Keil entfallen, erste Zeile an der Rippe
  function rootRows(G, c, M, X) {
    if (!rootPlane(G, c)) return M;
    const zr = rootZLine(G, c, X); if (zr < 0.05) return M;
    const out = M.filter(m => m.z > zr + 0.5); out.unshift({ z: zr, note: 'Wurzelrippe' });
    return out;
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
    if (hinge) {   // Abstand zur Scharnierlinie: gleich / innen→außen / je Segmentstoß / je Segmentgruppe
      const lay = hingeLay(G, st);
      let P;
      if (lay === 'grp') { P = []; hGroups(G, st, a, b).forEach(g => { P.push([g.z0, +g.gr.p0 || 0], [g.z1, +g.gr.p1 || 0]); }); }
      else {
        P = [[a, +st.off || 0]];
        if (lay === 'joint') jointsIn(G, a, b).forEach(q => { const v = st.jpos && st.jpos[q.k]; if (v != null) P.push([q.z, +v]); });
        P.push([b, lay === 'same' || st.off1 == null ? +st.off || 0 : +st.off1 || 0]);
      }
      return z => { const f = frame(G, z); return f.le + f.c * (1 - f.hp / 100) - lerpPts(P, z); };   // Abstand > 0 = vor dem Scharnier
    }
    const P = [[a, valAt(a, v0)]];
    if (pj) jointsIn(G, a, b).forEach(q => { const v = st.jpos && st.jpos[q.k]; if (v != null) P.push([q.z, valAt(q.z, v)]); });
    P.push([b, valAt(b, v1)]);
    if (hinge) return z => { const f = frame(G, z); return f.le + f.c * (1 - f.hp / 100) - lerpPts(P, z); };   // Abstand > 0 = vor dem Scharnier
    return z => lerpPts(P, z);
  }
  // Rudersteg an der Scharnierlinie: wie wird der Abstand angegeben (st.hLay)
  function hingeLay(G, st) {
    const l = st.hLay || (st.perJoint ? 'joint' : 'same');
    return G && G.segs.length < 2 && (l === 'joint' || l === 'grp') ? 'line' : l;
  }
  // Segmente im Bereich [a, b] des Stegs
  function segRange(G, a, b) {
    let kA = G.segs.findIndex(q => q.z1 > a + 1e-6); if (kA < 0) kA = G.segs.length - 1;
    let kB = kA; G.segs.forEach((q, k) => { if (q.z0 < b - 1e-6) kB = Math.max(kB, k); });
    return [kA, kB];
  }
  // Gruppen st.hGrp = [{ to: letzter Segmentindex, p0: Abstand innen, p1: außen }], lückenlos über die Segmente des Stegs
  function hGroups(G, st, a, b) {
    const [kA, kB] = segRange(G, a, b), n = kB - kA + 1;
    if (!Array.isArray(st.hGrp) || !st.hGrp.length) st.hGrp = [{ to: kB, p0: +st.off || 0, p1: st.off1 != null ? +st.off1 : +st.off || 0 }];
    if (st.hGrp.length > n) st.hGrp.length = n;
    let prev = kA - 1;
    st.hGrp.forEach((g, i) => { g.to = i === st.hGrp.length - 1 ? kB : clamp(Math.round(+g.to || 0), prev + 1, kB - (st.hGrp.length - 1 - i)); prev = g.to; });
    prev = kA - 1;
    return st.hGrp.map(g => { const r = { gr: g, a: prev + 1, b: g.to, z0: Math.max(a, G.segs[prev + 1].z0), z1: Math.min(b, G.segs[g.to].z1) }; prev = g.to; return r; });
  }
  function setHGroupCount(G, st, a, b, n) {
    const [kA, kB] = segRange(G, a, b), N = kB - kA + 1, f = xFn(G, st, a, b);
    n = clamp(Math.round(n) || 1, 1, N);
    if (n === hGroups(G, st, a, b).length) return;
    const at = z => { const fr = frame(G, z); return Math.round((fr.le + fr.c * (1 - fr.hp / 100) - f(z)) * 100) / 100; };
    const G2 = [];
    for (let i = 0; i < n; i++) { const p = kA + Math.round(i * N / n), q = kA + Math.round((i + 1) * N / n) - 1; G2.push({ to: q, p0: at(Math.max(a, G.segs[p].z0) + 1e-6), p1: at(Math.min(b, G.segs[q].z1) - 1e-6) }); }
    st.hGrp = G2;
  }
  // Fehlende Stoß-Lagen mit dem bisherigen Verlauf vorbelegen (beim Einschalten, nach Ändern von Von/Bis)
  function fillJoints(G, st) {
    segSync(G, st);
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
  // Bereich an Segmente gebunden (st.segA/segB = Segmentindex, null = frei in mm): Von/Bis folgen den Segmentgrenzen
  function segSync(G, st) {
    const n = G.segs.length, a = st.segA, b = st.segB;
    if (a != null && a >= 0 && a < n) st.from = Math.round(G.segs[a].z0 * 100) / 100;
    if (b != null && b >= 0 && b < n) st.to = Math.round(G.segs[b].z1 * 100) / 100;
  }
  const rangeOf = (G, st) => { segSync(G, st); return [clamp(Math.min(+st.from || 0, +st.to || 0), 0, G.L), clamp(Math.max(+st.from || 0, +st.to || 0), 0, G.L)]; };

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
    const key = JSON.stringify([st, a, b, c.shell, c.layOn, c.layA, c.layS, c.layI, c.ruderOn, c.lipSide, c.lipLen, c.lipOver, c.lipT, c.lipGap, c.lipR, c.lipR0, c.lipR1, c.lipRGrp, c.ruder.map(q => q.hGrp), c.lipSlot, c.lipAuto, c.lipMax, c.lipMargin, G.segs.map(q => q.sg.hingeSide + q.sg.hingePct + '/' + q.sg.hingePctTip)]);
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
    // Schräge Wurzelrippe: der Steg beginnt an ihr (Lage bleibt, der Keil davor entfällt)
    const aR = Math.min(b, Math.max(a0, rootZLine(G, c, xAt)));
    // Trifft der Steg die Steckungshülse, beginnt er erst hinter ihrer letzten Berührung; seine Lage bleibt
    const a = stkTrim(G, c, st, kind, aR, b, xAt), joints = G.segs.slice(0, -1).map(q => q.z1).filter(z => z > a + 1e-6 && z < b - 1e-6);
    const zs = []; const N = Math.max(2, Math.ceil((b - a) / 2));
    for (let i = 0; i <= N; i++) zs.push(a + (b - a) * i / N);
    // Rudersteg je Segmentgruppe: an jeder Gruppengrenze darf der Abstand springen → zweite Stützstelle knapp dahinter
    const gB = !dist && st.unit === 'hinge' && hingeLay(G, st) === 'grp' ? hGroups(G, st, a0, b0).slice(1).map((g, i) => ({ z: g.z0 + 1e-6, n: i + 2 })).filter(g => g.z > a && g.z < b) : [];
    zs.push(...joints, ...gB.map(g => g.z)); zs.sort((p, q) => p - q);
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
    gB.forEach(g => marks.push({ s: sOf(g.z), z: g.z, e: 1, note: T('Gruppe') + ' ' + g.n + ' ' + T('innen') }));
    marks.push({ s: len, z: b, note: 'Ende' });
    marks.sort((p, q) => p.s - q.s || (p.e || 0) - (q.e || 0));
    const rows = marks.map(m => Object.assign(at(m.z, m.s), { note: m.note }));
    // Umriss fein abgetastet; Lücken (außerhalb des Profils, Höhe ≤ 0) trennen die Teilstücke
    const M = Math.max(2, Math.ceil(len / 5)), sm = [];
    for (let i = 0; i <= M; i++) sm.push(len * i / M);
    joints.forEach(z => sm.push(sOf(z))); gB.forEach(g => sm.push(sOf(g.z))); rows.forEach(r => sm.push(r.s)); sm.sort((p, q) => p - q);
    const runs = []; let cur = null;
    sm.forEach(q => { const r = at(zOf(q), q); if (r.h != null && r.h > 0) { if (!cur) runs.push(cur = []); cur.push(r); } else cur = null; });
    const polys = runs.filter(R => R.length >= 2 && len > 1e-6).map(R => R.map(r => [r.s, r.top]).concat(R.slice().reverse().map(r => [r.s, r.bot])));
    return { st, kind, a, b, len, path, rows, polys, at, xAt, auto, cut: b < b0 - 1e-6, stkCut: a > aR + 1e-6, rootCut: aR > a0 + 1e-6 };
  }
  const webOf = (st, kind) => st.web != null ? Math.max(0, +st.web || 0) : (kind === 'holm' ? 3 : 2);
  // Gurtwerte: Wurzel → Außenende der Tragfläche linear
  function capAt(G, c, key, z) { const a = +c[key + '0'] || 0, b = +c[key + '1'] || 0; return Math.max(0, a + (b - a) * (G.L > 0 ? z / G.L : 0)); }
  // Gurtmitte (Gesamt-x) an der Stelle z, unabhängig von den Stegen: Stützstellen Wurzel, ggf. je Segmentstoß, außen;
  // dazwischen im Grundriss gerade.
  // Schale: eine Dicke oder Aufbau aus Außenlage, Stützstoff, Innenlage (je Seite)
  const layA = c => Math.max(0, +c.layA || 0), layS = c => Math.max(0, +c.layS || 0), layI = c => Math.max(0, +c.layI || 0);
  const shellOf = c => (c.layOn ? layA(c) + layS(c) + layI(c) : Math.max(0, +c.shell || 0));
  // Endleiste: Abstand von der Endleiste, ab dem die Profilhöhe (senkrecht) kleiner als H wird. Abgetastet von der
  // Endleiste nach vorne (0,25 mm, höchstens 60 % der Tiefe), dann halbiert. null = wird nirgends erreicht.
  function teDist(G, z, H) {
    const f = frame(G, z), te = f.le + f.c, h = d => { const sc = section(G, te - d, z); return sc ? sc.top - sc.bot : 0; };
    if (H <= 0) return 0;
    let prev = 0;
    for (let d = 0.25; d <= f.c * 0.6; d += 0.25) {
      if (h(d) >= H) { let a = prev, b = d; for (let k = 0; k < 30; k++) { const m = (a + b) / 2; if (h(m) >= H) b = m; else a = m; } return (a + b) / 2; }
      prev = d;
    }
    return null;
  }
  // Stützstoff an der Endleiste (nur bei Schalenaufbau): wo sich die Schalenhälften berühren (Schleifen beginnt),
  // wo der Stützstoff oben/unten aufeinandertrifft und ab wo nur noch die Außenlagen Platz haben (Stützstoff ganz weg)
  function teLayers(G, c, z) {
    if (!c.layOn || layS(c) <= 0) return null;
    const a = layA(c), sS = layS(c), i = layI(c);
    return { start: teDist(G, z, 2 * (a + sS + i)), meet: teDist(G, z, 2 * (a + sS)), gone: teDist(G, z, 2 * a) };
  }
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
    const lay = capLay(c, G);
    if (lay === 'grp') {   // Segmentgruppen: je Gruppe innen → außen gerade im Grundriss
      const g = capGroups(G, c).find(q => z <= q.z1 + 1e-9) || capGroups(G, c).slice(-1)[0];
      return lerpPts([[g.z0, val(g.z0, g.gr.p0)], [g.z1, val(g.z1, g.gr.p1)]], z);
    }
    if (lay === 'joint') jointsIn(G, 0, G.L).forEach(q => { const v = c.capJ && c.capJ[q.k]; if (v != null) P.push([q.z, val(q.z, v)]); });
    P.push([G.L, val(G.L, c.capP1)]);
    return lerpPts(P, z);
  }
  // Gurtlage: 'line' = Wurzel → außen gerade, 'joint' = je Segmentstoß, 'grp' = Segmentgruppen (je Gruppe innen/außen)
  function capLay(c, G) {
    const l = c.capLay || (c.capPerJoint ? 'joint' : 'line');
    return G && G.segs.length < 2 && l !== 'line' ? 'line' : l;
  }
  // Gruppen c.capGrp = [{ to: letzter Segmentindex, p0: innen, p1: außen }], lückenlos ab Segment 0, letzte bis außen
  function capGroups(G, c) {
    const n = G.segs.length;
    if (!Array.isArray(c.capGrp) || !c.capGrp.length) c.capGrp = [{ to: n - 1, p0: +c.capP0 || 0, p1: +c.capP1 || 0 }];
    let prev = -1;
    c.capGrp.forEach((g, i) => { g.to = i === c.capGrp.length - 1 ? n - 1 : clamp(Math.round(+g.to || 0), prev + 1, n - 1 - (c.capGrp.length - 1 - i)); prev = g.to; });
    prev = -1;
    return c.capGrp.map(g => { const r = { gr: g, a: prev + 1, b: g.to, z0: G.segs[prev + 1].z0, z1: G.segs[g.to].z1 }; prev = g.to; return r; });
  }
  function setCapGroupCount(G, c, n) {
    const N = G.segs.length; n = clamp(Math.round(n) || 1, 1, N);
    const old = capGroups(G, c), at = z => { const f = frame(G, z), x = capCenter(G, c, z) - f.le; return Math.round((c.capMode === 'mm' ? x : x / f.c * 100) * 100) / 100; };
    if (n === old.length) return;
    // neue Gruppen gleichmäßig über die Segmente, Werte aus der bisherigen Lage
    const G2 = [];
    for (let i = 0; i < n; i++) { const a = Math.round(i * N / n), b = Math.round((i + 1) * N / n) - 1; G2.push({ to: b, p0: at(G.segs[a].z0 + 1e-6), p1: at(G.segs[b].z1 - 1e-6) }); }
    c.capGrp = G2;
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
  function stkAll(G, c) {
    let M = stkCache.get(App.wing); if (!M) stkCache.set(App.wing, M = new Map());
    const key = JSON.stringify(Object.keys(c).filter(k => k !== 'holm' && k !== 'ruder' && k !== 'step' && !/^lip/.test(k)).sort().map(k => [k, c[k]]));
    if (!M.has(key)) {
      if (M.size > 50) M.clear();
      const out = [];
      // Hauptsteckung ab der Wurzelrippe (bei schräger Rippe dort, wo sie die Mitte der Steckung trifft)
      if (c.stkOn) { const cen = z => stkCenter(G, c, z), z0 = rootZLine(G, c, cen); out.push(stkCalc(G, c, { z0, z1: clamp(z0 + (+c.stkLen || 0), 0, G.L), wall: c.stkWall, round: c.stkForm === 'round', w: c.stkW, fix: c.stkFix, d: c.stkD, mode: stkModeOf(c), v: c.stkV, cen })); }
      // Teilungen in Spannweitenrichtung: eigene Steckung je Trennstelle, x mm nach innen und x mm nach außen
      (c.stkSplit || []).forEach((t, i) => {
        const zt = clamp(+t.z || 0, 0, G.L), z0 = Math.max(clamp(zt - Math.max(0, +t.li || 0), 0, G.L), Math.min(zt, rootZLine(G, c, z => capCenter(G, c, z)))), z1 = clamp(zt + Math.max(0, +t.la || 0), 0, G.L);
        const S = stkCalc(G, c, { z0, z1, wall: t.wall, round: t.form === 'round', w: t.w, fix: t.fix, d: t.d, mode: t.vMode === 'wing' ? 'wing' : 'level', v: 0, cen: z => capCenter(G, c, z) });
        S.split = i; S.zt = zt; out.push(S);
      });
      M.set(key, out);
    }
    return M.get(key);
  }
  // Hauptsteckung an der Wurzel (null, wenn keine)
  function stkData(G, c) { const A = stkAll(G, c); return A.length && A[0].split == null ? A[0] : null; }
  function stkTrim(G, c, st, kind, a, b, xAt) {
    const S = stkData(G, c); if (!S || S.cy == null || !(S.oW > 0)) return a;
    const e = Math.min(b, S.len), web = webOf(st, kind), hit = z => Math.abs(xAt(z) - S.cx(z)) < S.oW / 2 + web / 2;
    let last = null;
    for (let z = a; z < e; z += 1) if (hit(z)) last = z;
    if (e >= a && hit(e)) last = e;
    return last == null ? a : Math.min(b, Math.min(last + 1, S.len));
  }
  // Höhe der V-Form-Linie der Tragfläche bei z (Stationen inkl. globaler V-Form), im Rahmen von section() (flipY aufgehoben)
  function riseAt(z) {
    const st = App.wing && App.wing.stations; if (!st || st.length < 2) return 0;
    const sg = state.cfg.flipY ? -1 : 1;
    for (let i = 1; i < st.length; i++) if (z <= st[i].z || i === st.length - 1) {
      const a = st[i - 1], b = st[i], d = b.z - a.z, t = d > 0 ? (z - a.z) / d : 0;
      return sg * ((+a.yRise || 0) + ((+b.yRise || 0) - (+a.yRise || 0)) * t);
    }
    return 0;
  }
  // Neigung der Tragfläche (V-Form, °) zwischen z0 und z1: Bezug für die Lage der Steckung
  const wingAngle = (z0, z1) => z1 > z0 + 1e-6 ? Math.atan((riseAt(z1) - riseAt(z0)) / (z1 - z0)) * 180 / Math.PI : 0;
  // Lage der Hauptsteckung: 'wing' = parallel zur Tragfläche, 'level' = waagrecht, 'free' = eigener Winkel gegen die Fläche.
  // Alte Stände ohne Angabe behalten ihre Lage (waagrecht bzw. der Winkel bei Rund).
  const stkModeOf = c => c.stkVMode || (c.stkForm === 'round' && +c.stkV ? 'free' : 'level');
  function stkCalc(G, c, P) {
    const z0 = P.z0, len = P.z1, wall = Math.max(0, +P.wall || 0), round = !!P.round, zs = [], cen = P.cen;
    // Lage über die Einbindetiefe: vDeg = Winkel gegen die Tragfläche (+ = Hülse fällt nach außen gegen die Profilebene),
    // tubeDeg = Neigung gegen die Waagrechte (Höhe y = cy + z·tan). waagrecht: vDeg = V-Form der Fläche → gerade Steckung.
    const wAng = wingAngle(z0, len), mode = P.mode || 'level';
    const vDeg = mode === 'level' ? wAng : mode === 'free' ? clamp(+P.v || 0, -45, 45) : 0, tubeDeg = mode === 'level' ? 0 : wAng - vDeg;
    const tan = Math.tan(tubeDeg * Math.PI / 180), cos = Math.cos(tubeDeg * Math.PI / 180);
    const N = Math.max(1, Math.min(40, Math.ceil((len - z0) / 10)));
    for (let i = 0; i <= N; i++) zs.push(z0 + (len - z0) * i / N);
    jointsIn(G, z0, len).forEach(q => zs.push(q.z));
    const capMin = Math.min(...zs.map(z => capAt(G, c, 'capW', z)));
    const box = w => {
      let top = Infinity, bot = -Infinity;
      for (const z of zs) {
        const xc = cen(z), ins = insetOf(G, c, 'holm', z);
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
    } else { pOW = Math.max(0, +P.w || 0) + 2 * wall; const q = box(pOW); pOH = q ? q.H : 0; }
    const pH = Math.max(0, pOH - 2 * wall), pW = Math.max(0, pOW - 2 * wall);
    // Festes Maß: Hülse ergibt sich daraus, die Prüfung meldet, wenn es nicht passt
    const fix = !!P.fix && +P.d > 0, D = fix ? +P.d : 0;
    const oW = fix && round ? D + 2 * wall : pOW, oH = fix ? D + 2 * wall : pOH, b = box(oW), warn = [];
    if (!b) return { z0, cx: cen, round, wall, len, fix, mode, vDeg, wAng, tubeDeg, tan, pH, pW, inW: 0, inH: 0, oW, oH: 0, warn: [T('Die Hülse ragt aus dem Profil.')] };
    if (fix && oH > b.H + 1e-6) warn.push(T('Passt nicht: Hülse außen') + ' ' + f1(oH) + ' mm, ' + T('Platz zwischen den Gurten') + ' ' + f1(b.H) + ' mm');
    if (oW > capMin + 1e-6) warn.push(T('Die Hülse ist breiter als der Gurt an der schmalsten Stelle:') + ' ' + f1(capMin) + ' mm');
    const inH = oH - 2 * wall, inW = oW - 2 * wall;
    if (inH <= 0 || inW <= 0) warn.push(T('Zwischen den Gurten bleibt kein Platz für die Steckung.'));
    return { z0, cx: cen, round, wall, len, fix, mode, vDeg, wAng, tubeDeg, tan, pH, pW, oW, oH, inW: Math.max(0, inW), inH: Math.max(0, inH), cy: (b.top + b.bot) / 2, warn };
  }
  // Abgerundet: die Steckung muss hineinpassen
  const fl1 = v => (Math.floor(v * 10 + 1e-6) / 10).toFixed(1);
  function stkResult() {
    if (!stkBox) return;
    const G = geo(), c = cfg(); stkBox.innerHTML = ''; if (!G) return;
    stkAll(G, c).forEach(S => {
    const line = (t, col) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'font-size:12px;margin-top:3px' + (col ? ';color:' + col : ''); stkBox.appendChild(d); };
    if (S.split != null) line(T('Teilung') + ' ' + (S.split + 1) + ' (' + f1(S.zt) + ' mm, ' + T('Steckung von') + ' ' + f1(S.z0) + ' ' + T('bis') + ' ' + f1(S.len) + ' mm):', '#fff06a');
    else if ((c.stkSplit || []).length) line(T('Hauptsteckung') + ':', '#fff06a');
    if (S.round) line(T('Steckung möglich: Ø') + ' ' + fl1(S.pH) + ' mm', '#7ee0a0');
    else line(T('Steckung möglich: Dicke') + ' ' + fl1(S.pH) + ' mm × ' + T('Breite') + ' ' + fl1(S.pW) + ' mm', '#7ee0a0');
    if (S.fix) line(T('Eingetragen:') + ' ' + (S.round ? 'Ø ' + f1(S.inH) : f1(S.inH) + ' × ' + f1(S.inW)) + ' mm');
    line(S.round ? T('Hülse außen: Ø') + ' ' + f1(S.oH) + ' mm' : T('Hülse außen:') + ' ' + f1(S.oH) + ' × ' + f1(S.oW) + ' mm');
    if (Math.abs(S.wAng) > 0.05 || Math.abs(S.tubeDeg) > 0.05)
      line(T('Neigung der Hülse') + ' ' + f1(S.tubeDeg) + '°, ' + T('V-Form der Tragfläche') + ' ' + f1(S.wAng) + '°' + (S.split == null ? ', ' + T('Knick der Steckung') + ' ' + f1(Math.abs(2 * S.tubeDeg)) + '°' : ''));
    S.warn.forEach(w => line(w, '#ffb454'));
    if (S.split != null && S.cy != null) c.holm.forEach((st, k) => {
      const d = stegData(G, c, st, 'holm');
      for (let z = Math.max(S.z0, d.a); z <= Math.min(S.len, d.b); z += 2) if (Math.abs(d.at(z, 0).x - S.cx(z)) < S.oW / 2 + webOf(st, 'holm') / 2) { line(T('Holmsteg') + ' ' + (k + 1) + ' ' + T('trifft die Hülse – dort aussparen.'), '#ffb454'); break; }
    });
    });
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
    if (App.StegRippen) {
      const b3 = document.createElement('button'); b3.type = 'button'; b3.textContent = '🧊 ' + T('3D-Ansicht');
      b3.title = T('Schale, Gurt, Stege, Stützrippen und Steckung in 3D, einzeln ein-/ausblendbar (eigenes Fenster)');
      b3.style.cssText = 'position:absolute;top:8px;right:10px;z-index:2'; b3.onclick = () => App.StegRippen.open3d();
      cw.appendChild(b3);
    }
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
      if (best && best.rib != null) { if (App.StegRippen) App.StegRippen.select(best.rib); }   // Stützrippe
      else if (best && best.root) { showRoot(); focus('root'); }   // Wurzelrippe
      else if (best && best !== sel) { sel = best; refresh(true); const nb = side.querySelector('[data-selsteg]'); if (nb) nb.scrollIntoView({ block: 'nearest' }); }
    });
    cv.addEventListener('dblclick', () => { fitNext = autoFit = true; draw(); });
  }

  // Seitenleiste des Reiters (Aufbau nur bei Strukturänderung, Zahlen rechnen ohne Neuaufbau)
  // Eigene Menügruppen wie in den anderen Modulen (Standard zugeklappt): Steghöhen (allgemein), Holmgurt, Steckung, Stege, Stützrippen, Ausgabe
  const GRP = { root: ['Wurzelrippe', 'stegHroot'], cap: ['Holmgurt', 'stegHcap'], stk: ['Steckung', 'stegHstk'], steg: ['Stege', 'stegHsteg'], lip: ['Dichtlippe (Ruderstege)', 'stegHlip'], rip: ['Stützrippen', 'stegHrip'], out: ['Ausgabe', 'stegHout'] };
  function mkGrp(part) {
    const [title, key] = GRP[part], g = App.grp(title, false, 'stegh', { key });
    g.g.dataset.part = part; side.appendChild(g.g);
    return g.body;
  }
  function openGrp(el) { const b = el && el.querySelector('.body'), h = el && el.querySelector('h3'); if (b && h && b.style.display === 'none') h.click(); }
  function buildSide() {
    if (!side) return;
    const { numRow, selectRow, hint, subhead, txtRow } = App, c = cfg(), G = geo(), L = G ? G.L : 0, scr = document.getElementById('side'), keep = scr ? scr.scrollTop : 0;
    side.innerHTML = '';
    const gm = App.grp('Steghöhen', true, 'stegh', { key: 'stegH', alwaysOpen: true }); side.appendChild(gm.g);
    let box = gm.body;
    if (App.wingSelectEl) {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = T('Tragfläche');
      const s = App.wingSelectEl(); s.style.cssText = '';
      row.append(l, s); box.appendChild(row);
    }
    const NR = { step: 0.5, min: 0, norender: true, enter: true };
    const upd = () => { update(); };
    hint(box, 'Höhen aus der Außenkontur der aktiven Tragfläche im Tragflächendesign, senkrecht gemessen. Holmsteg: Abzug 2 × (Schale + Gurt). Rudersteg: Abzug 2 × Schale. Ansicht: Rad = Zoom, Ziehen = verschieben, Klick = Steg wählen, Doppelklick = einpassen.');
    if (!G) { hint(box, 'Keine Tragfläche vorhanden.'); return; }
    App.boolRow(box, 'Schale aus Außenlage, Stützstoff, Innenlage', () => !!c.layOn, v => {
      c.layOn = v;
      if (v && c.layA == null) { c.layA = 0.2; c.layS = Math.max(0, (+c.shell || 0) - 0.4); c.layI = 0.2; c.capOn = 'inner'; c.ruderOn = 'inner'; c.capOver = true; }
      refresh(true);
    });
    if (c.layOn) {
      const NL = Object.assign({}, NR, { step: 0.1 });
      numRow(box, 'Außenlage je Seite (mm)', () => c.layA, v => { c.layA = Math.max(0, v); upd(); }, NL);
      numRow(box, 'Stützstoff je Seite (mm)', () => c.layS, v => { c.layS = Math.max(0, v); upd(); }, NL);
      numRow(box, 'Innenlage je Seite (mm)', () => c.layI, v => { c.layI = Math.max(0, v); upd(); }, NL);
      const ON = [['inner', 'Innenlage'], ['outer', 'Außenlage']];
      selectRow(box, 'Holmgurt liegt auf', ON, () => c.capOn || 'inner', v => { c.capOn = v; refresh(true); });
      if (c.capOn === 'outer') App.boolRow(box, 'Innenlage läuft über den Gurt', () => c.capOver !== false, v => { c.capOver = v; upd(); }, 'An: Der Steg steht auf der Innenlage über dem Gurt. Aus: Der Steg steht direkt auf dem Gurt.');
      selectRow(box, 'Ruderstege liegen auf', ON, () => c.ruderOn || 'inner', v => { c.ruderOn = v; upd(); });
    } else numRow(box, 'Schalendicke je Seite (mm)', () => c.shell, v => { c.shell = Math.max(0, v); upd(); }, NR);
    numRow(box, 'Schalenüberstand Nase (mm)', () => ovLE(c), v => { c.shellOvLE = Math.max(0, v); upd(); }, Object.assign({}, NR, { step: 1 }));
    numRow(box, 'Schalenüberstand Endleiste (mm)', () => ovTE(c), v => { c.shellOvTE = Math.max(0, v); upd(); }, Object.assign({}, NR, { step: 1 }));
    hint(box, 'Steht die Schale an Nase oder Endleiste über, zeigt die Liste neben jedem Maß ab Nase bzw. ab Endleiste zusätzlich das Maß plus Überstand.');
    numRow(box, 'Höhe alle … mm Steglänge', () => c.step, v => { c.step = Math.max(1, v); upd(); }, Object.assign({}, NR, { step: 10, min: 1 }));
    // Wurzelrippe: Schrägstellung, Schnitt mit allen Teilen, Übernahme ins CAD (wurzelrippe.js)
    if (App.StegWurzel) App.StegWurzel.sidebar(mkGrp('root'), { upd, refresh: () => refresh(true) });
    // Holmgurt: aufklappbar, fest definiert und unabhängig von den Stegen
    const det = mkGrp('cap');
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
      if (Array.isArray(c.capGrp) && c.capGrp.length) capGroups(G, c).forEach(g => { g.gr.p0 = conv(g.z0, g.gr.p0); g.gr.p1 = conv(g.z1, g.gr.p1); });
      c.capMode = v; refresh(true);
    });
    App.boolRow(det, 'Rechtwinklig zur Wurzelrippe (Draufsicht)', () => !!c.capOrtho, v => { c.capOrtho = v; refresh(true); }, 'Gurt und Steckung laufen von oben gesehen gerade, rechtwinklig zur Wurzelrippe: gleiche Rücklage wie an der Wurzel über die ganze Spannweite.');
    if (G.segs.length > 1 && !c.capOrtho) selectRow(det, 'Gurtlage angeben', [['line', 'Wurzel → außen gerade'], ['joint', 'an jedem Segmentstoß'], ['grp', 'je Segmentgruppe innen/außen']], () => capLay(c, G), v => {
      if (v === 'grp' && capLay(c, G) !== 'grp') { const keep = c.capGrp; c.capGrp = null; capGroups(G, c); if (Array.isArray(keep) && keep.length) c.capGrp = keep; }
      c.capLay = v; c.capPerJoint = v === 'joint'; refresh(true);
    });
    {
      const u = c.capMode === 'mm' ? ' (mm)' : ' (%)', GP = Object.assign({}, NR, { step: 1 }), lay = c.capOrtho ? 'line' : capLay(c, G);
      if (lay === 'grp') {
        const GR = capGroups(G, c), N = G.segs.length;
        numRow(det, 'Anzahl Segmentgruppen', () => GR.length, v => { setCapGroupCount(G, c, v); refresh(true); }, { step: 1, min: 1, max: N, dec: 0 });
        GR.forEach((g, i) => {
          const h = document.createElement('div'); h.style.cssText = 'margin:6px 0 2px;font-weight:600;color:#ff6ae6';
          h.textContent = T('Gruppe') + ' ' + (i + 1) + ': ' + T('Segment') + ' ' + (g.a + 1) + (g.b > g.a ? '–' + (g.b + 1) : '');
          det.appendChild(h);
          if (i < GR.length - 1) {
            const opts = []; for (let k = g.a; k <= N - 1 - (GR.length - 1 - i); k++) opts.push([String(k), T('bis Segment') + ' ' + (k + 1)]);
            selectRow(det, 'Gruppe endet', opts, () => String(g.b), v => { g.gr.to = +v; refresh(true); });
          }
          numRow(det, T('Gurtmitte innen') + u, () => g.gr.p0, v => { g.gr.p0 = v; upd(); }, GP);
          numRow(det, T('Gurtmitte außen') + u, () => g.gr.p1, v => { g.gr.p1 = v; upd(); }, GP);
        });
        hint(det, 'Je Gruppe läuft der Gurt von innen nach außen im Grundriss gerade. An der Grenze zweier Gruppen darf die Lage springen oder knicken.');
      } else {
        numRow(det, T('Gurtmitte Wurzel') + u, () => c.capP0, v => { c.capP0 = v; upd(); }, GP);
        if (lay === 'joint') fillCapJoints(G, c).forEach(q => numRow(det, T('Gurtmitte') + ' ' + T('Segmentstoß') + ' ' + (q.k + 1) + '|' + (q.k + 2) + u, () => c.capJ[q.k], v => { c.capJ[q.k] = v; upd(); }, GP));
        if (!c.capOrtho) numRow(det, T('Gurtmitte außen') + u, () => c.capP1, v => { c.capP1 = v; upd(); }, GP);
      }
    }
    // Steckung: aufklappbar, liegt immer zwischen den Gurten
    const dk = mkGrp('stk');
    App.boolRow(dk, 'Steckung vorsehen', () => !!c.stkOn, v => {
      c.stkOn = v;
      if (v && c.stkWall == null) { c.stkWall = 1; c.stkLen = Math.round(Math.min(200, L)); c.stkForm = 'square'; c.stkW = 15; c.stkVMode = 'wing'; }
      refresh(true);
    });
    stkBox = (c.stkOn || (c.stkSplit || []).length) ? document.createElement('div') : null;
    if (c.stkOn) {
      selectRow(dk, 'Form', [['square', 'Vierkant'], ['round', 'Rund']], () => c.stkForm || 'square', v => { c.stkForm = v; refresh(true); });
      if (!c.capOrtho) App.boolRow(dk, 'Rechtwinklig zur Wurzelrippe (Draufsicht)', () => !!c.stkOrtho, v => { c.stkOrtho = v; refresh(true); }, 'Nur die Steckung läuft von oben gesehen gerade, rechtwinklig zur Wurzelrippe, ab der Gurtmitte an der Wurzel. Der Gurt bleibt, wie er ist.');
      numRow(dk, 'Wandstärke Hülse (mm)', () => c.stkWall, v => { c.stkWall = Math.max(0, v); upd(); }, GR);
      numRow(dk, 'Einbindetiefe ab Wurzel (mm)', () => c.stkLen, v => { c.stkLen = clamp(v, 0, L); upd(); }, Object.assign({}, NR, { step: 10 }));
      if (c.stkForm !== 'round') numRow(dk, 'Breite Steckung (mm)', () => c.stkW, v => { c.stkW = Math.max(0, v); upd(); }, GB);
      selectRow(dk, 'Lage der Steckung', [['wing', 'parallel zur Tragfläche (V-Form)'], ['level', 'waagrecht (gerade Steckung)'], ['free', 'eigener Winkel']], () => stkModeOf(c), v => {
        // beim Wechsel auf „eigener Winkel“ mit der bisherigen Lage vorbelegen (kein Sprung)
        if (v === 'free' && stkModeOf(c) !== 'free') { const S0 = stkData(G, c); c.stkV = S0 ? Math.round(S0.vDeg * 10) / 10 : 0; }
        c.stkVMode = v; refresh(true);
      }, 'Parallel zur Tragfläche: Die Hülse folgt der V-Form; die Steckung ist in der Mitte um 2 × V-Form geknickt. Waagrecht: gerade Steckung durch den Rumpf, die Hülse liegt schräg in der Fläche (weniger Platz zwischen den Gurten).');
      if (stkModeOf(c) === 'free') numRow(dk, 'Winkel gegen die Tragfläche (° je Seite)', () => c.stkV || 0, v => { c.stkV = clamp(v, -45, 45); upd(); }, Object.assign({}, NR, { step: 0.5, min: -45, max: 45, hint: '+ = Hülse fällt nach außen gegen die Profilebene. 0 = parallel zur Tragfläche, gleich der V-Form der Fläche = waagrecht.' }));
      App.boolRow(dk, 'Festes Maß eintragen', () => !!c.stkFix, v => { c.stkFix = v; if (v && !(+c.stkD > 0)) { const S0 = stkData(G, c); c.stkD = S0 ? Math.floor(S0.pH * 10) / 10 : 0; } refresh(true); });
      if (c.stkFix) numRow(dk, c.stkForm === 'round' ? 'Durchmesser Steckung (mm)' : 'Dicke Steckung (mm)', () => c.stkD, v => { c.stkD = Math.max(0, v); upd(); }, GR);
    }
    // Teilungen der Tragfläche in Spannweitenrichtung, je eine eigene Steckung
    subhead(dk, 'Teilungen in Spannweitenrichtung', '#fff06a');
    numRow(dk, 'Anzahl Teilungen', () => (c.stkSplit || []).length, v => {
      const n = Math.max(0, Math.min(10, Math.round(v))), A = c.stkSplit || (c.stkSplit = []);
      while (A.length > n) A.pop();
      while (A.length < n) A.push({ z: Math.round(L * (A.length + 1) / (n + 1)), li: 100, la: 100, form: 'square', w: 10, wall: 1, vMode: 'wing' });
      refresh(true);
    }, { step: 1, min: 0, max: 10, int: true, norender: true, enter: true });
    (c.stkSplit || []).forEach((t, i) => {
      subhead(dk, T('Teilung') + ' ' + (i + 1), '#fff06a');
      numRow(dk, 'Lage der Trennung ab Wurzel (mm)', () => t.z, v => { t.z = clamp(v, 0, L); upd(); }, Object.assign({}, NR, { step: 5 }));
      numRow(dk, 'Steckung in den Flügel innen (mm)', () => t.li, v => { t.li = Math.max(0, v); upd(); }, Object.assign({}, NR, { step: 10 }));
      numRow(dk, 'Steckung in den Flügel außen (mm)', () => t.la, v => { t.la = Math.max(0, v); upd(); }, Object.assign({}, NR, { step: 10 }));
      selectRow(dk, 'Form', [['square', 'Vierkant'], ['round', 'Rund']], () => t.form || 'square', v => { t.form = v; refresh(true); });
      selectRow(dk, 'Lage der Steckung', [['wing', 'parallel zur Tragfläche (V-Form)'], ['level', 'waagrecht']], () => t.vMode === 'wing' ? 'wing' : 'level', v => { t.vMode = v; refresh(true); });
      numRow(dk, 'Wandstärke Hülse (mm)', () => t.wall, v => { t.wall = Math.max(0, v); upd(); }, GR);
      if (t.form !== 'round') numRow(dk, 'Breite Steckung (mm)', () => t.w, v => { t.w = Math.max(0, v); upd(); }, GB);
      App.boolRow(dk, 'Festes Maß eintragen', () => !!t.fix, v => { t.fix = v; if (v && !(+t.d > 0)) { const S0 = stkAll(G, c).find(q => q.split === i); t.d = S0 ? Math.floor(S0.pH * 10) / 10 : 0; } refresh(true); });
      if (t.fix) numRow(dk, t.form === 'round' ? 'Durchmesser Steckung (mm)' : 'Dicke Steckung (mm)', () => t.d, v => { t.d = Math.max(0, v); upd(); }, GR);
    });
    if (stkBox) dk.appendChild(stkBox);
    if (!sel || (c.holm.indexOf(sel) < 0 && c.ruder.indexOf(sel) < 0)) sel = c.holm[0] || c.ruder[0] || null;
    box = mkGrp('steg');
    for (const [kind, label] of [['holm', 'Holmstege'], ['ruder', 'Ruderstege']]) {
      subhead(box, label, COL[kind]);
      numRow(box, 'Anzahl', () => c[kind].length, v => setCount(kind, v), { step: 1, min: 0, max: 20, int: true, norender: true, enter: true });
      c[kind].forEach((st, i) => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center';
        const nb = document.createElement('button'); nb.textContent = st.name || (T(label) + ' ' + (i + 1)); nb.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left';
        if (st === sel) { nb.className = 'primary'; nb.dataset.selsteg = '1'; } nb.onclick = () => { sel = st; refresh(true); };
        const del = document.createElement('button'); del.textContent = '✕'; del.title = T('Steg löschen'); del.style.padding = '2px 7px';
        del.onclick = () => { c[kind].splice(i, 1); if (sel === st) sel = null; fitNext = autoFit = true; refresh(true); };
        row.append(nb, del); box.appendChild(row);
      });
    }
    if (sel) {
      const st = sel, kind = c.holm.indexOf(st) >= 0 ? 'holm' : 'ruder';
      subhead(box, 'Gewählter Steg');
      txtRow(box, 'Name', () => st.name || '', v => { st.name = v; upd(); });
      const lenNow = () => stegData(G, c, st, kind).len;
      let iFrom, iTo, iLen;
      const after = () => { if (st.perJoint) refresh(true); else upd(); };   // andere Stöße im Bereich -> neue Zeilen
      const sync = () => { if (iFrom) iFrom.value = f1(+st.from || 0); if (iTo) iTo.value = f1(+st.to || 0); if (iLen) iLen.value = f1(lenNow()); };
      if (G.segs.length > 1) {
        segSync(G, st);
        const so = [['', T('frei (mm)')]].concat(G.segs.map((q, k) => [String(k), T('Segment') + ' ' + (k + 1)]));
        const gs = k => st[k] == null ? '' : String(st[k]);
        selectRow(box, 'Ab Segment (innen)', so, () => gs('segA'), v => { st.segA = v === '' ? null : +v; if (st.segA != null && st.segB != null && st.segB < st.segA) st.segB = st.segA; segSync(G, st); refresh(true); });
        selectRow(box, 'Bis Segment (außen)', so, () => gs('segB'), v => { st.segB = v === '' ? null : +v; if (st.segA != null && st.segB != null && st.segA > st.segB) st.segA = st.segB; segSync(G, st); refresh(true); });
      }
      iFrom = numRow(box, 'Von (mm ab Wurzel)', () => st.from, v => { st.segA = null; st.from = clamp(v, 0, L); sync(); after(); }, Object.assign({}, NR, { step: 10 }));
      iTo = numRow(box, 'Bis (mm ab Wurzel)', () => st.to, v => { st.segB = null; st.to = clamp(v, 0, L); sync(); after(); }, Object.assign({}, NR, { step: 10 }));
      iLen = numRow(box, 'Länge des Stegs (mm)', () => f1(lenNow()), v => {
        st.segB = null; const l0 = lenNow(), d = Math.abs((+st.to || 0) - (+st.from || 0));
        st.to = clamp((+st.from || 0) + Math.max(0, v) * (l0 > 0 ? d / l0 : 1), 0, L); sync(); after();
      }, Object.assign({}, NR, { step: 10 }));
      hint(box, T('Spannweite gesamt: ') + f1(L) + ' mm');
      const units = [['pct', '% der Sehne ab Nase'], ['mm', 'mm ab Nase']];
      if (kind === 'ruder') units.push(['hinge', 'an der Scharnierlinie']);
      if (kind === 'holm') units.push(['gurt', 'auf dem Gurt verteilt']);
      selectRow(box, 'Lage angeben', units, () => st.unit || 'pct', v => { if (v === 'gurt') c.holm.forEach(q => { q.unit = 'gurt'; }); st.unit = v; fitNext = autoFit = true; refresh(true); });
      const onCap = st.unit === 'gurt', joints = G.segs.length > 1 && !onCap ? (st.perJoint ? fillJoints(G, st) : null) : null;
      const hng = st.unit === 'hinge';
      if (hng) selectRow(box, 'Abstand angeben', [['same', 'gleich über die ganze Länge'], ['line', 'innen / außen']].concat(G.segs.length > 1 ? [['joint', 'an jedem Segmentstoß'], ['grp', 'je Segmentgruppe innen/außen']] : []), () => hingeLay(G, st), v => {
        const a0 = clamp(Math.min(+st.from || 0, +st.to || 0), 0, L), b0 = clamp(Math.max(+st.from || 0, +st.to || 0), 0, L);
        if (v === 'line' && st.off1 == null) st.off1 = +st.off || 0;
        if (v === 'grp' && hingeLay(G, st) !== 'grp') { const keep = st.hGrp; st.hGrp = null; hGroups(G, st, a0, b0); if (Array.isArray(keep) && keep.length) st.hGrp = keep; }
        st.hLay = v; st.perJoint = v === 'joint'; refresh(true);
      });
      else if (G.segs.length > 1 && !onCap) App.boolRow(box, 'Lage je Segmentstoß einzeln', () => !!st.perJoint, v => { st.perJoint = v; refresh(true); }, 'An: eigene Lage an jedem Segmentstoß im Bereich des Stegs; dazwischen läuft er im Grundriss gerade.');
      const jName = q => T('Segmentstoß') + ' ' + (q.k + 1) + '|' + (q.k + 2);
      if (onCap) {
        const grp = distGroup(c), thr = distThrough(grp);
        hint(box, 'Erster Steg an der Vorderkante des Gurts, letzter an der Hinterkante, die übrigen gleichmäßig dazwischen. Reicht die Gurtbreite nicht mehr, läuft nur der gewählte durch, die anderen enden dort.');
        selectRow(box, 'Durchlaufender Steg', grp.map((q, i) => [String(i), q.name || String(i + 1)]), () => String(grp.indexOf(thr)), v => { grp.forEach((q, i) => { q.through = i === +v; }); refresh(true); });
      } else if (st.unit === 'hinge') {
        // Abstand zur Scharnierlinie: intern mit Vorzeichen (> 0 = vor dem Scharnier), Richtung als eigene Wahl
        const hRow = (name, get, set) => {
          let dir = get() < 0 ? -1 : 1;
          selectRow(box, name, [['1', 'vor der Scharnierlinie'], ['-1', 'nach der Scharnierlinie']], () => String(dir), v => { dir = +v; set(Math.abs(get()) * dir); upd(); });
          numRow(box, 'Abstand (mm)', () => Math.abs(get()), v => { set(Math.max(0, v) * dir); upd(); }, Object.assign({}, NR));
        };
        const lay = hingeLay(G, st);
        if (lay === 'joint') {
          hRow(T('Anfang'), () => +st.off || 0, v => { st.off = v; });
          (joints || []).forEach(q => hRow(jName(q), () => +st.jpos[q.k] || 0, v => { st.jpos[q.k] = v; }));
          hRow(T('Ende'), () => +st.off1 || 0, v => { st.off1 = v; });
        } else if (lay === 'line') {
          hRow(T('Innen'), () => +st.off || 0, v => { st.off = v; });
          hRow(T('Außen'), () => (st.off1 != null ? +st.off1 : +st.off || 0), v => { st.off1 = v; });
          hint(box, 'Der Abstand ändert sich von innen nach außen gleichmäßig.');
        } else if (lay === 'grp') {
          const a0 = clamp(Math.min(+st.from || 0, +st.to || 0), 0, L), b0 = clamp(Math.max(+st.from || 0, +st.to || 0), 0, L);
          const GR = hGroups(G, st, a0, b0), [kA, kB] = segRange(G, a0, b0);
          numRow(box, 'Anzahl Segmentgruppen', () => GR.length, v => { setHGroupCount(G, st, a0, b0, v); refresh(true); }, { step: 1, min: 1, max: kB - kA + 1, dec: 0 });
          GR.forEach((g, i) => {
            const h = document.createElement('div'); h.style.cssText = 'margin:6px 0 2px;font-weight:600;color:' + COL.ruder;
            h.textContent = T('Gruppe') + ' ' + (i + 1) + ': ' + T('Segment') + ' ' + (g.a + 1) + (g.b > g.a ? '–' + (g.b + 1) : '');
            box.appendChild(h);
            if (i < GR.length - 1) {
              const opts = []; for (let k = g.a; k <= kB - (GR.length - 1 - i); k++) opts.push([String(k), T('bis Segment') + ' ' + (k + 1)]);
              selectRow(box, 'Gruppe endet', opts, () => String(g.b), v => { g.gr.to = +v; refresh(true); });
            }
            hRow(T('Innen'), () => +g.gr.p0 || 0, v => { g.gr.p0 = v; });
            hRow(T('Außen'), () => +g.gr.p1 || 0, v => { g.gr.p1 = v; });
          });
          hint(box, 'Je Gruppe ändert sich der Abstand von innen nach außen gleichmäßig. An der Grenze zweier Gruppen darf er springen.');
        } else hRow('Lage', () => +st.off || 0, v => { st.off = v; });
      } else {
        const u = st.unit === 'mm' ? ' (mm)' : ' (%)', NP = Object.assign({}, NR, { step: 1 });
        numRow(box, T('Lage Anfang') + u, () => st.pos0, v => { st.pos0 = v; upd(); }, NP);
        if (st.perJoint) (joints || []).forEach(q => numRow(box, T('Lage') + ' ' + jName(q) + u, () => st.jpos[q.k], v => { st.jpos[q.k] = v; upd(); }, NP));
        numRow(box, T('Lage Ende') + u, () => st.pos1, v => { st.pos1 = v; upd(); }, NP);
        if (!st.perJoint) hint(box, 'Zwischen Anfang und Ende läuft der Steg im Grundriss gerade.');
      }
      numRow(box, 'Stegbreite (mm)', () => webOf(st, kind), v => { st.web = Math.max(0, v); upd(); }, Object.assign({}, NR));
    }
    // Dichtlippe: eigenes Menü zu den Ruderstegen (die Schnittansicht zeigt nur Ausschlag und Prüfung)
    {
      const lb = mkGrp('lip'), NL = Object.assign({}, NR, { step: 0.1 }), NM = Object.assign({}, NR, { step: 1 });
      App.boolRow(lb, 'Dichtlippe', () => !!c.lipOn, v => {
        c.lipOn = v;
        if (v && c.lipLen == null) { c.lipLen = 25; c.lipOver = 10; c.lipT = 0.3; c.lipGap = 1; c.lipSide = 'opp'; c.lipFix = 'ruder'; }
        if (v && c.lipR == null && c.lipR0 == null) { c.lipR0 = 10; c.lipSlot = 0; }
        refresh(true);
      });
      if (c.lipOn) {
        selectRow(lb, 'Seite', [['opp', 'gegenüber Scharnier'], ['top', 'oben'], ['bot', 'unten']], () => c.lipSide || 'opp', v => { c.lipSide = v; refresh(true); });
        selectRow(lb, 'befestigt an', [['ruder', 'Ruder'], ['wing', 'Flügel']], () => c.lipFix || 'ruder', v => { c.lipFix = v; refresh(true); });
        numRow(lb, 'Länge (mm)', () => c.lipLen, v => { c.lipLen = Math.max(0, v); upd(); }, NM);
        numRow(lb, 'Dicke (mm)', () => c.lipT, v => { c.lipT = Math.max(0, v); upd(); }, NL);
        numRow(lb, 'Spalt (mm)', () => c.lipGap, v => { c.lipGap = Math.max(0, v); upd(); }, NL);
        const GR = lipRGroups(G, c);
        if (GR) {
          GR.forEach((g, i) => {
            const h = document.createElement('div'); h.style.cssText = 'margin:6px 0 2px;font-weight:600;color:' + COL.ruder;
            h.textContent = T('Gruppe') + ' ' + (i + 1) + ': ' + T('Segment') + ' ' + (g.a + 1) + (g.b > g.a ? '–' + (g.b + 1) : ''); lb.appendChild(h);
            numRow(lb, 'Radius innen (mm, 0 = gerade)', () => c.lipRGrp[i].r0, v => { c.lipRGrp[i].r0 = Math.max(0, v); upd(); }, NM);
            numRow(lb, 'Radius außen (mm, 0 = gerade)', () => c.lipRGrp[i].r1, v => { c.lipRGrp[i].r1 = Math.max(0, v); upd(); }, NM);
          });
          hint(lb, 'Gruppen wie beim Rudersteg an der Scharnierlinie. Je Gruppe ändert sich der Radius von innen nach außen gleichmäßig.');
        } else {
          numRow(lb, 'Radius innen (mm, 0 = gerade)', () => lipR0(c), v => { c.lipR0 = Math.max(0, v); upd(); }, NM);
          numRow(lb, 'Radius außen (mm, 0 = gerade)', () => lipR1(c), v => { c.lipR1 = Math.max(0, v); upd(); }, NM);
        }
        numRow(lb, 'Ruderschlitz zur Scharnierlinie (mm, + = hinten)', () => +c.lipSlot || 0, v => { c.lipSlot = v; upd(); }, Object.assign({}, NL, { min: -1e9 }));
        if (c.lipFix !== 'wing') {
          App.boolRow(lb, 'Vorderen Rudersteg automatisch nach vorne setzen', () => !!c.lipAuto, v => { c.lipAuto = v; if (v && c.lipMax == null) { c.lipMax = 25; c.lipMargin = 0.5; } refresh(true); });
          if (c.lipAuto) {
            numRow(lb, 'bis Ausschlag ± (°)', () => c.lipMax, v => { c.lipMax = clamp(v, 0, 45); upd(); }, Object.assign({}, NR, { step: 1 }));
            numRow(lb, 'Mindestabstand (mm)', () => c.lipMargin, v => { c.lipMargin = Math.max(0, v); upd(); }, NL);
          }
        }
        hint(lb, 'Ausschlag und Prüfung in der Schnittansicht.');
      }
    }
    if (App.StegRippen) App.StegRippen.sidebar(mkGrp('rip'), { upd, refresh: () => refresh(true) });   // Stützrippen (stuetzrippen.js)
    box = mkGrp('out');
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
    if (App.cadImportDxfText) { const b = document.createElement('button'); b.textContent = T('In CAD übernehmen'); b.className = 'primary'; b.title = T('Alle Stege und Stützrippen in den Reiter „CAD-Bearbeitung" laden, je Steg/Rippe eine Ebene (ersetzt dessen Inhalt nach Rückfrage)'); b.onclick = toCad; bar.appendChild(b); }
    if (App.cadImportDxfText && App.StegWurzel) { const b = document.createElement('button'); b.textContent = T('Wurzelrippe in CAD übernehmen'); b.title = T('Schnitt in der Ebene der Wurzelrippe (wahre Form) mit Schale/Lagen, Holmgurt, Stegen, Hülse, Steckung und Rippenkontur in den Reiter „CAD-Bearbeitung" laden, je Teil eine Ebene (ersetzt dessen Inhalt nach Rückfrage)'); b.onclick = () => App.StegWurzel.toCad(); bar.appendChild(b); }
    if (App.exportViaPicker && App.StegWurzel && App.StegWurzel.stlDialog) { const b = document.createElement('button'); b.textContent = T('Wurzelrippe als STL…'); b.title = T('Wurzelrippe als Körper exportieren: Dicke und Ausnehmungen (Holmgurt, Hülse, Bohrungen) abfragen, dann STL-Vorschau und Speichern'); b.onclick = () => App.StegWurzel.stlDialog(); bar.appendChild(b); }
    const cp = document.createElement('button'); cp.textContent = T('Liste kopieren'); cp.title = T('Höhenliste als Tabelle in die Zwischenablage (z. B. für Excel)'); cp.onclick = copyList; bar.appendChild(cp);
    const pp = document.createElement('button'); pp.textContent = T('🔍 Druckvorschau…'); pp.title = T('Höhenliste drucken oder als PDF speichern'); pp.onclick = printPreview; bar.appendChild(pp);
    box.appendChild(bar);
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
    if (App.StegRippen) layers.push(...App.StegRippen.cadLayers(yc - 20));   // Stützrippen mit Löchern darunter
    return layers.length ? Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 3 }) : null;
  }
  function toCad() {
    const t = dxfText();
    if (!t) { App.toast && App.toast(T('Keine Stege mit Höhe vorhanden.')); return; }
    App.cadImportDxfText(t, T('Steghöhen'));
    if (App.switchView && document.getElementById('cadView')) App.switchView('cad');
  }
  // Schalenüberstand: wird zu allen Abständen ab Nase bzw. ab Endleiste addiert (Maß ab Schalenkante)
  // Schalenüberstand Nase/Endleiste getrennt (Altstand c.shellOv gilt für beide). Die Liste zeigt die Originalmaße
  // und, wenn ein Überstand gesetzt ist, daneben dieselben Maße plus Überstand (Maß ab Schalenkante).
  const ovLE = c => Math.max(0, +(c.shellOvLE != null ? c.shellOvLE : c.shellOv) || 0);
  const ovTE = c => Math.max(0, +(c.shellOvTE != null ? c.shellOvTE : c.shellOv) || 0);
  const ovH = h => h.replace(/ \(mm\)$/, '') + ' ' + T('+ Überstand') + ' (mm)';
  const hN = h => [T(h)].concat(ovLE(cfg()) > 0 ? [ovH(T(h))] : []), hT = h => [T(h)].concat(ovTE(cfg()) > 0 ? [ovH(T(h))] : []);
  const vN = (c, x) => [f1(x)].concat(ovLE(c) > 0 ? [f1(x + ovLE(c))] : []), vT = (c, x) => [f1(x)].concat(ovTE(c) > 0 ? [f1(x + ovTE(c))] : []);
  // Ruderstege zusätzlich ab Endleiste; kind 'all' = Kopf für die kopierte Gesamtliste
  const HEAD = kind => [T('ab Steganfang (mm)'), T('ab Wurzel (mm)')].concat(hN('ab Nase (mm)'), kind === 'holm' ? [] : hT('ab Endleiste (mm)'), [T('Profilhöhe (mm)'), T('Abzug (mm)'), T('Steghöhe (mm)')]);
  function rowVals(G, c, d, r, all) {
    const f = frame(G, r.z), xn = r.x - f.le;
    const te = d.kind === 'holm' ? (all ? vT(c, 0).map(() => '') : []) : vT(c, f.c - xn);
    return [f1(r.s), f1(r.z)].concat(vN(c, xn), te, [r.H == null ? '' : f1(r.H), f1(r.ded), r.h == null ? '' : f1(r.h)]);
  }
  const ovText = c => (ovLE(c) > 0 || ovTE(c) > 0) ? T('Schalenüberstand') + ': ' + T('Nase') + ' ' + f1(ovLE(c)) + ' mm, ' + T('Endleiste') + ' ' + f1(ovTE(c)) + ' mm' : '';
  // Scharnierlinie als eigener Block: alle „Höhe alle … mm“ ab Wurzel + jeder Segmentstoß + außen (hp = Rudertiefe in % von hinten)
  const HINGEHEAD = () => [T('ab Wurzel (mm)'), T('Profiltiefe (mm)')].concat(hN('Scharnier ab Nase (mm)'), hT('Scharnier ab Endleiste (mm)'));
  function hingeRows(G, c) {
    const step = Math.max(1, +c.step || 50), M = [];
    for (let z = 0; z < G.L - 0.5; z += step) M.push({ z, note: z === 0 ? 'Wurzel' : '' });
    jointsIn(G, 0, G.L).forEach(q => { const n = T('Segmentstoß') + ' ' + (q.k + 1) + '|' + (q.k + 2), h = M.find(m => Math.abs(m.z - q.z) < 0.5); if (h) { h.z = q.z; h.note = n; } else M.push({ z: q.z, note: n }); });
    M.push({ z: G.L, note: 'außen' });
    M.sort((a, b) => a.z - b.z);
    return rootRows(G, c, M, z => { const f = frame(G, z); return f.le + f.c * (1 - f.hp / 100); }).map(m => { const f = frame(G, m.z), hb = f.c * f.hp / 100; return { note: m.note, v: [f1(m.z), f1(f.c)].concat(vN(c, f.c - hb), vT(c, hb)) }; });
  }
  // Stützstoff an der Endleiste: gleiche Stellen wie die Scharnierliste, Maße ab Endleiste (Original + Überstand)
  const TEHEAD = () => { const c = cfg(); return [T('ab Wurzel (mm)')].concat(layI(c) > 0 ? hT('Schalen berühren sich, Schleifen ab Endleiste (mm)') : [], hT('Stützstoff trifft aufeinander ab Endleiste (mm)'), hT('Stützstoff ganz weg ab Endleiste (mm)')); };
  function teRows(G, c) {
    if (!c.layOn || layS(c) <= 0) return [];
    const step = Math.max(1, +c.step || 50), M = [];
    for (let z = 0; z < G.L - 0.5; z += step) M.push({ z, note: z === 0 ? 'Wurzel' : '' });
    jointsIn(G, 0, G.L).forEach(q => { const n = T('Segmentstoß') + ' ' + (q.k + 1) + '|' + (q.k + 2), h = M.find(m => Math.abs(m.z - q.z) < 0.5); if (h) { h.z = q.z; h.note = n; } else M.push({ z: q.z, note: n }); });
    M.push({ z: G.L, note: 'außen' });
    M.sort((a, b) => a.z - b.z);
    const col = d => d == null ? vT(c, 0).map(() => '') : vT(c, d);
    return rootRows(G, c, M, z => { const f = frame(G, z); return f.le + f.c; }).map(m => { const L = teLayers(G, c, m.z); return { note: m.note, v: [f1(m.z)].concat(layI(c) > 0 ? col(L.start) : [], col(L.meet), col(L.gone)) }; });
  }
  // Holmgurt-Liste, unabhängig von den Stegen: alle „Höhe alle … mm“ ab Wurzel + jeder Segmentstoß + außen
  const CAPHEAD = () => [T('ab Wurzel (mm)')].concat(hN('Gurt von Nase (mm)'), hN('Gurtmitte ab Nase (mm)'), hN('Gurt bis Nase (mm)'), [T('Gurtbreite (mm)'), T('Gurtdicke je Seite (mm)')]);
  function capRows(G, c) {
    if (!c.holm || !c.holm.length) return [];
    const step = Math.max(1, +c.step || 50), M = [];
    for (let z = 0; z < G.L - 0.5; z += step) M.push({ z, note: z === 0 ? 'Wurzel' : '' });
    jointsIn(G, 0, G.L).forEach(q => { const n = T('Segmentstoß') + ' ' + (q.k + 1) + '|' + (q.k + 2), h = M.find(m => Math.abs(m.z - q.z) < 0.5); if (h) { h.z = q.z; h.note = n; } else M.push({ z: q.z, note: n }); });
    M.push({ z: G.L, note: 'außen' });
    // Segmentgruppen: an jeder Gruppengrenze zusätzlich der Anfangswert der nächsten Gruppe (Lage darf springen)
    if (!c.capOrtho && capLay(c, G) === 'grp') capGroups(G, c).slice(1).forEach((g, i) => M.push({ z: g.z0, e: 1e-6, note: T('Gruppe') + ' ' + (i + 2) + ' ' + T('innen') }));
    M.sort((a, b) => a.z - b.z || (a.e || 0) - (b.e || 0));
    return rootRows(G, c, M, z => capCenter(G, c, z)).map(m => {
      const zz = m.z + (m.e || 0), le = frame(G, zz).le, mid = capCenter(G, c, zz) - le, w = capAt(G, c, 'capW', m.z);
      return { note: m.note, v: [f1(m.z)].concat(vN(c, mid - w / 2), vN(c, mid), vN(c, mid + w / 2), [f1(w), f1(capAt(G, c, 'capT', m.z))]) };
    });
  }
  // Druckvorschau: Liste als A4-Dokument, Drucken über den Systemdialog (dort „Als PDF speichern“/„Microsoft Print to PDF“)
  function printHtml() {
    const G = geo(); if (!G) return null;
    const cc = cfg(), D = allStege(G, cc); if (!D.length) return null;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, q => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[q]));
    const title = (state.projectName || T('Projekt')) + ' – ' + T('Steghöhen');
    const css = 'body{font:10pt/1.35 "Segoe UI",Arial,sans-serif;color:#111;margin:0;background:#fff}.doc{padding:10mm}h1{font-size:16pt;margin:0 0 1mm}.meta{color:#555;font-size:9pt;margin-bottom:4mm}'
      + 'h2{font-size:11pt;margin:5mm 0 1mm;page-break-after:avoid}.sub{font-size:9pt;color:#444;margin-bottom:1mm}table{border-collapse:collapse;font-size:8.5pt;width:100%}tr{page-break-inside:avoid}'
      + 'th,td{border:1px solid #bbb;padding:.6mm 1.5mm;text-align:right}th{background:#eee;font-weight:600}td.n{text-align:left}td.h{font-weight:700}tr.j td{background:#f2f2f2}'
      + '@media print{.doc{padding:0}@page{size:A4;margin:12mm}}';
    const CR = capRows(G, cc), capHtml = CR.length ? '<h2 style="color:#a0208a">' + esc(T('Holmgurt')) + '</h2><div class="sub">' + esc(T('Gurt von/bis: Vorder- und Hinterkante des Holmgurts in Profilrichtung ab Nase')) + '</div><table><thead><tr>' + CAPHEAD().map(h => '<th>' + esc(h) + '</th>').join('') + '<th>' + esc(T('Stelle')) + '</th></tr></thead><tbody>'
      + CR.map(r => '<tr' + (/\|/.test(r.note) ? ' class="j"' : '') + '>' + r.v.map(x => '<td>' + x + '</td>').join('') + '<td class="n">' + esc(r.note ? T(r.note) : '') + '</td></tr>').join('') + '</tbody></table>' : '';
    const HR = hingeRows(G, cc), hingeHtml = '<h2 style="color:#1a8a4a">' + esc(T('Scharnierlinie')) + '</h2><div class="sub">' + esc(T('Lage der Scharnierlinie in Profilrichtung')) + '</div><table><thead><tr>' + HINGEHEAD().map(h => '<th>' + esc(h) + '</th>').join('') + '<th>' + esc(T('Stelle')) + '</th></tr></thead><tbody>'
      + HR.map(r => '<tr' + (/\|/.test(r.note) ? ' class="j"' : '') + '>' + r.v.map(x => '<td>' + x + '</td>').join('') + '<td class="n">' + esc(r.note ? T(r.note) : '') + '</td></tr>').join('') + '</tbody></table>';
    const ER = teRows(G, cc), teHtml = ER.length ? '<h2 style="color:#b05a00">' + esc(T('Stützstoff an der Endleiste')) + '</h2><div class="sub">' + esc(T('Ab hier muss der Stützstoff zur Endleiste hin weggeschliffen werden, damit Ober- und Unterschale zusammenpassen.')) + '</div><table><thead><tr>' + TEHEAD().map(h => '<th>' + esc(h) + '</th>').join('') + '<th>' + esc(T('Stelle')) + '</th></tr></thead><tbody>'
      + ER.map(r => '<tr' + (/\|/.test(r.note) ? ' class="j"' : '') + '>' + r.v.map(x => '<td>' + (x === '' ? '—' : x) + '</td>').join('') + '<td class="n">' + esc(r.note ? T(r.note) : '') + '</td></tr>').join('') + '</tbody></table>' : '';
    const body = capHtml + hingeHtml + teHtml + D.map(d => '<h2>' + esc(d.st.name) + '</h2><div class="sub">' + esc(T('Länge')) + ' ' + f1(d.len) + ' mm · ' + esc(T('Stegbreite')) + ' ' + f1(webOf(d.st, d.kind)) + ' mm</div>'
      + '<table><thead><tr>' + HEAD(d.kind).map(h => '<th>' + esc(h) + '</th>').join('') + '<th>' + esc(T('Stelle')) + '</th></tr></thead><tbody>'
      + d.rows.map(r => { const v = rowVals(G, cc, d, r); return '<tr' + (/\|/.test(r.note) ? ' class="j"' : '') + '>' + v.map((x, i) => '<td' + (i === v.length - 1 ? ' class="h"' : '') + '>' + (x === '' ? '—' : x) + '</td>').join('') + '<td class="n">' + esc(r.note ? T(r.note) : '') + '</td></tr>'; }).join('')
      + '</tbody></table>').join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + css + '</style></head><body><div class="doc"><h1>' + esc(T('Steghöhen')) + '</h1><div class="meta">' + [state.projectName ? esc(state.projectName) : '', new Date().toLocaleDateString(), esc(ovText(cc))].filter(Boolean).join(' · ') + '</div>' + body + '</div></body></html>';
  }
  function printPreview() {
    const html = printHtml();
    if (!html) { App.toast && App.toast(T('Keine Stege mit Höhe vorhanden.')); return; }
    const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);display:flex;flex-direction:column;align-items:center;padding:16px';
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;color:#fff';
    const lb = document.createElement('b'); lb.textContent = T('Druckvorschau'); bar.appendChild(lb);
    const fr = document.createElement('iframe'); fr.style.cssText = 'flex:1;width:min(230mm,100%);border:0;background:#fff;box-shadow:0 2px 12px #000';
    const bp = document.createElement('button'); bp.className = 'primary'; bp.textContent = T('Drucken / als PDF…'); bp.title = T('Systemdruckdialog öffnen; als Drucker „Als PDF speichern“ oder „Microsoft Print to PDF“ wählen');
    bp.onclick = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { alert(e.message); } };
    const bc = document.createElement('button'); bc.textContent = T('Schließen');
    const onKey = e => { if (e.key === 'Escape') close(); };
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    bc.onclick = close; document.addEventListener('keydown', onKey);
    bar.appendChild(bp); bar.appendChild(bc); ov.appendChild(bar); ov.appendChild(fr); document.body.appendChild(ov);
    const dd = fr.contentWindow.document; dd.open(); dd.write(html); dd.close();
  }
  function copyList() {
    const G = geo(); if (!G) return;
    const cc = cfg(), out = [[T('Steg')].concat(HEAD('all'), [T('Stelle')]).join('\t')];
    allStege(G, cc).forEach(d => d.rows.forEach(r => out.push([d.st.name].concat(rowVals(G, cc, d, r, true), [r.note ? T(r.note) : '']).join('\t'))));
    const CR = capRows(G, cc);
    if (CR.length) { out.push('', [T('Holmgurt')].concat(CAPHEAD(), [T('Stelle')]).join('\t')); CR.forEach(r => out.push([T('Holmgurt')].concat(r.v, [r.note ? T(r.note) : '']).join('\t'))); }
    const ER = teRows(G, cc);
    if (ER.length) { out.push('', [T('Stützstoff an der Endleiste')].concat(TEHEAD(), [T('Stelle')]).join('\t')); ER.forEach(r => out.push([T('Stützstoff an der Endleiste')].concat(r.v, [r.note ? T(r.note) : '']).join('\t'))); }
    out.push('', [T('Scharnierlinie')].concat(HINGEHEAD(), [T('Stelle')]).join('\t')); hingeRows(G, cc).forEach(r => out.push([T('Scharnierlinie')].concat(r.v, [r.note ? T(r.note) : '']).join('\t')));
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
    const CR = capRows(G, cc), capHtml = CR.length ? '<div style="margin:6px 0 2px;font-weight:700;color:#ff6ae6">' + esc(T('Holmgurt')) + ' — ' + esc(T('Lage in Profilrichtung ab Nase')) + '</div><table style="border-collapse:collapse"><tr><th style="' + th + '">' + CAPHEAD().map(esc).join('</th><th style="' + th + '">') + '</th><th style="' + th + ';text-align:left"></th></tr>'
      + CR.map(r => '<tr' + (/\|/.test(r.note) ? ' style="background:rgba(255,255,255,.06)"' : '') + '>' + r.v.map((x, i) => '<td style="' + td + (i >= 1 && i < r.v.length - 2 ? ';color:#ff6ae6' : '') + '">' + x + '</td>').join('') + '<td style="' + td + ';text-align:left">' + esc(r.note ? T(r.note) : '') + '</td></tr>').join('') + '</table>' : '';
    const HR = hingeRows(G, cc), hingeHtml = '<div style="margin:6px 0 2px;font-weight:700;color:#7ee0a0">' + esc(T('Scharnierlinie')) + ' — ' + esc(T('Lage der Scharnierlinie in Profilrichtung')) + '</div><table style="border-collapse:collapse"><tr><th style="' + th + '">' + HINGEHEAD().map(esc).join('</th><th style="' + th + '">') + '</th><th style="' + th + ';text-align:left"></th></tr>'
      + HR.map(r => '<tr' + (/\|/.test(r.note) ? ' style="background:rgba(255,255,255,.06)"' : '') + '>' + r.v.map((x, i) => '<td style="' + td + (i >= 2 ? ';color:#7ee0a0' : '') + '">' + x + '</td>').join('') + '<td style="' + td + ';text-align:left">' + esc(r.note ? T(r.note) : '') + '</td></tr>').join('') + '</table>';
    const ovNote = ovText(cc) ? '<div style="color:#9aa4ad;margin:4px 0">' + esc(ovText(cc)) + ' — ' + esc(T('Spalten „+ Überstand“ = Maß ab Schalenkante')) + '</div>' : '';
    const ER = teRows(G, cc), teHtml = ER.length ? '<div style="margin:6px 0 2px;font-weight:700;color:#ffa040">' + esc(T('Stützstoff an der Endleiste')) + ' — ' + esc(T('ab hier wegschleifen, damit die Schalen zusammenpassen')) + '</div><table style="border-collapse:collapse"><tr><th style="' + th + '">' + TEHEAD().map(esc).join('</th><th style="' + th + '">') + '</th><th style="' + th + ';text-align:left"></th></tr>'
      + ER.map(r => '<tr' + (/\|/.test(r.note) ? ' style="background:rgba(255,255,255,.06)"' : '') + '>' + r.v.map((x, i) => '<td style="' + td + (i ? ';color:#ffa040' : '') + '">' + (x === '' ? '—' : x) + '</td>').join('') + '<td style="' + td + ';text-align:left">' + esc(r.note ? T(r.note) : '') + '</td></tr>').join('') + '</table>' : '';
    tbl.innerHTML = ovNote + capHtml + hingeHtml + teHtml + D.map(d => {
      const bad = d.rows.some(r => r.h == null || r.h <= 0);
      const off = d.kind === 'holm' && d.rows.some(r => Math.abs(capCenter(G, cc, r.z) - r.x) + webOf(d.st, d.kind) / 2 > capAt(G, cc, 'capW', r.z) / 2 + 1e-6);
      return '<div style="margin:6px 0 2px;font-weight:700;color:' + COL[d.kind] + '">' + esc(d.st.name) + ' — ' + esc(T('Länge')) + ' ' + f1(d.len) + ' mm · ' + esc(T('Stegbreite')) + ' ' + f1(webOf(d.st, d.kind)) + ' mm</div>'
        + (d.auto && (d.auto.s > 0 || d.auto.fail) ? '<div style="color:' + (d.auto.fail ? '#ffb454' : '#7ee0a0') + '">' + esc(d.auto.fail ? T('Automatik: bis zur Nase kein ausreichender Abstand zur Dichtlippe.') : T('Automatisch nach vorne versetzt um') + ' ' + f1(d.auto.s) + ' mm') + '</div>' : '')
        + (d.cut ? '<div style="color:#ffb454">' + esc(d.len > 0 ? T('Gurt zu schmal: endet bei') + ' ' + f1(d.b) + ' mm ' + T('ab Wurzel') : T('Passt nirgends auf den Gurt.')) + '</div>' : '')
        + (d.stkCut ? '<div style="color:#7ee0a0">' + esc(d.len > 0 ? T('Von der Steckung gekürzt: beginnt bei') + ' ' + f1(d.a) + ' mm ' + T('ab Wurzel') : T('Liegt ganz im Bereich der Steckung und entfällt.')) + '</div>' : '')
        + (off ? '<div style="color:#ffb454">' + esc(T('Der Steg steht stellenweise nicht ganz auf dem Gurt.')) + '</div>' : '')
        + (bad ? '<div style="color:#ffb454">' + esc(T('Stellenweise außerhalb des Profils oder ohne Resthöhe.')) + '</div>' : '')
        + '<table style="border-collapse:collapse"><tr><th style="' + th + '">' + HEAD(d.kind).map(esc).join('</th><th style="' + th + '">') + '</th><th style="' + th + ';text-align:left"></th></tr>'
        + d.rows.map(r => {
          const j = /\|/.test(r.note), v = rowVals(G, cc, d, r);
          return '<tr' + (j ? ' style="background:rgba(255,255,255,.06)"' : '') + '>' + v.map((x, i) => '<td style="' + td + (i === v.length - 1 ? ';font-weight:700' + (r.h == null || r.h <= 0 ? ';color:#ffb454' : '') : '') + '">' + (x === '' ? '—' : x) + '</td>').join('') + '<td style="' + td + ';text-align:left">' + esc(r.note ? T(r.note) : '') + '</td></tr>';
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
      const cc = cfg();
      stkAll(G, cc).forEach(S => {
        if (S.split != null) {
          const fr = frame(G, S.zt), xs = fr ? [fr.le, fr.le + fr.c] : [];
          if (xs.length) { cx.setLineDash([6, 3]); cx.strokeStyle = '#ff6a6a'; cx.lineWidth = 1.6; line([[S.zt, -xs[0] + 6], [S.zt, -xs[xs.length - 1] - 6]]); cx.stroke(); cx.setLineDash([]); cx.fillStyle = '#ff6a6a'; cx.fillText(T('Teilung') + ' ' + (S.split + 1), X(S.zt) + 3, Y(-xs[0] + 6) - 4); }
        }
        if (!(S.len > S.z0 && S.oW > 0)) return;
        const Z = [S.z0, S.len].concat(G.segs.slice(0, -1).map(q => q.z1).filter(z => z > S.z0 && z < S.len)).sort((p, q) => p - q);
        line(Z.map(z => [z, -(S.cx(z) - S.oW / 2)]).concat(Z.slice().reverse().map(z => [z, -(S.cx(z) + S.oW / 2)])), true);
        cx.fillStyle = 'rgba(255,240,106,.28)'; cx.fill(); cx.strokeStyle = '#fff06a'; cx.lineWidth = 1.3; cx.stroke();
        if (S.split == null) { cx.fillStyle = '#fff06a'; cx.fillText(T('Steckung'), X(S.len) + 4, Y(-S.cx(S.len)) + 4); }
      });
    }
    if (App.StegRippen) App.StegRippen.drawPlan(cx, X, Y, G, view.s, hits);
    // Wurzelrippe: bei Schräge der Keil davor abgedunkelt (gehört nicht zum Werkstück); Klick wählt die Wurzelrippe
    {
      const cc = cfg(), RP = rootPlane(G, cc), E = rootEnds(G, cc), rs = secOpen() && secRoot;
      if (RP) {
        const J = G.segs.slice(0, -1).map(q => q.z1), le = z => frame(G, z).le, te = z => { const f = frame(G, z); return f.le + f.c; };
        const W = [[0, -le(0)]];
        J.filter(z => z < E.zL).forEach(z => W.push([z, -le(z)]));
        W.push([E.zL, -E.xL], [E.zT, -E.xT]);
        J.filter(z => z < E.zT).reverse().forEach(z => W.push([z, -te(z)]));
        W.push([0, -te(0)]);
        line(W, true); cx.fillStyle = 'rgba(16,20,26,.82)'; cx.fill();
        cx.save(); line(W, true); cx.clip(); cx.strokeStyle = 'rgba(200,210,224,.22)'; cx.lineWidth = 1; cx.beginPath();
        for (let k = -h; k < w + h; k += 7) { cx.moveTo(k, 0); cx.lineTo(k + h, h); }
        cx.stroke(); cx.restore();
      }
      if (RP || rs) {
        line([[E.zL, -E.xL], [E.zT, -E.xT]]); cx.strokeStyle = rs ? '#ff5c8a' : '#e0b97a'; cx.lineWidth = rs ? 3 : 2.5; cx.stroke();
        const tx = T('Wurzelrippe') + (RP ? ' ' + (Math.abs(RP.a) > 0.01 ? f1(RP.a) + '°' : f1(RP.zL) + ' mm') : '');
        cx.fillStyle = rs ? '#ff5c8a' : '#e0b97a'; cx.fillText(tx, X(Math.max(E.zL, E.zT)) + 6, Y(-(E.xL + E.xT) / 2) + 4);
      }
      for (let k = 0; k <= 20; k++) hits.push([X(E.zL + (E.zT - E.zL) * k / 20), Y(-(E.xL + (E.xT - E.xL) * k / 20)), { root: true }, 2]);
    }
    // Segmentstöße (durch Draufsicht und Stege)
    const yBottom = yc + gap;
    cx.setLineDash([5, 4]); cx.strokeStyle = 'rgba(200,210,224,.35)'; cx.lineWidth = 1;
    G.segs.slice(0, -1).forEach(q => { line([[q.z1, -xmin + gap * 0.2], [q.z1, yBottom]]); cx.stroke(); });
    cx.setLineDash([]);
    // Stelle des Schnitts aus dem Fenster „Schnitte in Spannweite“
    if (secOpen() && !secRoot) {
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
  let secPane = null, scv = null, sTop = null, sv = { s: 1, ox: 0, oy: 0 }, sFit = true, sDrag = null, secZ = 0, secAll = false, secDelta = 0, secRoot = false;
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
    const leaveRoot = () => { if (secRoot) { secRoot = false; sFit = true; if (rl) rl.remove(); } };
    rg.oninput = () => { leaveRoot(); secZ = +rg.value; num.value = f1(secZ); draw(); drawSec(); };
    num.onchange = () => { const v = parseFloat(num.value.replace(',', '.')); if (isNaN(v)) return; leaveRoot(); secZ = clamp(v, 0, G.L); num.value = f1(secZ); rg.value = secZ; draw(); drawSec(); };
    const js = document.createElement('select');
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; js.appendChild(o); };
    add('', T('Stelle wählen…')); add('0', T('Wurzel'));
    if (App.StegWurzel) add('root', T('Wurzelrippe (wahre Form, für CAD)'));
    G.segs.slice(0, -1).forEach(q => add(q.z1, T('Segmentstoß') + ' ' + (q.k + 1) + '|' + (q.k + 2)));
    add(G.L, T('Außenende'));
    js.onchange = () => {
      if (js.value === '') return;
      if (js.value === 'root') { js.value = ''; showRoot(); return; }
      secZ = +js.value; js.value = ''; secAll = false; if (secRoot) { secRoot = false; sFit = true; } secBar(); draw(); drawSec();
    };
    const all = document.createElement('label'); all.style.cssText = 'display:flex;gap:4px;align-items:center';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = secAll; cb.onchange = () => { leaveRoot(); secAll = cb.checked; sFit = true; draw(); drawSec(); };
    all.append(cb, lab('alle Segmentstöße untereinander'));
    const rl = secRoot ? lab('Ansicht: Wurzelrippe') : null;
    if (rl) rl.style.cssText = 'color:#ff5c8a;font-weight:600';
    sTop.append(lab('mm ab Wurzel'), num, rg, js, all);
    if (rl) sTop.append(rl);
    // Ruderausschlag und Dichtlippe
    const c = cfg(), brk = document.createElement('div'); brk.style.cssText = 'flex-basis:100%;height:0'; sTop.appendChild(brk);
    const dn = document.createElement('input'); dn.type = 'text'; dn.inputMode = 'decimal'; dn.style.width = '50px'; dn.value = secDelta;
    const dr = document.createElement('input'); dr.type = 'range'; dr.min = -45; dr.max = 45; dr.step = 0.5; dr.value = secDelta; dr.style.cssText = 'flex:1;min-width:120px';
    dr.oninput = () => { secDelta = +dr.value; dn.value = secDelta; drawSec(); };
    dn.onchange = () => { const v = parseFloat(dn.value.replace(',', '.')); if (isNaN(v)) return; secDelta = clamp(v, -45, 45); dn.value = secDelta; dr.value = secDelta; drawSec(); };
    const z0 = document.createElement('button'); z0.textContent = '0°'; z0.style.padding = '2px 7px'; z0.onclick = () => { secDelta = 0; dn.value = 0; dr.value = 0; drawSec(); };
    sTop.append(lab('Ruderausschlag (°, + = nach unten)'), dn, dr, z0);
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
  // Radius der Dichtlippe: innen/außen über die Spannweite; ist ein Rudersteg (Scharnierlinie) in Segmentgruppen
  // geteilt, gilt je Gruppe ein eigener Radius innen/außen (c.lipRGrp[i] = { r0, r1 }).
  function lipGrpSteg(G, c) { return G.segs.length > 1 ? (c.ruder || []).find(st => st.unit === 'hinge' && hingeLay(G, st) === 'grp') || null : null; }
  function lipRGroups(G, c) {
    const st = lipGrpSteg(G, c); if (!st) return null;
    const a0 = clamp(Math.min(+st.from || 0, +st.to || 0), 0, G.L), b0 = clamp(Math.max(+st.from || 0, +st.to || 0), 0, G.L), GR = hGroups(G, st, a0, b0);
    if (!Array.isArray(c.lipRGrp)) c.lipRGrp = [];
    GR.forEach((g, i) => { if (!c.lipRGrp[i]) c.lipRGrp[i] = { r0: lipR0(c), r1: lipR1(c) }; });
    if (c.lipRGrp.length > GR.length) c.lipRGrp.length = GR.length;
    return GR;
  }
  const lipR0 = c => Math.max(0, +(c.lipR0 != null ? c.lipR0 : c.lipR) || 0), lipR1 = c => Math.max(0, +(c.lipR1 != null ? c.lipR1 : lipR0(c)) || 0);
  function lipRadAt(G, c, z) {
    const lerp = (r0, r1, z0, z1) => Math.max(0, (+r0 || 0) + ((+r1 || 0) - (+r0 || 0)) * (z1 > z0 ? clamp((z - z0) / (z1 - z0), 0, 1) : 0));
    const GR = lipRGroups(G, c);
    if (GR) {
      let i = GR.findIndex(g => z <= g.z1 + 1e-6); if (i < 0) i = GR.length - 1;
      const g = GR[i], r = c.lipRGrp[i]; return lerp(r.r0, r.r1, g.z0, g.z1);
    }
    return lerp(lipR0(c), lipR1(c), 0, G.L);
  }
  function ruderAt(G, c, z, D) {
    const f = frame(G, z), xh = f.le + f.c * (1 - f.hp / 100), sec = section(G, xh, z); if (!sec) return null;
    const hs = locate(G, z).s.sg.hingeSide === 'bottom' ? 'bot' : 'top', H = [xh, hs === 'top' ? sec.top : sec.bot];
    const rotBy = deg => { const a = -deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); return p => [H[0] + (p[0] - H[0]) * ca - (p[1] - H[1]) * sa, H[1] + (p[0] - H[0]) * sa + (p[1] - H[1]) * ca]; };
    const opp = hs === 'top' ? 'bot' : 'top', R = { xh, xs: xh + (c.lipOn ? +c.lipSlot || 0 : 0), H, hs, rotBy, lip: null, side: opp, gap: Math.max(0, +c.lipGap || 0) };
    if (!c.lipOn) return R;
    const side = c.lipSide === 'top' || c.lipSide === 'bot' ? c.lipSide : opp, t = Math.max(0, +c.lipT || 0), onRuder = c.lipFix !== 'wing';
    const len = Math.max(0, +c.lipLen || 0), root = onRuder ? R.xs + R.gap : R.xs, tip = onRuder ? root - len : root + len, sh = shellOf(c), rad = lipRadAt(G, c, z), lip = [];
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
    // Wurzelrippe als wahre Form in ihrer (ggf. schrägen) Ebene, wie sie ins CAD geht
    if (secRoot && App.StegWurzel) {
      const R = App.StegWurzel.data(G, cfg());
      if (R) {
        if (sFit) {
          const m = 40, xr = Math.max(1, R.ulen), hh = Math.max(1, R.ymax - R.ymin), sc = Math.max(1e-4, Math.min((w - 2 * m) / xr, (h - 2 * m - 60) / hh));
          sv.s = sc; sv.ox = (w - xr * sc) / 2; sv.oy = (h - 60) / 2 + (R.ymax + R.ymin) / 2 * sc; sFit = false;
        }
        g.font = '12px sans-serif';
        App.StegWurzel.draw(g, u => sv.ox + u * sv.s, v => sv.oy - v * sv.s, R, sv.s);
        return;
      }
    }
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
      // Stützstoff an der Endleiste: Schleifbereich rot, Linien an Beginn / Treffpunkt / Stützstoff ganz weg
      {
        const L = teLayers(G, cfg(), q.z);
        if (L && L.start != null) {
          const u0 = q.xr - L.start, band = [], lo = [];
          for (let i = 0; i <= 40; i++) { const u = u0 + (q.xr - u0) * i / 40, sc = section(G, q.le + Math.min(u, q.xr - 1e-3), q.z); if (sc) { band.push([u, sc.top]); lo.push([u, sc.bot]); } }
          if (band.length > 1) {
            g.beginPath(); band.concat(lo.reverse()).forEach((p, i) => { const a = X(p[0]), b = Y(p[1] + q.dy); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath();
            g.fillStyle = 'rgba(255,90,60,.35)'; g.fill();
          }
          g.save(); g.setLineDash([4, 3]); g.lineWidth = 1; g.font = '10px sans-serif';
          [[L.start, '#ff6040', T('Schleifen ab')], [L.meet, '#ffa040', T('Stützstoff trifft')], [L.gone, '#ffd060', T('Stützstoff weg')]].forEach(([d, col, lab], k) => {
            if (d == null || (k === 1 && Math.abs(d - L.start) < 1e-3 && layI(cfg()) <= 0)) return;
            const u = q.xr - d, sc = section(G, q.le + u, q.z); if (!sc) return;
            // Linie durchs Profil, Beschriftung gestaffelt über der Endleiste (unten stehen die Steg-Namen)
            const s0 = section(G, q.le + u0, q.z), yb = Y((s0 ? s0.top : sc.top) + q.dy) - 8 - 12 * (2 - k);
            g.strokeStyle = col; g.beginPath(); g.moveTo(X(u), yb + 3); g.lineTo(X(u), Y(sc.bot + q.dy) + 3); g.stroke();
            g.fillStyle = col; g.textAlign = 'right'; g.fillText(lab + ' ' + f1(d) + ' mm ' + T('v. EL'), X(u) - 3, yb);
          });
          g.restore(); g.textAlign = 'left';
        }
      }
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
        const cc = cfg();
        for (const S of stkAll(G, cc)) if (S.cy != null && q.z >= S.z0 - 1e-6 && q.z <= S.len + 1e-6 && S.oH > 0) {
          const u = X(S.cx(q.z) - q.le), v = Y(S.cy + q.z * S.tan + q.dy), k = PX, shape = (w, h) => { g.beginPath(); if (S.round) g.arc(u, v, Math.max(0, w) / 2 * k, 0, 7); else g.rect(u - w / 2 * k, v - h / 2 * k, w * k, h * k); };
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
      // Bemaßung: Abstand der Ruderstege (Mitte) zur Scharnierlinie, oberhalb des Profils
      if (RU && RU.xh != null) {
        let m = 0; const xh = X(RU.xh - q.le), yTop = Y(q.hi + q.dy);
        D.forEach(d => {
          if (d.kind !== 'ruder' || q.z < d.a - 1e-6 || q.z > d.b + 1e-6) return;
          const a = d.at(q.z, 0); if (a.H == null || a.x == null) return;
          const hw = webOf(d.st, d.kind) / 2, xf = a.x < RU.xh ? a.x + hw : a.x - hw;   // dem Scharnier zugewandte Stegseite
          const xw = X(xf - q.le), y = yTop - 22 - 16 * m++, dist = Math.abs(RU.xh - xf), col = COL.ruder;
          g.save(); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
          g.setLineDash([2, 3]); g.beginPath(); g.moveTo(xw, yTop); g.lineTo(xw, y - 4); g.moveTo(xh, yTop); g.lineTo(xh, y - 4); g.stroke(); g.setLineDash([]);
          g.beginPath(); g.moveTo(xw, y); g.lineTo(xh, y); g.stroke();
          const s = xh > xw ? 1 : -1, arr = (x, dr) => { g.beginPath(); g.moveTo(x, y); g.lineTo(x + dr * 6, y - 3); g.lineTo(x + dr * 6, y + 3); g.closePath(); g.fill(); };
          if (Math.abs(xh - xw) > 14) { arr(xw, s); arr(xh, -s); }
          const tx = f1(dist) + ' mm', tw = g.measureText(tx).width;
          g.fillText(tx, Math.abs(xh - xw) > tw + 6 ? (xw + xh) / 2 - tw / 2 : Math.max(xw, xh) + 4, y - 3);
          g.restore();
        });
      }
      if (App.StegRippen) App.StegRippen.drawSec(g, G, q, X, Y);   // Stützrippe an dieser Stelle
  }
  // Schnitt an die Stelle z (z. B. gewählte Stützrippe)
  function showSecAt(z) {
    if (!isOpen()) return;
    const G = geo(); secZ = G ? clamp(z, 0, G.L) : z; secAll = false; if (secRoot) { secRoot = false; sFit = true; }
    if (bottom !== 'sec') setBottom('sec'); else { secBar(); draw(); drawSec(); }
  }
  // Schnitt in der Ebene der Wurzelrippe zeigen
  function showRoot() {
    if (!isOpen()) return;
    secRoot = true; secAll = false; sFit = true;
    if (bottom !== 'sec') setBottom('sec'); else { secBar(); draw(); drawSec(); }
  }
  // Teil im Menü wählen (Klick in der 3D-Ansicht): Steg, Gurt, Steckung
  function focus(what, st) {
    if (what === 'steg' && st) sel = st;
    refresh(true);
    openGrp(side.querySelector('.grp[data-part="' + what + '"]'));
    const el = what === 'steg' ? side.querySelector('[data-selsteg]') : side.querySelector('.grp[data-part="' + what + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function update() { stkResult(); buildTable(); draw(); drawSec(); if (App.StegRippen) App.StegRippen.refresh3d(); }
  function refresh(rebuild) {
    if (!isOpen()) return;
    if (rebuild) buildSide();
    if (rebuild && secOpen()) secBar();
    update();
  }

  // ---------- Seitenleiste ----------
  function stegHSidebar(side0) {
    side = document.createElement('div'); side.dataset.tabs = 'stegh';
    side0.appendChild(side);
    if (isOpen()) refresh(true);   // Tragfläche/Geometrie gewechselt
  }

  App.stegHSidebar = stegHSidebar;
  App.StegApi = { stkAll, showSecAt, showRoot, focus, getSel: () => sel, capFace, cfg, geo, frame, section, capCenter, stkCenter, capAt, insetOf, shellOf, layA, layS, layI, webOf, allStege, stkData, ruderAt, secOne, profOf, rootPlane, rootZLine, rootEnds, COL, f1, fl1, clamp };
  window.StegHoehen = { show, refresh, _test: { stkAll, stkData, autoShift, ruderAt, distX, distFits, fillCapJoints, capAt, capCenter, webOf, setBottom, fillJoints, geo, section, stegData, allStege, dxfText, cfg, rootPlane, rootZLine, rootEnds, capRows, hingeRows, teRows, showRoot } };
})();
