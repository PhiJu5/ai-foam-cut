/* stuetzrippen.js — Stützrippen und 3D-Ansicht im Reiter „Steghöhen“ (Feature steghoehe)
 *
 * Daten in cfg.stegH.rip (je Tragfläche, wie alles in cfg.stegH). Rippen stehen parallel zur Wurzelrippe
 * (Ebene z = konst.), Kontur = Profil innen (Schale bzw. Gurt-Innenfläche + Spiel). Stege schneiden die Rippe
 * je nach Wahl (global je Steg, einzeln je Rippe überschreibbar):
 *   through = nicht geschnitten, both = geteilt (geht vor und hinter dem Steg weiter),
 *   front = endet am Steg (nur davor), back = beginnt am Steg (nur dahinter).
 * Löcher (z. B. Servokabel): für alle Rippen und je Rippe, Lage in % der Sehne ab Nase + mm ab Höhenmitte.
 * 3D-Fenster: Schale/Lagen, Gurt, Stege, Rippen, Steckung + Hülse, alles einzeln ein-/ausblendbar.
 * Wird nur geschützt aus stegh.js gerufen (App.StegRippen && …).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const RIB_COL = '#e0b97a';
  const CUTS = [['both', 'geschnitten, geht vor und hinter dem Steg weiter'], ['front', 'endet am Steg (nur davor)'], ['back', 'beginnt am Steg (nur dahinter)'], ['through', 'nicht geschnitten']];

  let selRib = 0;
  const A = () => App.StegApi;

  function rcfg(c) {
    let r = c.rip;
    if (!r || typeof r !== 'object') r = c.rip = { on: false, t: 3, gap: 0, webGap: 0, mode: 'span', n: 5, ends: true, nSeg: 2, joints: true, list: [], cut: {}, holes: [], stkHole: true };
    if (!Array.isArray(r.list)) r.list = [];
    if (!Array.isArray(r.holes)) r.holes = [];
    if (!r.cut || typeof r.cut !== 'object') r.cut = {};
    return r;
  }
  const stegKey = (kind, i) => kind + ':' + i;
  const stegKeyOf = (c, d) => stegKey(d.kind, c[d.kind].indexOf(d.st));

  // Lagen aus der Verteilung (gleichmäßig über die Spannweite bzw. je Segment)
  function genZ(G, r) {
    const out = [];
    if (r.mode === 'seg') {
      const n = Math.max(0, Math.round(+r.nSeg || 0));
      G.segs.forEach((q, i) => {
        const d = q.z1 - q.z0;
        if (r.joints) { if (!i) out.push(q.z0); out.push(q.z1); }
        for (let k = 1; k <= n; k++) out.push(q.z0 + d * k / (n + 1));
      });
    } else {
      const n = Math.max(0, Math.round(+r.n || 0));
      if (r.ends) { if (n === 1) out.push(0); else for (let k = 0; k < n; k++) out.push(G.L * k / (n - 1)); }
      else for (let k = 1; k <= n; k++) out.push(G.L * k / (n + 1));
    }
    return out.map(z => Math.round(z * 10) / 10).sort((a, b) => a - b).filter((z, i, a) => !i || z - a[i - 1] > 0.05);
  }
  // Verteilung neu anwenden; Einstellungen je Rippe bleiben nach der Reihenfolge erhalten
  function regen(G, r) {
    if (r.mode === 'manual') return;
    const zs = genZ(G, r);
    r.list = zs.map((z, i) => Object.assign({}, r.list[i] || {}, { z }));
    if (selRib >= r.list.length) selRib = Math.max(0, r.list.length - 1);
  }

  // ---------- Geometrie einer Rippe ----------
  // Innenkontur an x: Schale (bzw. Gurt-Innenfläche im Gurtbereich) + Spiel
  function innerAt(G, c, r, x, z) {
    const S = A(), sec = S.section(G, x, z); if (!sec) return null;
    let ins = S.shellOf(c);
    const bw = S.capAt(G, c, 'capW', z), ct = S.capAt(G, c, 'capT', z);
    if (ct > 0 && bw > 0 && Math.abs(x - S.capCenter(G, c, z)) <= bw / 2) ins = Math.max(ins, S.capFace(c) + ct);
    ins += Math.max(0, +r.gap || 0);
    const top = sec.top - ins, bot = sec.bot + ins;
    return top > bot ? { top, bot } : null;
  }
  function circ(cx, cy, rx, ry, n) { const P = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; P.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return P; }
  // Langloch: Länge l in Flugrichtung (≥ d), Höhe d
  function slot(cx, cy, d, l) {
    const rr = d / 2, h = Math.max(0, l - d) / 2, P = [];
    if (h <= 1e-6) return circ(cx, cy, rr, rr, 32);
    for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + Math.PI * i / 16; P.push([cx + h + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
    for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + Math.PI * i / 16; P.push([cx - h + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
    return P;
  }
  function ribGeom(G, c, r, rib, D) {
    const S = A(), z = S.clamp(+rib.z || 0, 0, G.L), f = S.frame(G, z), warn = [], N = 140;
    // Abtastung der Sehne (Kosinus) + Stegkanten exakt
    const xs = [];
    for (let i = 0; i <= N; i++) xs.push(f.le + f.c * (1e-4 + (1 - 2e-4) * (1 - Math.cos(Math.PI * i / N)) / 2));
    let ivs = null;
    const valid = xs.filter(x => innerAt(G, c, r, x, z));
    if (valid.length < 2) return { z, f, pieces: [], dropped: [], ids: [], warn: [T('Kein Platz für eine Rippe an dieser Stelle.')] };
    ivs = [[valid[0], valid[valid.length - 1], 'LE', 'TE']];   // Teilstück + Grenze links/rechts (Nase, Steg-Schlüssel, Endleiste)
    const cl = Math.max(0, +r.webGap || 0), cuts = [];
    D.forEach(d => {
      if (z < d.a - 1e-6 || z > d.b + 1e-6) return;
      const a = d.at(z, 0); if (a.h == null || a.h <= 0) return;
      const key = stegKeyOf(c, d), mode = (rib.cut && rib.cut[key]) || r.cut[key] || 'both';
      if (mode === 'through') return;
      const w = S.webOf(d.st, d.kind), lo = a.x - w / 2 - cl, hi = a.x + w / 2 + cl;
      cuts.push(lo, hi);
      const out = [];
      ivs.forEach(([p, q, lk, rk]) => {
        if (mode === 'both') { if (lo > p) out.push([p, Math.min(q, lo), lk, lo < q ? key : rk]); if (hi < q) out.push([Math.max(p, hi), q, hi > p ? key : lk, rk]); }
        else if (mode === 'front') { if (lo > p) out.push([p, Math.min(q, lo), lk, lo < q ? key : rk]); }
        else if (hi < q) out.push([Math.max(p, hi), q, hi > p ? key : lk, rk]);
      });
      ivs = out.filter(iv => iv[1] - iv[0] > 1e-6);
    });
    const all = ivs.filter(iv => iv[1] - iv[0] > 0.5).map(([p, q, lk, rk]) => {
      const X = [p].concat(xs.filter(x => x > p + 1e-6 && x < q - 1e-6), [q]), up = [], dn = [], id = lk + '|' + rk;
      X.forEach(x => { const s = innerAt(G, c, r, x, z); if (s) { up.push([x, s.top]); dn.push([x, s.bot]); } });
      const own = rib.drop && rib.drop[id], drop = own === 'drop' || (own !== 'keep' && !!(r.drop && r.drop[id]));
      return { a: p, b: q, id, drop, P: up.concat(dn.reverse()), holes: [] };
    }).filter(pc => pc.P.length >= 4);
    const pieces = all.filter(pc => !pc.drop), dropped = all.filter(pc => pc.drop);
    // Löcher: nur, wenn ganz in einem Teilstück
    const place = (H, name) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      H.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
      const pc = pieces.find(q => x0 > q.a + 0.3 && x1 < q.b - 0.3);
      const ok = pc && [x0, (x0 + x1) / 2, x1].every(x => { const s = innerAt(G, c, r, x, z); return s && s.top > y1 + 0.3 && s.bot < y0 - 0.3; });
      if (ok) pc.holes.push(H); else warn.push(name + ': ' + T('passt nicht in die Rippe, entfällt.'));
    };
    const holes = (rib.globalHoles !== false ? r.holes : []).concat(rib.holes || []);
    holes.forEach((h, i) => {
      const d = Math.max(0, +h.d || 0); if (!(d > 0)) return;
      const x = f.le + f.c * (+h.x || 0) / 100, s = innerAt(G, c, r, x, z);
      if (!s) { warn.push(T('Loch') + ' ' + (i + 1) + ': ' + T('außerhalb des Profils.')); return; }
      place(slot(x, (s.top + s.bot) / 2 + (+h.y || 0), d, Math.max(d, +h.l || 0)), T('Loch') + ' ' + (i + 1));
    });
    // Ausschnitt für die Steckungshülse
    const K = c.stkOn && r.stkHole !== false ? S.stkData(G, c) : null;
    if (K && K.cy != null && K.oH > 0 && z <= K.len + 1e-6) {
      const xc = S.stkCenter(G, c, z), yc = K.cy + z * K.tan;
      const H = K.round ? circ(xc, yc, K.oW / 2, K.oW / 2, 40) : [[xc - K.oW / 2, yc - K.oH / 2], [xc + K.oW / 2, yc - K.oH / 2], [xc + K.oW / 2, yc + K.oH / 2], [xc - K.oW / 2, yc + K.oH / 2]];
      // die Hülse liegt zwischen den Gurten: Rippe dort ganz offen lassen, wenn die Hülse den Rand berührt
      const pc = pieces.find(q => xc > q.a && xc < q.b);
      if (pc) pc.holes.push(H);
    }
    if (!pieces.length) warn.push(T('Von den Stegen ganz weggeschnitten.'));
    return { z, f, pieces, dropped, ids: all.map(pc => pc.id), warn };
  }
  // Name einer Teilstück-Grenze bzw. eines Teilstücks „Nase – Holmsteg 1“
  function bName(c, k) {
    if (k === 'LE') return T('Nase'); if (k === 'TE') return T('Endleiste');
    const [kind, i] = k.split(':'), st = c[kind] && c[kind][+i]; return st ? (st.name || k) : k;
  }
  const pName = (c, id) => id.split('|').map(k => bName(c, k)).join(' – ');
  function allRibs(G, c) {
    const r = rcfg(c); if (!r.on) return [];
    const D = A().allStege(G, c);
    return r.list.map((rib, i) => Object.assign(ribGeom(G, c, r, rib, D), { i, rib }));
  }

  // ---------- Seitenleiste (in der Seitenleiste von Steghöhen) ----------
  function sidebar(side, H) {
    const S = A(), { numRow, selectRow, hint, subhead } = App, c = S.cfg(), G = S.geo(); if (!G) return;
    const r = rcfg(c), NR = { step: 0.5, min: 0, norender: true, enter: true };
    const det = side;   // eigene Menügruppe „Stützrippen“ aus stegh.js
    App.boolRow(det, 'Stützrippen vorsehen', () => !!r.on, v => { r.on = v; if (v && !r.list.length) regen(G, r); H.refresh(); });
    if (!r.on) return;
    const again = () => { regen(G, r); H.refresh(); };
    numRow(det, 'Rippendicke (mm)', () => r.t, v => { r.t = Math.max(0.1, v); H.upd(); }, Object.assign({}, NR, { step: 0.5, min: 0.1 }));
    numRow(det, 'Spiel zur Schale/zum Gurt (mm)', () => r.gap || 0, v => { r.gap = Math.max(0, v); H.upd(); }, Object.assign({}, NR, { step: 0.1 }));
    numRow(det, 'Spiel zum Steg (mm)', () => r.webGap || 0, v => { r.webGap = Math.max(0, v); H.upd(); }, Object.assign({}, NR, { step: 0.1 }));
    hint(det, 'Rippen stehen parallel zur Wurzelrippe; Kontur = Profil innen (Schale, im Gurtbereich Gurt-Innenfläche) abzüglich Spiel.');
    // Verteilung
    selectRow(det, 'Verteilung', [['span', 'gleichmäßig über die Spannweite'], ['seg', 'gleichmäßig je Segment'], ['manual', 'frei (Lage je Rippe)']], () => r.mode || 'span', v => { r.mode = v; again(); });
    if (r.mode === 'seg') {
      numRow(det, 'Rippen je Segment (zwischen den Stößen)', () => r.nSeg, v => { r.nSeg = Math.max(0, Math.round(v)); again(); }, { step: 1, min: 0, max: 100, int: true, norender: true, enter: true });
      App.boolRow(det, 'Zusätzlich an Wurzel, Segmentstößen und Außenende', () => !!r.joints, v => { r.joints = v; again(); });
    } else if (r.mode !== 'manual') {
      numRow(det, 'Anzahl Rippen', () => r.n, v => { r.n = Math.max(0, Math.round(v)); again(); }, { step: 1, min: 0, max: 200, int: true, norender: true, enter: true });
      App.boolRow(det, 'Erste an der Wurzel, letzte am Außenende', () => !!r.ends, v => { r.ends = v; again(); });
    } else hint(det, 'Lage jeder Rippe einzeln unten bei der gewählten Rippe. Ändern der Lage einer verteilten Rippe schaltet auf „frei“.');
    // Schnitt durch die Stege, global je Steg
    const D = S.allStege(G, c);
    if (D.length) {
      subhead(det, 'Schnitt durch die Stege (alle Rippen)');
      D.forEach(d => { const k = stegKeyOf(c, d); selectRow(det, d.st.name || k, CUTS, () => r.cut[k] || 'both', v => { r.cut[k] = v; H.upd(); }); });
    }
    // Teilstücke zwischen den Stegen entfernen (alle Rippen)
    {
      if (!r.drop || typeof r.drop !== 'object') r.drop = {};
      const ids = []; r.list.forEach(rib => ribGeom(G, c, r, rib, D).ids.forEach(id => { if (ids.indexOf(id) < 0) ids.push(id); }));
      if (ids.length > 1 || (ids.length === 1 && ids[0] !== 'LE|TE')) {
        subhead(det, 'Teilstücke entfernen (alle Rippen)');
        ids.forEach(id => App.boolRow(det, T('entfernen:') + ' ' + pName(c, id), () => !!r.drop[id], v => { if (v) r.drop[id] = true; else delete r.drop[id]; H.upd(); }));
      }
    }
    if (c.stkOn) App.boolRow(det, 'Ausschnitt für die Steckungshülse', () => r.stkHole !== false, v => { r.stkHole = v; H.upd(); });
    // Löcher
    const holeRows = (arr, title) => {
      subhead(det, title);
      arr.forEach((h, i) => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:12px;margin-top:4px';
        const b = document.createElement('b'); b.textContent = T('Loch') + ' ' + (i + 1); b.style.flex = '1';
        const x = document.createElement('button'); x.textContent = '✕'; x.title = T('Loch löschen'); x.style.padding = '2px 7px';
        x.onclick = () => { arr.splice(i, 1); H.refresh(); };
        row.append(b, x); det.appendChild(row);
        numRow(det, 'Lage (% der Sehne ab Nase)', () => h.x, v => { h.x = v; H.upd(); }, Object.assign({}, NR, { step: 1, min: -1e9 }));
        numRow(det, 'Höhe ab Mitte (mm, + = oben)', () => h.y || 0, v => { h.y = v; H.upd(); }, Object.assign({}, NR, { step: 0.5, min: -1e9 }));
        numRow(det, 'Durchmesser (mm)', () => h.d, v => { h.d = Math.max(0, v); H.upd(); }, NR);
        numRow(det, 'Länge Langloch (mm, 0 = rund)', () => h.l || 0, v => { h.l = Math.max(0, v); H.upd(); }, NR);
      });
      const add = document.createElement('button'); add.textContent = T('Loch hinzufügen'); add.style.marginTop = '4px';
      add.onclick = () => { arr.push({ x: 50, y: 0, d: 8, l: 0 }); H.refresh(); };
      det.appendChild(add);
    };
    holeRows(r.holes, 'Löcher in allen Rippen');
    // Liste
    subhead(det, T('Rippen') + ' (' + r.list.length + ')', RIB_COL);
    const lst = document.createElement('div'); lst.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px';
    if (selRib >= r.list.length) selRib = Math.max(0, r.list.length - 1);
    r.list.forEach((rib, i) => {
      const b = document.createElement('button'); b.textContent = (i + 1) + ' · ' + S.f1(+rib.z || 0); b.title = S.f1(+rib.z || 0) + ' mm ' + T('ab Wurzel');
      b.style.padding = '2px 6px'; if (i === selRib) { b.className = 'primary'; b.dataset.selrib = '1'; } b.onclick = () => select(i);
      lst.appendChild(b);
    });
    det.appendChild(lst);
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:4px;margin-top:4px';
    const ad = document.createElement('button'); ad.textContent = T('Rippe hinzufügen');
    ad.onclick = () => {
      // in die größte Lücke
      const zs = [0].concat(r.list.map(q => +q.z || 0), [G.L]).sort((a, b) => a - b); let best = 0, bz = G.L / 2;
      for (let i = 1; i < zs.length; i++) if (zs[i] - zs[i - 1] > best) { best = zs[i] - zs[i - 1]; bz = (zs[i] + zs[i - 1]) / 2; }
      r.mode = 'manual'; r.list.push({ z: Math.round(bz * 10) / 10 }); r.list.sort((a, b) => a.z - b.z); selRib = r.list.findIndex(q => Math.abs(q.z - Math.round(bz * 10) / 10) < 1e-6); H.refresh();
    };
    bar.appendChild(ad);
    if (r.list.length) {
      const dl = document.createElement('button'); dl.textContent = T('Gewählte löschen');
      dl.onclick = () => { r.mode = 'manual'; r.list.splice(selRib, 1); H.refresh(); };
      bar.appendChild(dl);
    }
    det.appendChild(bar);
    const rib = r.list[selRib];
    if (rib) {
      subhead(det, T('Rippe') + ' ' + (selRib + 1));
      numRow(det, 'Lage (mm ab Wurzel)', () => rib.z, v => { rib.z = S.clamp(v, 0, G.L); r.mode = 'manual'; r.list.sort((a, b) => a.z - b.z); select(r.list.indexOf(rib)); }, Object.assign({}, NR, { step: 5 }));
      if (D.length) D.forEach(d => {
        const k = stegKeyOf(c, d);
        selectRow(det, (d.st.name || k), [['', 'wie für alle Rippen']].concat(CUTS), () => (rib.cut && rib.cut[k]) || '', v => { if (!rib.cut) rib.cut = {}; if (v) rib.cut[k] = v; else delete rib.cut[k]; H.upd(); });
      });
      {
        const ids = ribGeom(G, c, r, rib, D).ids;
        if (ids.length > 1 || (ids.length === 1 && ids[0] !== 'LE|TE')) ids.forEach(id => selectRow(det, T('Teilstück') + ' ' + pName(c, id), [['', 'wie für alle Rippen'], ['keep', 'behalten'], ['drop', 'entfernen']], () => (rib.drop && rib.drop[id]) || '', v => { if (!rib.drop) rib.drop = {}; if (v) rib.drop[id] = v; else delete rib.drop[id]; H.upd(); }));
      }
      App.boolRow(det, 'Löcher für alle Rippen auch hier', () => rib.globalHoles !== false, v => { rib.globalHoles = v; H.upd(); });
      if (!rib.holes) rib.holes = [];
      holeRows(rib.holes, 'Eigene Löcher dieser Rippe');
      const g = ribGeom(G, c, r, rib, D), box = document.createElement('div'); box.style.cssText = 'font-size:12px;margin-top:4px';
      box.textContent = T('Teilstücke') + ': ' + g.pieces.length + (g.pieces.length ? ' · ' + g.pieces.map(p => S.f1(p.b - p.a)).join(' + ') + ' mm' : '');
      det.appendChild(box);
      g.warn.forEach(w => { const d = document.createElement('div'); d.textContent = w; d.style.cssText = 'font-size:12px;color:#ffb454'; det.appendChild(d); });
    }
    const out = document.createElement('div'); out.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px';
    if (App.cadImportDxfText) { const b = document.createElement('button'); b.textContent = T('Rippen in CAD übernehmen'); b.title = T('Alle Stützrippen mit Löchern in den Reiter „CAD-Bearbeitung" laden, je Rippe eine Ebene (ersetzt dessen Inhalt nach Rückfrage)'); b.onclick = toCad; out.appendChild(b); }
    det.appendChild(out);
  }

  // ---------- Draufsicht (aus stegh.js draw) ----------
  function drawPlan(cx, X, Y, G, s, hits) {
    const c = A().cfg(), R = allRibs(G, c); if (!R.length) return;
    const t = Math.max(0.1, +rcfg(c).t || 0);
    R.forEach(g => {
      const on = g.i === selRib, w = Math.max(on ? 3 : 2, t * s);
      g.pieces.forEach(p => {
        cx.fillStyle = on ? '#ffe2a8' : RIB_COL + 'aa';
        cx.fillRect(X(g.z) - w / 2, Y(-p.a), w, Y(-p.b) - Y(-p.a));
        if (hits) for (let k = 0; k <= 10; k++) hits.push([X(g.z), Y(-(p.a + (p.b - p.a) * k / 10)), { rib: g.i }, w / 2]);
      });
      // entfernte Teilstücke gestrichelt
      cx.setLineDash([3, 3]); cx.strokeStyle = RIB_COL + '88'; cx.lineWidth = 1;
      g.dropped.forEach(p => { cx.strokeRect(X(g.z) - w / 2, Y(-p.a), w, Y(-p.b) - Y(-p.a)); });
      cx.setLineDash([]);
    });
  }
  // Rippe im Profilschnitt (aus stegh.js secOne): Rippen innerhalb ihrer Dicke an der Stelle q.z
  function drawSec(g, G, q, X, Y) {
    const c = A().cfg(), r = rcfg(c); if (!r.on) return;
    const t = Math.max(0.1, +r.t || 0), D = A().allStege(G, c);
    r.list.forEach((rib, i) => {
      if (Math.abs((+rib.z || 0) - q.z) > Math.max(t / 2, 0.5)) return;
      const R = ribGeom(G, c, r, rib, D), tr = P => P.forEach((p, k) => { const a = X(p[0] - q.le), b = Y(p[1] + q.dy); if (k) g.lineTo(a, b); else g.moveTo(a, b); });
      R.pieces.forEach(p => {
        g.beginPath(); tr(p.P); g.closePath(); p.holes.forEach(H => { tr(H); g.closePath(); });
        g.fillStyle = 'rgba(224,185,122,.55)'; g.fill('evenodd'); g.strokeStyle = i === selRib ? '#ffe2a8' : RIB_COL; g.lineWidth = i === selRib ? 1.8 : 1.2; g.stroke();
      });
      g.setLineDash([4, 4]); g.strokeStyle = RIB_COL + '88'; g.lineWidth = 1;
      R.dropped.forEach(p => { g.beginPath(); tr(p.P); g.closePath(); g.stroke(); });
      g.setLineDash([]);
      g.fillStyle = RIB_COL; g.fillText(T('Rippe') + ' ' + (i + 1) + (R.warn.length ? ' · ' + R.warn[0] : ''), X(0), Y(q.hi + q.dy) - 24);
    });
  }
  // Rippe wählen: Menü aufklappen, Schnitt an ihre Stelle
  function select(i) {
    const c = A().cfg(), r = rcfg(c), rib = r.list[i]; if (!rib) return;
    selRib = i;
    if (A().showSecAt) A().showSecAt(+rib.z || 0);
    if (window.StegHoehen) window.StegHoehen.refresh(true);
    if (A().focus) A().focus('rip');
    const b = document.querySelector('[data-selrib]'); if (b) b.scrollIntoView({ block: 'nearest' });
  }

  // ---------- CAD ----------
  // Ebenen je Rippe (x ab Nase), untereinander ab yc nach unten; auch von stegh.js dxfText genutzt
  function cadLayers(yc) {
    const S = A(), G = S.geo(); if (!G) return [];
    const c = S.cfg(), R = allRibs(G, c).filter(g => g.pieces.length), layers = [];
    yc = yc || 0;
    R.forEach(g => {
      let lo = Infinity, hi = -Infinity;
      g.pieces.forEach(p => p.P.forEach(q => { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }));
      const map = P => ({ closed: true, pts: P.map(q => ({ x: q[0] - g.f.le, y: q[1] - hi + yc })) });
      const polys = [];
      g.pieces.forEach(p => { polys.push(map(p.P)); p.holes.forEach(h => polys.push(map(h))); });
      layers.push({ name: 'RIPPE_' + (g.i + 1) + '_' + Math.round(g.z), color: 40, polys });
      yc -= (hi - lo) + 15;
    });
    return layers;
  }
  function toCad() {
    if (!window.Dxf) return;
    const layers = cadLayers(0);
    if (!layers.length) { App.toast && App.toast(T('Keine Stützrippen vorhanden.')); return; }
    App.cadImportDxfText(Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 3 }), T('Stützrippen'));
    if (App.switchView && document.getElementById('cadView')) App.switchView('cad');
  }

  // ---------- 3D-Ansicht ----------
  const VIS = { outer: true, sup: true, inner: true, cap: true, holm: true, ruder: true, rip: true, stk: true, huel: true };
  const COL = { outer: [120, 220, 170], sup: [185, 169, 138], inner: [214, 240, 228], cap: [255, 60, 220], holm: [90, 169, 255], ruder: [255, 169, 77], rip: [224, 185, 122], stk: [255, 240, 106], huel: [200, 190, 120] };
  const ALPHA = { outer: 0.28, sup: 0.35, inner: 0.35, huel: 0.55 };
  function buildScene() {
    const S = A(), G = S.geo(), faces = []; if (!G) return { faces };
    const c = S.cfg(), add = (p, k, extra) => faces.push(Object.assign({ p, col: COL[k], a: ALPHA[k] || 1 }, extra || {}));
    const P3 = (p, z) => [p[0], p[1], z];
    const loft = (rings, zs, k, closed, ex) => {
      for (let j = 1; j < rings.length; j++) {
        const a = rings[j - 1], b = rings[j], n = a.length;
        for (let i = 0; i < (closed ? n : n - 1); i++) { const i2 = (i + 1) % n; add([P3(a[i], zs[j - 1]), P3(a[i2], zs[j - 1]), P3(b[i2], zs[j]), P3(b[i], zs[j])], k, ex); }
      }
    };
    // Stationen: Segmentstöße + Teilungen
    const zs = [];
    G.segs.forEach((q, i) => { for (let k = i ? 1 : 0; k <= 4; k++) zs.push(q.z0 + (q.z1 - q.z0) * k / 4); });
    // Schale: Fläche je Lage in ihrem Abstand von der Kontur
    const NS = 48, ring = (z, off) => {
      const f = S.frame(G, z), up = [], dn = []; let last = null;
      for (let i = 0; i <= NS; i++) {
        const x = f.le + f.c * (1e-4 + (1 - 2e-4) * (1 - Math.cos(Math.PI * i / NS)) / 2), s = S.section(G, x, z) || last; if (!s) continue; last = s;
        let t = s.top - off, b = s.bot + off; if (t < b) t = b = (s.top + s.bot) / 2;
        up.push([x, t]); dn.push([x, b]);
      }
      return up.reverse().concat(dn.slice(1, -1));
    };
    const shells = c.layOn ? [['outer', 0], ['sup', S.layA(c)], ['inner', S.layA(c) + Math.max(0, +c.layS || 0)]] : [['outer', 0]];
    const shT = S.shellOf(c);
    shells.forEach(([k, off], j) => {
      if (!VIS[k]) return;
      const R = zs.map(z => ring(z, off)); loft(R, zs, k, true);
      // Stirnflächen Wurzel/außen als Ring bis zur nächsten Lage
      const inOff = j + 1 < shells.length ? shells[j + 1][1] : shT;
      [0, G.L].forEach((z, e) => { const o = e ? R[R.length - 1] : R[0]; add(o.map(p => P3(p, z)), k, { holes: [ring(z, inOff).map(p => P3(p, z))], cap: 1 }); });
    });
    // Holmgurt oben/unten
    if (VIS.cap) {
      const go = S.capFace(c), gz = zs, top = [], bot = [];
      gz.forEach(z => {
        const ct = S.capAt(G, c, 'capT', z), bw = S.capAt(G, c, 'capW', z), cm = S.capCenter(G, c, z), T1 = [], T2 = [], B1 = [], B2 = [];
        for (let i = 0; i <= 8; i++) {
          const x = cm - bw / 2 + bw * i / 8, s = S.section(G, x, z) || { top: 0, bot: 0 };
          T1.push([x, s.top - go]); T2.push([x, s.top - go - ct]); B1.push([x, s.bot + go]); B2.push([x, s.bot + go + ct]);
        }
        top.push(T1.concat(T2.reverse())); bot.push(B1.concat(B2.reverse()));
      });
      if (S.capAt(G, c, 'capT', 0) > 0 || S.capAt(G, c, 'capT', G.L) > 0) { const ex = { pick: { t: 'cap' } }; loft(top, gz, 'cap', true, ex); loft(bot, gz, 'cap', true, ex); [0, gz.length - 1].forEach(i => { add(top[i].map(p => P3(p, gz[i])), 'cap', { cap: 1, pick: ex.pick }); add(bot[i].map(p => P3(p, gz[i])), 'cap', { cap: 1, pick: ex.pick }); }); }
    }
    // Stege als Platten in ihrer Breite
    S.allStege(G, c).forEach(d => {
      if (!VIS[d.kind]) return;
      const w = S.webOf(d.st, d.kind), ex = { pick: { t: 'steg', st: d.st } };
      if (S.getSel && S.getSel() === d.st) ex.col = COL[d.kind].map(v => Math.min(255, v + 70));
      let run = [], rz = [];
      const flush = () => { if (run.length > 1) { loft(run, rz, d.kind, true, ex); add(run[0].map(p => P3(p, rz[0])), d.kind, Object.assign({ cap: 1 }, ex)); add(run[run.length - 1].map(p => P3(p, rz[rz.length - 1])), d.kind, Object.assign({ cap: 1 }, ex)); } run = []; rz = []; };
      const step = Math.max(1, Math.floor(d.path.length / 60));
      d.path.forEach((p, i) => {
        if (i % step && i !== d.path.length - 1) return;
        const a = d.at(p.z, p.s);
        if (a.h == null || a.h <= 0) { flush(); return; }
        run.push([[a.x - w / 2, a.top], [a.x + w / 2, a.top], [a.x + w / 2, a.bot], [a.x - w / 2, a.bot]]); rz.push(p.z);
      });
      flush();
    });
    // Steckung und Hülse
    const K = S.stkData(G, c);
    if (K && K.cy != null && K.len > 0 && (VIS.stk || VIS.huel)) {
      const kz = []; const n = Math.max(2, Math.ceil(K.len / 20)); for (let i = 0; i <= n; i++) kz.push(K.len * i / n);
      const sh = (z, w, h) => { const xc = S.stkCenter(G, c, z), yc = K.cy + z * K.tan; return K.round ? circ(xc, yc, w / 2, w / 2, 24) : [[xc - w / 2, yc - h / 2], [xc + w / 2, yc - h / 2], [xc + w / 2, yc + h / 2], [xc - w / 2, yc + h / 2]]; };
      const ex = { pick: { t: 'stk' } }, tube = (w, h, k) => { if (!(w > 0 && h > 0)) return; const R = kz.map(z => sh(z, w, h)); loft(R, kz, k, true, ex); add(R[0].map(p => P3(p, 0)), k, { cap: 1, pick: ex.pick }); add(R[R.length - 1].map(p => P3(p, K.len)), k, { cap: 1, pick: ex.pick }); };
      if (VIS.stk) tube(K.inW, K.inH, 'stk');
      if (VIS.huel) tube(K.oW, K.oH, 'huel');
    }
    // Stützrippen: Teilstücke mit Löchern, um die Dicke extrudiert
    if (VIS.rip) {
      const t = Math.max(0.1, +rcfg(c).t || 0);
      allRibs(G, c).forEach(g => {
        const z0 = S.clamp(g.z - t / 2, 0, Math.max(0, G.L - t)), z1 = z0 + t;
        const ex = { pick: { t: 'rib', i: g.i } }; if (g.i === selRib) ex.col = [255, 226, 168];
        g.pieces.forEach(p => {
          add(p.P.map(q => P3(q, z0)), 'rip', Object.assign({ holes: p.holes.map(h => h.map(q => P3(q, z0))), cap: 1, edge: 1 }, ex));
          add(p.P.map(q => P3(q, z1)), 'rip', Object.assign({ holes: p.holes.map(h => h.map(q => P3(q, z1))), cap: 1, edge: 1 }, ex));
          [p.P].concat(p.holes).forEach(L => L.forEach((q, i) => { const q2 = L[(i + 1) % L.length]; add([P3(q, z0), P3(q2, z0), P3(q2, z1), P3(q, z1)], 'rip', ex); }));
        });
      });
    }
    return { faces };
  }

  let win = null, cv = null, scene = null, drawn = [];
  // Treffer im Bild: vorderste wählbare Fläche (durchscheinende Schale wird übergangen)
  function pick3d(mx, my) {
    const inside = P => { let o = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > my) !== (P[j][1] > my) && mx < P[j][0] + (P[i][0] - P[j][0]) * (my - P[j][1]) / (P[i][1] - P[j][1])) o = !o; return o; };
    for (let k = drawn.length - 1; k >= 0; k--) {
      const L = drawn[k]; if (!L.f.pick) continue;
      let o = inside(L.q); if (L.hq) L.hq.forEach(H => { if (inside(H)) o = !o; });
      if (o) return L.f.pick;
    }
    return null;
  }
  function choose(pk) {
    if (!pk) return;
    if (pk.t === 'rib') select(pk.i);
    else if (A().focus) A().focus(pk.t, pk.st);
  }
  const CAM0 = { yaw: -0.7, pitch: 0.45, zoom: 1, px: 0, py: 0 }, cam = Object.assign({}, CAM0);
  function project(Sc, w, h) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    Sc.faces.forEach(f => f.p.forEach(q => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i]); hi[i] = Math.max(hi[i], q[i]); } }));
    const m = lo.map((v, i) => (v + hi[i]) / 2), R = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 || 1;
    const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), s = Math.min(w, h) / (2.1 * R) * cam.zoom;
    // Welt: x = Sehne (nach hinten), y = hoch, z = Spannweite
    return q => {
      const x = q[2] - m[2], y = q[1] - m[1], zz = -(q[0] - m[0]);
      const x1 = x * cyw - zz * syw, z1 = x * syw + zz * cyw, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      return [w / 2 + cam.px + x1 * s, h / 2 + cam.py - y2 * s, z2];
    };
  }
  function draw() {
    if (!cv || !win || win.style.display === 'none') return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#10141a'; g.fillRect(0, 0, w, h);
    if (!scene || !scene.faces.length) { g.fillStyle = '#8a97a6'; g.font = '13px Segoe UI'; g.textAlign = 'center'; g.fillText(T('Nichts zum Anzeigen gewählt.'), w / 2, h / 2); return; }
    const pr = project(scene, w, h), L = [0.35, 0.8, 0.5], ln = Math.hypot.apply(null, L);
    const list = scene.faces.map(f => {
      const q = f.p.map(pr);
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
      const lam = Math.abs((nx * L[0] - ny * L[1] + nz * L[2]) / (Math.hypot(nx, ny, nz) || 1) / ln);
      return { q, hq: f.holes ? f.holes.map(H => H.map(pr)) : null, d: q.reduce((s, v) => s + v[2], 0) / q.length, f, lam };
    }).sort((a, b) => a.d - b.d);
    drawn = list;
    g.lineJoin = 'round';
    list.forEach(({ q, hq, f, lam }) => {
      const k = 0.35 + 0.65 * lam, col = f.col.map(v => Math.round(v * k));
      g.beginPath(); q.forEach((v, i) => i ? g.lineTo(v[0], v[1]) : g.moveTo(v[0], v[1])); g.closePath();
      if (hq) hq.forEach(H => { H.forEach((v, i) => i ? g.lineTo(v[0], v[1]) : g.moveTo(v[0], v[1])); g.closePath(); });
      g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${f.a})`; g.fill('evenodd');
      if (f.edge) { g.strokeStyle = 'rgba(10,14,20,.8)'; g.lineWidth = 0.8; g.stroke(); }
      else if (f.a >= 1 && !f.cap) { g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.stroke(); }
    });
  }
  function refresh3d() { if (win && win.style.display !== 'none') { scene = buildScene(); buildChecks(); draw(); } }
  function buildChecks() {
    const box = win.querySelector('.s3d-checks'), c = A().cfg(), r = rcfg(c);
    const items = c.layOn ? [['outer', 'Außenlage'], ['sup', 'Stützstoff'], ['inner', 'Innenlage']] : [['outer', 'Schale']];
    items.push(['cap', 'Holmgurt']);
    if (c.holm.length) items.push(['holm', 'Holmstege']);
    if (c.ruder.length) items.push(['ruder', 'Ruderstege']);
    if (r.on) items.push(['rip', 'Stützrippen']);
    if (c.stkOn) items.push(['stk', 'Steckung'], ['huel', 'Hülse']);
    box.innerHTML = '';
    items.forEach(([k, lab]) => {
      const l = document.createElement('label'), i = document.createElement('input');
      i.type = 'checkbox'; i.checked = VIS[k];
      i.onchange = () => { VIS[k] = i.checked; scene = buildScene(); draw(); };
      const sw = document.createElement('span'); sw.style.cssText = 'display:inline-block;width:9px;height:9px;margin:0 3px;border-radius:2px;background:rgb(' + COL[k].join(',') + ')';
      l.append(i, sw, document.createTextNode(T(lab))); box.appendChild(l);
    });
  }
  function open3d() {
    if (!win) {
      win = document.createElement('div');
      win.style.cssText = 'position:fixed;left:6%;top:7%;width:88%;height:84%;z-index:9000;background:var(--panel,#1a2028);'
        + 'border:1px solid var(--line,#334);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);display:flex;flex-direction:column';
      win.innerHTML = '<div class="s3d-head" style="display:flex;align-items:center;gap:14px;padding:6px 10px;border-bottom:1px solid var(--line,#334);cursor:move;font-size:12px">'
        + '<b>' + T('Steghöhen — 3D-Ansicht') + '</b><div class="s3d-checks" style="display:flex;gap:12px;flex-wrap:wrap"></div>'
        + '<span style="flex:1"></span><button type="button" class="s3d-home" title="' + T('Ansicht zurücksetzen') + '">⌂</button>'
        + '<button type="button" class="s3d-close">✕</button></div>'
        + '<div style="position:relative;flex:1;min-height:0"><canvas style="width:100%;height:100%;display:block;cursor:grab"></canvas>'
        + '<div style="position:absolute;left:10px;bottom:8px;font-size:11px;color:var(--muted,#8a97a6)">'
        + T('Linke Maustaste: drehen · rechte: verschieben · Rad: zoomen · Klick: Rippe/Steg/Gurt/Steckung im Menü wählen') + '</div></div>';
      document.body.appendChild(win);
      cv = win.querySelector('canvas');
      win.querySelector('.s3d-close').onclick = () => { win.style.display = 'none'; };
      win.querySelector('.s3d-home').onclick = () => { Object.assign(cam, CAM0); draw(); };
      win.querySelector('.s3d-head').addEventListener('mousedown', e => {
        if (e.target.closest('label,button,input')) return;
        const rc = win.getBoundingClientRect(), ox = e.clientX - rc.left, oy = e.clientY - rc.top;
        const mv = ev => { win.style.left = (ev.clientX - ox) + 'px'; win.style.top = Math.max(0, ev.clientY - oy) + 'px'; };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
      });
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('mousedown', e => {
        const x0 = e.clientX, y0 = e.clientY, c0 = Object.assign({}, cam), pan = e.button !== 0;
        const mv = ev => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (pan) { cam.px = c0.px + dx; cam.py = c0.py + dy; } else { cam.yaw = c0.yaw + dx * 0.008; cam.pitch = Math.max(-1.55, Math.min(1.55, c0.pitch + dy * 0.008)); }
          draw();
        };
        const up = ev => {
          removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
          if (!pan && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) { const rc = cv.getBoundingClientRect(); choose(pick3d(ev.clientX - rc.left, ev.clientY - rc.top)); }   // Klick wählt
        };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
      });
      cv.addEventListener('wheel', e => { e.preventDefault(); cam.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12; draw(); }, { passive: false });
      addEventListener('resize', draw);
    }
    win.style.display = 'flex';
    refresh3d();
  }

  App.StegRippen = { sidebar, drawPlan, drawSec, select, open3d, refresh3d, toCad, cadLayers, _test: { allRibs, ribGeom, genZ, buildScene } };
})();
