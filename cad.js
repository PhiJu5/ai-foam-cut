/* cad.js — Reiter CAD-Bearbeitung: 2D-CAD-Editor, erweiterte Befehle, Befehlszeile  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  // Demo-Build (Build-Tool: „nur Demo (ohne Export)"): zeichnen ja, DXF-Export nein.
  const DEMO = App.demoFeature('cad', 'Demo-Version: Der DXF-Export der CAD-Bearbeitung ist in dieser Ausgabe nicht enthalten. „In DXF-Formen übernehmen“ und damit Schneiden bleibt möglich.');
  // ======================================================================
  //  Reiter „CAD-Bearbeitung" — eigenständiger 2D-CAD-Editor
  //  Werkzeuge: Auswählen/Verschieben, Punkt, Linie, Rechteck, Kreis,
  //  Ellipse, Polylinie (Pline), Kopieren, Spiegeln, Trimmen, Löschen.
  //  Objektfang (F3): Endpunkt · Mittelpunkt · Perpendikular · Nächster.
  //  Ortho (F8). Undo/Redo. Import aus DXF-Formen/Rippendesign; DXF-Export.
  //  Store: state.cad (getrennt von state.dxf).
  // ======================================================================
  let cadDraw = null;   // letzte Zeichentransformation (für Klick-Trefferprüfung)
  function cadEntities() {
    const d = state.cad, out = [];
    for (const name of d.order) (d.layers[name] || []).forEach((loop, idx) => out.push({ layer: name, idx, loop }));
    return out;
  }
  function cadEnsureLayer(name) { const d = state.cad; if (!d.layers[name]) { d.layers[name] = []; if (!d.order.includes(name)) d.order.push(name); } if (!d.layerColors) d.layerColors = {}; if (!d.layerColors[name]) d.layerColors[name] = CAD_LAYER_PALETTE[d.order.indexOf(name) % CAD_LAYER_PALETTE.length]; return name; }
  function cadDefaultLayer() { const d = state.cad, e = d.edit; if (e.active && d.layers[e.active]) return e.active; if (d.order.length) return d.order[0]; e.active = cadEnsureLayer('Zeichnung'); return e.active; }
  function cadAddEntity(layer, loop) { cadEnsureLayer(layer); state.cad.layers[layer].push(loop); }
  function cadLoopOf(ref) { const a = state.cad.layers[ref.layer]; return a && a[ref.idx]; }
  // --- Undo/Redo (nur Geometrie) ---
  // Kontur klonen — inkl. Spline-Metadaten (Kontrollpunkte/Typ/Tangenten).
  function cadCloneLoop(l) { const a = l.map(p => ({ x: p.x, y: p.y })); a.closed = l.closed; if (l.pt) a.pt = true; if (l.ctype) { a.ctype = l.ctype; a.cclosed = l.cclosed; a.ctrl = (l.ctrl || []).map(p => ({ x: p.x, y: p.y })); if (l.startTan) a.startTan = { x: l.startTan.x, y: l.startTan.y }; if (l.endTan) a.endTan = { x: l.endTan.x, y: l.endTan.y }; } return a; }
  function cadSnap() { const d = state.cad, layers = {}; for (const k in d.layers) layers[k] = d.layers[k].map(cadCloneLoop); return { layers, order: d.order.slice(), texts: (d.texts || []).map(t => Object.assign({}, t)), layerColors: Object.assign({}, d.layerColors), layerHidden: Object.assign({}, d.layerHidden), lineStyles: Object.assign({}, d.lineStyles) }; }
  function cadApplySnap(s) { const d = state.cad; d.layers = {}; for (const k in s.layers) d.layers[k] = s.layers[k].map(cadCloneLoop); d.order = s.order.slice(); d.texts = (s.texts || []).map(t => Object.assign({}, t)); d.layerColors = Object.assign({}, s.layerColors || {}); d.layerHidden = Object.assign({}, s.layerHidden || {}); d.lineStyles = Object.assign({}, s.lineStyles || {}); }
  function cadPushUndo() { const d = state.cad; d.undo.push(cadSnap()); if (d.undo.length > 80) d.undo.shift(); d.redo.length = 0; }
  function cadUndo() { const d = state.cad; if (!d.undo.length) { cadFlash('Nichts rückgängig zu machen.'); return; } d.redo.push(cadSnap()); cadApplySnap(d.undo.pop()); d.edit.sel = []; d.edit.draft = null; d.edit.drag = null; App.buildSidebar(); renderCad(); }
  function cadRedo() { const d = state.cad; if (!d.redo.length) return; d.undo.push(cadSnap()); cadApplySnap(d.redo.pop()); d.edit.sel = []; d.edit.draft = null; d.edit.drag = null; App.buildSidebar(); renderCad(); }
  function cadAfterEdit() { App.buildSidebar(); renderCad(); }
  // --- Bildschirm -> Welt (mit Objektfang / Ortho) ---
  function cadWorld(ev) {
    const cv = document.getElementById('cCad'); if (!cv || !cadDraw) return null;
    const r = cv.getBoundingClientRect(), V = cadDraw.V;
    const wpt = V.inv(ev.clientX - r.left, ev.clientY - r.top);
    const ed = state.cad.edit; ed.snapHit = false; ed.snapKind = null;
    if (ed.snap) { const s = cadOsnap(wpt, 12); if (s) { ed.snapHit = true; ed.snapKind = s.kind; return { x: s.x, y: s.y }; } }
    const base = ed.ortho ? cadDraftRef() : null;
    if (base) return (Math.abs(wpt.x - base.x) >= Math.abs(wpt.y - base.y)) ? { x: wpt.x, y: base.y } : { x: base.x, y: wpt.y };
    if (ed.gridSnap) { const st = ed.gridStep || 10; return { x: Math.round(wpt.x / st) * st, y: Math.round(wpt.y / st) * st }; }
    return wpt;
  }
  // Objektfang: bester Treffer nach Typ (Priorität End 0 · Mitte 1 · Perp 2 · Nächster 3).
  // Kreis durch drei Punkte (für Bogen-Zentrum).
  function cadCircleFrom3(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)); if (Math.abs(d) < 1e-9) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    return { x: ux, y: uy, r: Math.hypot(a.x - ux, a.y - uy) };
  }
  // Zentrum einer Kontur: geschlossen -> Flächenschwerpunkt (Kreis/Rechteck/Polygon),
  // offen -> als Kreisbogen deuten (Kreis durch 3 Punkte, mit Plausibilitätsprüfung).
  function cadEntityCenter(loop) {
    const n = loop.length; if (n < 3) return null;
    if (loop.closed) {
      let A = 0, cx = 0, cy = 0;
      for (let i = 0; i < n; i++) { const a = loop[i], b = loop[(i + 1) % n], cr = a.x * b.y - b.x * a.y; A += cr; cx += (a.x + b.x) * cr; cy += (a.y + b.y) * cr; }
      if (Math.abs(A) < 1e-9) { let sx = 0, sy = 0; loop.forEach(p => { sx += p.x; sy += p.y; }); return { x: sx / n, y: sy / n }; }
      A *= 0.5; return { x: cx / (6 * A), y: cy / (6 * A) };
    }
    const cc = cadCircleFrom3(loop[0], loop[n >> 1], loop[n - 1]); if (!cc || !isFinite(cc.r) || cc.r < 1e-6) return null;
    let err = 0; for (const p of loop) err += Math.abs(Math.hypot(p.x - cc.x, p.y - cc.y) - cc.r); err /= n;
    if (err > cc.r * 0.06 + 1e-6) return null;   // kein sauberer Bogen -> kein Zentrum
    return { x: cc.x, y: cc.y };
  }
  // 3-Punkt-Kreisbogen (Start a, Punkt auf dem Bogen b, Ende c) -> Punktfolge.
  // Bei kollinearen Punkten Fallback als Linienzug a-b-c.
  function cadArcPoints(a, b, c) {
    const cc = cadCircleFrom3(a, b, c);
    if (!cc) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: c.x, y: c.y }];
    const ang = p => Math.atan2(p.y - cc.y, p.x - cc.x);
    const norm = t => { while (t < 0) t += 2 * Math.PI; while (t >= 2 * Math.PI) t -= 2 * Math.PI; return t; };
    const a1 = ang(a), ccwEnd = norm(ang(c) - a1), ccwMid = norm(ang(b) - a1);
    const ccw = ccwMid <= ccwEnd;                       // liegt b im CCW-Bogen a->c?
    const sweep = ccw ? ccwEnd : -(2 * Math.PI - ccwEnd);
    const steps = Math.max(2, Math.round((state.cad.edit.arcPoints || 48) * Math.abs(sweep) / (2 * Math.PI)));
    const pts = [];
    for (let i = 0; i <= steps; i++) { const t = a1 + sweep * (i / steps); pts.push({ x: cc.x + cc.r * Math.cos(t), y: cc.y + cc.r * Math.sin(t) }); }
    return pts;
  }
  // Punkt + Tangentenrichtung an der getroffenen Kontur (für tangentialen Anschluss).
  function cadTangentAt(wpt, tolPx) {
    const h = cadHitEntity(wpt, tolPx || 8); if (!h) return null;
    const loop = cadLoopOf(h); if (!loop || loop.length < 2) return null;
    const n = loop.length, a = loop[h.seg], b = loop[(h.seg + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    return { pt: { x: a.x + dx * h.t, y: a.y + dy * h.t }, tan: { x: dx / L, y: dy / L } };
  }
  // Weiche Kurve (Cubic-Hermite) durch die Punkte; optionale geklemmte Start-/
  // Endtangente (Einheitsrichtung) -> tangentialer Anschluss an andere Objekte.
  function cadTangentSpline(pts, startTan, endTan) {
    const n = pts.length; if (n < 2) return pts.map(p => ({ x: p.x, y: p.y }));
    const dir = (p, q) => ({ x: q.x - p.x, y: q.y - p.y });
    const align = (t, ref) => (t && (t.x * ref.x + t.y * ref.y) < 0) ? { x: -t.x, y: -t.y } : t;
    const m = new Array(n);
    for (let i = 0; i < n; i++) {
      if (i === 0) { const d = dir(pts[0], pts[1]), s = Math.hypot(d.x, d.y); const t = align(startTan, d); m[i] = t ? { x: t.x * s, y: t.y * s } : d; }
      else if (i === n - 1) { const d = dir(pts[n - 2], pts[n - 1]), s = Math.hypot(d.x, d.y); const t = align(endTan, d); m[i] = t ? { x: t.x * s, y: t.y * s } : d; }
      else m[i] = { x: (pts[i + 1].x - pts[i - 1].x) / 2, y: (pts[i + 1].y - pts[i - 1].y) / 2 };
    }
    const seg = Math.max(2, Math.round(state.cad.edit.splineSeg || 48)), out = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1], m0 = m[i], m1 = m[i + 1];
      for (let s = 0; s < seg; s++) {
        const t = s / seg, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        out.push({ x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x, y: h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y });
      }
    }
    out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
    return out;
  }
  function cadOsnap(wpt, tolPx) {
    const ed = state.cad.edit, V = cadDraw.V, wx = V.X(wpt.x), wy = V.Y(wpt.y);
    const ref = cadDraftRef(); let best = null;
    const consider = (kind, prio, x, y) => { const dd = Math.hypot(V.X(x) - wx, V.Y(y) - wy); if (dd <= tolPx && (!best || prio < best.prio || (prio === best.prio && dd < best.dd))) best = { kind, prio, dd, x, y }; };
    cadEntities().forEach(e => {
      const loop = e.loop, n = loop.length, last = loop.closed ? n : n - 1;
      if (ed.snapEnd) loop.forEach(p => consider('end', 0, p.x, p.y));
      // Zentrum von Kreisen/Bögen/Vierecken (unter „Mittelpunkt").
      if (ed.snapMid) { const cc = cadEntityCenter(loop); if (cc) consider('center', 1, cc.x, cc.y); }
      const circ = (ed.snapQuad || (ed.snapTan && ref)) ? cadIsCircle(loop) : null;
      if (circ) {
        if (ed.snapQuad) [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(q => consider('quad', 1, circ.x + q[0] * circ.r, circ.y + q[1] * circ.r));
        if (ed.snapTan && ref) { const dd = Math.hypot(ref.x - circ.x, ref.y - circ.y); if (dd > circ.r) { const al = Math.atan2(ref.y - circ.y, ref.x - circ.x), th = Math.acos(circ.r / dd); [al + th, al - th].forEach(a => consider('tan', 2, circ.x + circ.r * Math.cos(a), circ.y + circ.r * Math.sin(a))); } }
      }
      for (let i = 0; i < last; i++) {
        const a = loop[i], b = loop[(i + 1) % n];
        if (ed.snapMid) consider('mid', 1, (a.x + b.x) / 2, (a.y + b.y) / 2);
        if (ed.snapNear || (ed.snapPerp && ref)) {
          const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-9;
          if (ed.snapNear) { let t = ((wpt.x - a.x) * dx + (wpt.y - a.y) * dy) / L2; t = Math.max(0, Math.min(1, t)); consider('near', 3, a.x + t * dx, a.y + t * dy); }
          if (ed.snapPerp && ref) { const tp = ((ref.x - a.x) * dx + (ref.y - a.y) * dy) / L2; if (tp >= 0 && tp <= 1) consider('perp', 2, a.x + tp * dx, a.y + tp * dy); }
        }
      }
    });
    // Kreuzung: Schnittpunkte von Segmenten nahe dem Cursor (Kandidaten vorfiltern).
    if (ed.snapInt) {
      const cand = [];
      cadEntities().forEach(e => {
        if (!cadVisible(e.layer)) return;
        const loop = e.loop, n = loop.length, last = loop.closed ? n : n - 1;
        for (let i = 0; i < last; i++) {
          const a = loop[i], b = loop[(i + 1) % n], ax = V.X(a.x), ay = V.Y(a.y), bx = V.X(b.x), by = V.Y(b.y);
          const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1; let t = ((wx - ax) * dx + (wy - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
          if (Math.hypot(ax + t * dx - wx, ay + t * dy - wy) <= tolPx + 18) cand.push({ a, b, idx: e.idx, layer: e.layer, i });
        }
      });
      for (let p = 0; p < cand.length; p++) for (let q = p + 1; q < cand.length; q++) {
        const A = cand[p], B = cand[q];
        if (A.layer === B.layer && A.idx === B.idx && Math.abs(A.i - B.i) <= 1) continue;   // benachbarte Segmente = gemeinsamer Endpunkt
        const X = HotWire.segX(A.a, A.b, B.a, B.b); if (X) consider('int', 1, X.x, X.y);
      }
    }
    return best;
  }
  function cadDraftRef() {
    const dr = state.cad.edit.draft; if (!dr) return null;
    if (dr.type === 'line' || dr.type === 'rect' || dr.type === 'ellipse') return dr.p0;
    if (dr.type === 'circle') return dr.c;
    if (dr.type === 'move') return dr.base || null;
    if (dr.type === 'mirror') return dr.p2 || dr.p1 || null;
    if (dr.type === 'offset') return dr.dp0 || null;
    if (dr.type === 'rotate' || dr.type === 'scale' || dr.type === 'stretch') return dr.base || null;
    if (dr.type === 'align') return dr.t2 || dr.s2 || dr.t1 || dr.s1 || null;
    if (dr.type === 'zoom') return dr.p0 || null;
    if (dr.type === 'xline') return dr.p1 || null;
    if (dr.type === 'dim' && dr.pts.length) return dr.pts[dr.pts.length - 1];
    if ((dr.type === 'poly' || dr.type === 'spline' || dr.type === 'splinetan' || dr.type === 'measure' || dr.type === 'arc') && dr.pts.length) return dr.pts[dr.pts.length - 1];
    return null;
  }
  function cadNearestVertex(wpt, tolPx) {
    const V = cadDraw.V; let best = null, bd = tolPx * tolPx;
    cadEntities().forEach(e => { if (e.loop.ctrl) return; e.loop.forEach((p, vi) => { const dx = V.X(p.x) - V.X(wpt.x), dy = V.Y(p.y) - V.Y(wpt.y), dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = { x: p.x, y: p.y, layer: e.layer, idx: e.idx, vi }; } }); });
    return best;
  }
  function cadDistToLoop(loop, wpt) {
    const V = cadDraw.V; let best = { dist: 1e9, seg: 0, t: 0 };
    if (loop.length === 1) return { dist: Math.hypot(V.X(loop[0].x) - V.X(wpt.x), V.Y(loop[0].y) - V.Y(wpt.y)), seg: 0, t: 0 };
    const n = loop.length, last = loop.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = loop[i], c = loop[(i + 1) % n], ax = V.X(a.x), ay = V.Y(a.y), cx = V.X(c.x), cy = V.Y(c.y);
      const dx = cx - ax, dy = cy - ay, L2 = dx * dx + dy * dy || 1;
      let t = ((V.X(wpt.x) - ax) * dx + (V.Y(wpt.y) - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const dd = Math.hypot(ax + t * dx - V.X(wpt.x), ay + t * dy - V.Y(wpt.y));
      if (dd < best.dist) best = { dist: dd, seg: i, t };
    }
    return best;
  }
  function cadHitEntity(wpt, tolPx) {
    let best = null;
    cadEntities().forEach(e => { if (!cadVisible(e.layer)) return; const h = cadDistToLoop(e.loop, wpt); if (h.dist < (tolPx || 8) && (!best || h.dist < best.dist)) best = { layer: e.layer, idx: e.idx, dist: h.dist, seg: h.seg, t: h.t }; });
    return best;
  }
  // Text unter dem Cursor (näherungsweise Textkasten, Anker zentriert). {tx, d}.
  function cadHitText(wpt) {
    const V = cadDraw.V, wx = V.X(wpt.x), wy = V.Y(wpt.y); let best = null;
    (state.cad.texts || []).forEach((t, i) => {
      if (!cadVisible(t.layer)) return;
      const hPx = Math.max(8, (t.h || 3) * V.s), halfW = 0.32 * hPx * Math.max(1, (t.text || '').length), halfH = 0.65 * hPx;
      const cx = V.X(t.x), cy = V.Y(t.y);
      if (Math.abs(wx - cx) <= halfW + 3 && Math.abs(wy - cy) <= halfH + 3) { const d = Math.hypot(wx - cx, wy - cy); if (!best || d < best.d) best = { tx: i, d }; }
    });
    return best;
  }
  // --- Maus ---
  function cadEditDown(ev) {
    const d = state.cad, ed = d.edit; if (!cadDraw) return;
    if (ev.button === 0 || ev.button === 1) ev.stopImmediatePropagation();   // kein Nav-Pan im Editor
    if (ev.button === 1) { ev.preventDefault(); ed.pan = { px: ev.clientX, py: ev.clientY, ox: App.nav.cad.ox, oy: App.nav.cad.oy }; return; }
    if (ev.button !== 0) return;
    ev.preventDefault();
    const wpt = cadWorld(ev); if (!wpt) return;
    if (ed.m2p) { cadM2PPoint(wpt); return; }   // Mitte-2-Punkte-Erfassung
    // Objektwahl-Phase eines Verb-Befehls (Verschieben/Kopieren/Spiegeln/Löschen):
    // Klick auf Objekt = (ab)wählen, Klick ins Leere = Aufziehfenster. Enter = weiter.
    if (ed.draft && ed.draft.type === 'stretch' && ed.draft.phase === 'select') { ed.drag = { mode: 'box', start: wpt, cur: wpt, add: true, stretch: true }; renderCad(); return; }
    if (ed.draft && ed.draft.phase === 'select') {
      if (!cadPickToggle(wpt)) ed.drag = { mode: 'box', start: wpt, cur: wpt, add: true };
      renderCad(); return;
    }
    switch (ed.tool) {
      case 'select': {
        const h = cadHitEntity(wpt, 8);
        if (h) {
          const key = h.layer + ':' + h.idx, has = ed.sel.some(s => s.layer + ':' + s.idx === key);
          if (ev.shiftKey) { if (has) ed.sel = ed.sel.filter(s => s.layer + ':' + s.idx !== key); else ed.sel.push({ layer: h.layer, idx: h.idx }); }
          else if (!has) ed.sel = [{ layer: h.layer, idx: h.idx }];
          ed.drag = null;   // Auswahl per Klick; Objekte NICHT per Maus verschieben (nur über die Verschieben-Funktion)
        } else {
          const ht = cadHitText(wpt);
          if (ht) {
            const has = ed.sel.some(s => s.tx === ht.tx);
            if (ev.shiftKey) { if (has) ed.sel = ed.sel.filter(s => s.tx !== ht.tx); else ed.sel.push({ tx: ht.tx }); }
            else if (!has) ed.sel = [{ tx: ht.tx }];
            ed.drag = null;   // Auswahl per Klick; Objekte NICHT per Maus verschieben (nur über die Verschieben-Funktion)
          } else { ed.drag = { mode: 'box', start: wpt, cur: wpt, add: ev.shiftKey }; }
        }
        App.buildSidebar(); break;
      }
      case 'vertex': {
        const cr = cadNearestCtrl(wpt, 12);   // Spline-Kontrollpunkt zuerst
        if (cr) { ed.drag = { mode: 'ctrl', ref: cr }; break; }
        const vr = cadNearestVertex(wpt, 12); if (vr) ed.drag = { mode: 'vertex', ref: vr }; break;
      }
      case 'delpt': {
        const cr = cadNearestCtrl(wpt, 12);
        if (cr) { const loop = cadLoopOf(cr); if (loop && loop.ctrl && loop.ctrl.length > 2) { cadPushUndo(); loop.ctrl.splice(cr.ci, 1); cadRebuildCurve(loop); cadAfterEdit(); } else cadFlash('Zu wenige Stützpunkte zum Löschen.'); return; }
        const vr = cadNearestVertex(wpt, 12); if (!vr) return;
        const loop = cadLoopOf(vr), minPts = loop && loop.closed ? 3 : 2;
        if (loop && loop.length > minPts) { cadPushUndo(); loop.splice(vr.vi, 1); cadAfterEdit(); } else cadFlash('Zu wenige Punkte zum Löschen.');
        return;
      }
      case 'trim': cadTrimAt(wpt); return;
      case 'erase': { ed.draft = { type: 'erase', phase: 'select' }; if (!cadPickToggle(wpt)) ed.drag = { mode: 'box', start: wpt, cur: wpt, add: true }; renderCad(); return; }
      default: if (cadIsPointTool(ed.tool)) { cadToolPoint(wpt); return; }
    }
    renderCad();
  }
  // Punktzahl (Segmente) für Kreis/Ellipse — optional beim Zeichnen abfragen.
  // Liefert ein Promise mit der Punktzahl (App.askText statt window.prompt,
  // das es in Electron nicht gibt — deshalb asynchron).
  function cadArcSteps(kind) {
    const ed = state.cad.edit; const steps = Math.max(3, Math.round(ed.arcPoints || 48));
    if (!ed.arcAsk) return Promise.resolve(steps);
    return App.askText(T(kind === 'ellipse' ? 'Punktzahl für die Ellipse:' : 'Punktzahl für den Kreis:'),
      String(steps)).then(a => {
      if (a === null) return steps;
      const nn = parseInt(a, 10);
      if (nn >= 3) { ed.arcPoints = nn; return nn; }
      return steps;
    });
  }
  function cadToolPoint(wpt) {
    const d = state.cad, ed = d.edit, active = cadDefaultLayer();
    switch (ed.tool) {
      case 'line': {   // Linienkette wie in AutoCAD: jeder Klick hängt eine Linie an, Enter beendet, S schließt.
        if (!ed.draft) ed.draft = { type: 'line', p0: wpt, first: wpt, segs: 0 };
        else { const L = Math.hypot(wpt.x - ed.draft.p0.x, wpt.y - ed.draft.p0.y); if (L < 1e-9) break; cadPushUndo(); cadAddEntity(active, App.mkLoopLocal([ed.draft.p0, wpt], false)); ed.draft.p0 = wpt; ed.draft.segs++; cadAfterEdit(); return; }
        break;
      }
      case 'rect': if (!ed.draft) ed.draft = { type: 'rect', p0: wpt }; else { const a = ed.draft.p0, c = wpt; cadPushUndo(); cadAddEntity(active, App.mkLoopLocal([{ x: a.x, y: a.y }, { x: c.x, y: a.y }, { x: c.x, y: c.y }, { x: a.x, y: c.y }], true)); cadLog(T('Rechteck ') + Math.abs(c.x - a.x).toFixed(2) + ' × ' + Math.abs(c.y - a.y).toFixed(2)); cadSetTool('select', true); return; } break;
      case 'circle': {
        const dr = ed.draft;
        if (dr && dr.mode === '2p') {   // Kreis über zwei Durchmesser-Endpunkte
          dr.pts.push(wpt); if (dr.pts.length < 2) break;
          const a = dr.pts[0], b = dr.pts[1]; cadMakeCircle({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.hypot(b.x - a.x, b.y - a.y) / 2); return;
        }
        if (dr && dr.mode === '3p') {   // Kreis durch drei Punkte
          dr.pts.push(wpt); if (dr.pts.length < 3) break;
          const c = cadCircleFrom3(dr.pts[0], dr.pts[1], dr.pts[2]);
          if (!c) { cadFlash('Die drei Punkte liegen auf einer Geraden.'); ed.draft = null; renderCad(); return; }
          cadMakeCircle({ x: c.x, y: c.y }, c.r); return;
        }
        if (!dr) { ed.draft = { type: 'circle', c: wpt }; break; }
        const rr = Math.hypot(wpt.x - dr.c.x, wpt.y - dr.c.y);
        if (dr.ask === 'd') { cadMakeCircle(dr.c, rr / 2); return; }   // Klick im Durchmesser-Modus = Durchmesser-Punkt
        cadMakeCircle(dr.c, rr); return;
      }
      case 'ellipse': if (!ed.draft) ed.draft = { type: 'ellipse', p0: wpt }; else {
        const a = ed.draft.p0, c = wpt, cx = (a.x + c.x) / 2, cy = (a.y + c.y) / 2, rx = Math.abs(c.x - a.x) / 2, ry = Math.abs(c.y - a.y) / 2;
        if (rx < 1e-6 || ry < 1e-6) { ed.draft = null; renderCad(); return; }
        cadArcSteps('ellipse').then(steps => {
          const pts = [];
          for (let k = 0; k < steps; k++) { const t = 2 * Math.PI * k / steps; pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }); }
          cadPushUndo(); cadAddEntity(active, App.mkLoopLocal(pts, true)); cadSetTool('select', true);
        });
        return;
      } break;
      case 'arc': {   // 3-Punkt-Kreisbogen: Start · Punkt auf dem Bogen · Ende
        if (!ed.draft || ed.draft.type !== 'arc') ed.draft = { type: 'arc', pts: [] };
        ed.draft.pts.push(wpt);
        if (ed.draft.pts.length >= 3) {
          const P = ed.draft.pts, geom = cadArcPoints(P[0], P[1], P[2]);
          if (geom.length >= 2) { cadPushUndo(); cadAddEntity(active, App.mkLoopLocal(geom, false)); }
          cadSetTool('select', true); return;
        }
        cadFlash(ed.draft.pts.length === 1 ? 'Kreisbogen: Punkt auf dem Bogen.' : 'Kreisbogen: Endpunkt.');
        break;
      }
      case 'polyline': {
        if (!ed.draft) ed.draft = { type: 'poly', pts: [] };
        if (ed.draft.pts.length >= 2 && cadDraw) { const p0 = ed.draft.pts[0], V = cadDraw.V; if (Math.hypot(V.X(p0.x) - V.X(wpt.x), V.Y(p0.y) - V.Y(wpt.y)) < 10) { cadFinishPolyline(true); return; } }
        ed.draft.pts.push(wpt); break;
      }
      case 'spline': {
        if (!ed.draft) ed.draft = { type: 'spline', pts: [] };
        if (ed.draft.pts.length >= 2 && cadDraw) { const p0 = ed.draft.pts[0], V = cadDraw.V; if (Math.hypot(V.X(p0.x) - V.X(wpt.x), V.Y(p0.y) - V.Y(wpt.y)) < 10) { cadFinishSpline(true); return; } }
        ed.draft.pts.push(wpt); break;
      }
      case 'splinetan': {   // Spline mit tangentialem Anschluss an Objekte
        if (!ed.draft || ed.draft.type !== 'splinetan') ed.draft = { type: 'splinetan', pts: [], startTan: null };
        if (ed.draft.pts.length === 0) {
          const tg = cadTangentAt(wpt, 10);
          if (tg) { ed.draft.pts.push(tg.pt); ed.draft.startTan = tg.tan; cadFlash('Tangential am Objekt begonnen — weitere Stützpunkte klicken.'); }
          else { ed.draft.pts.push(wpt); cadFlash('Kein Objekt am Start — freier Anfang. Weitere Stützpunkte klicken.'); }
          break;
        }
        ed.draft.pts.push(wpt); break;
      }
      case 'move': case 'copy': {
        if (!ed.sel.length) { cadSetTool(ed.tool); return; }
        const dr = ed.draft && ed.draft.type === 'move' ? ed.draft : (ed.draft = { type: 'move', copy: ed.tool === 'copy', phase: 'base' });
        if (dr.phase !== 'dest') { dr.base = wpt; dr.phase = 'dest'; break; }
        cadPushUndo(); cadTranslateSelection(wpt.x - dr.base.x, wpt.y - dr.base.y, dr.copy);
        if (dr.copy) { dr.placed = (dr.placed || 0) + 1; cadAfterEdit(); cadLog(ed.sel.length + T(' Objekt(e) kopiert.')); return; }   // Kopieren: Mehrfach bis Enter
        cadLog(ed.sel.length + T(' Objekt(e) verschoben.')); cadSetTool('select', true); return;
      }
      case 'mirror': {
        if (!ed.sel.length) { cadSetTool('mirror'); return; }
        const dr = ed.draft && ed.draft.type === 'mirror' ? ed.draft : (ed.draft = { type: 'mirror', phase: 'p1' });
        if (dr.phase === 'p1') { dr.p1 = wpt; dr.phase = 'p2'; break; }
        if (dr.phase === 'p2') { dr.p2 = wpt; dr.phase = 'del'; break; }   // dann: Quellobjekte löschen? [Ja/Nein]
        break;
      }
      case 'rotate': case 'scale': {
        if (!ed.sel.length) { cadSetTool(ed.tool); return; }
        const dr = ed.draft; if (!dr) break;
        if (dr.phase === 'base') { dr.base = wpt; dr.phase = ed.tool === 'rotate' ? 'angle' : 'factor'; break; }
        if (dr.phase === 'angle') { cadFinishRotate(cadAng(dr.base, wpt)); return; }
        if (dr.phase === 'factor') { cadFinishScale(cadDist(dr.base, wpt)); return; }
        if (dr.phase === 'ref1') { dr.r1 = wpt; dr.phase = 'ref2'; break; }
        if (dr.phase === 'ref2') { dr.r2 = wpt; dr.phase = 'refnew'; break; }
        if (dr.phase === 'refnew') {
          if (ed.tool === 'rotate') cadFinishRotate(cadAng(dr.base, wpt) - cadAng(dr.r1, dr.r2));
          else { const rl = cadDist(dr.r1, dr.r2); if (rl < 1e-9) { cadFlash('Referenzlänge ist 0.'); break; } cadFinishScale(cadDist(dr.base, wpt) / rl); }
          return;
        }
        break;
      }
      case 'align': {
        if (!ed.sel.length) { cadSetTool('align'); return; }
        const dr = ed.draft; if (!dr) break;
        if (dr.phase === 's1') { dr.s1 = wpt; dr.phase = 't1'; break; }
        if (dr.phase === 't1') { dr.t1 = wpt; dr.phase = 's2'; break; }
        if (dr.phase === 's2') { dr.s2 = wpt; dr.phase = 't2'; break; }
        if (dr.phase === 't2') { dr.t2 = wpt; dr.phase = 'scale'; break; }   // dann: skalieren? [Ja/Nein]
        break;
      }
      case 'array': {
        if (!ed.sel.length) { cadSetTool('array'); return; }
        const dr = ed.draft; if (!dr) break;
        if (dr.phase === 'center') { dr.center = wpt; dr.phase = 'pcount'; dr.ask = 'count'; break; }
        break;
      }
      case 'stretch': {
        const dr = ed.draft; if (!dr || dr.phase === 'select') break;
        if (dr.phase === 'base') { dr.base = wpt; dr.phase = 'dest'; break; }
        if (dr.phase === 'dest') { cadFinishStretch(wpt.x - dr.base.x, wpt.y - dr.base.y); return; }
        break;
      }
      case 'fillet': case 'chamfer': {
        const dr = ed.draft; if (!dr) break;
        const h = cadHitEntity(wpt, 10); if (!h) { cadFlash('Keine Kontur getroffen.'); break; }
        if (dr.phase === 'first') { dr.a = h; dr.clickA = wpt; dr.phase = 'second'; break; }
        if (cadDoCorner(dr.a, h, wpt)) { cadLog(ed.tool === 'fillet' ? T('Abgerundet mit Radius ') + (ed.filletR || 0).toFixed(2) : T('Gefast ') + (ed.chamferD1 || 0).toFixed(2) + ' / ' + (ed.chamferD2 || 0).toFixed(2)); ed.sel = []; cadSetTool('select', true); cadAfterEdit(); return; }
        dr.phase = 'first'; dr.a = null; break;
      }
      case 'extend': cadExtendAt(wpt); return;
      case 'break': {
        const dr = ed.draft; if (!dr) break;
        if (dr.phase === 'obj') { const h = cadHitEntity(wpt, 10); if (!h) { cadFlash('Keine Kontur getroffen.'); break; } dr.ref = { layer: h.layer, idx: h.idx }; dr.pos1 = h.seg + h.t; ed.sel = [dr.ref]; dr.phase = 'second'; break; }
        if (dr.phase === 'first') { const loop = cadLoopOf(dr.ref); if (!loop) break; const q = cadDistToLoop(loop, wpt); dr.pos1 = q.seg + q.t; dr.phase = 'second'; break; }
        if (dr.phase === 'second') { const loop = cadLoopOf(dr.ref); if (!loop) break; const q = cadDistToLoop(loop, wpt); const p2 = q.seg + q.t, same = cadDist(cadPosPoint(loop, p2), cadPosPoint(loop, dr.pos1)) < (cadDraw ? 3 / cadDraw.V.s : 0.1); cadBreakApply(same ? null : p2); return; }
        break;
      }
      case 'point': cadAddPoint(wpt); return;
      case 'xline': {
        const dr = ed.draft; if (!dr) break;
        if (dr.phase === 'p1') { dr.p1 = wpt; if (dr.mode === 'h') { cadAddXline(wpt, 0); return; } if (dr.mode === 'v') { cadAddXline(wpt, Math.PI / 2); return; } if (dr.mode === 'a') { cadAddXline(wpt, (dr.ang || 0) * D2R); return; } dr.phase = 'p2'; break; }
        if (dr.phase === 'p2') { if (cadDist(wpt, dr.p1) < 1e-9) break; cadAddXline(dr.p1, cadAng(dr.p1, wpt)); return; }
        break;
      }
      case 'polygon': {
        const dr = ed.draft; if (!dr || dr.ask) break;
        if (dr.phase === 'center') { dr.center = wpt; dr.phase = 'mode'; break; }
        if (dr.phase === 'mode') { dr.circum = false; dr.phase = 'radius'; }
        if (dr.phase === 'radius') { const r = cadDist(dr.center, wpt); if (r < 1e-6) break; cadPushUndo(); cadAddEntity(active, cadMakePolygon(dr.center, dr.n, r, dr.circum, cadAng(dr.center, wpt))); cadLog(T('Polygon ') + dr.n + T(' Seiten, Radius ') + r.toFixed(2)); cadSetTool('select', true); cadAfterEdit(); return; }
        break;
      }
      case 'dim': {
        const dr = ed.draft; if (!dr) break;
        dr.pts.push(wpt);
        if (dr.pts.length >= 3) { cadAddDim(dr.pts[0], dr.pts[1], dr.pts[2]); ed.draft = { type: 'dim', pts: [] }; return; }
        break;
      }
      case 'origin': cadSetOrigin(wpt); return;
      case 'zoom': {
        const dr = ed.draft; if (!dr) break;
        if (dr.phase === 'opt' || dr.phase === 'w1') { dr.p0 = wpt; dr.phase = 'w2'; break; }
        if (dr.phase === 'w2') { cadZoomTo(App.bounds([dr.p0, wpt])); cadLog(T('Zoom: Fenster')); cadSetTool('select', true); return; }
        break;
      }
      case 'area': cadAreaAt(wpt); return;
      case 'matchprop': {
        const dr = ed.draft; if (!dr) break;
        if (dr.phase === 'source') { const h = cadHitEntity(wpt, 8); const ht = h ? null : cadHitText(wpt); if (!h && !ht) { cadFlash('Kein Objekt getroffen.'); break; } dr.srcLayer = h ? h.layer : state.cad.texts[ht.tx].layer; dr.phase = 'select'; ed.sel = []; cadLog(T('Quelle: Layer „') + dr.srcLayer + '"'); break; }
        break;
      }
      case 'offset': {
        const dr = ed.draft && ed.draft.type === 'offset' ? ed.draft : (ed.draft = { type: 'offset', phase: 'dist' });
        if (dr.phase === 'dist') {   // Abstand über zwei Punkte
          if (!dr.dp0) { dr.dp0 = wpt; break; }
          const L = Math.hypot(wpt.x - dr.dp0.x, wpt.y - dr.dp0.y); dr.dp0 = null;
          if (L < 1e-6) { cadFlash('Abstand muss größer als 0 sein.'); break; }
          dr.dist = L; ed.offsetDist = L; dr.phase = 'obj'; cadLog(T('Abstand: ') + L.toFixed(2)); break;
        }
        if (dr.phase === 'obj') {
          const h = cadHitEntity(wpt, 8);
          if (!h) { cadFlash('Kein Objekt getroffen.'); break; }
          dr.ref = { layer: h.layer, idx: h.idx }; dr.phase = dr.through ? 'through' : 'side'; break;
        }
        if (dr.phase === 'side' || dr.phase === 'through') {
          const loop = cadLoopOf(dr.ref); if (!loop) { dr.phase = 'obj'; break; }
          const sd = cadSideOf(loop, wpt), dist = dr.phase === 'through' ? sd.dist : dr.dist;
          if (!(dist > 1e-6)) { cadFlash('Abstand muss größer als 0 sein.'); dr.phase = 'obj'; break; }
          const res = cadOffsetLoop(loop, sd.sign * dist);
          if (!res || res.length < 2) { cadFlash('Versetzen nicht möglich (Kontur zu klein für diesen Abstand).'); dr.phase = 'obj'; break; }
          cadPushUndo(); cadAddEntity(dr.ref.layer, res); ed.sel = [{ layer: dr.ref.layer, idx: state.cad.layers[dr.ref.layer].length - 1 }];
          cadLog(T('Versetzt um ') + dist.toFixed(2) + ' mm.'); dr.ref = null; dr.phase = 'obj'; cadAfterEdit(); return;
        }
        break;
      }
      case 'measure': {
        // Messen: Punkte klicken; erzeugt KEINE Geometrie (kein Undo). Zeigt
        // Länge/Richtung des letzten Segments und Winkel am mittleren Punkt.
        if (!ed.draft || ed.draft.type !== 'measure') ed.draft = { type: 'measure', pts: [] };
        ed.draft.pts.push(wpt);
        const P = ed.draft.pts;
        if (P.length >= 2) {
          const a = P[P.length - 2], b = P[P.length - 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y), ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360;
          let msg = T('Länge ') + len.toFixed(2) + ' mm · ' + T('Richtung ') + ang.toFixed(1) + '°';
          if (P.length >= 3) {
            const v = P[P.length - 3];
            const a1 = Math.atan2(v.y - a.y, v.x - a.x), a2 = Math.atan2(b.y - a.y, b.x - a.x);
            let da = Math.abs((a2 - a1) * 180 / Math.PI) % 360; if (da > 180) da = 360 - da;
            msg += ' · ' + T('Winkel ') + da.toFixed(1) + '°';
          }
          cadFlash(msg);
        }
        break;
      }
    }
    renderCad();
  }
  // Kurzbefehle der Befehlszeile (AutoCAD-artig): Tippen + Enter wählt das Werkzeug.
  const CAD_ALIASES = {
    pl: 'polyline', l: 'line', ci: 'circle', rec: 'rect', spl: 'spline',
    mo: 'move', co: 'copy', all: 'ellipse', el: 'ellipse',
    tr: 'trim', mi: 'mirror', er: 'erase', sel: 'select', me: 'measure', di: 'measure', a: 'arc', bo: 'arc', spt: 'splinetan',
    o: 'offset', offset: 'offset', ve: 'offset', versetz: 'offset',
    line: 'line', linie: 'line', pline: 'polyline', polylinie: 'polyline', circle: 'circle', kreis: 'circle', rectangle: 'rect', rechteck: 'rect', spline: 'spline',
    move: 'move', schieben: 'move', copy: 'copy', kopieren: 'copy', ellipse: 'ellipse', trim: 'trim', stutzen: 'trim', mirror: 'mirror', spiegeln: 'mirror',
    erase: 'erase', löschen: 'erase', e: 'erase', select: 'select', dist: 'measure', messen: 'measure', arc: 'arc', bogen: 'arc',
    dr: 'rotate', ro: 'rotate', rotate: 'rotate', drehen: 'rotate',
    sk: 'scale', sc: 'scale', scale: 'scale', skalieren: 'scale',
    ab: 'fillet', f: 'fillet', fillet: 'fillet', abrunden: 'fillet',
    fa: 'chamfer', cha: 'chamfer', chamfer: 'chamfer', fasen: 'chamfer',
    de: 'extend', ex: 'extend', extend: 'extend', dehnen: 'extend',
    br: 'break', break: 'break', bruch: 'break',
    re: 'array', ar: 'array', array: 'array', reihe: 'array',
    st: 'stretch', s: 'stretch', stretch: 'stretch', strecken: 'stretch',
    pt: 'point', po: 'point', point: 'point', punkt: 'point',
    kl: 'xline', xl: 'xline', xline: 'xline', hilfslinie: 'xline',
    pg: 'polygon', pol: 'polygon', polygon: 'polygon',
    bm: 'dim', dim: 'dim', bemaßung: 'dim', bemassung: 'dim',
    urs: 'origin', origin: 'origin', ursprung: 'origin',
    ali: 'align', al: 'align', align: 'align', ausrichten: 'align',
    rev: 'reverse', reverse: 'reverse', umkehren: 'reverse',
    x: 'explode', explode: 'explode', auflösen: 'explode',
    la: 'layer', layer: 'layer',
    ea: 'matchprop', ma: 'matchprop', matchprop: 'matchprop',
    z: 'zoom', zoom: 'zoom', fl: 'area', area: 'area', fläche: 'area', flaeche: 'area'
  };
  // Direktaktionen (kein Werkzeug): Kürzel -> CAD_ACTIONS-Schlüssel.
  const CAD_ACTION_ALIASES = { j: 'join', join: 'join', verbinden: 'join', aa: 'selall', alle: 'selall', vo: 'selprev', ae: 'selsim', 'äh': 'selsim', za: 'zoomall', zo: 'zoomobj', zv: 'zoomprev', u: 'undo', undo: 'undo', redo: 'redo' };
  const CAD_ACTION_REV = (() => { const m = {}; for (const k in CAD_ACTION_ALIASES) { const id = CAD_ACTION_ALIASES[k]; if (!m[id]) m[id] = k; } return m; })();
  // Klarname je Werkzeug für die Befehlszeile (Großschreibung wie in AutoCAD).
  function cadCmdName(id) { return T(cadToolLabel(id)).toUpperCase(); }
  // Bevorzugtes Kürzel je Werkzeug (für Tooltips), abgeleitet aus CAD_ALIASES.
  const CAD_ALIASES_REV = (() => { const m = {}; for (const k in CAD_ALIASES) { const id = CAD_ALIASES[k]; if (!m[id]) m[id] = k; } return m; })();
  // Layer-Farben: Standardpalette (Anzeige) + ACI-Zuordnung (für DXF-Export).
  const CAD_LAYER_PALETTE = ['#4aa3ff', '#ffb454', '#57d38c', '#ff6b6b', '#c78bff', '#5bd6c8', '#ffd24a', '#8fa0b4', '#ff5ad0', '#7ad0ff'];
  const ACI_HEX = { 1: '#ff5a3c', 2: '#ffd24a', 3: '#5ad16b', 4: '#4ad1d1', 5: '#4aa3ff', 6: '#d98bff', 7: '#c8d2dc', 8: '#8b98a8', 30: '#ffa03c' };
  function cadHexToRgb(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]; }
  function cadHexToAci(hex) { const t = cadHexToRgb(hex); let best = 7, bd = 1e18; for (const a in ACI_HEX) { const r = cadHexToRgb(ACI_HEX[a]); const d = (r[0] - t[0]) * (r[0] - t[0]) + (r[1] - t[1]) * (r[1] - t[1]) + (r[2] - t[2]) * (r[2] - t[2]); if (d < bd) { bd = d; best = +a; } } return best; }
  function cadLayerColor(name) { const lc = state.cad.layerColors; return (lc && lc[name]) || App.PAL.profInner || '#4aa3ff'; }
  function cadVisible(name) { const h = state.cad.layerHidden; return !(h && h[name]); }
  function cadLayerStyle(name) { const s = state.cad.lineStyles; return (s && s[name]) || 'solid'; }
  // Bildschirm-Strichmuster je Linienart.
  function cadLayerDash(name) { return ({ dashed: [8, 5], dotted: [1, 4], dashdot: [9, 4, 1, 4] })[cadLayerStyle(name)] || []; }
  // Zuordnung Linienart -> DXF-Linientyp (LTYPE-Name).
  function cadLayerLtype(name) { return ({ dashed: 'DASHED', dotted: 'DOTTED', dashdot: 'DASHDOT' })[cadLayerStyle(name)] || 'CONTINUOUS'; }
  // Ausschnitt an alle Objekte anpassen (einfrieren) und Pan/Zoom zurücksetzen.
  function cadFitView() { state.cad.view = null; if (App.nav.cad) { App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; } renderCad(); }
  // Hintergrundbild (Vorlage zum Nachzeichnen) aus einer Datei laden.
  function cadLoadBgImage(file) {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const bg = state.cad.bg;
        bg.url = rd.result; bg.img = img; bg.iw = img.naturalWidth || img.width; bg.ih = img.naturalHeight || img.height; bg.visible = true;
        // Erstplatzierung: mittig über die Geometrie (bzw. Ursprung), Breite ~ Geometrie oder 200 mm.
        if (!bg.scale || bg.scale === 1) {
          const b = App.bounds.apply(null, cadEntities().map(e => e.loop));
          const targetW = (isFinite(b.maxx) && b.maxx > b.minx) ? (b.maxx - b.minx) * 1.2 : 200;
          bg.scale = bg.iw > 0 ? targetW / bg.iw : 1;
          bg.x = (isFinite(b.maxx) && b.maxx > b.minx) ? (b.minx + b.maxx) / 2 : 0;
          bg.y = (isFinite(b.maxy) && b.maxy > b.miny) ? (b.miny + b.maxy) / 2 : 0;
        }
        App.buildSidebar(); renderCad();
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  }
  function buildCadBgSidebar(side) {
    const bg = state.cad.bg;
    const g = App.grp('Hintergrundbild', true, 'cad', { key: 'cadBg' });
    const bl = document.createElement('button'); bl.className = bg.img ? '' : 'primary';
    bl.textContent = bg.img ? T('Anderes Bild laden…') : T('Bild laden…');
    bl.onclick = () => App.loadFileVia({ 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'] }, f => cadLoadBgImage(f), 'fileCadBg', 'ldImg');
    g.body.appendChild(bl);
    if (!bg.img) { App.hint(g.body, 'Lädt ein Referenz-/Vorlagenbild (PNG/JPG/SVG) unter die Zeichnung — danach verschiebbar, skalierbar und drehbar. Nur Vorlage, nicht Teil der Geometrie/des Exports.'); side.appendChild(g.g); return; }
    App.boolRow(g.body, 'Sichtbar', () => bg.visible, v => { bg.visible = v; renderCad(); });
    App.numRow(g.body, 'Deckkraft (%)', () => Math.round(bg.opacity * 100), v => { bg.opacity = Math.min(1, Math.max(0, v / 100)); renderCad(); }, { int: true, min: 0, max: 100, norender: true });
    App.numRow(g.body, 'Position X (mm)', () => bg.x, v => { bg.x = v; renderCad(); }, { step: 1, norender: true });
    App.numRow(g.body, 'Position Y (mm)', () => bg.y, v => { bg.y = v; renderCad(); }, { step: 1, norender: true });
    App.numRow(g.body, 'Breite (mm)', () => +(bg.iw * bg.scale).toFixed(1), v => { if (bg.iw > 0 && v > 0) bg.scale = v / bg.iw; renderCad(); }, { step: 1, min: 0.1, norender: true, hint: 'Gesamtbreite in mm (skaliert proportional).' });
    App.numRow(g.body, 'Skalierung (%)', () => +(bg.scale * 100).toFixed(1), v => { if (v > 0) bg.scale = v / 100; renderCad(); }, { step: 1, min: 0.1, norender: true });
    App.numRow(g.body, 'Drehung (°)', () => bg.rot, v => { bg.rot = v; renderCad(); }, { step: 1, norender: true });
    const br = document.createElement('button'); br.textContent = T('Bild entfernen'); br.style.color = 'var(--bad)';
    br.onclick = () => { bg.img = null; bg.url = null; App.buildSidebar(); renderCad(); };
    g.body.appendChild(br);
    side.appendChild(g.g);
  }
  // Objektfang „Mitte zwischen 2 Punkten": nach dem Start liefern die nächsten
  // zwei Punkte (Klick ODER Koordinaten) ihren Mittelpunkt an das aktive Werkzeug.
  function cadIsPointTool(t) { return ['line', 'rect', 'circle', 'ellipse', 'arc', 'polyline', 'spline', 'splinetan', 'move', 'copy', 'mirror', 'measure', 'offset', 'rotate', 'scale', 'align', 'array', 'stretch', 'fillet', 'chamfer', 'extend', 'break', 'point', 'xline', 'polygon', 'dim', 'origin', 'zoom', 'area', 'layer', 'matchprop', 'explode', 'reverse'].indexOf(t) >= 0; }
  // =====================================================================
  //  Erweiterte 2D-Befehle: Drehen, Skalieren, Ausrichten, Reihe, Strecken,
  //  Abrunden, Fasen, Dehnen, Bruch, Punkt, Hilfslinie, Polygon, Bemaßung,
  //  Ursprung, Zoom, Auswahl-Helfer, Fläche, Layer ändern, Eigenschaften
  //  angleichen, Umkehren, Auflösen. Alle laufen über cadSetTool/cadToolPoint.
  // =====================================================================
  const CAD_NOEXPORT = { 'Hilfslinien': true };   // Hilfslayer: nie in DXF/Formen exportieren
  const D2R = Math.PI / 180;
  function cadIsCircle(loop) {   // kreisförmige geschlossene Kontur -> {x,y,r} sonst null
    if (!loop.closed || loop.length < 8) return null;
    const c = cadEntityCenter(loop); if (!c) return null;
    let r = 0; loop.forEach(p => { r += Math.hypot(p.x - c.x, p.y - c.y); }); r /= loop.length;
    for (const p of loop) if (Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r) > r * 0.01 + 1e-6) return null;
    return { x: c.x, y: c.y, r };
  }
  const cadRot = (base, a) => { const c = Math.cos(a), s = Math.sin(a); return p => ({ x: base.x + (p.x - base.x) * c - (p.y - base.y) * s, y: base.y + (p.x - base.x) * s + (p.y - base.y) * c }); };
  const cadRotVec = a => { const c = Math.cos(a), s = Math.sin(a); return v => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c }); };
  const cadScl = (base, k) => p => ({ x: base.x + (p.x - base.x) * k, y: base.y + (p.y - base.y) * k });
  const cadAng = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const cadDist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  // Auswahl transformieren. fn(p) für Punkte, lin(v) für Richtungsvektoren (optional),
  // copy = Kopien anlegen, extra(text) für Textattribute. Liefert die neuen Referenzen.
  function cadTransformSelection(fn, lin, copy, extra) {
    const d = state.cad, ed = d.edit, out = [];
    ed.sel.forEach(s => {
      if (s.tx != null) {
        const t = d.texts[s.tx]; if (!t) return; const q = fn({ x: t.x, y: t.y }), nt = Object.assign({}, t, { x: q.x, y: q.y }); if (extra) extra(nt);
        if (copy) { d.texts.push(nt); out.push({ tx: d.texts.length - 1 }); } else { Object.assign(t, nt); out.push(s); } return;
      }
      const loop = cadLoopOf(s); if (!loop) return;
      const tgt = copy ? cadCloneLoop(loop) : loop;
      tgt.forEach(p => { const q = fn(p); p.x = q.x; p.y = q.y; });
      if (tgt.ctrl) tgt.ctrl.forEach(p => { const q = fn(p); p.x = q.x; p.y = q.y; });
      if (lin) { if (tgt.startTan) tgt.startTan = lin(tgt.startTan); if (tgt.endTan) tgt.endTan = lin(tgt.endTan); }
      if (copy) { cadAddEntity(s.layer, tgt); out.push({ layer: s.layer, idx: d.layers[s.layer].length - 1 }); } else out.push(s);
    });
    return out;
  }
  function cadSelCentroid() { let n = 0, sx = 0, sy = 0; state.cad.edit.sel.forEach(s => { if (s.tx != null) { const t = state.cad.texts[s.tx]; if (t) { sx += t.x; sy += t.y; n++; } return; } const l = cadLoopOf(s); if (l) l.forEach(p => { sx += p.x; sy += p.y; n++; }); }); return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 }; }
  function cadSelBounds() { const arrs = []; state.cad.edit.sel.forEach(s => { if (s.tx != null) { const t = state.cad.texts[s.tx]; if (t) arrs.push([{ x: t.x, y: t.y }]); return; } const l = cadLoopOf(s); if (l) arrs.push(l); }); return arrs.length ? App.bounds.apply(null, arrs) : null; }
  // Vorschau: gewählte Konturen transformiert (gestrichelt) zeichnen.
  function cadPreviewSel(ctx, V, fn) {
    ctx.save(); ctx.strokeStyle = '#57d38c'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.3;
    state.cad.edit.sel.forEach(s => { const l = cadLoopOf(s); if (!l) return; ctx.beginPath(); l.forEach((p, i) => { const q = fn(p); i ? ctx.lineTo(V.X(q.x), V.Y(q.y)) : ctx.moveTo(V.X(q.x), V.Y(q.y)); }); if (l.closed) ctx.closePath(); ctx.stroke(); });
    ctx.restore();
  }
  // --- Drehen / Skalieren / Ausrichten ---
  function cadFinishRotate(a) {
    const ed = state.cad.edit, dr = ed.draft; cadPushUndo();
    const res = cadTransformSelection(cadRot(dr.base, a), cadRotVec(a), dr.copy, t => { t.rot = ((t.rot || 0) + a / D2R) % 360; });
    cadLog(ed.sel.length + T(' Objekt(e) gedreht um ') + (a / D2R).toFixed(2) + '°' + (dr.copy ? T(' (Kopie)') : '') + '.');
    ed.sel = res; cadSetTool('select', true); cadAfterEdit();
  }
  function cadFinishScale(k) {
    const ed = state.cad.edit, dr = ed.draft; if (!(k > 1e-9)) { cadFlash('Faktor muss größer als 0 sein.'); return; } cadPushUndo();
    const res = cadTransformSelection(cadScl(dr.base, k), null, dr.copy, t => { t.h = (t.h || 3) * k; });
    cadLog(ed.sel.length + T(' Objekt(e) skaliert mit Faktor ') + k.toFixed(4) + (dr.copy ? T(' (Kopie)') : '') + '.');
    ed.sel = res; cadSetTool('select', true); cadAfterEdit();
  }
  function cadFinishAlign(withScale) {
    const ed = state.cad.edit, dr = ed.draft; if (!dr.s1 || !dr.t1) return;
    let fn, lin = null;
    if (dr.s2 && dr.t2) {
      const a = cadAng(dr.t1, dr.t2) - cadAng(dr.s1, dr.s2), k = withScale ? cadDist(dr.t1, dr.t2) / Math.max(1e-9, cadDist(dr.s1, dr.s2)) : 1;
      const R = cadRot({ x: 0, y: 0 }, a); lin = cadRotVec(a);
      fn = p => { const v = R({ x: p.x - dr.s1.x, y: p.y - dr.s1.y }); return { x: dr.t1.x + v.x * k, y: dr.t1.y + v.y * k }; };
    } else fn = p => ({ x: p.x + dr.t1.x - dr.s1.x, y: p.y + dr.t1.y - dr.s1.y });
    cadPushUndo(); const res = cadTransformSelection(fn, lin, false);
    cadLog(ed.sel.length + T(' Objekt(e) ausgerichtet.')); ed.sel = res; cadSetTool('select', true); cadAfterEdit();
  }
  // --- Reihe ---
  function cadFinishArrayRect() {
    const ed = state.cad.edit, dr = ed.draft, rows = Math.max(1, Math.round(dr.rows)), cols = Math.max(1, Math.round(dr.cols));
    cadPushUndo(); const base = ed.sel.slice(); let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { if (!r && !c) continue; ed.sel = base; cadTransformSelection(p => ({ x: p.x + c * dr.dx, y: p.y + r * dr.dy }), null, true); n++; }
    ed.sel = []; cadLog(T('Reihe: ') + rows + ' × ' + cols + T(' (') + n * base.length + T(' Kopien).')); cadSetTool('select', true); cadAfterEdit();
  }
  function cadFinishArrayPolar(rotateItems) {
    const ed = state.cad.edit, dr = ed.draft, n = Math.max(2, Math.round(dr.count)), fill = dr.fill || 360;
    cadPushUndo(); const base = ed.sel.slice(), c0 = cadSelCentroid();
    for (let k = 1; k < n; k++) {
      const a = (Math.abs(fill) >= 360 ? 360 * k / n : fill * k / (n - 1)) * D2R;
      ed.sel = base;
      if (rotateItems) cadTransformSelection(cadRot(dr.center, a), cadRotVec(a), true, t => { t.rot = ((t.rot || 0) + a / D2R) % 360; });
      else { const q = cadRot(dr.center, a)(c0); cadTransformSelection(p => ({ x: p.x + q.x - c0.x, y: p.y + q.y - c0.y }), null, true); }
    }
    ed.sel = []; cadLog(T('Polare Reihe: ') + n + T(' Elemente über ') + fill + '°.'); cadSetTool('select', true); cadAfterEdit();
  }
  // --- Strecken: Punkte im Kreuzen-Fenster erfassen, dann verschieben ---
  function cadStretchCollect(p0, p1) {
    const x0 = Math.min(p0.x, p1.x), x1 = Math.max(p0.x, p1.x), y0 = Math.min(p0.y, p1.y), y1 = Math.max(p0.y, p1.y);
    const inBox = p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    const verts = [], sel = [];
    cadEntities().forEach(e => {
      if (!cadVisible(e.layer)) return;
      const src = e.loop.ctrl || e.loop; let any = false;
      src.forEach((p, vi) => { if (inBox(p)) { verts.push({ layer: e.layer, idx: e.idx, vi, ctrl: !!e.loop.ctrl }); any = true; } });
      if (any) sel.push({ layer: e.layer, idx: e.idx });
    });
    (state.cad.texts || []).forEach((t, i) => { if (cadVisible(t.layer) && inBox({ x: t.x, y: t.y })) { verts.push({ tx: i }); sel.push({ tx: i }); } });
    return { verts, sel };
  }
  function cadFinishStretch(dx, dy) {
    const ed = state.cad.edit, dr = ed.draft; cadPushUndo(); const touched = {};
    dr.verts.forEach(v => {
      if (v.tx != null) { const t = state.cad.texts[v.tx]; if (t) { t.x += dx; t.y += dy; } return; }
      const loop = cadLoopOf(v); if (!loop) return; const src = v.ctrl ? loop.ctrl : loop; const p = src[v.vi]; if (!p) return; p.x += dx; p.y += dy;
      if (v.ctrl) touched[v.layer + ':' + v.idx] = loop;
    });
    Object.keys(touched).forEach(k => cadRebuildCurve(touched[k]));
    cadLog(dr.verts.length + T(' Punkt(e) gestreckt.')); cadSetTool('select', true); cadAfterEdit();
  }
  // --- Abrunden / Fasen ---
  // Ende eines gepickten Segments bestimmen, das zur Ecke hin verändert wird.
  // Liefert {loop, endIdx, other} oder null (kein freies Ende).
  function cadCornerEnd(h, X, click) {
    const loop = cadLoopOf(h); if (!loop) return null; const n = loop.length, a = loop[h.seg], b = loop[(h.seg + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12;
    const tX = ((X.x - a.x) * dx + (X.y - a.y) * dy) / L2, tC = ((click.x - a.x) * dx + (click.y - a.y) * dy) / L2;
    const useB = tX >= tC;   // Ecke liegt jenseits von b -> b wird ersetzt, sonst a
    const endIdx = useB ? (h.seg + 1) % n : h.seg, otherIdx = useB ? h.seg : (h.seg + 1) % n;
    if (loop.closed || (endIdx !== 0 && endIdx !== n - 1)) return null;   // nur freie Enden offener Züge
    return { loop, endIdx, other: loop[otherIdx] };
  }
  function cadArcPts(C, r, a0, a1) {   // Bogenpunkte von Winkel a0 nach a1 (kürzester Weg)
    let sw = a1 - a0; while (sw > Math.PI) sw -= 2 * Math.PI; while (sw < -Math.PI) sw += 2 * Math.PI;
    const steps = Math.max(3, Math.round((state.cad.edit.arcPoints || 48) * Math.abs(sw) / (2 * Math.PI))), pts = [];
    for (let k = 0; k <= steps; k++) { const a = a0 + sw * k / steps; pts.push({ x: C.x + r * Math.cos(a), y: C.y + r * Math.sin(a) }); }
    return pts;
  }
  // Ecke aus zwei Richtungen u, w ab X: liefert {T1, T2, mid} (mid = Bogen- oder Fasenpunkte ohne T1/T2).
  function cadCornerGeom(X, u, w, kind, r, d1, d2) {
    const phi = Math.acos(Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y)));
    if (phi < 1e-6 || Math.abs(phi - Math.PI) < 1e-6) return null;   // parallel
    if (kind === 'chamfer') return { T1: { x: X.x + u.x * d1, y: X.y + u.y * d1 }, T2: { x: X.x + w.x * d2, y: X.y + w.y * d2 }, mid: [], d1, d2 };
    if (r <= 1e-9) return { T1: { x: X.x, y: X.y }, T2: { x: X.x, y: X.y }, mid: [], d1: 0, d2: 0, zero: true };
    const d = r / Math.tan(phi / 2), T1 = { x: X.x + u.x * d, y: X.y + u.y * d }, T2 = { x: X.x + w.x * d, y: X.y + w.y * d };
    const bl = Math.hypot(u.x + w.x, u.y + w.y), bis = { x: (u.x + w.x) / bl, y: (u.y + w.y) / bl }, cd = r / Math.sin(phi / 2);
    const C = { x: X.x + bis.x * cd, y: X.y + bis.y * cd };
    const arc = cadArcPts(C, r, cadAng(C, T1), cadAng(C, T2));
    return { T1, T2, mid: arc.slice(1, -1), d1: d, d2: d };
  }
  function cadDoCorner(hA, hB, clickB) {
    const ed = state.cad.edit, dr = ed.draft, kind = dr.type, r = ed.filletR || 0, d1 = ed.chamferD1 || 0, d2 = ed.chamferD2 || 0;
    const LA = cadLoopOf(hA), LB = cadLoopOf(hB); if (!LA || !LB) return false;
    const nA = LA.length, nB = LB.length;
    // Fall 1: Ecke innerhalb eines Zuges (benachbarte Segmente).
    if (hA.layer === hB.layer && hA.idx === hB.idx) {
      const adj = (i, j) => Math.abs(i - j) === 1 || (LA.closed && Math.abs(i - j) === nA - 1);
      if (hA.seg === hB.seg) { cadFlash('Zwei verschiedene Segmente wählen.'); return false; }
      if (!adj(hA.seg, hB.seg)) { cadFlash('Segmente müssen an einer Ecke zusammenstoßen.'); return false; }
      const first = (hA.seg < hB.seg && !(LA.closed && hB.seg === nA - 1 && hA.seg === 0)) || (LA.closed && hA.seg === nA - 1 && hB.seg === 0);
      const segPrev = first ? hA.seg : hB.seg, vi = (segPrev + 1) % nA, v = LA[vi], P = LA[segPrev], N = LA[(vi + 1) % nA];
      const lu = cadDist(v, P), lw = cadDist(v, N), u = { x: (P.x - v.x) / lu, y: (P.y - v.y) / lu }, w = { x: (N.x - v.x) / lw, y: (N.y - v.y) / lw };
      const g = cadCornerGeom(v, u, w, kind, r, first ? d1 : d2, first ? d2 : d1); if (!g) { cadFlash('Segmente sind parallel.'); return false; }
      if (g.d1 > lu + 1e-9 || g.d2 > lw + 1e-9) { cadFlash(kind === 'fillet' ? 'Radius zu groß für diese Ecke.' : 'Fasenabstand zu groß für diese Ecke.'); return false; }
      cadPushUndo(); const ins = g.zero ? [] : [g.T1].concat(g.mid, [g.T2]);
      LA.splice(vi, 1, ...ins); if (LA.ctrl) { delete LA.ctrl; delete LA.ctype; }
      return true;
    }
    // Fall 2: zwei Züge -> Schnittpunkt der Geraden, freie Enden anpassen, Bogen/Fase als neues Objekt.
    const a0 = LA[hA.seg], a1 = LA[(hA.seg + 1) % nA], b0 = LB[hB.seg], b1 = LB[(hB.seg + 1) % nB];
    const den = (a0.x - a1.x) * (b0.y - b1.y) - (a0.y - a1.y) * (b0.x - b1.x); if (Math.abs(den) < 1e-12) { cadFlash('Objekte sind parallel.'); return false; }
    const tt = ((a0.x - b0.x) * (b0.y - b1.y) - (a0.y - b0.y) * (b0.x - b1.x)) / den, X = { x: a0.x + tt * (a1.x - a0.x), y: a0.y + tt * (a1.y - a0.y) };
    const eA = cadCornerEnd(hA, X, dr.clickA), eB = cadCornerEnd(hB, X, clickB);
    if (!eA || !eB) { cadFlash('Beide Objekte müssen an der Ecke ein freies Ende haben (offene Linie/Polylinie).'); return false; }
    const lu = cadDist(X, eA.other), lw = cadDist(X, eB.other);
    const u = { x: (eA.other.x - X.x) / lu, y: (eA.other.y - X.y) / lu }, w = { x: (eB.other.x - X.x) / lw, y: (eB.other.y - X.y) / lw };
    const g = cadCornerGeom(X, u, w, kind, r, d1, d2); if (!g) { cadFlash('Objekte sind parallel.'); return false; }
    if (g.d1 > lu + 1e-9 || g.d2 > lw + 1e-9) { cadFlash(kind === 'fillet' ? 'Radius zu groß.' : 'Fasenabstand zu groß.'); return false; }
    cadPushUndo();
    eA.loop[eA.endIdx] = { x: g.T1.x, y: g.T1.y }; eB.loop[eB.endIdx] = { x: g.T2.x, y: g.T2.y };
    if (eA.loop.ctrl) { delete eA.loop.ctrl; delete eA.loop.ctype; } if (eB.loop.ctrl) { delete eB.loop.ctrl; delete eB.loop.ctype; }
    if (!g.zero) cadAddEntity(hA.layer, App.mkLoopLocal([g.T1].concat(g.mid, [g.T2]), false));
    return true;
  }
  // --- Dehnen: Ende einer offenen Kontur bis zur nächsten Kontur verlängern ---
  function cadExtendAt(wpt) {
    const h = cadHitEntity(wpt, 10); if (!h) { cadFlash('Keine Kontur getroffen.'); return; }
    const loop = cadLoopOf(h); if (!loop || loop.closed || loop.length < 2) { cadFlash('Nur offene Linien/Polylinien lassen sich dehnen.'); return; }
    const n = loop.length, atEnd = cadDist(wpt, loop[n - 1]) <= cadDist(wpt, loop[0]);
    const E = atEnd ? loop[n - 1] : loop[0], P = atEnd ? loop[n - 2] : loop[1], L = cadDist(P, E); if (L < 1e-9) return;
    const d = { x: (E.x - P.x) / L, y: (E.y - P.y) / L }; let best = null;
    cadEntities().forEach(e => {
      if (!cadVisible(e.layer) || (e.layer === h.layer && e.idx === h.idx)) return;
      const m = e.loop.length, last = e.loop.closed ? m : m - 1;
      for (let j = 0; j < last; j++) {
        const a = e.loop[j], b = e.loop[(j + 1) % m], sx = b.x - a.x, sy = b.y - a.y, den = d.x * sy - d.y * sx; if (Math.abs(den) < 1e-12) continue;
        const qx = a.x - E.x, qy = a.y - E.y, t = (qx * sy - qy * sx) / den, s = (qx * d.y - qy * d.x) / den;
        if (t > 1e-6 && s >= -1e-9 && s <= 1 + 1e-9 && (!best || t < best.t)) best = { t };
      }
    });
    if (!best) { cadFlash('Keine Kontur in Verlängerung gefunden.'); return; }
    cadPushUndo(); E.x += d.x * best.t; E.y += d.y * best.t; if (loop.ctrl) { delete loop.ctrl; delete loop.ctype; }
    cadLog(T('Gedehnt um ') + best.t.toFixed(2) + ' mm.'); cadAfterEdit();
  }
  // --- Bruch ---
  function cadBreakApply(pos2) {
    const ed = state.cad.edit, dr = ed.draft, loop = cadLoopOf(dr.ref); if (!loop) return;
    const n = loop.length, last = loop.closed ? n : n - 1, arr = state.cad.layers[dr.ref.layer], p1 = dr.pos1;
    const split = pos2 == null || Math.abs(pos2 - p1) < 1e-6;
    cadPushUndo();
    if (loop.closed) {
      let keep;
      if (split) keep = cadLoopSub(loop, p1, p1 + n);
      else {   // das kürzere Teilstück zwischen den Bruchpunkten fällt weg
        const A = cadLoopSub(loop, pos2, p1 < pos2 ? p1 + n : p1), B = cadLoopSub(loop, p1, pos2 < p1 ? pos2 + n : pos2);
        const len = L => { let t = 0; for (let i = 1; i < L.length; i++) t += cadDist(L[i - 1], L[i]); return t; };
        keep = len(A) >= len(B) ? A : B;
      }
      arr[dr.ref.idx] = App.mkLoopLocal(keep, false);
      cadLog(split ? T('Kontur an dieser Stelle geöffnet.') : T('Teilstück entfernt.'));
    } else {
      const lo = split ? p1 : Math.min(p1, pos2), hi = split ? p1 : Math.max(p1, pos2), parts = [];
      const a = cadLoopSub(loop, 0, lo), b = cadLoopSub(loop, hi, last);
      if (a.length >= 2 && cadDist(a[0], a[a.length - 1]) > 1e-9) parts.push(App.mkLoopLocal(a, false));
      if (b.length >= 2 && cadDist(b[0], b[b.length - 1]) > 1e-9) parts.push(App.mkLoopLocal(b, false));
      arr.splice(dr.ref.idx, 1, ...parts);
      cadLog(split ? T('Kontur geteilt (') + parts.length + T(' Teile).') : T('Teilstück entfernt (') + parts.length + T(' Teile).'));
    }
    ed.sel = []; dr.ref = null; dr.phase = 'obj'; cadAfterEdit();
  }
  // --- Punkt / Hilfslinie / Polygon / Bemaßung ---
  function cadAddPoint(p) { const l = App.mkLoopLocal([p], false); l.pt = true; cadPushUndo(); cadAddEntity(cadDefaultLayer(), l); cadLog(T('Punkt ') + p.x.toFixed(2) + ', ' + p.y.toFixed(2)); cadAfterEdit(); }
  function cadAddXline(p, ang) {
    const d = state.cad, L = 10000, c = Math.cos(ang), s = Math.sin(ang), fresh = !d.layers['Hilfslinien'];
    cadPushUndo(); cadEnsureLayer('Hilfslinien'); if (fresh) { d.lineStyles['Hilfslinien'] = 'dashdot'; d.layerColors['Hilfslinien'] = '#8b98a8'; }
    cadAddEntity('Hilfslinien', App.mkLoopLocal([{ x: p.x - c * L, y: p.y - s * L }, { x: p.x + c * L, y: p.y + s * L }], false));
    cadLog(T('Hilfslinie ') + ((ang / D2R + 360) % 180).toFixed(1) + '°'); cadAfterEdit();
  }
  function cadMakePolygon(center, n, R0, circum, a0) {
    const R = circum ? R0 / Math.cos(Math.PI / n) : R0, start = circum ? a0 + Math.PI / n : a0, pts = [];
    for (let k = 0; k < n; k++) { const a = start + 2 * Math.PI * k / n; pts.push({ x: center.x + R * Math.cos(a), y: center.y + R * Math.sin(a) }); }
    return App.mkLoopLocal(pts, true);
  }
  function cadAddDim(p1, p2, pos) {
    const d = state.cad, L = cadDist(p1, p2); let rot = cadAng(p1, p2) / D2R; if (rot > 90 || rot <= -90) rot += 180;
    cadPushUndo(); cadEnsureLayer('Bemaßung'); if (!d.texts) d.texts = [];
    d.texts.push({ x: pos.x, y: pos.y, h: d.edit.dimH || 3, text: L.toFixed(2), rot: rot % 360, layer: 'Bemaßung' });
    cadLog(T('Maß ') + L.toFixed(2) + ' mm'); cadAfterEdit();
  }
  // --- Ursprung verschieben (alles um -p) ---
  function cadSetOrigin(p) {
    const d = state.cad; cadPushUndo();
    cadEntities().forEach(e => { e.loop.forEach(q => { q.x -= p.x; q.y -= p.y; }); if (e.loop.ctrl) e.loop.ctrl.forEach(q => { q.x -= p.x; q.y -= p.y; }); });
    (d.texts || []).forEach(t => { t.x -= p.x; t.y -= p.y; });
    if (d.view) { d.view.minx -= p.x; d.view.maxx -= p.x; d.view.miny -= p.y; d.view.maxy -= p.y; }
    cadLog(T('Ursprung verschoben nach ') + p.x.toFixed(2) + ', ' + p.y.toFixed(2)); cadSetTool('select', true); cadAfterEdit();
  }
  // --- Zoom ---
  function cadZoomTo(b) { if (!b) return; const ed = state.cad.edit; ed.prevView = state.cad.view ? Object.assign({}, state.cad.view) : null; ed.prevNav = App.nav.cad ? Object.assign({}, App.nav.cad) : null; const pad = Math.max(1, (b.maxx - b.minx + b.maxy - b.miny) * 0.02); state.cad.view = { minx: b.minx - pad, maxx: b.maxx + pad, miny: b.miny - pad, maxy: b.maxy + pad }; if (App.nav.cad) { App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; } renderCad(); }
  function cadZoomAll() { const ed = state.cad.edit; ed.prevView = state.cad.view ? Object.assign({}, state.cad.view) : null; ed.prevNav = App.nav.cad ? Object.assign({}, App.nav.cad) : null; cadFitView(); cadLog(T('Zoom: Alles')); }
  function cadZoomSel() { const b = cadSelBounds(); if (!b) { cadFlash('Nichts gewählt.'); return; } cadZoomTo(b); cadLog(T('Zoom: Auswahl')); }
  function cadZoomPrev() { const ed = state.cad.edit; if (!ed.prevView) { cadFlash('Keine vorherige Ansicht.'); return; } const v = ed.prevView, nv = ed.prevNav; ed.prevView = state.cad.view ? Object.assign({}, state.cad.view) : null; ed.prevNav = App.nav.cad ? Object.assign({}, App.nav.cad) : null; state.cad.view = v; if (App.nav.cad && nv) Object.assign(App.nav.cad, nv); renderCad(); cadLog(T('Zoom: vorherige Ansicht')); }
  // --- Auswahl-Helfer ---
  function cadSelectAll() { const ed = state.cad.edit; ed.sel = cadEntities().filter(e => cadVisible(e.layer)).map(e => ({ layer: e.layer, idx: e.idx })).concat((state.cad.texts || []).map((t, i) => cadVisible(t.layer) ? { tx: i } : null).filter(Boolean)); cadLog(ed.sel.length + T(' gefunden')); App.buildSidebar(); renderCad(); }
  function cadSelectPrev() { const ed = state.cad.edit; if (!ed.prevSel || !ed.prevSel.length) { cadFlash('Keine vorherige Auswahl.'); return; } ed.sel = ed.prevSel.filter(s => s.tx != null ? !!(state.cad.texts || [])[s.tx] : !!cadLoopOf(s)); cadLog(ed.sel.length + T(' gefunden')); App.buildSidebar(); renderCad(); }
  function cadSelectSimilar() {
    const ed = state.cad.edit; if (!ed.sel.length) { cadFlash('Erst ein Objekt wählen.'); return; }
    const keys = {}; ed.sel.forEach(s => { if (s.tx != null) { const t = state.cad.texts[s.tx]; if (t) keys['T:' + t.layer] = 1; return; } const l = cadLoopOf(s); if (l) keys[s.layer + ':' + (l.pt ? 'p' : l.ctype ? 's' : l.closed ? 'c' : 'o')] = 1; });
    ed.sel = cadEntities().filter(e => cadVisible(e.layer) && keys[e.layer + ':' + (e.loop.pt ? 'p' : e.loop.ctype ? 's' : e.loop.closed ? 'c' : 'o')]).map(e => ({ layer: e.layer, idx: e.idx }))
      .concat((state.cad.texts || []).map((t, i) => cadVisible(t.layer) && keys['T:' + t.layer] ? { tx: i } : null).filter(Boolean));
    cadLog(ed.sel.length + T(' gefunden')); App.buildSidebar(); renderCad();
  }
  // --- Fläche / Umfang ---
  function cadAreaAt(wpt) {
    const h = cadHitEntity(wpt, 10); if (!h) { cadFlash('Keine Kontur getroffen.'); return; }
    const loop = cadLoopOf(h), n = loop.length, last = loop.closed ? n : n - 1; let per = 0;
    for (let i = 0; i < last; i++) per += cadDist(loop[i], loop[(i + 1) % n]);
    let msg;
    if (loop.closed) { const A = Math.abs(App.polyArea(loop)); msg = T('Fläche ') + A.toFixed(2) + ' mm² · ' + T('Umfang ') + per.toFixed(2) + ' mm'; }
    else msg = T('Länge ') + per.toFixed(2) + ' mm' + T(' (offen, ') + n + T(' Punkte)');
    state.cad.edit.sel = [{ layer: h.layer, idx: h.idx }]; cadLog(msg); cadFlash(msg); App.buildSidebar(); renderCad();
  }
  // --- Layer ändern / Eigenschaften angleichen ---
  // keepSel: Auswahl nach dem Verschieben beibehalten (Klick auf Layer in der Seitenleiste).
  function cadMoveSelToLayer(name, keepSel) {
    const d = state.cad, ed = d.edit; name = String(name || '').trim(); if (!name) return;
    cadPushUndo(); cadEnsureLayer(name);
    const loops = ed.sel.filter(s => s.layer != null && s.layer !== name).sort((a, b) => b.idx - a.idx);
    const moved = []; loops.forEach(s => { const l = d.layers[s.layer] && d.layers[s.layer].splice(s.idx, 1)[0]; if (l) moved.push(l); });
    moved.reverse().forEach(l => cadAddEntity(name, l));
    const texts = ed.sel.filter(s => s.tx != null && d.texts[s.tx]);
    texts.forEach(s => { d.texts[s.tx].layer = name; });
    const n = moved.length + texts.length;
    // Neue Referenzen: verschobene Loops liegen jetzt am Ende des Ziellayers.
    const base = d.layers[name].length - moved.length;
    ed.sel = keepSel ? moved.map((l, i) => ({ layer: name, idx: base + i })).concat(texts.map(s => ({ tx: s.tx }))) : [];
    cadLog(n + T(' Objekt(e) auf Layer „') + name + T('" gelegt.'));
    if (!keepSel) cadSetTool('select', true);
    cadAfterEdit();
  }
  // --- Umkehren / Auflösen ---
  function cadReverseSelection() {
    const ed = state.cad.edit; if (!ed.sel.length) return; cadPushUndo(); let n = 0;
    ed.sel.forEach(s => { const l = cadLoopOf(s); if (!l || l.pt) return; l.reverse(); if (l.ctrl) l.ctrl.reverse(); const st = l.startTan, en = l.endTan; if (st || en) { l.startTan = en ? { x: -en.x, y: -en.y } : null; l.endTan = st ? { x: -st.x, y: -st.y } : null; } n++; });
    cadLog(n + T(' Kontur(en) umgekehrt.')); cadSetTool('select', true); cadAfterEdit();
  }
  function cadExplodeSelection() {
    const d = state.cad, ed = d.edit; if (!ed.sel.length) return; cadPushUndo(); let n = 0; const out = [];
    ed.sel.filter(s => s.layer != null).sort((a, b) => b.idx - a.idx).forEach(s => {
      const l = cadLoopOf(s); if (!l || l.pt || l.length < 2) return; const m = l.length, last = l.closed ? m : m - 1;
      d.layers[s.layer].splice(s.idx, 1);
      for (let i = 0; i < last; i++) { cadAddEntity(s.layer, App.mkLoopLocal([l[i], l[(i + 1) % m]], false)); out.push({ layer: s.layer, idx: d.layers[s.layer].length - 1 }); n++; }
    });
    ed.sel = out; cadLog(T('Aufgelöst in ') + n + T(' Linien.')); cadSetTool('select', true); cadAfterEdit();
  }
  // Nach der Objektwahl (Enter) in die nächste Phase des Befehls wechseln.
  function cadAfterSelect() {
    const ed = state.cad.edit, dr = ed.draft; if (!dr) return;
    switch (dr.type) {
      case 'erase': cadEraseSelection(); return;
      case 'mirror': dr.phase = 'p1'; break;
      case 'move': case 'rotate': case 'scale': dr.phase = 'base'; break;
      case 'align': dr.phase = 's1'; break;
      case 'array': dr.phase = 'type'; break;
      case 'layer': dr.phase = 'target'; break;
      case 'matchprop': cadMoveSelToLayer(dr.srcLayer); return;
      case 'explode': cadExplodeSelection(); return;
      case 'reverse': cadReverseSelection(); return;
      default: dr.phase = 'base';
    }
    App.buildSidebar(); renderCad();
  }
  // Direktaktionen (keine Werkzeuge) für Werkzeugleiste und Befehlszeile.
  const CAD_ACTIONS = {
    join: cadJoinSelection, selall: cadSelectAll, selprev: cadSelectPrev, selsim: cadSelectSimilar,
    zoomall: cadZoomAll, zoomobj: cadZoomSel, zoomprev: cadZoomPrev, undo: cadUndo, redo: cadRedo,
    snap: () => { const ed = state.cad.edit; ed.snap = !ed.snap; cadFlash('Objektfang ' + (ed.snap ? 'AN' : 'AUS')); App.buildSidebar(); renderCad(); },
    ortho: () => { const ed = state.cad.edit; ed.ortho = !ed.ortho; cadFlash('Ortho ' + (ed.ortho ? 'AN' : 'AUS')); App.buildSidebar(); renderCad(); }
  };
  // Werkzeugleiste (horizontal über der Zeichenfläche), gruppiert.
  const CAD_TOOLBAR = [
    ['Zeichnen', [['line', 'Linie'], ['polyline', 'Polylinie'], ['spline', 'Spline'], ['splinetan', 'Spline tangential'], ['arc', 'Kreisbogen'], ['circle', 'Kreis'], ['rect', 'Rechteck'], ['polygon', 'Polygon'], ['ellipse', 'Ellipse'], ['point', 'Punkt'], ['xline', 'Hilfslinie'], ['dim', 'Bemaßung']]],
    ['Ändern', [['move', 'Verschieben'], ['copy', 'Kopieren'], ['rotate', 'Drehen'], ['scale', 'Skalieren'], ['mirror', 'Spiegeln'], ['offset', 'Versetzen'], ['array', 'Reihe'], ['stretch', 'Strecken'], ['align', 'Ausrichten'], ['origin', 'Ursprung setzen']]],
    ['Bearbeiten', [['trim', 'Trimmen'], ['extend', 'Dehnen'], ['fillet', 'Abrunden'], ['chamfer', 'Fasen'], ['break', 'Bruch'], ['join', 'Verbinden'], ['explode', 'Auflösen'], ['reverse', 'Umkehren'], ['vertex', 'Punkt verschieben'], ['delpt', 'Punkt löschen'], ['erase', 'Löschen'], ['layer', 'Layer ändern'], ['matchprop', 'Eigenschaften angleichen']]],
    ['Auswahl · Messen', [['select', 'Auswählen'], ['selall', 'Alles wählen'], ['selprev', 'Vorherige Auswahl'], ['selsim', 'Ähnliche wählen'], ['measure', 'Messen'], ['area', 'Fläche/Umfang']]],
    ['Ansicht', [['zoomall', 'Zoom Alles'], ['zoomwin', 'Zoom Fenster'], ['zoomobj', 'Zoom Auswahl'], ['zoomprev', 'Zoom zurück']]],
    ['', [['undo', 'Rückgängig (Strg+Z)'], ['redo', 'Wiederholen (Strg+Y)'], ['snap', 'Objektfang (F3)'], ['ortho', 'Ortho (F8)']]]
  ];
  function cadBuildToolbar() {
    const el = document.getElementById('cadToolbar'); if (!el) return;
    const d = state.cad, ed = d.edit; el.innerHTML = '';
    CAD_TOOLBAR.forEach(([cap, items]) => {
      const g = document.createElement('div'); g.className = 'cadTbGroup';
      const bs = document.createElement('div'); bs.className = 'cadTbBtns'; bs.style.gridTemplateRows = 'repeat(2, 27px)';
      items.forEach(([id, label]) => {
        const b = document.createElement('button'); b.className = 'cadTbBtn'; const ic = CAD_ICON[id];
        if (ic && ic.indexOf('<svg') === 0) b.innerHTML = ic; else b.textContent = ic || T(label).slice(0, 2);
        const al = CAD_ALIASES_REV[id]; b.title = T(label) + (al ? '  (' + al + ')' : '');
        const act = CAD_ACTIONS[id];
        const on = act ? ((id === 'snap' && ed.snap) || (id === 'ortho' && ed.ortho)) : ed.tool === id;
        if (on) b.classList.add('on');
        if (id === 'undo') b.disabled = !d.undo.length; if (id === 'redo') b.disabled = !d.redo.length;
        if (id === 'join') b.disabled = ed.sel.length < 2; if (id === 'zoomobj' || id === 'selsim') b.disabled = !ed.sel.length;
        b.onclick = () => { if (act) act(); else cadSetTool(id); const inp = document.getElementById('cadCoordInput'); if (inp) inp.focus(); };
        bs.appendChild(b);
      });
      const c = document.createElement('div'); c.className = 'cadTbCap'; c.textContent = T(cap || 'Allgemein');
      g.appendChild(c); g.appendChild(bs);
      el.appendChild(g);
    });
  }
  // Zahleingabe für die erweiterten Befehle (Phase/Abfrage des laufenden Drafts).
  // true = verbraucht.
  function cadNumInput(dr, num) {
    const ed = state.cad.edit, t = dr.type;
    if (t === 'rotate') {
      if (dr.phase === 'angle') { cadFinishRotate(num * D2R); return true; }
      if (dr.phase === 'refnew') { cadFinishRotate(num * D2R - cadAng(dr.r1, dr.r2)); return true; }
    }
    if (t === 'scale') {
      if (dr.phase === 'factor') { cadFinishScale(num); return true; }
      if (dr.phase === 'ref2') { dr.refLen = num; dr.phase = 'refnew'; renderCad(); return true; }
      if (dr.phase === 'refnew') { const rl = dr.refLen || cadDist(dr.r1, dr.r2); if (!(rl > 1e-9)) { cadFlash('Referenzlänge ist 0.'); return true; } cadFinishScale(num / rl); return true; }
    }
    if (t === 'array') {
      if (dr.ask === 'rows') { dr.rows = ed.arrRows = Math.max(1, Math.round(num)); dr.ask = 'cols'; renderCad(); return true; }
      if (dr.ask === 'cols') { dr.cols = ed.arrCols = Math.max(1, Math.round(num)); dr.ask = 'dy'; renderCad(); return true; }
      if (dr.ask === 'dy') { dr.dy = ed.arrDy = num; dr.ask = 'dx'; renderCad(); return true; }
      if (dr.ask === 'dx') { dr.dx = ed.arrDx = num; dr.ask = null; cadFinishArrayRect(); return true; }
      if (dr.ask === 'count') { dr.count = ed.arrN = Math.max(2, Math.round(num)); dr.ask = 'fill'; renderCad(); return true; }
      if (dr.ask === 'fill') { dr.fill = ed.arrFill = num; dr.ask = null; dr.phase = 'prot'; renderCad(); return true; }
    }
    if (t === 'fillet' && dr.ask === 'r') { if (num < 0) { cadFlash('Radius darf nicht negativ sein.'); return true; } ed.filletR = num; dr.ask = null; cadLog(T('Radius = ') + num); renderCad(); return true; }
    if (t === 'chamfer') {
      if (dr.ask === 'd1') { ed.chamferD1 = Math.max(0, num); dr.ask = 'd2'; renderCad(); return true; }
      if (dr.ask === 'd2') { ed.chamferD2 = Math.max(0, num); dr.ask = null; cadLog(T('Abstände = ') + ed.chamferD1 + ' / ' + ed.chamferD2); renderCad(); return true; }
    }
    if (t === 'xline' && dr.ask === 'xang') { dr.mode = 'a'; dr.ang = num; dr.ask = null; renderCad(); return true; }
    if (t === 'polygon') {
      if (dr.ask === 'n') { if (num < 3) { cadFlash('Mindestens 3 Seiten.'); return true; } dr.n = ed.polyN = Math.round(num); dr.ask = null; dr.phase = 'center'; renderCad(); return true; }
      if (dr.phase === 'radius' && dr.center) { if (num <= 0) { cadFlash('Radius muss größer als 0 sein.'); return true; } cadPushUndo(); cadAddEntity(cadDefaultLayer(), cadMakePolygon(dr.center, dr.n, num, dr.circum, 0)); cadLog(T('Polygon ') + dr.n + T(' Seiten, Radius ') + num.toFixed(2)); cadSetTool('select', true); cadAfterEdit(); return true; }
    }
    return false;
  }

  // ---------------------------------------------------------------------
  //  Befehlsführung (AutoCAD/BricsCAD-artig): zentrale Werkzeugwahl,
  //  Prompt mit Optionen [Schließen/Zurück/…], Verlauf, Objektwahl-Phase.
  // ---------------------------------------------------------------------
  // Koordinaten-Modus der Befehlszeile: relativ (zum letzten Punkt) oder absolut.
  function cadSetRel(on) {
    const ed = state.cad.edit; ed.relCoords = !!on;
    try { localStorage.setItem('cadRelCoords', on ? '1' : '0'); } catch (e) {}
    cadUpdateRelButtons(); cadLog(T('Koordinaten: ') + (on ? T('relativ (@ zum letzten Punkt)') : T('absolut (Ursprung)')));
    cadPromptKey = ''; renderCad();
  }
  function cadUpdateRelButtons() {
    const ed = state.cad.edit, a = document.getElementById('cadAbsBtn'), r = document.getElementById('cadRelBtn'); if (!a || !r) return;
    const on = (b, yes) => { b.style.background = yes ? 'var(--accent)' : ''; b.style.color = yes ? '#04121f' : ''; b.style.borderColor = yes ? 'var(--accent)' : ''; };
    on(a, !ed.relCoords); on(r, !!ed.relCoords);
  }
  function cadSetTool(id, quiet) {
    const ed = state.cad.edit;
    if (id !== 'select') ed.lastTool = id;
    ed.tool = id; ed.draft = null; ed.drag = null; ed.m2p = null;
    if (id !== 'select' && !quiet) cadLog(T('Befehl: ') + cadCmdName(id));
    const SELCMD = { move: 1, copy: 1, mirror: 1, erase: 1, rotate: 1, scale: 1, align: 1, array: 1, layer: 1, explode: 1, reverse: 1 };
    if (SELCMD[id]) {   // Objektwahl zuerst; Vorauswahl (Substantiv-Verb) wird direkt übernommen
      ed.draft = { type: id === 'copy' ? 'move' : id, copy: id === 'copy', phase: 'select' };
      if (ed.sel.length) { cadLog(ed.sel.length + T(' gefunden')); cadAfterSelect(); return; }
    }
    else if (id === 'offset') ed.draft = { type: 'offset', phase: 'dist' };
    else if (id === 'matchprop') ed.draft = { type: 'matchprop', phase: 'source' };
    else if (id === 'stretch') { if (ed.sel.length) ed.prevSel = ed.sel.slice(); ed.sel = []; ed.draft = { type: 'stretch', phase: 'select' }; }
    else if (id === 'fillet' || id === 'chamfer') ed.draft = { type: id, phase: 'first' };
    else if (id === 'break') ed.draft = { type: 'break', phase: 'obj' };
    else if (id === 'xline') ed.draft = { type: 'xline', phase: 'p1', mode: null };
    else if (id === 'polygon') ed.draft = { type: 'polygon', ask: 'n', n: ed.polyN || 6 };
    else if (id === 'dim') ed.draft = { type: 'dim', pts: [] };
    else if (id === 'zoom') ed.draft = { type: 'zoom', phase: 'opt' };
    else if (id === 'zoomwin') { ed.tool = 'zoom'; ed.lastTool = 'zoom'; ed.draft = { type: 'zoom', phase: 'w1' }; }
    else if (id === 'extend' || id === 'area' || id === 'point' || id === 'origin') ed.draft = { type: id };
    App.buildSidebar(); renderCad();
  }
  // Objekt unter dem Cursor in die Auswahl aufnehmen bzw. daraus entfernen. true = getroffen.
  function cadPickToggle(wpt) {
    const ed = state.cad.edit, h = cadHitEntity(wpt, 8);
    if (h) { const key = h.layer + ':' + h.idx, i = ed.sel.findIndex(s => s.layer + ':' + s.idx === key); if (i >= 0) ed.sel.splice(i, 1); else ed.sel.push({ layer: h.layer, idx: h.idx }); return true; }
    const ht = cadHitText(wpt);
    if (ht) { const i = ed.sel.findIndex(s => s.tx === ht.tx); if (i >= 0) ed.sel.splice(i, 1); else ed.sel.push({ tx: ht.tx }); return true; }
    return false;
  }
  function cadEraseSelection() {
    const ed = state.cad.edit; if (!ed.sel.length) return;
    cadPushUndo(); const n = ed.sel.length;
    ed.sel.filter(s => s.tx != null).map(s => s.tx).sort((a, b) => b - a).forEach(i => state.cad.texts.splice(i, 1));
    ed.sel.filter(s => s.layer != null).sort((a, b) => b.idx - a.idx).forEach(s => { if (state.cad.layers[s.layer]) state.cad.layers[s.layer].splice(s.idx, 1); });
    ed.sel = []; cadLog(n + T(' Objekt(e) gelöscht.')); cadSetTool('select', true); cadAfterEdit();
  }
  function cadMakeCircle(c, r) {
    const ed = state.cad.edit; if (!(r > 1e-6)) { ed.draft = null; renderCad(); return; }
    cadArcSteps('circle').then(steps => {
      const pts = [];
      for (let k = 0; k < steps; k++) { const a = 2 * Math.PI * k / steps; pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
      cadPushUndo(); cadAddEntity(cadDefaultLayer(), App.mkLoopLocal(pts, true)); ed.lastRadius = r; cadLog(T('Kreis: Radius ') + r.toFixed(2)); cadSetTool('select', true);
    });
  }
  function cadFinishMirror(del) {
    const ed = state.cad.edit, dr = ed.draft; if (!dr || dr.type !== 'mirror' || !dr.p1 || !dr.p2) return;
    cadPushUndo(); const src = ed.sel.slice(); cadMirrorSelection(dr.p1, dr.p2);
    if (del) {
      src.filter(s => s.tx != null).map(s => s.tx).sort((a, b) => b - a).forEach(i => state.cad.texts.splice(i, 1));
      src.filter(s => s.layer != null).sort((a, b) => b.idx - a.idx).forEach(s => { if (state.cad.layers[s.layer]) state.cad.layers[s.layer].splice(s.idx, 1); });
      ed.sel = [];
    }
    cadLog(src.length + T(' Objekt(e) gespiegelt') + (del ? T(', Quelle gelöscht.') : '.'));
    cadSetTool('select', true); cadAfterEdit();
  }
  // Letzten Punkt der laufenden Skizze zurücknehmen (Option „Zurück").
  function cadUndoPoint() {
    const ed = state.cad.edit, dr = ed.draft; if (!dr) return;
    if (dr.pts && dr.pts.length) { dr.pts.pop(); if (!dr.pts.length && dr.type !== 'arc') ed.draft = null; }
    else if (dr.type === 'line') {
      if (dr.segs > 0) {   // letzte Linie der Kette entfernen (Undo) und Kette dort fortsetzen
        const before = cadEntities().length; cadUndo(); if (cadEntities().length >= before) { ed.draft = null; renderCad(); return; }
        dr.segs--; ed.tool = 'line'; ed.draft = dr;
        const ents = cadEntities(), lastL = ents.length ? ents[ents.length - 1].loop : null;
        dr.p0 = dr.segs && lastL && lastL.length ? { x: lastL[lastL.length - 1].x, y: lastL[lastL.length - 1].y } : dr.first;
      } else ed.draft = null;
    }
    else ed.draft = null;
    App.buildSidebar(); renderCad();
  }
  // Seite/Abstand eines Punkts zur Kontur (Weltkoordinaten). sign: +1 = links der Laufrichtung.
  function cadSideOf(loop, p) {
    let best = null; const n = loop.length, last = loop.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = loop[i], b = loop[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy; if (L2 < 1e-12) continue;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const dd = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
      if (!best || dd < best.dist) best = { dist: dd, cross: dx * (p.y - a.y) - dy * (p.x - a.x) };
    }
    return best ? { dist: best.dist, sign: best.cross >= 0 ? 1 : -1 } : { dist: 0, sign: 1 };
  }
  // Parallel-Offset einer Kontur um d (vorzeichenbehaftet, + = links der
  // Laufrichtung). Ecken: Gehrung (Schnitt der versetzten Kanten), bei sehr
  // spitzen Winkeln abgeschrägt. Entstehende Selbstüberschneidungen (Innen-
  // Offset) werden entfernt.
  function cadOffsetLoop(loop, d) {
    const src = []; loop.forEach(p => { if (!src.length || Math.hypot(p.x - src[src.length - 1].x, p.y - src[src.length - 1].y) > 1e-9) src.push({ x: p.x, y: p.y }); });
    const closed = !!loop.closed;
    if (closed && src.length > 2 && Math.hypot(src[0].x - src[src.length - 1].x, src[0].y - src[src.length - 1].y) < 1e-9) src.pop();
    const n = src.length; if (n < 2) return null;
    const last = closed ? n : n - 1, off = [];
    for (let i = 0; i < last; i++) { const a = src[i], b = src[(i + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y); off[i] = { x: -(b.y - a.y) / L * d, y: (b.x - a.x) / L * d }; }
    const add = (p, o) => ({ x: p.x + o.x, y: p.y + o.y });
    const xsect = (p1, p2, p3, p4) => { const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x); if (Math.abs(den) < 1e-12) return null; const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den; return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }; };
    const out = [], lim = 4 * Math.abs(d);
    for (let i = 0; i < n; i++) {
      const hasPrev = closed || i > 0, hasNext = closed || i < n - 1, ip = (i - 1 + n) % n;
      if (!hasPrev) { out.push(add(src[i], off[i])); continue; }
      if (!hasNext) { out.push(add(src[i], off[ip])); continue; }
      const o1 = off[ip], o2 = off[i], a1 = add(src[i], o1), b0 = add(src[i], o2);
      const X = xsect(add(src[ip], o1), a1, b0, add(src[(i + 1) % n], o2));
      if (X && Math.hypot(X.x - src[i].x, X.y - src[i].y) <= lim) out.push(X); else { out.push(a1); out.push(b0); }
    }
    let res = out;
    if (closed) { if (res.length >= 4) res = App.deloopPoly(res, Math.abs(d) * 0.3); if (res.length < 3 || Math.abs(App.polyArea(res)) < 1e-9) return null; }
    else {   // offen: lokale Schleifen (Kanten-Kreuzungen) herausschneiden
      for (let pass = 0; pass < 200; pass++) {
        let hit = null;
        for (let i = 0; i < res.length - 1 && !hit; i++) for (let j = i + 2; j < res.length - 1; j++) { const X = App.segCross(res[i], res[i + 1], res[j], res[j + 1]); if (X) { hit = { i, j, X }; break; } }
        if (!hit) break;
        res = res.slice(0, hit.i + 1).concat([hit.X], res.slice(hit.j + 1));
      }
    }
    return App.mkLoopLocal(res, closed);
  }
  // --- Befehlszeile: Verlauf + Prompt mit Optionen ---
  const cadHist = [];
  function cadLog(msg) {
    cadHist.push(String(msg)); if (cadHist.length > 60) cadHist.shift();
    const el = document.getElementById('cadCmdHist'); if (!el) return;
    el.textContent = cadHist.join('\n'); el.scrollTop = el.scrollHeight;
  }
  // Aktueller Prompt: { text, opts:[{k:[Tasten], l:Label, fn}], def:Enter-Vorgabe }.
  function cadPromptSpec() {
    const ed = state.cad.edit, dr = ed.draft, t = ed.tool, nSel = ed.sel.length;
    const O = (k, l, fn) => ({ k: Array.isArray(k) ? k : [k], l, fn });
    const P = (text, opts, def) => ({ text: T(text), opts: opts || [], def: def || '' });
    const oEnd = O(['b', 'e', 'x'], 'Beenden', () => cadSetTool('select', true));
    const oUndo = O(['z', 'u'], 'Zurück', cadUndoPoint);
    const oLen = O(['l', 'w'], 'Länge/Winkel', () => { if (dr) dr.ask = 'plen'; });
    if (dr && dr.ask === 'plen') return P('Länge angeben:', [], ed.relCoords ? T('(relativ zum letzten Punkt)') : '');
    if (dr && dr.ask === 'pang') return P('Winkel angeben (° zur X-Achse, gegen den Uhrzeigersinn):');
    const found = nSel ? '  (' + nSel + T(' gefunden') + ')' : '';
    if (ed.m2p) return P(ed.m2p.pts.length ? 'Mitte zwischen 2 Punkten: zweiten Punkt angeben:' : 'Mitte zwischen 2 Punkten: ersten Punkt angeben:');
    if (dr && dr.phase === 'select') return P('Objekte wählen (Klick / Fenster):' + found, [], nSel ? T('Enter = weiter') : '');
    switch (t) {
      case 'select': return P('Befehl:', [], ed.lastTool ? T('Enter = ') + cadCmdName(ed.lastTool) : '');
      case 'vertex': return P('Konturpunkt anklicken und ziehen:');
      case 'delpt': return P('Zu löschenden Konturpunkt anklicken:');
      case 'line':
        if (!dr) return P('LINIE  Ersten Punkt angeben:');
        return P('Nächsten Punkt angeben oder', dr.segs >= 2 ? [O(['s', 'c'], 'Schließen', () => { cadToolPoint(dr.first); cadSetTool('select', true); }), oUndo, oLen] : [oUndo, oLen], T('Enter = Beenden'));
      case 'rect':
        if (!dr) return P('RECHTECK  Ersten Eckpunkt angeben:');
        if (dr.ask === 'len') return P('Länge angeben:');
        if (dr.ask === 'wid') return P('Breite angeben:');
        return P('Anderen Eckpunkt angeben (oder b x h tippen) oder', [O('m', 'Maße', () => { dr.ask = 'len'; })]);
      case 'circle':
        if (!dr) return P('KREIS  Mittelpunkt angeben oder', [O('2p', '2P', () => { ed.draft = { type: 'circle', mode: '2p', pts: [] }; }), O('3p', '3P', () => { ed.draft = { type: 'circle', mode: '3p', pts: [] }; })]);
        if (dr.mode === '2p') return P(dr.pts.length ? 'Zweiten Endpunkt des Durchmessers angeben:' : 'Ersten Endpunkt des Durchmessers angeben:');
        if (dr.mode === '3p') return P(['Ersten Punkt auf dem Kreis angeben:', 'Zweiten Punkt auf dem Kreis angeben:', 'Dritten Punkt auf dem Kreis angeben:'][dr.pts.length]);
        if (dr.ask === 'd') return P('Durchmesser angeben:');
        return P('Radius angeben oder', [O('d', 'Durchmesser', () => { dr.ask = 'd'; })], ed.lastRadius ? '<' + ed.lastRadius.toFixed(2) + '>' : '');
      case 'ellipse': return P(dr ? 'Gegenüberliegenden Eckpunkt angeben:' : 'ELLIPSE  Ersten Eckpunkt des umschließenden Rechtecks angeben:');
      case 'arc': { const k = dr ? dr.pts.length : 0; return P(['BOGEN  Startpunkt angeben:', 'Zweiten Punkt auf dem Bogen angeben:', 'Endpunkt des Bogens angeben:'][k], k ? [oUndo] : []); }
      case 'polyline':
        if (!dr || !dr.pts.length) return P('POLYLINIE  Startpunkt angeben:');
        return P('Nächsten Punkt angeben oder', dr.pts.length >= 2 ? [O(['s', 'c'], 'Schließen', () => cadFinishDraft(true)), oUndo, oLen] : [oUndo, oLen], T('Enter = Beenden'));
      case 'spline':
        if (!dr || !dr.pts.length) return P('SPLINE  Ersten Stützpunkt angeben:');
        return P('Nächsten Stützpunkt angeben oder', dr.pts.length >= 2 ? [O(['s', 'c'], 'Schließen', () => cadFinishDraft(true)), oUndo, oLen] : [oUndo, oLen], T('Enter = Beenden'));
      case 'splinetan':
        if (!dr || !dr.pts.length) return P('SPLINE TANGENTIAL  Startpunkt angeben (auf einem Objekt = tangentialer Anfang):');
        return P('Nächsten Stützpunkt angeben (auf Objekt = tangentiales Ende) oder', [oUndo], T('Enter = Beenden'));
      case 'move': case 'copy':
        if (!dr || dr.phase === 'base') return P('Basispunkt angeben:');
        if (dr.copy && dr.placed) return P('Zweiten Punkt für weitere Kopie angeben oder', [oEnd], T('Enter = Beenden'));
        return P('Zweiten Punkt angeben (oder @dx,dy):');
      case 'mirror':
        if (!dr || dr.phase === 'p1') return P('Ersten Punkt der Spiegelachse angeben:');
        if (dr.phase === 'p2') return P('Zweiten Punkt der Spiegelachse angeben:');
        return P('Quellobjekte löschen?', [O(['j', 'y'], 'Ja', () => cadFinishMirror(true)), O('n', 'Nein', () => cadFinishMirror(false))], '<N>');
      case 'erase': return P('LÖSCHEN  Objekte wählen:' + found, [], nSel ? T('Enter = löschen') : '');
      case 'trim': return P('STUTZEN  Zu entfernenden Teil einer Kontur anklicken:');
      case 'measure': return P(dr && dr.pts.length ? 'Nächsten Punkt angeben:' : 'MESSEN  Ersten Punkt angeben:', dr && dr.pts.length ? [oUndo] : [], T('Enter = Beenden'));
      case 'rotate': case 'scale': {
        const isR = t === 'rotate', oCopy = O('k', 'Kopie', () => { dr.copy = !dr.copy; cadFlash(dr.copy ? 'Kopie: AN' : 'Kopie: AUS'); }), oRef = O('r', 'Referenz', () => { dr.phase = 'ref1'; });
        if (!dr || dr.phase === 'base') return P('Basispunkt angeben:');
        if (dr.phase === 'angle') return P('Drehwinkel angeben (° oder Punkt) oder', [oRef, oCopy], dr.copy ? T('(Kopie)') : '');
        if (dr.phase === 'factor') return P('Skalierfaktor angeben (Zahl oder Punkt) oder', [oRef, oCopy], dr.copy ? T('(Kopie)') : '');
        if (dr.phase === 'ref1') return P(isR ? 'Referenzwinkel: ersten Punkt angeben:' : 'Referenzlänge: ersten Punkt angeben:');
        if (dr.phase === 'ref2') return P(isR ? 'Referenzwinkel: zweiten Punkt angeben:' : 'Referenzlänge: zweiten Punkt angeben (oder Länge tippen):');
        return P(isR ? 'Neuen Winkel angeben (° oder Punkt):' : 'Neue Länge angeben (Zahl oder Punkt):');
      }
      case 'align':
        if (!dr || dr.phase === 's1') return P('Ersten Quellpunkt angeben:');
        if (dr.phase === 't1') return P('Ersten Zielpunkt angeben:');
        if (dr.phase === 's2') return P('Zweiten Quellpunkt angeben oder', [], T('Enter = nur verschieben'));
        if (dr.phase === 't2') return P('Zweiten Zielpunkt angeben:');
        return P('Objekte auf Ausrichtungspunkte skalieren?', [O(['j', 'y'], 'Ja', () => cadFinishAlign(true)), O('n', 'Nein', () => cadFinishAlign(false))], '<N>');
      case 'array': {
        if (!dr || dr.phase === 'type') return P('Art der Reihe', [O('r', 'Rechteckig', () => { dr.phase = 'rect'; dr.ask = 'rows'; }), O('p', 'Polar', () => { dr.phase = 'center'; })], '<R>');
        if (dr.ask === 'rows') return P('Anzahl Reihen (Y):', [], '<' + (ed.arrRows || 2) + '>');
        if (dr.ask === 'cols') return P('Anzahl Spalten (X):', [], '<' + (ed.arrCols || 3) + '>');
        if (dr.ask === 'dy') return P('Abstand der Reihen (Y):', [], '<' + (ed.arrDy || 50) + '>');
        if (dr.ask === 'dx') return P('Abstand der Spalten (X):', [], '<' + (ed.arrDx || 50) + '>');
        if (dr.phase === 'center') return P('Mittelpunkt der polaren Reihe angeben:');
        if (dr.ask === 'count') return P('Anzahl der Elemente:', [], '<' + (ed.arrN || 6) + '>');
        if (dr.ask === 'fill') return P('Füllwinkel (°, + = gegen Uhrzeigersinn):', [], '<' + (ed.arrFill || 360) + '>');
        return P('Elemente mitdrehen?', [O(['j', 'y'], 'Ja', () => cadFinishArrayPolar(true)), O('n', 'Nein', () => cadFinishArrayPolar(false))], '<J>');
      }
      case 'stretch':
        if (!dr || dr.phase === 'select') return P('STRECKEN  Punkte mit Kreuzen-Fenster aufziehen (Rechteck über die zu streckenden Ecken):');
        if (dr.phase === 'base') return P('Basispunkt angeben:', [], '(' + dr.verts.length + T(' Punkte') + ')');
        return P('Zweiten Punkt angeben (oder @dx,dy):');
      case 'fillet': case 'chamfer': {
        const isF = t === 'fillet';
        const oVal = isF ? O('r', 'Radius', () => { dr.ask = 'r'; }) : O('a', 'Abstände', () => { dr.ask = 'd1'; });
        if (dr && dr.ask === 'r') return P('Abrundungsradius angeben:', [], '<' + (ed.filletR || 0) + '>');
        if (dr && dr.ask === 'd1') return P('Ersten Fasenabstand angeben:', [], '<' + (ed.chamferD1 || 0) + '>');
        if (dr && dr.ask === 'd2') return P('Zweiten Fasenabstand angeben:', [], '<' + (ed.chamferD2 || 0) + '>');
        const cur = isF ? T('Radius = ') + (ed.filletR || 0) : T('Abstände = ') + (ed.chamferD1 || 0) + ' / ' + (ed.chamferD2 || 0);
        if (!dr || dr.phase === 'first') return P((isF ? 'ABRUNDEN  ' : 'FASEN  ') + 'Erstes Objekt/Segment wählen oder', [oVal], '(' + cur + ')');
        return P('Zweites Objekt/Segment wählen oder', [oVal], '(' + cur + ')');
      }
      case 'extend': return P('DEHNEN  Zu dehnendes Objekt nahe dem Ende anklicken oder', [oEnd], T('Enter = Beenden'));
      case 'break':
        if (!dr || dr.phase === 'obj') return P('BRUCH  Objekt am ersten Bruchpunkt anklicken:');
        if (dr.phase === 'first') return P('Ersten Bruchpunkt angeben:');
        return P('Zweiten Bruchpunkt angeben oder', [O(['e', 'f'], 'Erster Punkt', () => { dr.phase = 'first'; }), O('@', 'Teilen an erster Stelle', () => cadBreakApply(null))]);
      case 'point': return P('PUNKT  Punkt angeben:', [], T('Enter = Beenden'));
      case 'xline':
        if (!dr || dr.phase === 'p1') return P('HILFSLINIE  Punkt angeben oder', [O('h', 'Horizontal', () => { dr.mode = 'h'; }), O('v', 'Vertikal', () => { dr.mode = 'v'; }), O('w', 'Winkel', () => { dr.ask = 'xang'; })], dr && dr.mode ? '(' + ({ h: T('horizontal'), v: T('vertikal'), a: (dr.ang || 0) + '°' })[dr.mode] + ')' : '');
        return P('Durchgangspunkt angeben:', [], T('Enter = Beenden'));
      case 'polygon':
        if (!dr || dr.ask === 'n') return P('POLYGON  Anzahl Seiten:', [], '<' + (ed.polyN || 6) + '>');
        if (dr.phase === 'center') return P('Mittelpunkt angeben:');
        if (dr.phase === 'mode') return P('Polygon', [O('e', 'Einbeschrieben', () => { dr.circum = false; dr.phase = 'radius'; }), O('u', 'Umbeschrieben', () => { dr.circum = true; dr.phase = 'radius'; })], '<E>');
        return P(dr.circum ? 'Radius des Innenkreises angeben (Zahl oder Punkt):' : 'Radius des Umkreises angeben (Zahl oder Punkt):');
      case 'dim': { const k = dr ? dr.pts.length : 0; return P(['BEMASSUNG  Ersten Messpunkt angeben:', 'Zweiten Messpunkt angeben:', 'Position des Maßtextes angeben:'][k], k ? [oUndo] : [], T('Enter = Beenden')); }
      case 'origin': return P('URSPRUNG  Neuen Nullpunkt angeben (alle Objekte werden entsprechend verschoben):');
      case 'zoom':
        if (!dr || dr.phase === 'opt') return P('ZOOM  Ersten Fensterpunkt angeben oder', [O('a', 'Alles', () => { cadZoomAll(); cadSetTool('select', true); }), O('f', 'Fenster', () => { dr.phase = 'w1'; }), O('o', 'Objekte', () => { cadZoomSel(); cadSetTool('select', true); }), O('v', 'Vorher', () => { cadZoomPrev(); cadSetTool('select', true); })]);
        if (dr.phase === 'w1') return P('Ersten Fensterpunkt angeben:');
        return P('Zweiten Fensterpunkt angeben:');
      case 'area': return P('FLÄCHE  Kontur anklicken (geschlossen = Fläche + Umfang, offen = Länge) oder', [oEnd], T('Enter = Beenden'));
      case 'layer': {
        if (!dr || dr.phase !== 'target') return P('Objekte wählen:');
        const opts = state.cad.order.map((nm, i) => O(String(i + 1), nm, () => cadMoveSelToLayer(nm)));
        return P('Ziellayer wählen (Nummer, Name tippen = neuer Layer)', opts);
      }
      case 'matchprop':
        if (!dr || dr.phase === 'source') return P('EIGENSCHAFTEN ANGLEICHEN  Quellobjekt wählen:');
        return P('Zielobjekte wählen:' + found, [], nSel ? T('Enter = anwenden') : '');
      case 'explode': return P('AUFLÖSEN  Objekte wählen:' + found, [], nSel ? T('Enter = auflösen') : '');
      case 'reverse': return P('UMKEHREN  Objekte wählen:' + found, [], nSel ? T('Enter = umkehren') : '');
      case 'offset': {
        if (!dr || dr.phase === 'dist') {
          if (dr && dr.dp0) return P('Zweiten Punkt für den Abstand angeben:');
          return P('VERSETZEN  Abstand angeben (Zahl oder 2 Punkte) oder', [O(['d', 't'], 'Durch Punkt', () => { if (dr) { dr.through = true; dr.phase = 'obj'; } })], ed.offsetDist ? '<' + ed.offsetDist.toFixed(2) + '>' : '');
        }
        if (dr.phase === 'obj') return P('Zu versetzendes Objekt wählen oder', [oEnd], T('Enter = Beenden'));
        if (dr.phase === 'through') return P('Durchgangspunkt angeben oder', [oEnd]);
        return P('Punkt auf der Seite angeben, auf die versetzt werden soll, oder', [oEnd]);
      }
    }
    return P('');
  }
  // --- Dynamische Eingabe am Cursor (AutoCAD-artig): Prompt + Eingabefeld + Länge/Winkel ---
  let cadDynVisible = false;
  function cadDynEl() { return document.getElementById('cadDynIn'); }
  function cadDynInput() { return document.getElementById('cadDynInput'); }
  function cadUpdateDyn(V, w, h) {
    const box = cadDynEl(); if (!box) return;
    const ed = state.cad.edit, hv = ed.hover, cv = document.getElementById('cCad');
    const active = ed.dynIn !== false && hv && cv && (ed.tool !== 'select' || ed.draft || ed.m2p);
    if (!active) {
      if (cadDynVisible) { box.style.display = 'none'; cadDynVisible = false; const di = cadDynInput(), ci = document.getElementById('cadCoordInput'); if (di && ci && document.activeElement === di) ci.focus(); }
      return;
    }
    const sp = cadPromptSpec();
    let txt = sp.text; if (sp.opts.length) txt += ' [' + sp.opts.map(o => T(o.l)).join('/') + ']';
    const pe = box.querySelector('.dynPrompt'); if (pe && pe.textContent !== txt) pe.textContent = txt;
    const ref = cadDraftRef(); let vals = 'X ' + hv.x.toFixed(1) + '  Y ' + hv.y.toFixed(1);
    if (ref) { const dx = hv.x - ref.x, dy = hv.y - ref.y; vals = 'L ' + Math.hypot(dx, dy).toFixed(1) + '  ∠ ' + ((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360).toFixed(1) + '°  ·  ' + vals; }
    const ve = box.querySelector('.dynVals'); if (ve && ve.textContent !== vals) ve.textContent = vals;
    let x = V.X(hv.x) + 18, y = V.Y(hv.y) + 18;
    const bw = box.offsetWidth || 240, bh = box.offsetHeight || 46;
    if (x + bw > w - 4) x = V.X(hv.x) - bw - 18; if (y + bh > h - 4) y = V.Y(hv.y) - bh - 18;
    box.style.left = (cv.offsetLeft + x) + 'px'; box.style.top = (cv.offsetTop + y) + 'px';
    if (!cadDynVisible) { box.style.display = 'block'; cadDynVisible = true; const di = cadDynInput(), ci = document.getElementById('cadCoordInput'); if (di && ci) { di.value = ci.value; if (document.activeElement === ci || document.activeElement === document.body) di.focus(); } }
  }
  // Gemeinsamer Tastatur-Handler für Befehlszeile und Dyn-Feld.
  function cadInputKey(ev, el) {
    const other = el.id === 'cadDynInput' ? document.getElementById('cadCoordInput') : cadDynInput();
    const clear = () => { el.value = ''; if (other) other.value = ''; cadSuggest(''); el.focus(); };
    if (ev.key === 'Enter') { ev.preventDefault(); const v = el.value; clear(); cadCoordApply(v); }
    else if (ev.key === 'Delete' && !el.value && state.cad.edit.sel.length) { ev.preventDefault(); cadEraseSelection(); }
    else if (ev.key === ' ' || ev.code === 'Space') { ev.preventDefault(); const v = el.value; clear(); cadCoordApply(v); }   // Leertaste = Enter (wie AutoCAD); Koordinaten mit Komma trennen
    else if (ev.key === 'Escape') { ev.preventDefault(); if (el.value) clear(); else cadCancel(); }
  }
  let cadPromptKey = '';
  function cadUpdatePrompt() {
    const el = document.getElementById('cadPromptLine'); if (!el) return;
    const sp = cadPromptSpec();
    const key = sp.text + '|' + sp.opts.map(o => o.l).join('/') + '|' + sp.def;
    if (key === cadPromptKey) return; cadPromptKey = key;
    el.innerHTML = '';
    const tx = document.createElement('span'); tx.textContent = sp.text; el.appendChild(tx);
    if (sp.opts.length) {
      const br = document.createElement('span'); br.textContent = '['; br.style.color = 'var(--muted)'; el.appendChild(br);
      sp.opts.forEach((o, i) => {
        if (i) { const sl = document.createElement('span'); sl.textContent = '/'; sl.style.color = 'var(--muted)'; el.appendChild(sl); }
        const b = document.createElement('span'); b.className = 'cadOpt'; b.title = T('Taste: ') + o.k[0].toUpperCase();
        const lab = T(o.l), k0 = o.k[0];
        b.innerHTML = lab.toLowerCase().indexOf(k0) === 0 ? '<b>' + lab.slice(0, k0.length) + '</b>' + lab.slice(k0.length) : '<b>' + k0.toUpperCase() + '</b> ' + lab;
        b.onclick = () => { cadLog('> ' + lab); o.fn(); App.buildSidebar(); renderCad(); const inp = document.getElementById('cadCoordInput'); if (inp) inp.focus(); };
        el.appendChild(b);
      });
      const br2 = document.createElement('span'); br2.textContent = ']:'; br2.style.color = 'var(--muted)'; el.appendChild(br2);
    }
    if (sp.def) { const d = document.createElement('span'); d.textContent = sp.def; d.style.color = 'var(--muted)'; el.appendChild(d); }
  }
  // Enter/Leertaste ohne Eingabe: Skizze abschließen, Objektwahl bestätigen,
  // Befehl beenden oder letzten Befehl wiederholen (wie AutoCAD).
  function cadEnterKey() {
    const ed = state.cad.edit, dr = ed.draft;
    if (ed.m2p) { ed.m2p = null; renderCad(); return; }
    if (dr && dr.phase === 'select') {
      if (!ed.sel.length) { cadFlash('Nichts gewählt.'); return; }
      cadLog(ed.sel.length + T(' gefunden'));
      cadAfterSelect(); return;
    }
    // Enter-Vorgaben der erweiterten Befehle.
    if (dr && dr.type === 'polygon' && dr.ask === 'n') { dr.n = ed.polyN || 6; dr.ask = null; dr.phase = 'center'; renderCad(); return; }
    if (dr && dr.type === 'polygon' && dr.phase === 'mode') { dr.circum = false; dr.phase = 'radius'; renderCad(); return; }
    if (dr && dr.type === 'array') {
      if (dr.phase === 'type') { dr.phase = 'rect'; dr.ask = 'rows'; renderCad(); return; }
      if (dr.ask === 'rows') { dr.rows = ed.arrRows || 2; dr.ask = 'cols'; renderCad(); return; }
      if (dr.ask === 'cols') { dr.cols = ed.arrCols || 3; dr.ask = 'dy'; renderCad(); return; }
      if (dr.ask === 'dy') { dr.dy = ed.arrDy || 50; dr.ask = 'dx'; renderCad(); return; }
      if (dr.ask === 'dx') { dr.dx = ed.arrDx || 50; dr.ask = null; cadFinishArrayRect(); return; }
      if (dr.ask === 'count') { dr.count = ed.arrN || 6; dr.ask = 'fill'; renderCad(); return; }
      if (dr.ask === 'fill') { dr.fill = ed.arrFill || 360; dr.ask = null; dr.phase = 'prot'; renderCad(); return; }
      if (dr.phase === 'prot') { cadFinishArrayPolar(true); return; }
    }
    if (dr && dr.type === 'align' && dr.phase === 's2' && dr.s1 && dr.t1) { cadFinishAlign(false); return; }
    if (dr && dr.type === 'align' && dr.phase === 'scale') { cadFinishAlign(false); return; }
    if (dr && (dr.type === 'fillet' || dr.type === 'chamfer') && dr.ask) { dr.ask = null; renderCad(); return; }
    if (dr && dr.type === 'xline' && dr.ask === 'xang') { dr.ask = null; renderCad(); return; }

    if (dr && dr.type === 'mirror' && dr.phase === 'del') { cadFinishMirror(false); return; }
    if (dr && dr.type === 'circle' && !dr.mode && !dr.ask && ed.lastRadius) { cadMakeCircle(dr.c, ed.lastRadius); return; }
    if (dr && dr.type === 'offset' && dr.phase === 'dist' && !dr.dp0 && ed.offsetDist) { dr.dist = ed.offsetDist; dr.phase = 'obj'; renderCad(); return; }
    if (dr && (dr.type === 'poly' || dr.type === 'spline' || dr.type === 'splinetan') && dr.pts.length >= 2) { cadFinishDraft(false); return; }   // laufende Skizze abschließen
    if (dr) { cadSetTool('select', true); return; }                       // unfertige Skizze verwerfen / Befehl beenden
    if (ed.tool !== 'select') { cadSetTool('select', true); return; }     // Befehl beenden
    if (ed.lastTool) cadSetTool(ed.lastTool);                              // letzten Befehl wiederholen
  }

  function cadStartM2P() {
    const ed = state.cad.edit;
    if (!cadIsPointTool(ed.tool)) { cadFlash('Erst ein Zeichen-/Verschiebe-Werkzeug wählen, dann Mitte-2-Punkte.'); return; }
    if ((ed.tool === 'move' || ed.tool === 'copy' || ed.tool === 'mirror') && !ed.sel.length) { cadFlash('Erst Konturen auswählen.'); return; }
    ed.m2p = { pts: [] }; cadFlash('Mitte zwischen 2 Punkten: 1. Punkt wählen.'); renderCad();
  }
  function cadM2PPoint(pt) {
    const ed = state.cad.edit; if (!ed.m2p) return;
    ed.m2p.pts.push({ x: pt.x, y: pt.y });
    if (ed.m2p.pts.length >= 2) {
      const a = ed.m2p.pts[0], b = ed.m2p.pts[1]; ed.m2p = null;
      cadToolPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });   // Mittelpunkt an das Werkzeug
    } else { cadFlash('Mitte zwischen 2 Punkten: 2. Punkt wählen.'); renderCad(); }
  }
  // Ist die Eingabe eine Option des laufenden Prompts? (Taste oder Klarname)
  function cadMatchOption(low) {
    const sp = cadPromptSpec();
    return sp.opts.find(o => o.k.indexOf(low) >= 0 || o.l.toLowerCase() === low || T(o.l).toLowerCase() === low) || null;
  }
  function cadCoordApply(str) {
    const ed = state.cad.edit; const raw = (str || '').trim();
    if (!raw) { cadEnterKey(); return; }
    const low = raw.toLowerCase();
    cadLog('> ' + raw);
    // 1) Option des laufenden Befehls (hat Vorrang vor Kurzbefehlen, wie in AutoCAD).
    const opt = cadMatchOption(low);
    if (opt) { opt.fn(); App.buildSidebar(); renderCad(); return; }
    // 2) Sofortbefehle (keine Werkzeugwahl).
    if (low === 'j' || low === 'join' || low === 'verbinden') { cadJoinSelection(); return; }
    if (low === 'm2p' || low === 'mtp') { cadStartM2P(); return; }
    if (low === 'esc' || low === 'abbruch') { cadCancel(); return; }
    if (low === 'rel' || low === 'relativ' || low === 'relative') { cadSetRel(true); return; }
    if (low === 'abs' || low === 'absolut' || low === 'absolute') { cadSetRel(false); return; }
    // 3) Werteingaben des laufenden Befehls (Radius, Maße, Abstand, Länge/Winkel …).
    const dr = ed.draft; let mm; const isNum = /^\d*\.?\d+$/.test(low), num = parseFloat(low);
    if (dr && dr.ask === 'plen' && isNum) { dr.plen = num; dr.ask = 'pang'; renderCad(); return; }
    if (dr && dr.ask === 'pang' && /^-?\d*\.?\d+$/.test(low)) {
      const ref = cadDraftRef() || { x: 0, y: 0 }, a = parseFloat(low) * Math.PI / 180, L = dr.plen; dr.ask = null;
      cadToolPoint({ x: ref.x + L * Math.cos(a), y: ref.y + L * Math.sin(a) }); return;
    }
    if (dr && dr.type === 'circle' && !dr.mode && isNum) { if (num > 0) cadMakeCircle(dr.c, dr.ask === 'd' ? num / 2 : num); return; }
    if (dr && dr.type === 'rect') {
      if (dr.ask === 'len' && isNum) { dr.len = num; dr.ask = 'wid'; renderCad(); return; }
      if (dr.ask === 'wid' && isNum) { cadToolPoint({ x: dr.p0.x + dr.len, y: dr.p0.y + num }); return; }
      if ((mm = low.match(/^(\d*\.?\d+)\s*[x×*]\s*(\d*\.?\d+)$/))) { cadToolPoint({ x: dr.p0.x + parseFloat(mm[1]), y: dr.p0.y + parseFloat(mm[2]) }); return; }
      if (isNum) { if (num > 0) cadToolPoint({ x: dr.p0.x + num, y: dr.p0.y + num }); return; }   // Quadrat
    }
    if (dr && dr.type === 'offset' && dr.phase === 'dist' && isNum) { if (num > 0) { dr.dist = num; ed.offsetDist = num; dr.dp0 = null; dr.phase = 'obj'; renderCad(); } else cadFlash('Abstand muss größer als 0 sein.'); return; }
    // 3b) Werteingaben der erweiterten Befehle (Zahl passend zur Phase/Abfrage).
    const isSNum = /^-?\d*\.?\d+$/.test(low);
    if (dr && isSNum && cadNumInput(dr, num)) return;
    if (dr && dr.type === 'layer' && dr.phase === 'target') { cadMoveSelToLayer(raw); return; }
    if (dr && dr.type === 'break' && dr.phase === 'second' && low === '@') { cadBreakApply(null); return; }
    // 4) Kurzbefehl (Werkzeugwahl) / Direktaktion / Zoom-Kurzform, sonst Koordinate.
    if ((mm = low.match(/^z(?:oom)?\s+([afov])$/))) { cadSetTool('zoom', true); const o = cadMatchOption(mm[1]); if (o) o.fn(); App.buildSidebar(); renderCad(); return; }
    if (CAD_ACTION_ALIASES[low]) { CAD_ACTIONS[CAD_ACTION_ALIASES[low]](); return; }
    const id = CAD_ALIASES[low];
    if (id) { cadSetTool(id); return; }
    const s = raw.replace(',', ' ').replace(/\s+/g, ' ');
    // Bezug: letzter Punkt des laufenden Befehls. „@" = relativ erzwingen, „#" = absolut
    // erzwingen; ohne Präfix entscheidet der Abs/Rel-Schalter (nur wenn ein Bezug existiert).
    const dref = cadDraftRef(); let pt = null, m;
    const forceRel = s[0] === '@', forceAbs = s[0] === '#';
    const rel = dref && (forceRel || (!forceAbs && ed.relCoords));
    const ref = rel ? dref : { x: 0, y: 0 };
    const body = (forceRel || forceAbs) ? s.slice(1).trim() : s;
    if ((m = body.match(/^(-?\d*\.?\d+)\s*<\s*(-?\d*\.?\d+)$/))) { const L = parseFloat(m[1]), a = parseFloat(m[2]) * Math.PI / 180; pt = { x: ref.x + L * Math.cos(a), y: ref.y + L * Math.sin(a) }; }
    else if ((m = body.match(/^(-?\d*\.?\d+)\s+(-?\d*\.?\d+)$/))) pt = { x: ref.x + parseFloat(m[1]), y: ref.y + parseFloat(m[2]) };
    if (!pt) { cadFlash('Unbekannter Befehl. Eingabe: Befehl · x,y · @dx,dy · #x,y · Länge<Winkel'); cadLog(T('Unbekannter Befehl: ') + raw); return; }
    if (ed.m2p) { cadM2PPoint(pt); return; }
    if (ed.draft && ed.draft.phase === 'select') { cadPickToggle(pt); renderCad(); return; }
    cadToolPoint(pt);
  }
  function cadCancel() {
    const ed = state.cad.edit;
    if (ed.draft || ed.tool !== 'select' || ed.m2p) cadLog('*' + T('Abbruch') + '*');
    if (ed.sel.length) ed.prevSel = ed.sel.slice();
    ed.draft = null; ed.drag = null; ed.sel = []; ed.m2p = null; ed.tool = 'select'; App.buildSidebar(); renderCad();
  }
  // Vorschläge beim Tippen (BricsCAD-artig): passende Befehle auflisten.
  function cadSuggest(val) {
    const el = document.getElementById('cadCmdSuggest'); if (!el) return;
    const v = (val || '').trim().toLowerCase();
    if (!v || /^[@\d.\-<,\s]/.test(v)) { el.style.display = 'none'; return; }
    const seen = {}, rows = [];
    const extra = { j: 'Verbinden', m2p: 'Mitte 2 Punkte' };
    Object.keys(CAD_ALIASES).forEach(k => { const id = CAD_ALIASES[k]; if (seen[id]) return; if (k.indexOf(v) === 0 || T(cadToolLabel(id)).toLowerCase().indexOf(v) === 0) { seen[id] = 1; rows.push([CAD_ALIASES_REV[id], cadToolLabel(id), CAD_ALIASES_REV[id]]); } });
    Object.keys(extra).forEach(k => { if (k.indexOf(v) === 0 || T(extra[k]).toLowerCase().indexOf(v) === 0) rows.push([k, extra[k], k]); });
    if (!rows.length) { el.style.display = 'none'; return; }
    el.innerHTML = ''; el.style.display = 'block';
    rows.slice(0, 8).forEach(r => {
      const d = document.createElement('div'); d.className = 'cadSug';
      d.innerHTML = '<span style="color:var(--accent);display:inline-block;min-width:44px">' + r[0] + '</span>' + T(r[1]);
      d.onmousedown = ev => { ev.preventDefault(); const inp = document.getElementById('cadCoordInput'); if (inp) { inp.value = ''; inp.focus(); } el.style.display = 'none'; cadCoordApply(r[2]); };
      el.appendChild(d);
    });
  }
  function cadEditMove(ev) {
    const ed = state.cad.edit; if (!cadDraw) return;
    if (ed.pan) { App.nav.cad.ox = ed.pan.ox + (ev.clientX - ed.pan.px); App.nav.cad.oy = ed.pan.oy + (ev.clientY - ed.pan.py); renderCad(); return; }
    const wpt = cadWorld(ev); if (!wpt) return; ed.hover = wpt;
    if (ed.drag && ed.drag.mode === 'box') { ed.drag.cur = wpt; renderCad(); return; }
    if (ed.drag) {
      if (!ed.drag.moved) cadPushUndo();
      if (ed.drag.mode === 'move') { cadTranslateSelection(wpt.x - ed.drag.last.x, wpt.y - ed.drag.last.y, false); ed.drag.last = wpt; ed.drag.moved = true; }
      else if (ed.drag.mode === 'vertex') { const loop = cadLoopOf(ed.drag.ref); if (loop && loop[ed.drag.ref.vi]) { loop[ed.drag.ref.vi].x = wpt.x; loop[ed.drag.ref.vi].y = wpt.y; } ed.drag.moved = true; }
      else if (ed.drag.mode === 'ctrl') { const loop = cadLoopOf(ed.drag.ref); if (loop && loop.ctrl && loop.ctrl[ed.drag.ref.ci]) { loop.ctrl[ed.drag.ref.ci].x = wpt.x; loop.ctrl[ed.drag.ref.ci].y = wpt.y; cadRebuildCurve(loop); } ed.drag.moved = true; }
    }
    renderCad();
  }
  function cadEditUp() {
    const ed = state.cad.edit;
    if (ed.pan) { ed.pan = null; return; }
    if (ed.drag && ed.drag.mode === 'box') {
      const b = ed.drag; ed.drag = null;
      const V = cadDraw && cadDraw.V;
      const movedPx = V ? Math.hypot(V.X(b.cur.x) - V.X(b.start.x), V.Y(b.cur.y) - V.Y(b.start.y)) : 0;
      if (b.stretch) {   // Strecken: Punkte im Fenster erfassen
        if (movedPx >= 4) { const r = cadStretchCollect(b.start, b.cur); if (!r.verts.length) cadFlash('Keine Punkte im Fenster.'); else { ed.sel = r.sel; ed.draft.verts = r.verts; ed.draft.phase = 'base'; cadLog(r.verts.length + T(' Punkt(e) erfasst')); } }
        App.buildSidebar(); renderCad(); return;
      }
      if (movedPx < 4) { if (!b.add) { if (ed.sel.length) ed.prevSel = ed.sel.slice(); ed.sel = []; } }   // reiner Klick ins Leere = abwählen
      else {
        const res = cadEntsInBox(b.start, b.cur);
        if (!b.add) ed.sel = [];
        res.forEach(r => { if (!ed.sel.some(s => s.layer === r.layer && s.idx === r.idx)) ed.sel.push(r); });
      }
      App.buildSidebar(); renderCad(); return;
    }
    if (ed.drag) { const wasVertex = ed.drag.mode === 'vertex' || ed.drag.mode === 'ctrl', moved = ed.drag.moved; ed.drag = null; if (wasVertex || moved) cadAfterEdit(); }
  }
  // Konturen in einem Aufziehfenster. p0→p1 links→rechts = „Fenster" (Objekt muss
  // vollständig innerhalb liegen); rechts→links = „Kreuzen" (Berühren genügt).
  function cadEntsInBox(p0, p1) {
    const x0 = Math.min(p0.x, p1.x), x1 = Math.max(p0.x, p1.x), y0 = Math.min(p0.y, p1.y), y1 = Math.max(p0.y, p1.y);
    const crossing = p1.x < p0.x;
    const inBox = p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    const edges = [[{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }], [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }]];
    const res = [];
    cadEntities().forEach(e => {
      if (!cadVisible(e.layer)) return;
      const loop = e.loop, n = loop.length, last = loop.closed ? n : n - 1;
      const allIn = loop.every(inBox);
      let touch = loop.some(inBox);
      if (!touch) for (let i = 0; i < last && !touch; i++) { const a = loop[i], b = loop[(i + 1) % n]; for (const eg of edges) { if (HotWire.segX(a, b, eg[0], eg[1])) { touch = true; break; } } }
      if (crossing ? touch : allIn) res.push({ layer: e.layer, idx: e.idx });
    });
    // Texte: Anker im Fenster (bei Fenster wie Kreuzen — Ankerpunkt zählt).
    (state.cad.texts || []).forEach((t, i) => { if (cadVisible(t.layer) && inBox({ x: t.x, y: t.y })) res.push({ tx: i }); });
    return res;
  }
  function cadFinishPolyline(closed) {
    const ed = state.cad.edit; if (!ed.draft || ed.draft.type !== 'poly' || ed.draft.pts.length < 2) { ed.draft = null; renderCad(); return; }
    const n0 = ed.draft.pts.length;
    cadPushUndo(); cadAddEntity(cadDefaultLayer(), App.mkLoopLocal(ed.draft.pts.map(p => ({ x: p.x, y: p.y })), !!closed)); ed.draft = null; ed.lastTool = 'polyline'; ed.tool = 'select'; cadLog(T('Polylinie mit ') + n0 + T(' Punkten') + (closed ? T(' (geschlossen)') : '') + '.'); cadAfterEdit();
  }
  // Weiche Kurve (Catmull-Rom) durch die Stützpunkte in eine Polylinie abtasten.
  function cadCatmullRom(pts, closed, seg) {
    const n = pts.length; if (n < 3) return pts.map(p => ({ x: p.x, y: p.y }));
    seg = seg || 16;
    const get = i => closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    const out = [], segEnd = closed ? n : n - 1;
    for (let i = 0; i < segEnd; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      for (let s = 0; s < seg; s++) {
        const t = s / seg, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        });
      }
    }
    if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
    return out;
  }
  function cadFinishSpline(closed) {
    const ed = state.cad.edit, dr = ed.draft;
    if (!dr || dr.type !== 'spline' || dr.pts.length < 2) { ed.draft = null; renderCad(); return; }
    const geom = dr.pts.length < 3 ? dr.pts.map(p => ({ x: p.x, y: p.y })) : cadCatmullRom(dr.pts, !!closed, Math.max(2, Math.round(ed.splineSeg || 48)));
    const loop = App.mkLoopLocal(geom, !!closed);
    loop.ctype = 'spline'; loop.cclosed = !!closed; loop.ctrl = dr.pts.map(p => ({ x: p.x, y: p.y }));   // als Spline bearbeitbar
    cadPushUndo(); cadAddEntity(cadDefaultLayer(), loop); ed.draft = null; ed.lastTool = 'spline'; ed.tool = 'select'; cadAfterEdit();
  }
  function cadFinishSplineTan() {
    const ed = state.cad.edit, dr = ed.draft;
    if (!dr || dr.type !== 'splinetan' || dr.pts.length < 2) { ed.draft = null; renderCad(); return; }
    // Endtangente: liegt der letzte Punkt auf einem Objekt?
    const last = dr.pts[dr.pts.length - 1], tg = cadTangentAt(last, 6);
    const geom = cadTangentSpline(dr.pts, dr.startTan, tg ? tg.tan : null);
    const loop = App.mkLoopLocal(geom, false);
    loop.ctype = 'splinetan'; loop.cclosed = false; loop.ctrl = dr.pts.map(p => ({ x: p.x, y: p.y }));
    if (dr.startTan) loop.startTan = { x: dr.startTan.x, y: dr.startTan.y };
    if (tg) loop.endTan = { x: tg.tan.x, y: tg.tan.y };
    cadPushUndo(); cadAddEntity(cadDefaultLayer(), loop);
    ed.draft = null; ed.lastTool = 'splinetan'; ed.tool = 'select'; cadAfterEdit();
    cadFlash(dr.startTan || tg ? 'Spline tangential angeschlossen.' : 'Spline erstellt.');
  }
  // Sampled-Kurve einer Spline-Kontur aus ihren Kontrollpunkten neu berechnen (in place).
  function cadRebuildCurve(loop) {
    if (!loop || !loop.ctrl || loop.ctrl.length < 2) return;
    let geom;
    if (loop.ctype === 'splinetan') geom = cadTangentSpline(loop.ctrl, loop.startTan || null, loop.endTan || null);
    else geom = loop.ctrl.length < 3 ? loop.ctrl.map(p => ({ x: p.x, y: p.y })) : cadCatmullRom(loop.ctrl, !!loop.cclosed, Math.max(2, Math.round(state.cad.edit.splineSeg || 48)));
    loop.length = 0; geom.forEach(p => loop.push({ x: p.x, y: p.y })); loop.closed = !!loop.cclosed;
  }
  // Nächster Kontroll-(Stütz-)Punkt einer Spline-Kontur zum Weltpunkt.
  function cadNearestCtrl(wpt, tolPx) {
    const V = cadDraw.V; let best = null, bd = tolPx * tolPx;
    cadEntities().forEach(e => { if (!cadVisible(e.layer) || !e.loop.ctrl) return; e.loop.ctrl.forEach((p, ci) => { const dx = V.X(p.x) - V.X(wpt.x), dy = V.Y(p.y) - V.Y(wpt.y), dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = { layer: e.layer, idx: e.idx, ci }; } }); });
    return best;
  }
  // Laufende Skizze abschließen (Polylinie, Spline oder Spline-tangential).
  function cadFinishDraft(closed) {
    const dr = state.cad.edit.draft; if (!dr) return;
    if (dr.type === 'spline') cadFinishSpline(closed);
    else if (dr.type === 'splinetan') cadFinishSplineTan();
    else cadFinishPolyline(closed);
  }
  function cadTranslateSelection(dx, dy, copy) {
    const d = state.cad, ed = d.edit;
    ed.sel.forEach(s => {
      if (s.tx != null) { const t = d.texts[s.tx]; if (!t) return; if (copy) d.texts.push(Object.assign({}, t, { x: t.x + dx, y: t.y + dy })); else { t.x += dx; t.y += dy; } return; }
      const loop = cadLoopOf(s); if (!loop) return;
      if (copy) { const cp = cadCloneLoop(loop); cp.forEach(p => { p.x += dx; p.y += dy; }); if (cp.ctrl) cp.ctrl.forEach(p => { p.x += dx; p.y += dy; }); cadAddEntity(s.layer, cp); }
      else { loop.forEach(p => { p.x += dx; p.y += dy; }); if (loop.ctrl) loop.ctrl.forEach(p => { p.x += dx; p.y += dy; }); }
    });
  }
  function cadMirrorSelection(p1, p2) {
    const ed = state.cad.edit, dx = p2.x - p1.x, dy = p2.y - p1.y, L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) { cadFlash('Spiegelachse zu kurz.'); return; }
    const refl = p => { const t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / L2, fx = p1.x + t * dx, fy = p1.y + t * dy; return { x: 2 * fx - p.x, y: 2 * fy - p.y }; };
    ed.sel.forEach(s => {
      if (s.tx != null) { const t = state.cad.texts[s.tx]; if (t) { const r = refl({ x: t.x, y: t.y }); state.cad.texts.push(Object.assign({}, t, { x: r.x, y: r.y })); } return; }
      const loop = cadLoopOf(s); if (loop) cadAddEntity(s.layer, App.mkLoopLocal(loop.map(refl).reverse(), loop.closed));
    });
  }
  // Verbinden (JOIN): gewählte offene Linien/Polylinien/Splines mit
  // zusammenfallenden Endpunkten zu Ketten zusammenfügen (schließt sich der
  // Zug -> geschlossen). Geschlossene Konturen der Auswahl bleiben erhalten.
  function cadJoinSelection() {
    const d = state.cad, ed = d.edit;
    if (ed.sel.length < 2) { cadFlash('Mindestens zwei Konturen auswählen.'); return; }
    const items = ed.sel.map(r => ({ r, loop: cadLoopOf(r) })).filter(x => x.loop);
    if (items.length < 2) return;
    cadPushUndo();
    const tol = (cadDraw && cadDraw.V) ? Math.max(0.05, 5 / cadDraw.V.s) : 0.5;
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
    const closedKeep = []; let open = [];
    items.forEach(x => { if (x.loop.closed) closedKeep.push(x.loop.map(p => ({ x: p.x, y: p.y }))); else open.push(x.loop.map(p => ({ x: p.x, y: p.y }))); });
    const result = []; let guard = 0;
    while (open.length && guard++ < 10000) {
      let cur = open.shift(), merged = true;
      while (merged) {
        merged = false;
        for (let k = 0; k < open.length; k++) {
          const o = open[k], ce = cur[cur.length - 1], cs = cur[0];
          if (near(ce, o[0])) cur = cur.concat(o.slice(1));
          else if (near(ce, o[o.length - 1])) cur = cur.concat(o.slice(0, -1).reverse());
          else if (near(cs, o[o.length - 1])) cur = o.slice(0, -1).concat(cur);
          else if (near(cs, o[0])) cur = o.slice().reverse().slice(0, -1).concat(cur);
          else continue;
          open.splice(k, 1); merged = true; break;
        }
      }
      const isClosed = cur.length > 2 && near(cur[0], cur[cur.length - 1]);
      if (isClosed) cur = cur.slice(0, -1);
      result.push(App.mkLoopLocal(cur, isClosed));
    }
    // Originale entfernen (Indizes je Layer absteigend), Ergebnis auf den aktiven Layer.
    const byLayer = {}; ed.sel.forEach(r => { (byLayer[r.layer] = byLayer[r.layer] || []).push(r.idx); });
    Object.keys(byLayer).forEach(L => byLayer[L].sort((a, b) => b - a).forEach(idx => d.layers[L] && d.layers[L].splice(idx, 1)));
    const active = ed.active && d.layers[ed.active] ? ed.active : ed.sel[0].layer;
    result.forEach(L => cadAddEntity(active, L));
    closedKeep.forEach(pts => cadAddEntity(active, App.mkLoopLocal(pts, true)));
    ed.sel = []; cadAfterEdit();
    cadFlash(T('Verbunden: ') + result.length + T(' Kette(n)') + (result.some(l => l.closed) ? T(' (geschlossen)') : '') + '.');
  }
  function cadPosPoint(loop, pos) { const n = loop.length, i = ((Math.floor(pos) % n) + n) % n, t = pos - Math.floor(pos), a = loop[i], b = loop[(i + 1) % n]; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function cadLoopSub(loop, fromPos, toPos) {
    const n = loop.length, pts = [cadPosPoint(loop, ((fromPos % n) + n) % n)]; let i = Math.floor(fromPos) + 1, guard = 0;
    while (i < toPos - 1e-9 && guard++ < n + 4) { const vi = ((i % n) + n) % n; pts.push({ x: loop[vi].x, y: loop[vi].y }); i++; }
    pts.push(cadPosPoint(loop, ((toPos % n) + n) % n)); return pts;
  }
  // Robuste Segment-Kreuzung inkl. Endpunkten (t,u in [0,1] mit kleiner Toleranz).
  // Rückgabe: Parameter t auf a→b oder null (parallel/kein Schnitt).
  function cadSegCross(a, b, c, d) {
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    const den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) return null;
    const qpx = c.x - a.x, qpy = c.y - a.y;
    const t = (qpx * sy - qpy * sx) / den, u = (qpx * ry - qpy * rx) / den;
    const e = 1e-9;
    if (t >= -e && t <= 1 + e && u >= -e && u <= 1 + e) return Math.max(0, Math.min(1, t));
    return null;
  }
  // Projektion eines Punktes auf ein Segment: {t (geklemmt), d (Abstand)}.
  function cadProjOnSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; t = Math.max(0, Math.min(1, t));
    return { t, d: Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) };
  }
  function cadTrimAt(wpt) {
    const h = cadHitEntity(wpt, 10); if (!h) { cadFlash('Keine Kontur getroffen.'); return; }
    const loop = cadLoopOf(h); if (!loop || loop.length < 2) return;
    const n = loop.length, closed = !!loop.closed, last = closed ? n : n - 1;
    const V = cadDraw && cadDraw.V, tolW = V ? Math.max(1e-4, 3 / V.s) : 0.3;   // ~3 px in Weltkoordinaten
    let cutPos = [];
    cadEntities().forEach(e => {
      if (e.layer === h.layer && e.idx === h.idx) return;
      const m = e.loop.length, mlast = e.loop.closed ? m : m - 1;
      for (let i = 0; i < last; i++) {
        const a = loop[i], b = loop[(i + 1) % n];
        // 1) Echte Segment-Kreuzungen (inkl. Endpunkte).
        for (let j = 0; j < mlast; j++) { const t = cadSegCross(a, b, e.loop[j], e.loop[(j + 1) % m]); if (t != null) cutPos.push(i + t); }
        // 2) Punkte der anderen Kontur, die GENAU auf diesem Segment liegen
        //    (z. B. eine Linie, die direkt am Kreuzungspunkt endet).
        e.loop.forEach(p => { const pr = cadProjOnSeg(p, a, b); if (pr.d <= tolW) cutPos.push(i + pr.t); });
      }
    });
    // Fast identische Kreuzungspositionen zusammenfassen.
    cutPos.sort((x, y) => x - y);
    cutPos = cutPos.filter((q, k) => k === 0 || q - cutPos[k - 1] > 1e-6);
    if (!cutPos.length) { cadFlash('Keine Kreuzung gefunden — nichts getrimmt.'); return; }
    cadPushUndo();
    const cp = h.seg + h.t, arr = state.cad.layers[h.layer]; let a = null, b = null;
    for (const q of cutPos) { if (q < cp - 1e-9) a = q; if (q > cp + 1e-9 && b === null) b = q; }
    if (closed) {
      if (a === null) a = cutPos[cutPos.length - 1]; if (b === null) b = cutPos[0];
      const keep = cadLoopSub(loop, b, a > b ? a : a + n); if (keep.length < 2) { cadFlash('Trimmen nicht eindeutig.'); return; }
      arr[h.idx] = App.mkLoopLocal(keep, false);
    } else {
      const parts = [];
      if (a !== null) { const p1 = cadLoopSub(loop, 0, a); if (p1.length >= 2) parts.push(App.mkLoopLocal(p1, false)); }
      if (b !== null) { const p2 = cadLoopSub(loop, b, last); if (p2.length >= 2) parts.push(App.mkLoopLocal(p2, false)); }
      if (!parts.length) { cadFlash('Trimmen nicht möglich (Klick liegt außerhalb der Kreuzungen).'); return; }
      arr.splice(h.idx, 1, ...parts);
    }
    state.cad.edit.sel = []; cadAfterEdit();
  }
  function cadToolLabel(t) { return ({ select: 'Auswählen', vertex: 'Punkt', delpt: 'Punkt löschen', line: 'Linie', rect: 'Rechteck', circle: 'Kreis', ellipse: 'Ellipse', polyline: 'Polylinie', spline: 'Spline', move: 'Verschieben', copy: 'Kopieren', mirror: 'Spiegeln', trim: 'Trimmen', erase: 'Löschen', measure: 'Messen', arc: 'Kreisbogen', splinetan: 'Spline tangential', offset: 'Versetzen',
    rotate: 'Drehen', scale: 'Skalieren', align: 'Ausrichten', array: 'Reihe', stretch: 'Strecken', fillet: 'Abrunden', chamfer: 'Fasen', extend: 'Dehnen', 'break': 'Bruch',
    point: 'Punkt setzen', xline: 'Hilfslinie', polygon: 'Polygon', dim: 'Bemaßung', origin: 'Ursprung', zoom: 'Zoom', area: 'Fläche', layer: 'Layer ändern', matchprop: 'Eigenschaften angleichen', explode: 'Auflösen', reverse: 'Umkehren' })[t] || t; }
  function cadToolHint(t) {
    switch (t) {
      case 'select': return T('Klick wählt eine Kontur (Umschalt = mehrere). Ziehen einer gewählten Kontur verschiebt sie. Aufziehfenster: links→rechts = nur vollständig umschlossene Konturen; rechts→links = auch berührte. Space/Enter beendet bzw. wiederholt den letzten Befehl.');
      case 'vertex': return T('Einen Konturpunkt anfassen und ziehen. Bei Splines werden die Stützpunkte (Kontrollpunkte) verschoben — die Kurve rechnet sich neu.');
      case 'delpt': return T('Auf einen Konturpunkt klicken, um ihn zu entfernen.');
      case 'line': return T('Startpunkt klicken, dann weitere Punkte — jede Strecke wird eine Linie (Kette). Enter beendet, S schließt zum Anfang, Z nimmt die letzte zurück.');
      case 'offset': return T('Versetzen (Offset): Abstand tippen (oder 2 Punkte klicken, oder D = durch Punkt), dann Objekt anklicken, dann die Seite anklicken. Wiederholt sich bis Enter/Esc.');
      case 'rect': return T('Zwei gegenüberliegende Ecken klicken — oder nach der 1. Ecke die Kantenlängen tippen: b x h (z. B. 100x60) bzw. eine Zahl = Quadrat.');
      case 'circle': return T('Mittelpunkt klicken, dann Radius klicken oder als Zahl tippen (D = Durchmesser). Vorher 2P = zwei Durchmesser-Endpunkte, 3P = drei Punkte auf dem Kreis.');
      case 'arc': return T('Kreisbogen: Startpunkt, dann einen Punkt auf dem Bogen, dann den Endpunkt klicken.');
      case 'ellipse': return T('Zwei gegenüberliegende Ecken des umschließenden Rechtecks klicken.');
      case 'polyline': return T('Nacheinander Punkte klicken. Enter/Doppelklick beendet; Taste C schließt die Kontur; nahe am Start = geschlossen.');
      case 'spline': return T('Stützpunkte klicken — eine weiche Kurve läuft hindurch. Enter/Doppelklick beendet; Taste C schließt; nahe am Start = geschlossen.');
      case 'splinetan': return T('Spline tangential: 1. Punkt auf ein Objekt setzen (Anfang tangential), weitere Stützpunkte klicken, letzten Punkt wieder auf ein Objekt für tangentiales Ende. Enter/Doppelklick beendet.');
      case 'move': return T('Objekte anklicken oder mit Fenster wählen, Enter — dann Basispunkt + Zielpunkt klicken (oder @dx,dy tippen). Vorauswahl wird übernommen.');
      case 'copy': return T('Wie Verschieben; nach dem Basispunkt beliebig viele Zielpunkte klicken (Mehrfachkopie), Enter beendet.');
      case 'mirror': return T('Objekte wählen, Enter, dann zwei Punkte der Spiegelachse klicken. Danach Abfrage „Quellobjekte löschen? [Ja/Nein]" (Enter = Nein).');
      case 'trim': return T('Auf den WEGZUSCHNEIDENDEN Teil einer Kontur klicken — er wird bis zur nächsten Kreuzung entfernt.');
      case 'erase': return T('Objekte anklicken oder mit Fenster wählen, Enter löscht. Ist bereits etwas gewählt, wird sofort gelöscht.');
      case 'rotate': return T('Objekte wählen, Basispunkt, dann Winkel tippen oder Punkt klicken. R = Referenz (Winkel über zwei Punkte, dann neuer Winkel), K = Kopie behalten.');
      case 'scale': return T('Objekte wählen, Basispunkt, dann Faktor tippen. R = Referenz (Referenzlänge über zwei Punkte oder Zahl, dann neue Länge), K = Kopie behalten.');
      case 'align': return T('Objekte wählen, dann 1. Quell-/Zielpunkt und 2. Quell-/Zielpunkt (verschiebt + dreht). Enter nach dem 1. Paar = nur verschieben. Zuletzt Abfrage, ob skaliert wird.');
      case 'array': return T('Objekte wählen, dann Rechteckig (Reihen, Spalten, Abstände) oder Polar (Mittelpunkt, Anzahl, Füllwinkel, mitdrehen).');
      case 'stretch': return T('Kreuzen-Fenster über die zu streckenden Ecken ziehen, dann Basis- und Zielpunkt. Nur die Punkte im Fenster wandern, der Rest bleibt.');
      case 'fillet': return T('R = Radius setzen, dann zwei Segmente/Linien an der Ecke anklicken. Radius 0 verbindet die Linien zur scharfen Ecke.');
      case 'chamfer': return T('A = Abstände setzen, dann zwei Segmente/Linien an der Ecke anklicken (erster Abstand gilt fürs erste Objekt).');
      case 'extend': return T('Offene Linie/Polylinie nahe dem Ende anklicken — sie wird bis zur nächsten Kontur in Verlängerung gedehnt.');
      case 'break': return T('Objekt am ersten Bruchpunkt anklicken, dann zweiten Bruchpunkt klicken (Teilstück fällt weg). @ oder gleicher Punkt = nur teilen. E = ersten Punkt neu setzen.');
      case 'point': return T('Markierungspunkt setzen (z. B. Holmlage, Bohrmitte). Punkte werden nicht exportiert.');
      case 'xline': return T('Unendliche Hilfslinie durch zwei Punkte oder H/V/W (horizontal, vertikal, Winkel). Liegt auf Layer „Hilfslinien", der nicht exportiert wird.');
      case 'polygon': return T('Anzahl Seiten, Mittelpunkt, ein-/umbeschrieben, Radius (Zahl oder Punkt).');
      case 'dim': return T('Zwei Messpunkte und die Textposition klicken — setzt den Abstand als Text auf Layer „Bemaßung" (keine Geometrie).');
      case 'origin': return T('Neuen Nullpunkt anklicken — alle Objekte werden so verschoben, dass dieser Punkt 0,0 wird (Export startet dort).');
      case 'zoom': return T('A = Alles, F = Fenster (zwei Punkte), O = auf Auswahl, V = vorherige Ansicht. Mausrad zoomt, mittlere Taste schiebt.');
      case 'area': return T('Kontur anklicken: geschlossen = Fläche und Umfang, offen = Länge.');
      case 'layer': return T('Objekte wählen, dann Ziellayer per Nummer/Klick wählen oder neuen Namen tippen.');
      case 'matchprop': return T('Quellobjekt anklicken, dann Zielobjekte wählen, Enter — die Ziele übernehmen den Layer (Farbe/Linienart) der Quelle.');
      case 'explode': return T('Polylinien/Splines/Kreise in einzelne Linien zerlegen. Umkehrung: Verbinden (J).');
      case 'reverse': return T('Laufrichtung der gewählten Konturen umdrehen (Schnittrichtung).');
      case 'measure': return T('Punkte klicken — zeigt Länge/Richtung des letzten Segments und den Winkel am mittleren Punkt. Erzeugt keine Geometrie. Enter/Esc beendet.');
      default: return '';
    }
  }
  let cadFlashT = 0;
  function cadFlash(msg) { const el = document.getElementById('cadInfo'); if (!el) return; el.textContent = T(msg); el.style.opacity = '1'; clearTimeout(cadFlashT); cadFlashT = setTimeout(() => { el.style.opacity = '0.6'; }, 2200); }
  // --- Zeichnen ---
  function renderCad() {
    const cv = document.getElementById('cCad'); if (!cv) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    const ents = cadEntities(), texts = state.cad.texts || [];
    // Basisausschnitt EINMAL einpassen und einfrieren (folgt NICHT den Objekten).
    if (!state.cad.view) {
      const all = ents.filter(e => cadVisible(e.layer)).map(e => e.loop).concat(texts.filter(t => cadVisible(t.layer)).map(t => [{ x: t.x, y: t.y }]));
      state.cad.view = all.length ? App.bounds.apply(null, all) : { minx: 0, maxx: 120, miny: 0, maxy: 80 };
    }
    const V = App.makeView(w, h, state.cad.view, 50, App.nav.cad); cadDraw = { V };
    const ed = state.cad.edit;
    if (state.cad.bg && state.cad.bg.img && state.cad.bg.visible) App.dxfDrawBg(ctx, V, state.cad.bg);
    if (ed.showGrid) cadDrawGrid(ctx, w, h, V);
    // Konturen je Layer.
    ents.forEach(e => {
      if (!cadVisible(e.layer)) return;
      const isSel = ed.sel.some(s => s.layer === e.layer && s.idx === e.idx);
      ctx.strokeStyle = isSel ? App.PAL.accent2 : cadLayerColor(e.layer); ctx.lineWidth = isSel ? 2.4 : 1.6;
      ctx.setLineDash(isSel ? [] : cadLayerDash(e.layer));
      if (e.loop.pt) { const x = V.X(e.loop[0].x), y = V.Y(e.loop[0].y); ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 6.3); ctx.stroke(); return; }
      App.poly(ctx, V, e.loop, !!e.loop.closed); ctx.stroke(); ctx.setLineDash([]);
    });
    // Spline-Kontrollpunkte + Stützpolygon (im Modus „Punkt verschieben" oder wenn gewählt).
    ents.forEach(e => {
      if (!e.loop.ctrl || !cadVisible(e.layer)) return;
      const isSel = ed.sel.some(s => s.layer === e.layer && s.idx === e.idx);
      if (ed.tool !== 'vertex' && ed.tool !== 'delpt' && !isSel) return;
      ctx.save(); ctx.strokeStyle = App.hexA(App.PAL.accent2 || '#ffb454', 0.55); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      App.poly(ctx, V, e.loop.ctrl, !!e.loop.cclosed); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = App.PAL.accent2 || '#ffb454';
      e.loop.ctrl.forEach(p => { ctx.beginPath(); ctx.arc(V.X(p.x), V.Y(p.y), 3, 0, 6.3); ctx.fill(); });
      ctx.restore();
    });
    // Textelemente (Maßtexte etc.).
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    texts.forEach((t, i) => {
      if (!cadVisible(t.layer)) return;
      const isSel = ed.sel.some(s => s.tx === i);
      ctx.fillStyle = isSel ? App.PAL.accent2 : cadLayerColor(t.layer);
      ctx.font = Math.max(8, (t.h || 3) * V.s) + 'px Segoe UI';
      const px = V.X(t.x), py = V.Y(t.y);
      if (t.rot) { ctx.save(); ctx.translate(px, py); ctx.rotate(-t.rot * Math.PI / 180); ctx.fillText(t.text, 0, 0); ctx.restore(); }
      else ctx.fillText(t.text, px, py);
    });
    cadOverlay(ctx, V, w, h);
  }
  function cadDrawGrid(ctx, w, h, V) {
    const step = state.cad.edit.gridStep || 10;
    const p0 = V.inv(0, h), p1 = V.inv(w, 0);
    const x0 = Math.floor(Math.min(p0.x, p1.x) / step) * step, x1 = Math.max(p0.x, p1.x);
    const y0 = Math.floor(Math.min(p0.y, p1.y) / step) * step, y1 = Math.max(p0.y, p1.y);
    if ((x1 - x0) / step > 800 || (y1 - y0) / step > 800) return;
    ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x += step) { ctx.strokeStyle = Math.abs(x) < 1e-6 ? 'rgba(120,140,160,.5)' : 'rgba(90,105,120,.16)'; const px = V.X(x); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); }
    for (let y = y0; y <= y1; y += step) { ctx.strokeStyle = Math.abs(y) < 1e-6 ? 'rgba(120,140,160,.5)' : 'rgba(90,105,120,.16)'; const py = V.Y(y); ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke(); }
  }
  function cadOverlay(ctx, V, w, h) {
    const ed = state.cad.edit, hv = ed.hover;
    // Koordinatenursprung (0,0) mit kurzen Achsen (X rot, Y grün).
    if (ed.showOrigin) {
      const ox = V.X(0), oy = V.Y(0);
      if (ox > -40 && ox < w + 40 && oy > -40 && oy < h + 40) {
        ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 1.3;
        ctx.strokeStyle = App.PAL.bad || '#ff3b3b'; ctx.beginPath(); ctx.moveTo(ox - 12, oy); ctx.lineTo(ox + 24, oy); ctx.stroke();   // X-Achse
        ctx.strokeStyle = App.PAL.good || '#57d38c'; ctx.beginPath(); ctx.moveTo(ox, oy + 12); ctx.lineTo(ox, oy - 24); ctx.stroke();   // Y-Achse (oben)
        ctx.strokeStyle = App.PAL.origin || '#ff3b3b'; ctx.beginPath(); ctx.arc(ox, oy, 3, 0, 6.3); ctx.stroke();
        ctx.font = '10px Consolas, monospace'; ctx.textBaseline = 'top';
        ctx.fillStyle = App.PAL.muted || '#8b98a8'; ctx.textAlign = 'left'; ctx.fillText('0,0', ox + 5, oy + 4);
        ctx.fillStyle = App.PAL.bad || '#ff3b3b'; ctx.fillText('X', ox + 24, oy - 11);
        ctx.fillStyle = App.PAL.good || '#57d38c'; ctx.textAlign = 'center'; ctx.fillText('Y', ox, oy - 34);
        ctx.restore();
      }
    }
    // „Mitte zwischen 2 Punkten": 1. Punkt + provisorischer Mittelpunkt.
    if (ed.m2p && ed.m2p.pts.length) {
      const p0 = ed.m2p.pts[0], x0 = V.X(p0.x), y0 = V.Y(p0.y);
      ctx.save(); ctx.strokeStyle = '#ffd27f'; ctx.lineWidth = 1.4; ctx.setLineDash([]); ctx.strokeRect(x0 - 3, y0 - 3, 6, 6);
      if (hv) {
        ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke();
        const cmx = V.X((p0.x + hv.x) / 2), cmy = V.Y((p0.y + hv.y) / 2);
        ctx.setLineDash([]); ctx.strokeStyle = '#57d38c'; ctx.beginPath(); ctx.moveTo(cmx - 5, cmy); ctx.lineTo(cmx + 5, cmy); ctx.moveTo(cmx, cmy - 5); ctx.lineTo(cmx, cmy + 5); ctx.stroke();
      }
      ctx.restore();
    }
    // Aufziehfenster für die Auswahl.
    if (ed.drag && ed.drag.mode === 'box') {
      const s = ed.drag.start, c = ed.drag.cur, crossing = c.x < s.x;
      const x = V.X(s.x), y = V.Y(s.y), x2 = V.X(c.x), y2 = V.Y(c.y);
      const rx = Math.min(x, x2), ry = Math.min(y, y2), rw = Math.abs(x2 - x), rh = Math.abs(y2 - y);
      ctx.save(); ctx.lineWidth = 1.2; ctx.strokeStyle = crossing ? '#57d38c' : '#4aa3ff';
      ctx.fillStyle = crossing ? 'rgba(87,211,140,.10)' : 'rgba(74,163,255,.10)';
      ctx.setLineDash(crossing ? [5, 4] : []); ctx.fillRect(rx, ry, rw, rh); ctx.strokeRect(rx, ry, rw, rh); ctx.restore();
    }
    if (hv) {   // Fadenkreuz (immer an); Größe in % der Fläche, 100 = durchgehend
      const cx = V.X(hv.x), cy = V.Y(hv.y), pc = Math.max(1, Math.min(100, ed.crossSize || 100)), full = pc >= 100, arm = Math.min(w, h) * pc / 200;
      ctx.strokeStyle = App.hexA(App.PAL.crosshair, 0.55); ctx.lineWidth = 1; ctx.setLineDash(full ? [4, 4] : []); ctx.beginPath();
      if (full) { ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.moveTo(0, cy); ctx.lineTo(w, cy); }
      else { ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm); ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (ed.draft && hv) {
      ctx.strokeStyle = '#57d38c'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); const dr = ed.draft;
      if (dr.type === 'line') { ctx.beginPath(); ctx.moveTo(V.X(dr.p0.x), V.Y(dr.p0.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); }
      else if (dr.type === 'rect') { const x0 = V.X(dr.p0.x), y0 = V.Y(dr.p0.y), x1 = V.X(hv.x), y1 = V.Y(hv.y); ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
      else if (dr.type === 'circle') {
        if (dr.mode === '2p') { if (dr.pts.length) { const a = dr.pts[0], rr = Math.hypot(V.X(hv.x) - V.X(a.x), V.Y(hv.y) - V.Y(a.y)) / 2; ctx.beginPath(); ctx.arc((V.X(a.x) + V.X(hv.x)) / 2, (V.Y(a.y) + V.Y(hv.y)) / 2, rr, 0, 6.3); ctx.stroke(); } }
        else if (dr.mode === '3p') {
          const c = dr.pts.length >= 2 ? cadCircleFrom3(dr.pts[0], dr.pts[1], hv) : null;
          if (c) { ctx.beginPath(); ctx.arc(V.X(c.x), V.Y(c.y), c.r * V.s, 0, 6.3); ctx.stroke(); }
          else if (dr.pts.length === 1) { ctx.beginPath(); ctx.moveTo(V.X(dr.pts[0].x), V.Y(dr.pts[0].y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); }
          dr.pts.forEach(p => ctx.strokeRect(V.X(p.x) - 2, V.Y(p.y) - 2, 4, 4));
        }
        else { let rr = Math.hypot(V.X(hv.x) - V.X(dr.c.x), V.Y(hv.y) - V.Y(dr.c.y)); if (dr.ask === 'd') rr /= 2; ctx.beginPath(); ctx.arc(V.X(dr.c.x), V.Y(dr.c.y), rr, 0, 6.3); ctx.stroke(); }
      }
      else if (dr.type === 'rotate' && dr.base) {
        if (dr.phase === 'angle' || dr.phase === 'refnew') { const a = dr.phase === 'angle' ? cadAng(dr.base, hv) : cadAng(dr.base, hv) - cadAng(dr.r1, dr.r2); cadPreviewSel(ctx, V, cadRot(dr.base, a)); }
        ctx.beginPath(); ctx.moveTo(V.X(dr.base.x), V.Y(dr.base.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke();
        ctx.fillStyle = '#57d38c'; ctx.font = '11px Consolas, monospace'; ctx.fillText(((cadAng(dr.base, hv) / D2R + 360) % 360).toFixed(1) + '°', V.X(hv.x) + 10, V.Y(hv.y) + 14);
      }
      else if (dr.type === 'scale' && dr.base) {
        if (dr.phase === 'factor') cadPreviewSel(ctx, V, cadScl(dr.base, cadDist(dr.base, hv)));
        else if (dr.phase === 'refnew') { const rl = dr.refLen || cadDist(dr.r1, dr.r2); if (rl > 1e-9) cadPreviewSel(ctx, V, cadScl(dr.base, cadDist(dr.base, hv) / rl)); }
        ctx.beginPath(); ctx.moveTo(V.X(dr.base.x), V.Y(dr.base.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke();
      }
      else if (dr.type === 'align') {
        const src = dr.phase === 't1' ? dr.s1 : dr.phase === 't2' ? dr.s2 : null;
        if (src) { ctx.beginPath(); ctx.moveTo(V.X(src.x), V.Y(src.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); }
        if (dr.s1 && dr.t1) { ctx.save(); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(V.X(dr.s1.x), V.Y(dr.s1.y)); ctx.lineTo(V.X(dr.t1.x), V.Y(dr.t1.y)); ctx.stroke(); ctx.restore(); }
      }
      else if (dr.type === 'stretch' && dr.base && dr.phase === 'dest') {
        const dx = hv.x - dr.base.x, dy = hv.y - dr.base.y, moved = {};
        dr.verts.forEach(v => { if (v.tx == null) moved[v.layer + ':' + v.idx + ':' + v.vi] = true; });
        ctx.save(); ctx.setLineDash([5, 4]);
        ed.sel.forEach(s => { const l = cadLoopOf(s); if (!l || l.ctrl) return; ctx.beginPath(); l.forEach((p, i) => { const m = moved[s.layer + ':' + s.idx + ':' + i], x = p.x + (m ? dx : 0), y = p.y + (m ? dy : 0); i ? ctx.lineTo(V.X(x), V.Y(y)) : ctx.moveTo(V.X(x), V.Y(y)); }); if (l.closed) ctx.closePath(); ctx.stroke(); });
        ctx.restore(); ctx.beginPath(); ctx.moveTo(V.X(dr.base.x), V.Y(dr.base.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke();
      }
      else if ((dr.type === 'fillet' || dr.type === 'chamfer') && dr.a) {
        const l = cadLoopOf(dr.a); if (l) { const a = l[dr.a.seg], b = l[(dr.a.seg + 1) % l.length]; ctx.save(); ctx.strokeStyle = '#ffd27f'; ctx.setLineDash([]); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(V.X(a.x), V.Y(a.y)); ctx.lineTo(V.X(b.x), V.Y(b.y)); ctx.stroke(); ctx.restore(); }
      }
      else if (dr.type === 'break' && dr.ref) {
        const l = cadLoopOf(dr.ref); if (l) { const p = cadPosPoint(l, dr.pos1); ctx.save(); ctx.strokeStyle = '#ffd27f'; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(V.X(p.x), V.Y(p.y), 5, 0, 6.3); ctx.stroke(); if (dr.phase === 'second') { const q = cadDistToLoop(l, hv); const p2 = cadPosPoint(l, q.seg + q.t); ctx.strokeRect(V.X(p2.x) - 4, V.Y(p2.y) - 4, 8, 8); } ctx.restore(); }
      }
      else if (dr.type === 'xline') {
        let ang = null; if (dr.mode === 'h') ang = 0; else if (dr.mode === 'v') ang = Math.PI / 2; else if (dr.mode === 'a') ang = (dr.ang || 0) * D2R;
        const p = dr.phase === 'p2' ? dr.p1 : hv; if (dr.phase === 'p2' && ang == null && cadDist(p, hv) > 1e-9) ang = cadAng(p, hv);
        if (ang != null) { const c = Math.cos(ang), s = Math.sin(ang), L = 1e4; ctx.beginPath(); ctx.moveTo(V.X(p.x - c * L), V.Y(p.y - s * L)); ctx.lineTo(V.X(p.x + c * L), V.Y(p.y + s * L)); ctx.stroke(); }
      }
      else if (dr.type === 'polygon' && dr.phase === 'radius' && dr.center) {
        const r = cadDist(dr.center, hv); if (r > 1e-6) { const pg = cadMakePolygon(dr.center, dr.n, r, dr.circum, cadAng(dr.center, hv)); ctx.beginPath(); pg.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); ctx.closePath(); ctx.stroke(); }
      }
      else if (dr.type === 'dim' && dr.pts.length) {
        const P = dr.pts, a = P[0], b = P.length > 1 ? P[1] : hv; ctx.beginPath(); ctx.moveTo(V.X(a.x), V.Y(a.y)); ctx.lineTo(V.X(b.x), V.Y(b.y)); ctx.stroke();
        const L = cadDist(a, b), pos = P.length > 1 ? hv : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.fillStyle = '#ffb454'; ctx.font = '11px Consolas, monospace'; ctx.textAlign = 'center'; ctx.fillText(L.toFixed(2), V.X(pos.x), V.Y(pos.y) - 4); ctx.textAlign = 'left';
      }
      else if (dr.type === 'zoom' && dr.phase === 'w2' && dr.p0) { ctx.strokeRect(Math.min(V.X(dr.p0.x), V.X(hv.x)), Math.min(V.Y(dr.p0.y), V.Y(hv.y)), Math.abs(V.X(hv.x) - V.X(dr.p0.x)), Math.abs(V.Y(hv.y) - V.Y(dr.p0.y))); }
      else if (dr.type === 'origin') { ctx.beginPath(); ctx.moveTo(V.X(hv.x) - 14, V.Y(hv.y)); ctx.lineTo(V.X(hv.x) + 14, V.Y(hv.y)); ctx.moveTo(V.X(hv.x), V.Y(hv.y) - 14); ctx.lineTo(V.X(hv.x), V.Y(hv.y) + 14); ctx.stroke(); }
      else if (dr.type === 'offset') {
        if (dr.phase === 'dist' && dr.dp0) { ctx.beginPath(); ctx.moveTo(V.X(dr.dp0.x), V.Y(dr.dp0.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); }
        else if ((dr.phase === 'side' || dr.phase === 'through') && dr.ref) {
          const loop = cadLoopOf(dr.ref);
          if (loop) {
            const sd = cadSideOf(loop, hv), dist = dr.phase === 'through' ? sd.dist : dr.dist, res = dist > 1e-6 ? cadOffsetLoop(loop, sd.sign * dist) : null;
            ctx.save(); ctx.strokeStyle = '#ffd27f'; ctx.setLineDash([]); ctx.lineWidth = 2; ctx.beginPath(); loop.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); if (loop.closed) ctx.closePath(); ctx.stroke(); ctx.restore();
            if (res) { ctx.beginPath(); res.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); if (res.closed) ctx.closePath(); ctx.stroke(); }
          }
        }
      }
      else if (dr.type === 'ellipse') { const cx = V.X((dr.p0.x + hv.x) / 2), cy = V.Y((dr.p0.y + hv.y) / 2), rx = Math.abs(V.X(hv.x) - V.X(dr.p0.x)) / 2, ry = Math.abs(V.Y(hv.y) - V.Y(dr.p0.y)) / 2; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.3); ctx.stroke(); }
      else if (dr.type === 'poly') { ctx.beginPath(); dr.pts.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); }
      else if (dr.type === 'spline') {
        const cps = dr.pts.concat([hv]);
        // Stützpolygon gepunktet, weiche Kurve durchgezogen.
        ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = App.hexA('#57d38c', 0.5); ctx.beginPath();
        cps.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); ctx.stroke(); ctx.restore();
        const sm = cps.length >= 3 ? cadCatmullRom(cps, false, 12) : cps;
        ctx.beginPath(); sm.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); ctx.stroke();
        cps.forEach(p => ctx.strokeRect(V.X(p.x) - 2, V.Y(p.y) - 2, 4, 4));
      }
      else if (dr.type === 'splinetan') {
        const cps = dr.pts.concat([hv]);
        ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = App.hexA('#57d38c', 0.5); ctx.beginPath();
        cps.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); ctx.stroke(); ctx.restore();
        const etg = cadTangentAt(hv, 8);   // Endtangente, falls Hover auf Objekt
        const sm = cadTangentSpline(cps, dr.startTan, etg ? etg.tan : null);
        ctx.beginPath(); sm.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); ctx.stroke();
        cps.forEach(p => ctx.strokeRect(V.X(p.x) - 2, V.Y(p.y) - 2, 4, 4));
      }
      else if (dr.type === 'move') { if (dr.base) { ctx.beginPath(); ctx.moveTo(V.X(dr.base.x), V.Y(dr.base.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); } }
      else if (dr.type === 'arc') {
        const pts = dr.pts.concat([hv]);
        pts.forEach(p => ctx.strokeRect(V.X(p.x) - 2, V.Y(p.y) - 2, 4, 4));
        ctx.beginPath();
        if (pts.length <= 2) { ctx.moveTo(V.X(pts[0].x), V.Y(pts[0].y)); ctx.lineTo(V.X(pts[pts.length - 1].x), V.Y(pts[pts.length - 1].y)); }
        else { const g = cadArcPoints(pts[0], pts[1], pts[2]); g.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); }
        ctx.stroke();
      }
      else if (dr.type === 'mirror') { if (dr.p1) { const q = dr.p2 || hv; ctx.beginPath(); ctx.moveTo(V.X(dr.p1.x), V.Y(dr.p1.y)); ctx.lineTo(V.X(q.x), V.Y(q.y)); ctx.stroke(); } }
      else if (dr.type === 'measure') {
        ctx.save();
        const col = App.PAL.accent2 || '#ffb454', pts = dr.pts.concat(hv ? [hv] : []);
        ctx.strokeStyle = col; ctx.setLineDash([6, 4]); ctx.beginPath();
        pts.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); ctx.stroke();
        ctx.setLineDash([]); pts.forEach(p => ctx.strokeRect(V.X(p.x) - 2, V.Y(p.y) - 2, 4, 4));
        ctx.fillStyle = col; ctx.font = '11px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 1e-6) continue; ctx.fillText(len.toFixed(1), (V.X(a.x) + V.X(b.x)) / 2, (V.Y(a.y) + V.Y(b.y)) / 2 - 3); }
        for (let i = 1; i < pts.length - 1; i++) { const v = pts[i - 1], o = pts[i], b = pts[i + 1]; const a1 = Math.atan2(v.y - o.y, v.x - o.x), a2 = Math.atan2(b.y - o.y, b.x - o.x); let da = Math.abs((a2 - a1) * 180 / Math.PI) % 360; if (da > 180) da = 360 - da; ctx.fillText(da.toFixed(0) + '°', V.X(o.x), V.Y(o.y) - 4); }
        ctx.restore();
      }
      ctx.setLineDash([]);
    }
    if (hv) {
      const mx = V.X(hv.x), my = V.Y(hv.y); ctx.strokeStyle = ed.snapHit ? '#ffd27f' : '#57d38c'; ctx.lineWidth = 1.6; ctx.setLineDash([]);
      const k = ed.snapHit ? ed.snapKind : null;
      if (k === 'mid') { ctx.beginPath(); ctx.moveTo(mx, my - 6); ctx.lineTo(mx + 6, my + 5); ctx.lineTo(mx - 6, my + 5); ctx.closePath(); ctx.stroke(); }
      else if (k === 'center') { ctx.beginPath(); ctx.arc(mx, my, 6, 0, 6.3); ctx.stroke(); ctx.beginPath(); ctx.arc(mx, my, 1.2, 0, 6.3); ctx.stroke(); }
      else if (k === 'perp') { ctx.beginPath(); ctx.moveTo(mx - 6, my - 6); ctx.lineTo(mx - 6, my + 6); ctx.lineTo(mx + 6, my + 6); ctx.moveTo(mx - 6, my + 1); ctx.lineTo(mx + 1, my + 1); ctx.lineTo(mx + 1, my + 6); ctx.stroke(); }
      else if (k === 'near') { ctx.beginPath(); ctx.moveTo(mx - 6, my - 6); ctx.lineTo(mx + 6, my + 6); ctx.moveTo(mx + 6, my - 6); ctx.lineTo(mx - 6, my + 6); ctx.stroke(); }
      else if (k === 'int') { ctx.beginPath(); ctx.moveTo(mx - 7, my - 7); ctx.lineTo(mx + 7, my + 7); ctx.moveTo(mx + 7, my - 7); ctx.lineTo(mx - 7, my + 7); ctx.stroke(); ctx.strokeRect(mx - 7, my - 7, 14, 14); }
      else if (k === 'quad') { ctx.beginPath(); ctx.moveTo(mx, my - 7); ctx.lineTo(mx + 7, my); ctx.lineTo(mx, my + 7); ctx.lineTo(mx - 7, my); ctx.closePath(); ctx.stroke(); }
      else if (k === 'tan') { ctx.beginPath(); ctx.arc(mx, my, 5, 0, 6.3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(mx - 8, my - 6); ctx.lineTo(mx + 8, my - 6); ctx.stroke(); }
      else if (k === 'end') ctx.strokeRect(mx - 5, my - 5, 10, 10);
    }
    cadUpdateDyn(V, w, h);
    cadUpdatePrompt();
    const read = document.getElementById('cadCoordRead');
    if (hv) {
      const ref = cadDraftRef(); let txt = 'X ' + hv.x.toFixed(1) + '  Y ' + hv.y.toFixed(1);
      if (ref) { const dx = hv.x - ref.x, dy = hv.y - ref.y, len = Math.hypot(dx, dy), ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; txt += '   Δ ' + dx.toFixed(1) + ',' + dy.toFixed(1) + '   L ' + len.toFixed(1) + '  ∠ ' + ang.toFixed(1) + '°'; }
      if (!cadDynVisible) { ctx.fillStyle = '#cfe3ff'; ctx.font = '11px Consolas, monospace'; ctx.fillText('X ' + hv.x.toFixed(1) + ' Y ' + hv.y.toFixed(1), V.X(hv.x) + 9, V.Y(hv.y) - 9); }
      if (read && document.activeElement !== document.getElementById('cadCoordInput')) read.textContent = txt;
    } else if (read) read.textContent = T('Cursor über die Fläche bewegen …');
  }
  // --- Brücken: Geometrie importieren ---
  function cadClearAsk() { const d = state.cad; return !cadEntities().length || confirm(T('Vorhandene CAD-Geometrie ersetzen?')); }
  function cadLoadFromDxf() {
    const d = state.dxf; if (!d.layers || !d.order.length) { cadFlash('Keine DXF-Formen geladen.'); return; }
    if (!cadClearAsk()) return; cadPushUndo();
    const c = state.cad; c.layers = {}; c.order = []; c.texts = []; c.layerColors = {}; c.layerHidden = {}; c.lineStyles = {};
    d.order.forEach(name => { const arr = d.layers[name]; if (!arr) return; cadEnsureLayer(name); arr.forEach(loop => cadAddEntity(name, App.mkLoopLocal(loop.map(p => ({ x: p.x, y: p.y })), loop.closed))); });
    c.edit.active = c.order[0] || null; c.edit.sel = []; c.edit.draft = null;
    state.cad.view = null; App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; App.buildSidebar(); renderCad(); cadFlash('Aus DXF-Formen geladen.');
  }
  // Fremde DXF-Datei importieren (Linien, Polylinien, Kreise, Bögen, Splines …).
  // Dxf.parse tesselliert Bögen/Kreise/Splines zu Punkt-Loops je Layer.
  function cadImportDxfText(text, name) {
    let parsed; try { parsed = Dxf.parse(text); } catch (e) { cadFlash(T('DXF-Import fehlgeschlagen: ') + e.message); return; }
    if (!parsed || !parsed.order || !parsed.order.length) { cadFlash('Keine Geometrie in der DXF.'); return; }
    if (!cadClearAsk()) return;
    cadPushUndo();
    const c = state.cad; c.layers = {}; c.order = []; c.texts = []; c.layerColors = {}; c.layerHidden = {}; c.lineStyles = {};
    parsed.order.forEach(ln => { const arr = parsed.layers[ln]; if (!arr) return; arr.forEach(loop => { if (loop && loop.length >= 2) { cadEnsureLayer(ln); cadAddEntity(ln, App.mkLoopLocal(loop.map(p => ({ x: p.x, y: p.y })), !!loop.closed)); } }); });
    if (!c.order.length) { cadFlash('Keine Konturen in der DXF.'); return; }
    c.edit.active = c.order[0] || null; c.edit.sel = []; c.edit.draft = null;
    state.cad.view = null; App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; App.buildSidebar(); renderCad();
    cadFlash(T('DXF-Datei geladen') + (name ? ': ' + name : '') + '.');
  }
  function cadImportDxfFile() { App.loadVia({ 'application/dxf': ['.dxf'] }, (t, nm) => cadImportDxfText(t, nm), 'fileCadDxf', 'ldCadDxf'); }
  // Verfügbarkeit der Export-Inhalte anhand des aktuellen Designs (für die
  // dynamischen Checkboxen im CAD-Import).
  // ---- Tragflächen-Auswahl für die Importe (mehrere Tragflächen, wings.js) ----
  // state.cadWingIds = Kennungen der gewählten Tragflächen; leer/ungültig = aktive.
  function cadMultiWing() { return !!(App.wingList && App.withWing && App.wingList().length > 1); }
  function cadWingSel() {
    if (!cadMultiWing()) return [state.activeWing || 0];
    const L = App.wingList(), ids = Array.isArray(state.cadWingIds) ? state.cadWingIds : [];
    const idx = L.map((w, i) => ids.indexOf(App.wingId(i)) >= 0 ? i : -1).filter(i => i >= 0);
    return idx.length ? idx : [state.activeWing || 0];
  }
  // Nur die aktive Tragfläche gewählt? (dann gilt die Segmentauswahl S1…Sn)
  function cadWingSelIsActive() { const s = cadWingSel(); return s.length === 1 && s[0] === (state.activeWing || 0); }
  // fn je gewählter Tragfläche mit dieser als aktiver Tragfläche ausführen.
  function cadForWings(fn) {
    const multi = cadMultiWing();
    return cadWingSel().map(i => {
      const run = () => fn(i, multi ? App.wingName(i) : null);
      return multi ? App.withWing(i, run) : run();
    });
  }
  // Umschalt-Knöpfe je Tragfläche + „Alle".
  function cadWingPicker(body) {
    if (!cadMultiWing()) return;
    const L = App.wingList(), sel = cadWingSel();
    App.hint(body, 'Tragflächen für den Import aus Tragflächen-/Kern-/Negativ- und Rippendesign (mehrere werden untereinander angeordnet):');
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin-bottom:6px';
    const paint = (b, on) => { if (on) { b.style.background = 'var(--accent)'; b.style.color = '#04121f'; b.style.borderColor = 'var(--accent)'; } };
    const setIdx = arr => { state.cadWingIds = arr.slice().sort((a, b) => a - b).map(i => App.wingId(i)); App.buildSidebar(); renderCad(); };
    L.forEach((w, i) => {
      const b = document.createElement('button');
      b.textContent = (i + 1) + ' · ' + App.wingName(i); b.title = App.wingName(i);
      b.style.overflow = 'hidden'; b.style.textOverflow = 'ellipsis'; b.style.whiteSpace = 'nowrap';
      paint(b, sel.indexOf(i) >= 0);
      b.onclick = () => {
        let arr = sel.slice();
        if (arr.indexOf(i) >= 0) arr = arr.filter(x => x !== i); else arr.push(i);
        if (!arr.length) return;   // mindestens eine Tragfläche bleibt gewählt
        setIdx(arr);
      };
      grid.appendChild(b);
    });
    const all = document.createElement('button'); all.textContent = T('Alle');
    paint(all, sel.length === L.length);
    all.onclick = () => setIdx(L.map((_, i) => i));
    grid.appendChild(all);
    body.appendChild(grid);
  }
  // Mehrere Tragflächen: Layername mit Tragflächen-Namen voranstellen.
  function cadWingLayer(wname, layer) { return wname ? wname + ' · ' + layer : layer; }
  // Blöcke (je Tragfläche) untereinander verschieben: liefert dy je Block.
  function cadStackOffsets(boxes, gap) {
    let bottom = null;
    return boxes.map(b => {
      if (!b || !isFinite(b.miny)) return 0;
      const dy = bottom == null ? 0 : (bottom - gap) - b.maxy;
      bottom = b.miny + dy;
      return dy;
    });
  }

  function cadExportAvail() {
    const one = () => {
      const haveWing = !!(App.wing && App.wing.cuts && App.wing.cuts.length);
      const haveSpars = !!(state.spars && state.spars.length);
      let haveSheet = (state.cfg.sheeting || 0) > 0 || (state.cfg.sheetTop || 0) > 0 || (state.cfg.sheetBot || 0) > 0;
      if (!haveSheet && haveWing && state.segments) {
        try { haveSheet = state.segments.some(s => { const sf = App.sheetFor(s); return sf && (sf.root.top || sf.root.bot || sf.tip.top || sf.tip.bot); }); } catch (e) {}
      }
      return { haveWing, haveSpars, haveSheet };
    };
    // Über alle gewählten Tragflächen zusammenfassen.
    const r = cadForWings(one);
    return { haveWing: r.some(x => x.haveWing), haveSpars: r.some(x => x.haveSpars), haveSheet: r.some(x => x.haveSheet),
      segCount: state.segments ? state.segments.length : 0 };
  }
  // Geometrie gemäß aktueller Auswahl (state.dxfExport) in den CAD-Editor laden.
  // Nutzt denselben Erzeuger wie der frühere DXF-Export (buildDxfExportLayers).
  // Maßtexte werden nicht übernommen (CAD kennt nur Konturen), Maßlinien schon.
  // Mehrere Tragflächen: je Tragfläche ein Block, untereinander, Layer mit Namen.
  function cadImportSelection(label) {
    const segsForAll = !cadWingSelIsActive();   // Segmentauswahl gilt nur für die aktive Tragfläche allein
    let err = null;
    const blocks = cadForWings((wi, wname) => {
      if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) return null;
      const ex = state.dxfExport, s0 = ex.segs;
      if (segsForAll) ex.segs = null;
      try { return { wname, layers: App.buildDxfExportLayers() }; }
      catch (e) { err = e; return null; }
      finally { ex.segs = s0; }
    }).filter(b => b && b.layers && b.layers.length);
    if (err && !blocks.length) { cadFlash(T('Fehler: ') + err.message); return; }
    if (!blocks.length) {
      const anyWing = cadForWings(() => !!(App.wing && App.wing.cuts && App.wing.cuts.length)).some(Boolean);
      cadFlash(anyWing ? 'Nichts erzeugt — Auswahl/Design prüfen.' : 'Keine Tragfläche vorhanden.'); return;
    }
    if (!cadClearAsk()) return;
    cadPushUndo();
    // Mehrere Blöcke untereinander anordnen.
    const boxes = blocks.map(b => {
      let miny = Infinity, maxy = -Infinity, minx = Infinity;
      b.layers.forEach(l => {
        (l.polys || []).forEach(p => (p.pts || []).forEach(q => { if (q.y < miny) miny = q.y; if (q.y > maxy) maxy = q.y; if (q.x < minx) minx = q.x; }));
        (l.texts || []).forEach(t => { if (t.y < miny) miny = t.y; if (t.y > maxy) maxy = t.y; });
      });
      return { miny, maxy, minx };
    });
    const dys = cadStackOffsets(boxes, 60);
    const c = state.cad; c.layers = {}; c.order = []; c.texts = []; c.layerColors = {}; c.layerHidden = {}; c.lineStyles = {};
    blocks.forEach((b, bi) => {
      const dy = dys[bi], layers = b.layers;
      if (b.wname && isFinite(boxes[bi].maxy)) {
        cadEnsureLayer('Tragflächen-Namen');
        c.texts.push({ x: isFinite(boxes[bi].minx) ? boxes[bi].minx : 0, y: boxes[bi].maxy + dy + 12, h: 8, text: b.wname, rot: 0, layer: 'Tragflächen-Namen' });
      }
      layers.forEach(l0 => {
        const l = Object.assign({}, l0, { name: cadWingLayer(b.wname, l0.name) });
        if (l.polys) l.polys.forEach(p => { if (p.pts && p.pts.length >= 2) { cadEnsureLayer(l.name); cadAddEntity(l.name, App.mkLoopLocal(p.pts.map(q => ({ x: q.x, y: q.y + dy })), !!p.closed)); } });
        if (l.texts) l.texts.forEach(t => { if (t.text != null && t.text !== '') { cadEnsureLayer(l.name); c.texts.push({ x: t.x, y: t.y + dy, h: t.h || 3, text: String(t.text), rot: t.rot || 0, layer: l.name }); } });
        // Export-Farbe (ACI) als Anzeigefarbe übernehmen, falls vorhanden.
        if (c.layers[l.name] && l.color != null && ACI_HEX[l.color]) c.layerColors[l.name] = ACI_HEX[l.color];
      });
    });
    if (!c.order.length && !c.texts.length) { cadFlash('Keine Konturen erzeugt — bitte Inhalte ankreuzen.'); return; }
    c.edit.active = c.order[0] || null; c.edit.sel = []; c.edit.draft = null;
    state.cad.view = null; App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; App.buildSidebar(); renderCad();
    cadFlash(T(label || 'Geladen.') + (blocks.length > 1 ? ' (' + blocks.length + ' ' + T('Tragflächen') + ')' : ''));
  }
  // Schnellwahl: setzt die Auswahl-Flags (bleiben in den Checkboxen sichtbar) und lädt.
  // Voreinstellungen für die Inhalt-Auswahl (setzen nur die Häkchen — geladen
  // wird danach über „Auswahl laden"). Früher drei eigene Import-Knöpfe; da sie
  // dieselben Häkchen setzen, sind sie jetzt in die Auswahl zusammengeführt.
  const CAD_PRESETS = {
    wing: { grundriss: true, aufriss: true, profReal: true, profChord: false, workpiece: false, tower: false, levelCore: false, levelNeg: false },
    core: { grundriss: false, aufriss: false, profReal: false, profChord: false, workpiece: true, tower: true, levelCore: true, levelNeg: false },
    neg: { grundriss: false, aufriss: false, profReal: false, profChord: false, workpiece: true, tower: true, levelCore: false, levelNeg: true }
  };
  function cadPreset(key) { Object.assign(state.dxfExport, CAD_PRESETS[key]); App.buildSidebar(); renderCad(); }
  // Auswahl-Flags für den Rippendesign-Import (wie state.dxfExport bei der Tragfläche).
  function cadRibImportCfg() {
    if (!state.cadRibImport) state.cadRibImport = { profiles: true, sheeting: false, spars: false, templates: false };
    const s = state.cadRibImport;
    if (s.profiles == null) s.profiles = true;
    if (s.sheeting == null) s.sheeting = false;
    if (s.spars == null) s.spars = false;
    if (s.templates == null) s.templates = false;
    return s;
  }
  // Rippendesign gemäß Auswahl als CAD-Layer laden. Zusammengeführt aus den früher
  // getrennten Importen (Rippenprofile, Rippen+Beplankung, Nasenschablonen): eine
  // Auswahl mit Häkchen, danach „Auswahl laden". Rippen und Nasenschablonen werden
  // jeweils im Raster aufgereiht; Schablonen liegen unter dem Rippenblock.
  // Auswahl-Flags für den 3D-Modell-Import (Segmentpaare / Schnittspuren).
  function cadModelImportCfg() {
    if (!state.cadModelImport) state.cadModelImport = { outer: true, cut: false, sideA: true, sideB: true, layout: 'side', segs: null, oneLayer: false };
    const s = state.cadModelImport;
    if (s.outer == null) s.outer = true;
    if (s.cut == null) s.cut = false;
    if (s.sideA == null) s.sideA = true;
    if (s.sideB == null) s.sideB = true;
    if (!s.layout) s.layout = 'side';
    if (s.oneLayer == null) s.oneLayer = false;
    return s;
  }
  // 3D-Modell: Segmentpaare (Sollkonturen A/B inkl. Löcher) und/oder Schnittspuren
  // (mit Abbrand, Startpunkt, Bearbeitungen — genau das, was in den G-Code geht) als
  // CAD-Layer laden. Mehrere Segmente werden nebeneinander/untereinander aufgereiht
  // oder deckungsgleich übereinander gelegt. Parameter kommen aus dem G-Code-Menü
  // des 3D-Modell-Reiters (mgOpt).
  function cadLoadModelSelection() {
    if (!window.Model3D || !Model3D.hasModel()) { cadFlash('Kein 3D-Modell geladen.'); return; }
    const sel = cadModelImportCfg();
    if (!sel.outer && !sel.cut) { cadFlash('Nichts gewählt — bitte Inhalte ankreuzen.'); return; }
    if (!sel.sideA && !sel.sideB) { cadFlash('Keine Seite gewählt (A/B).'); return; }
    if (!Model3D.ensureSegments()) { cadFlash('Erst zerlegen — keine Segmente.'); return; }
    const nseg = Model3D.segCount();
    const segs = (sel.segs && sel.segs.length) ? sel.segs.filter(i => i < nseg) : Array.from({ length: nseg }, (_, i) => i);
    if (!segs.length) { cadFlash('Keine Segmente gewählt.'); return; }
    const opt = App.mgOpt();
    const items = [];
    segs.forEach(seg => {
      let d = null; try { d = Model3D.pairData(seg, opt); } catch (e) { d = null; }
      if (!d) return;
      const si = Model3D.sectionInfo ? Model3D.sectionInfo(seg) : null;
      const polys = [];   // {layer, pts, closed}
      const cvt = P => P.map(p => ({ x: p[0], y: p[1] }));
      // Eigene Layer je Segment („Segment N Soll/Schnitt A/B") — oder mit der
      // Option „Alles auf einen Layer" gesammelt auf „3D-Modell".
      // Layername trägt Schnitt-Namen + Lage im Raum („[S2 X1250.00]"), der
      // Layout-Versatz kommt beim Platzieren dazu (App.m3dLayerName) — so findet
      // DXF-Formen die Querschnitte auch nach einem DXF-Export/-Import lagerichtig wieder.
      const lay = (kind, tag) => sel.oneLayer ? '3D-Modell' : { kind, tag };
      const side = (tag, outer, inners, cutP) => {
        if (sel.outer) { polys.push({ layer: lay('Soll', tag), pts: cvt(outer), closed: true }); (inners || []).forEach(inn => polys.push({ layer: lay('Soll', tag), pts: cvt(inn), closed: true })); }
        if (sel.cut && cutP) polys.push({ layer: lay('Schnitt', tag), pts: cvt(cutP), closed: !d.hollow });
      };
      if (sel.sideA) side('A', d.outerA, d.innersA, d.A);
      if (sel.sideB) side('B', d.outerB, d.innersB, d.B);
      if (!polys.length) return;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      polys.forEach(pl => pl.pts.forEach(p => { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }));
      items.push({ seg, si, polys, minx, miny, w: maxx - minx, h: maxy - miny });
    });
    if (!items.length) { cadFlash('Querschnitte nicht ermittelbar.'); return; }
    if (!cadClearAsk()) return;
    cadPushUndo();
    const c = state.cad; c.layers = {}; c.order = []; c.texts = []; c.layerColors = {}; c.layerHidden = {}; c.lineStyles = {};
    const gap = 20;
    const cellW = Math.max.apply(null, items.map(r => r.w)) + gap, cellH = Math.max.apply(null, items.map(r => r.h)) + gap;
    // Gemeinsamer Bezugspunkt aller Segmente (Mitte des gemeinsamen Begrenzungs-
    // rahmens in Original-Koordinaten). Er wird je Segment mitverschoben als Kreuz
    // auf einem eigenen Layer gezeichnet: Kreuze deckungsgleich legen = Segmente
    // wieder in der ursprünglichen gegenseitigen Lage.
    const refX = (Math.min.apply(null, items.map(r => r.minx)) + Math.max.apply(null, items.map(r => r.minx + r.w))) / 2;
    const refY = (Math.min.apply(null, items.map(r => r.miny)) + Math.max.apply(null, items.map(r => r.miny + r.h))) / 2;
    const arm = Math.max(2, 0.06 * Math.max(cellW, cellH));
    const putCross = tr => {
      cadEnsureLayer('Bezugspunkt'); c.layerColors['Bezugspunkt'] = '#e74c3c'; c.lineStyles['Bezugspunkt'] = 'dashdot';
      const m = tr({ x: refX, y: refY });
      cadAddEntity('Bezugspunkt', App.mkLoopLocal([{ x: m.x - arm, y: m.y }, { x: m.x + arm, y: m.y }], false));
      cadAddEntity('Bezugspunkt', App.mkLoopLocal([{ x: m.x, y: m.y - arm }, { x: m.x, y: m.y + arm }], false));
    };
    items.forEach((it, i) => {
      // 'stack' = deckungsgleich (Original-Koordinaten), 'side' = Reihe, 'col' = Spalte.
      let ox = 0, oy = 0;
      if (sel.layout === 'side') { ox = i * cellW - it.minx; oy = -it.miny; }
      else if (sel.layout === 'col') { ox = -it.minx; oy = -i * cellH - it.miny; }
      const tr = p => ({ x: p.x + ox, y: p.y + oy });
      const lname = L => {
        if (typeof L === 'string') return L;
        const sec = it.si ? (L.tag === 'A' ? it.si.a : it.si.b) : null;
        return 'Segment ' + (it.seg + 1) + ' ' + L.kind + ' ' + L.tag + (sec ? ' ' + m3dSecTag(sec.idx, it.si.axisName, sec.pos, ox, oy) : '');
      };
      it.polys.forEach(pl => { const ln = lname(pl.layer); cadEnsureLayer(ln); cadAddEntity(ln, App.mkLoopLocal(pl.pts.map(tr), pl.closed)); });
      if (sel.layout !== 'stack' || i === 0) putCross(tr);   // deckungsgleich: ein Kreuz genügt
      if (sel.layout !== 'stack' || i === 0) {
        cadEnsureLayer('Bemaßung');
        const txt = it.si ? ('Segment ' + (it.seg + 1) + ': ' + it.si.a.name + ' / ' + it.si.b.name)
          : 'Segment ' + (it.seg + 1);
        c.texts.push({ x: it.minx + ox, y: it.miny + oy - 6, h: 3, text: sel.layout === 'stack' && items.length > 1 ? T('3D-Modell deckungsgleich') : txt, rot: 0, layer: 'Bemaßung' });
      }
    });
    c.edit.active = c.order[0] || null; c.edit.sel = []; c.edit.draft = null;
    state.cad.view = null; App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; App.buildSidebar(); renderCad();
    cadFlash(T('3D-Modell geladen: ') + items.length + ' ' + T('Segment(e).'));
  }
  // Lage-Kennung eines Modell-Schnitts im Layernamen: „[S2 X1250.00]" bzw. mit
  // Layout-Versatz „[S2 X1250.00 d420.00,0.00]" (nur DXF-taugliche Zeichen).
  // Gegenstück: App.m3dParseLayer in dxfshapes.js.
  function m3dSecTag(idx, axisName, pos, ox, oy) {
    const f = v => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4);
    return '[S' + idx + ' ' + axisName + f(pos) + ((Math.abs(ox) > 1e-6 || Math.abs(oy) > 1e-6) ? ' d' + f(ox) + ',' + f(oy) : '') + ']';
  }
  function cadLoadRibSelection() {
    // Der Rippendesigner ist eine abwählbare Funktion (ribs.js).
    if (!App.ribStations) { cadFlash('Rippendesigner nicht verfügbar.'); return; }
    const sel = cadRibImportCfg();
    if (!sel.profiles && !sel.sheeting && !sel.spars && !sel.templates) { cadFlash('Nichts gewählt — bitte Inhalte ankreuzen.'); return; }
    // Geometrie je gewählter Tragfläche erzeugen (CAD noch unverändert). Ein Block je
    // Tragfläche: Rippen im Raster, Nasenschablonen darunter. polys = {layer, pts}.
    let noWing = 0, noRibs = 0, noTpl = 0;
    const blocks = cadForWings((wi, wname) => {
      if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) { noWing++; return null; }
      const { list } = App.ribStations();
      if (!list.length) { noRibs++; return null; }
      const polys = [];
      const put = (layer, pts) => polys.push({ layer: cadWingLayer(wname, layer), pts });
      let yCursor = 0;   // obere Kante des nächsten Rasterblocks (wächst nach unten)

      if (sel.profiles || sel.sheeting || sel.spars) {
        const withSheet = sel.sheeting;   // Kernlinie auch ohne Umriss ladbar
        const withSpars = sel.spars;
        const baked = list.map((st, idx) => {
          const o = App.ribOutline(st), sh = App.ribSheet(st, idx);
          const xs = o.pts.map(p => p.x), ys = o.pts.map(p => p.y);
          const minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs), miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
          const core = (withSheet && (sh.top || sh.bot)) ? App.ribInset(o.pts, sh.top, sh.bot) : null;
          // Holmtaschen dieser Rippe (im Koordinatensystem der Rippe, wie im Rippendesigner).
          const spars = [];
          if (withSpars) (state.spars || []).forEach(sp => {
            if (!App.sparAppliesTo(sp, st.seg)) return;
            const fl = App.sparFromLE(sp, st.seg, 'root') + (App.sparFromLE(sp, st.seg, 'tip') - App.sparFromLE(sp, st.seg, 'root')) * st.t;
            const g = App.sparOnProfile(sp, o.pts, null, fl, App.sparYc(sp), st.t < 0.5 ? 'root' : 'tip', App.sparCoreFromSheet(o.pts, sh));
            App.sparPolys(g).forEach(pl => spars.push(pl));
          });
          return { outer: o.pts, core, spars, w: maxx - minx, h: maxy - miny, minx, miny };
        });
        const cols = Math.max(1, Math.ceil(Math.sqrt(baked.length)));
        const cellW = Math.max.apply(null, baked.map(r => r.w)) + 25, cellH = Math.max.apply(null, baked.map(r => r.h)) + 32;
        baked.forEach((r, i) => {
          const ox = (i % cols) * cellW - r.minx, oy = yCursor - Math.floor(i / cols) * cellH - r.miny;
          const tr = p => ({ x: p.x + ox, y: p.y + oy });
          if (sel.profiles) put('Rippen', r.outer.map(tr));
          if (r.core) put('Beplankung', r.core.map(tr));
          r.spars.forEach(sp => put('Holme', sp.map(tr)));
        });
        yCursor -= Math.ceil(baked.length / cols) * cellH + 40;
      }

      if (sel.templates) {
        const templates = App.ribCollectTemplates();
        if (!templates.length) noTpl++;
        else {
          const baked = templates.map(tpl => { const r = tpl.rect; return { ring: tpl.ring, holes: tpl.holes || [], w: r.xR - r.xF, h: r.yT - r.yB, minx: r.xF, miny: r.yB }; });
          const cols = Math.max(1, Math.ceil(Math.sqrt(baked.length)));
          const cellW = Math.max.apply(null, baked.map(r => r.w)) + 25, cellH = Math.max.apply(null, baked.map(r => r.h)) + 32;
          baked.forEach((r, i) => {
            const ox = (i % cols) * cellW - r.minx, oy = yCursor - Math.floor(i / cols) * cellH - r.miny;
            const tr = p => ({ x: p.x + ox, y: p.y + oy });
            put('Nasenschablonen', r.ring.map(tr));
            r.holes.forEach(h => put('Nummern', h.map(tr)));
          });
        }
      }
      return polys.length ? { wname, polys } : null;
    }).filter(Boolean);

    if (!blocks.length) {
      if (noWing && !noRibs && !noTpl) cadFlash('Keine Tragfläche/Rippen vorhanden.');
      else if (noRibs && !noTpl) cadFlash('Keine Rippen.');
      else if (noTpl) cadFlash('Keine gültige Nasenschablone erzeugt (Höhe/Tiefe prüfen).');
      else cadFlash('Nichts erzeugt — bitte Inhalte ankreuzen.');
      return;
    }
    if (!cadClearAsk()) return;
    cadPushUndo();
    const c = state.cad; c.layers = {}; c.order = []; c.texts = []; c.layerColors = {}; c.layerHidden = {}; c.lineStyles = {};
    // Mehrere Tragflächen: Blöcke untereinander, Name über jedem Block.
    const boxes = blocks.map(b => {
      let miny = Infinity, maxy = -Infinity, minx = Infinity;
      b.polys.forEach(pl => pl.pts.forEach(q => { if (q.y < miny) miny = q.y; if (q.y > maxy) maxy = q.y; if (q.x < minx) minx = q.x; }));
      return { miny, maxy, minx };
    });
    const dys = cadStackOffsets(boxes, 60);
    blocks.forEach((b, bi) => {
      const dy = dys[bi];
      if (b.wname) {
        cadEnsureLayer('Tragflächen-Namen');
        c.texts.push({ x: boxes[bi].minx, y: boxes[bi].maxy + dy + 12, h: 8, text: b.wname, rot: 0, layer: 'Tragflächen-Namen' });
      }
      b.polys.forEach(pl => { cadEnsureLayer(pl.layer); cadAddEntity(pl.layer, App.mkLoopLocal(pl.pts.map(p => ({ x: p.x, y: p.y + dy })), true)); });
    });
    if (!c.order.length) { cadFlash('Nichts erzeugt — bitte Inhalte ankreuzen.'); return; }
    c.edit.active = c.order[0] || null; c.edit.sel = []; c.edit.draft = null;
    state.cad.view = null; App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; App.buildSidebar(); renderCad();
    cadFlash(T('Rippendesign geladen.') + (blocks.length > 1 ? ' (' + blocks.length + ' ' + T('Tragflächen') + ')' : ''));
  }
  function cadExportDxf() {
    if (DEMO.blocked()) return;
    const ents = cadEntities(), texts = state.cad.texts || [];
    if (!ents.length && !texts.length) { cadFlash('Nichts zu exportieren.'); return; }
    const byLayer = {}; state.cad.order.forEach(n => { byLayer[n] = { name: n, color: 7, polys: [], texts: [] }; });
    const lay = n => (byLayer[n] = byLayer[n] || { name: n, color: 7, polys: [], texts: [] });
    ents.forEach(e => { if (!cadVisible(e.layer) || e.loop.pt || CAD_NOEXPORT[e.layer]) return; lay(e.layer).polys.push({ closed: !!e.loop.closed, pts: e.loop.map(p => ({ x: p.x, y: p.y })) }); });
    texts.forEach(t => { if (!cadVisible(t.layer || 'TEXT')) return; lay(t.layer || 'TEXT').texts.push({ x: t.x, y: t.y, h: t.h, text: t.text, rot: t.rot }); });
    const layers = Object.values(byLayer).filter(l => l.polys.length || (l.texts && l.texts.length));
    layers.forEach(l => { l.color = cadHexToAci(cadLayerColor(l.name)); l.ltype = cadLayerLtype(l.name); });   // Farbe -> ACI, Linienart -> LTYPE
    const text = Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 4 });
    App.exportViaPicker('cad-zeichnung.dxf', text, 'application/dxf', 'svDxf');
  }
  // CAD-Geometrie in den DXF-Formen-Reiter übergeben (wie ein DXF-Import): baut
  // dort die Layer neu auf, ordnet INNEN/AUSSEN automatisch zu und öffnet ihn.
  // Nur Konturen sichtbarer Layer (Texte gehören nicht zur Schneidgeometrie).
  function cadExportToDxfForms() {
    const ents = cadEntities().filter(e => cadVisible(e.layer) && !e.loop.pt && !CAD_NOEXPORT[e.layer]);
    if (!ents.length) { cadFlash('Nichts zu exportieren.'); return; }
    if (!confirm(T('Vorhandene DXF-Formen ersetzen?'))) return;
    const layers = {}, order = [];
    ents.forEach(e => { if (!layers[e.layer]) { layers[e.layer] = []; order.push(e.layer); } const a = e.loop.map(p => ({ x: p.x, y: p.y })); a.closed = !!e.loop.closed; layers[e.layer].push(a); });
    if (!order.length) { cadFlash('Keine Konturen.'); return; }
    state.dxf.file = 'CAD';
    App.applyParsedLayers({ layers, order });   // richtet DXF-Reiter ein + öffnet ihn
    App.flashDxf(T('Aus CAD übernommen — Layer INNEN/AUSSEN bei Bedarf zuordnen.'));
  }
  // Einblendbare Befehlsliste (rechts oben im CAD-Reiter).
  function cadBuildCmdList() {
    const el = document.getElementById('cadCmdList'); if (!el) return;
    const row = (k, d) => '<tr><td style="color:var(--accent);font-family:Consolas,monospace;white-space:nowrap;padding-right:10px;vertical-align:top">' + k + '</td><td>' + T(d) + '</td></tr>';
    let html = '<div style="font-weight:700;margin-bottom:5px">' + T('Befehle') + '</div><div style="max-height:60vh;overflow-y:auto"><table style="border-collapse:collapse;font-size:11px;line-height:1.5">';
    CAD_TOOLBAR.forEach(([cap, items]) => {
      html += '<tr><td colspan="2" style="padding-top:5px;color:var(--muted)">' + (cap ? T(cap) : T('Allgemein')) + '</td></tr>';
      items.forEach(([id, label]) => { const al = CAD_ALIASES_REV[id] || CAD_ACTION_REV[id]; if (al) html += row(al, label); });
    });
    html += row('m2p', 'Mitte 2 Punkte') + row('abs / rel', 'Koordinatenmodus') +
      '<tr><td colspan="2" style="padding-top:6px;color:var(--muted)">' + T('Tasten') + '</td></tr>' +
      row('S / Z', 'Schließen / Zurück (Option)') +
      row('Space/Enter', 'Weiter · Beenden · letzten wiederholen') + row('Esc', 'Abbruch') +
      row('F3', 'Objektfang') + row('F8', 'Ortho') + row('Entf', 'Auswahl löschen') +
      '</table></div>' +
      '<div style="margin-top:6px;color:var(--muted)">' + T('Befehl tippen + Enter (Zeile unten links). Die Befehlszeile zeigt zu jedem Schritt die möglichen Eingaben; Optionen in [Klammern] per Taste oder Klick. Koordinaten: x,y · @dx,dy · Länge<Winkel.') + '</div>';
    el.innerHTML = html;
  }
  function cadToggleCmdList(force) {
    const el = document.getElementById('cadCmdList'), btn = document.getElementById('cadCmdToggle'); if (!el) return;
    const show = force != null ? force : (el.style.display === 'none');
    el.style.display = show ? 'block' : 'none';
    if (btn) { btn.style.background = show ? 'var(--accent)' : ''; btn.style.color = show ? '#04121f' : ''; }
    try { localStorage.setItem('cadCmdList', show ? '1' : '0'); } catch (e) {}
  }
  // --- Sidebar (aufgeteilt in Blöcke: Import · Erstellen · Bearbeiten ·
  //     Fang & Optionen · Export) ---
  // Werkzeug-Kachelgitter für eine Liste [id,label].
  // Symbole für die Werkzeug-Buttons (Text erscheint als Tooltip beim Hover).
  // Symbole für die Werkzeug-Buttons. Werte, die mit '<svg' beginnen, werden als
  // Grafik eingesetzt (currentColor erbt die Textfarbe des Buttons).
  const CAD_SVG = s => '<svg viewBox="0 0 22 14" width="19" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + s + '</svg>';
  const CAD_ICON = {
    select: '⬚', vertex: '◇', delpt: '⊗',
    // Linie: Strecke mit Anfangs- und Endpunkt.
    line: CAD_SVG('<line x1="3" y1="11" x2="19" y2="3"/><circle cx="3" cy="11" r="1.8" fill="currentColor" stroke="none"/><circle cx="19" cy="3" r="1.8" fill="currentColor" stroke="none"/>'),
    // Polylinie: Linienzug mit mehreren Schenkeln + Stützpunkten.
    polyline: CAD_SVG('<polyline points="2,11 8,3 14,10 20,3"/><circle cx="2" cy="11" r="1.6" fill="currentColor" stroke="none"/><circle cx="8" cy="3" r="1.6" fill="currentColor" stroke="none"/><circle cx="14" cy="10" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="3" r="1.6" fill="currentColor" stroke="none"/>'),
    // Spline: weiche Kurve mit Stützpunkten.
    spline: CAD_SVG('<path d="M2,11 C5,1 9,1 11,7 C13,13 17,13 20,3"/><circle cx="2" cy="11" r="1.6" fill="currentColor" stroke="none"/><circle cx="11" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="3" r="1.6" fill="currentColor" stroke="none"/>'),
    // Kreisbogen: Bogen mit Anfangs-/Endpunkt.
    arc: CAD_SVG('<path d="M3,11 A12,12 0 0 1 19,4"/><circle cx="3" cy="11" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="4" r="1.7" fill="currentColor" stroke="none"/>'),
    // Spline tangential: Kurve mit Tangenten-Strich am Anschlusspunkt.
    splinetan: CAD_SVG('<path d="M4,11 C7,3 11,3 13,8 C15,12 18,12 20,6"/><line x1="1" y1="13" x2="7" y2="8"/><circle cx="4" cy="11" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="6" r="1.5" fill="currentColor" stroke="none"/>'),
    rect: '▭', circle: '◯', ellipse: '⬭',
    move: '✥', copy: '⧉', mirror: '◫', trim: '✂', erase: '🗑', measure: '📐',
    // Versetzen: Kontur + parallele Kopie.
    offset: CAD_SVG('<path d="M3,12 L3,4 L12,2"/><path d="M8,12 L8,7 L13,6"/>'),
    polygon: '⬡', point: '•',
    xline: CAD_SVG('<line x1="1" y1="12" x2="21" y2="2" stroke-dasharray="3 2"/>'),
    dim: '⟷', rotate: '⟳', scale: '⤢', array: '▦', stretch: '⇹', align: '⇗', origin: '✛',
    extend: '⟶', fillet: '◜', chamfer: '◺', 'break': '⫽', join: '⋈', explode: '✱', reverse: '⇄', layer: '▤', matchprop: '🖌',
    selall: '⊞', selprev: '↺', selsim: '≈', area: '▱',
    zoomall: '⤡', zoomwin: '⧈', zoomobj: '⊡', zoomprev: '⮌', undo: '↶', redo: '↷', snap: '⌖', ortho: '⊥'
  };
  function cadToolGrid(parent, tools, cols) {
    const ed = state.cad.edit;
    const tg = document.createElement('div'); tg.style.display = 'grid'; tg.style.gridTemplateColumns = 'repeat(' + (cols || 5) + ',1fr)'; tg.style.gap = '4px';
    tools.forEach(([id, label]) => {
      const b = document.createElement('button');
      const ic = CAD_ICON[id];
      if (ic && ic.indexOf('<svg') === 0) { b.innerHTML = ic; b.style.padding = '7px 0'; b.style.display = 'inline-flex'; b.style.alignItems = 'center'; b.style.justifyContent = 'center'; }
      else { b.textContent = ic || T(label); b.style.fontSize = '17px'; b.style.lineHeight = '1'; b.style.padding = '7px 0'; }
      b.title = T(label) + (CAD_ALIASES_REV[id] ? '  (' + CAD_ALIASES_REV[id] + ')' : '');
      if (ed.tool === id) { b.style.background = 'var(--accent)'; b.style.color = '#04121f'; b.style.borderColor = 'var(--accent)'; }
      b.onclick = () => cadSetTool(id);
      tg.appendChild(b);
    });
    parent.appendChild(tg);
  }
  function buildCadSidebar(side) {
    const d = state.cad, ed = d.edit;
    cadBuildToolbar();

    // --- Block: Import ---
    const gi = App.grp('Import', true, 'cad');
    App.hint(gi.body, 'Geometrie aus einem anderen Design in den CAD-Editor laden (inkl. Maßtexte). Bearbeitung und Export sind eigenständig — es wird NICHT in die Quelle zurückgeschrieben.');
    const mkImp = (label, fn) => { const b = document.createElement('button'); b.textContent = T(label); b.onclick = fn; gi.body.appendChild(b); };
    // Mehrere Tragflächen: welche importiert werden (1, 2, 3 … einzeln kombinierbar oder alle).
    cadWingPicker(gi.body);
    // Tragflächen-/Kern-/Negativdesign: eine gemeinsame Inhalt-Auswahl.
    const av = cadExportAvail(), ex = state.dxfExport;
    {
      const gs = App.grp('Tragflächen-/Kern-/Negativdesign', false, 'cad', { key: 'cadInhalte' });
      if (!av.haveWing) App.hint(gs.body, 'Kein Tragflächendesign geladen — beim Laden erscheint ein Hinweis.');
      App.hint(gs.body, 'Voreinstellung wählen (setzt die Häkchen) oder frei ankreuzen, dann „Auswahl laden".');
      // Voreinstellungen (früher drei getrennte Import-Knöpfe).
      const prow = document.createElement('div'); prow.style.display = 'grid'; prow.style.gridTemplateColumns = 'repeat(3,1fr)'; prow.style.gap = '4px'; prow.style.marginBottom = '6px';
      [['Tragfläche', 'wing'], ['Kern', 'core'], ['Negativ', 'neg']].forEach(([lab, key]) => {
        const b = document.createElement('button'); b.textContent = T(lab); b.onclick = () => cadPreset(key); prow.appendChild(b);
      });
      gs.body.appendChild(prow);
      const cbx = (k, label) => App.boolRow(gs.body, label, () => !!ex[k], v => { ex[k] = v; });
      cbx('grundriss', 'Grundriss (Draufsicht)');
      cbx('aufriss', 'Aufriss (Vorderansicht)');
      cbx('profReal', 'Profile — reale Lage');
      cbx('profChord', 'Profile — auf Sehne gestapelt');
      if (av.haveSpars) cbx('holme', 'Holme (Grundriss/Profile)');
      if (av.haveSheet) cbx('beplankung', 'Beplankung (in Profilen)');
      cbx('levelCore', 'Kern — Schneidepfade');
      cbx('levelNeg', 'Negativ — Schneidepfade');
      if (App.stegeOn && App.stegeOn()) cbx('stege', 'Kern-Stege (Nennkonturen, Original- + Schnittlage)');
      cbx('workpiece', '… Werkstückbahnen');
      cbx('tower', '… Turmbahnen');
      // Segmentauswahl nur bei mehreren Segmenten (leer = alle). Bei mehreren gewählten
      // bzw. einer nicht aktiven Tragfläche werden immer alle Segmente geladen.
      if (!cadWingSelIsActive()) App.hint(gs.body, 'Mehrere/andere Tragflächen gewählt: es werden jeweils alle Segmente geladen.');
      else if (av.segCount > 1) {
        App.hint(gs.body, 'Segmente (alle aktiv = alle exportieren):');
        const sgrid = document.createElement('div'); sgrid.style.display = 'grid'; sgrid.style.gridTemplateColumns = 'repeat(4,1fr)'; sgrid.style.gap = '4px';
        for (let k = 0; k < av.segCount; k++) {
          const on = !ex.segs || ex.segs.includes(k);
          const b = document.createElement('button'); b.textContent = 'S' + (k + 1);
          if (on) { b.style.background = 'var(--accent)'; b.style.color = '#04121f'; b.style.borderColor = 'var(--accent)'; }
          b.onclick = () => {
            let arr = ex.segs ? ex.segs.slice() : Array.from({ length: av.segCount }, (_, i) => i);
            if (arr.includes(k)) arr = arr.filter(x => x !== k); else arr.push(k);
            arr.sort((a, b2) => a - b2);
            ex.segs = (arr.length === av.segCount) ? null : arr;
            App.buildSidebar(); renderCad();
          };
          sgrid.appendChild(b);
        }
        gs.body.appendChild(sgrid);
      }
      const bload = document.createElement('button'); bload.className = 'primary'; bload.textContent = T('Auswahl laden');
      bload.onclick = () => cadImportSelection('Auswahl geladen.'); gs.body.appendChild(bload);
      gi.body.appendChild(gs.g);
    }
    // Rippendesign: eine gemeinsame Inhalt-Auswahl (Profile/Beplankung/Nasenschablonen).
    // Nur zeigen, wenn der Rippendesigner im Build steckt (abwählbare Funktion).
    if (App.ribStations) {
      const rs = cadRibImportCfg();
      const gr = App.grp('Rippendesign', false, 'cad', { key: 'cadRib' });
      App.hint(gr.body, 'Inhalte ankreuzen, dann „Auswahl laden". Rippen und Nasenschablonen werden jeweils im Raster aufgereiht.');
      App.boolRow(gr.body, 'Rippenprofile (Umriss)', () => rs.profiles, v => { rs.profiles = v; });
      App.boolRow(gr.body, 'Beplankung (Kernlinie)', () => rs.sheeting, v => { rs.sheeting = v; });
      App.boolRow(gr.body, 'Holme (Taschen)', () => rs.spars, v => { rs.spars = v; });
      App.boolRow(gr.body, 'Nasenschablonen', () => rs.templates, v => { rs.templates = v; });
      const brl = document.createElement('button'); brl.className = 'primary'; brl.textContent = T('Auswahl laden');
      brl.onclick = cadLoadRibSelection; gr.body.appendChild(brl);
      gi.body.appendChild(gr.g);
    }
    // 3D-Modell: Segmentpaare (Sollkonturen) und Schnittspuren.
    if (window.Model3D && Model3D.hasModel()) {
      const ms = cadModelImportCfg();
      const gm = App.grp('3D-Modell', false, 'cad', { key: 'cadModel' });
      App.hint(gm.body, 'Segmentpaare (Stirnquerschnitte A/B inkl. Löcher) und/oder Schnittspuren (mit Abbrand, Startpunkt und Bearbeitungen — wie im G-Code). Parameter wie im 3D-Modell-Reiter.');
      App.boolRow(gm.body, 'Sollkonturen (Segmentpaar)', () => ms.outer, v => { ms.outer = v; });
      App.boolRow(gm.body, 'Schnittspuren (mit Abbrand)', () => ms.cut, v => { ms.cut = v; });
      App.boolRow(gm.body, 'Seite A', () => ms.sideA, v => { ms.sideA = v; });
      App.boolRow(gm.body, 'Seite B', () => ms.sideB, v => { ms.sideB = v; });
      App.selectRow(gm.body, 'Anordnung', [['side', 'nebeneinander'], ['col', 'untereinander'], ['stack', 'deckungsgleich (Originallage)']], () => ms.layout, v => { ms.layout = v; });
      App.boolRow(gm.body, 'Alles auf einen Layer', () => ms.oneLayer, v => { ms.oneLayer = v; }, 'Alle Querschnitte auf dem Layer „3D-Modell" statt eigener Layer je Segment (Bezugskreuze bleiben auf „Bezugspunkt").');
      const nseg = Model3D.segCount();
      if (nseg > 1) {
        App.hint(gm.body, 'Segmente (alle aktiv = alle laden):');
        const sgrid = document.createElement('div'); sgrid.style.display = 'grid'; sgrid.style.gridTemplateColumns = 'repeat(4,1fr)'; sgrid.style.gap = '4px';
        for (let k = 0; k < nseg; k++) {
          const on = !ms.segs || ms.segs.includes(k);
          const b = document.createElement('button'); b.textContent = 'S' + (k + 1);
          if (on) { b.style.background = 'var(--accent)'; b.style.color = '#04121f'; b.style.borderColor = 'var(--accent)'; }
          b.onclick = () => {
            let arr = ms.segs ? ms.segs.slice() : Array.from({ length: nseg }, (_, i) => i);
            if (arr.includes(k)) arr = arr.filter(x => x !== k); else arr.push(k);
            arr.sort((a, b2) => a - b2);
            ms.segs = (arr.length === nseg) ? null : arr;
            App.buildSidebar(); renderCad();
          };
          sgrid.appendChild(b);
        }
        gm.body.appendChild(sgrid);
      } else if (nseg < 1) App.hint(gm.body, 'Noch nicht zerlegt — beim Laden wird automatisch zerlegt.');
      const bml = document.createElement('button'); bml.className = 'primary'; bml.textContent = T('Auswahl laden');
      bml.onclick = cadLoadModelSelection; gm.body.appendChild(bml);
      gi.body.appendChild(gm.g);
    }
    // Weitere Quellen.
    // Rippenfläche (rippenflaeche.js, abwählbare Funktion): der komplette
    // Bausatz — Rippen, Gurte, Stege/Kämme, Helling, abgewickelte Beplankung,
    // Geodäten — geschachtelt und je Werkstoff/Stärke auf eigenen Layern.
    if (App.rfToCad) mkImp('Aus Rippenfläche (Bausatz)', () => App.rfToCad());
    mkImp('Aus DXF-Formen', cadLoadFromDxf);
    mkImp('DXF-Datei laden…', cadImportDxfFile);
    side.appendChild(gi.g);

    // --- Block: Layer (Ziel-Layer, neuer Layer, Farben) ---
    const gl = App.grp('Layer', true, 'cad', { key: 'cadLayer' });
    const layerOpts = d.order.filter(n => d.layers[n]).map(n => [n, n]);
    App.selectRow(gl.body, 'Aktiver Layer (Ziel)', layerOpts.length ? layerOpts : [['Zeichnung', 'Zeichnung']],
      () => ed.active || (layerOpts[0] && layerOpts[0][0]) || 'Zeichnung', v => { ed.active = v; renderCad(); },
      'Neu gezeichnete Geometrie landet auf diesem Layer.');
    const nl = document.createElement('button'); nl.textContent = T('Neuer Layer…');
    nl.onclick = () => { App.askText(T('Name des neuen Layers:'), '').then(n => { if (n && n.trim()) { cadEnsureLayer(n.trim()); ed.active = n.trim(); App.buildSidebar(); renderCad(); } }); };
    gl.body.appendChild(nl);
    // Farben (umstellbar): je Layer ein Farbwähler + Name (Klick = aktiv).
    if (d.order.length) {
      const ll = document.createElement('div'); ll.style.display = 'grid'; ll.style.gap = '3px'; ll.style.margin = '2px 0';
      d.order.forEach(name => {
        const row = document.createElement('div'); row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '6px';
        const vis = cadVisible(name);
        const vb = document.createElement('button'); vb.textContent = vis ? '👁' : '🚫'; vb.title = vis ? T('Layer sichtbar (klicken: ausblenden)') : T('Layer ausgeblendet (klicken: einblenden)');
        vb.style.flex = '0 0 auto'; vb.style.padding = '2px 5px'; vb.style.fontSize = '13px'; vb.style.lineHeight = '1'; if (!vis) vb.style.opacity = '0.6';
        vb.onclick = () => { if (cadVisible(name)) d.layerHidden[name] = true; else delete d.layerHidden[name]; App.buildSidebar(); renderCad(); };
        const ci = document.createElement('input'); ci.type = 'color'; ci.value = cadLayerColor(name); ci.title = T('Layerfarbe');
        ci.style.width = '26px'; ci.style.height = '20px'; ci.style.padding = '0'; ci.style.border = '1px solid var(--line)'; ci.style.background = 'none'; ci.style.flex = '0 0 auto'; ci.style.cursor = 'pointer';
        ci.oninput = () => { d.layerColors[name] = ci.value; renderCad(); };
        const hasSel = ed.sel.length > 0;
        const nb = document.createElement('button'); nb.textContent = name; nb.title = hasSel ? T('Auswahl auf diesen Layer verschieben') : T('Als Ziel-Layer wählen (mit Auswahl: Auswahl auf diesen Layer verschieben)');
        nb.style.flex = '1'; nb.style.textAlign = 'left'; nb.style.overflow = 'hidden'; nb.style.textOverflow = 'ellipsis'; nb.style.whiteSpace = 'nowrap'; nb.style.fontSize = '11px'; nb.style.padding = '3px 6px';
        if (!vis) nb.style.opacity = '0.55';
        if ((ed.active || d.order[0]) === name) { nb.style.borderColor = 'var(--accent)'; nb.style.color = '#fff'; }
        nb.onclick = () => { ed.active = name; if (ed.sel.length) cadMoveSelToLayer(name, true); else { App.buildSidebar(); renderCad(); } };
        // Linienart-Auswahl (durchgezogen/gestrichelt/gepunktet/strichpunkt).
        const ls = document.createElement('select'); ls.title = T('Linienart');
        ls.style.flex = '0 0 auto'; ls.style.width = '58px'; ls.style.fontSize = '11px'; ls.style.padding = '2px';
        [['solid', '——'], ['dashed', '– – –'], ['dotted', '·····'], ['dashdot', '–·–·']].forEach(([v, lbl]) => { const o = document.createElement('option'); o.value = v; o.textContent = lbl; ls.appendChild(o); });
        ls.value = cadLayerStyle(name);
        ls.onchange = () => { d.lineStyles[name] = ls.value; renderCad(); };
        row.appendChild(vb); row.appendChild(ci); row.appendChild(nb); row.appendChild(ls); ll.appendChild(row);
      });
      gl.body.appendChild(ll);
    }
    side.appendChild(gl.g);

    // --- Block: Erstellen (Zeichen-Werkzeuge) ---
    const gc = App.grp('Zeichenoptionen', false, 'cad', { key: 'cadDrawOpts' });
    App.numRow(gc.body, 'Punkte Kreis/Ellipse', () => ed.arcPoints, v => { ed.arcPoints = Math.max(3, Math.round(v)); }, { step: 4, min: 3, norender: true });
    App.numRow(gc.body, 'Punkte je Spline-Segment', () => ed.splineSeg, v => { ed.splineSeg = Math.max(2, Math.round(v)); }, { step: 4, min: 2, norender: true,
      hint: 'Auflösung der Spline-Kurve (mehr = glatter, aber größere DXF/mehr G-Code). Gilt für normale und tangentiale Splines.' });
    App.boolRow(gc.body, 'Punktzahl beim Zeichnen abfragen', () => ed.arcAsk, v => { ed.arcAsk = v; },
      'Bei jedem Kreis/jeder Ellipse nach der Punktzahl fragen (vorbelegt mit dem letzten Wert). Aus: es gilt fest die eingestellte Punktzahl.');
    App.numRow(gc.body, 'Abrundungsradius (mm)', () => ed.filletR, v => { ed.filletR = Math.max(0, v); }, { step: 0.5, min: 0, norender: true });
    App.numRow(gc.body, 'Fasenabstand 1 (mm)', () => ed.chamferD1, v => { ed.chamferD1 = Math.max(0, v); }, { step: 0.5, min: 0, norender: true });
    App.numRow(gc.body, 'Fasenabstand 2 (mm)', () => ed.chamferD2, v => { ed.chamferD2 = Math.max(0, v); }, { step: 0.5, min: 0, norender: true });
    App.numRow(gc.body, 'Polygon: Seiten', () => ed.polyN, v => { ed.polyN = Math.max(3, Math.round(v)); }, { step: 1, min: 3, norender: true });
    App.numRow(gc.body, 'Bemaßung: Texthöhe (mm)', () => ed.dimH, v => { ed.dimH = Math.max(0.5, v); }, { step: 0.5, min: 0.5, norender: true });
    side.appendChild(gc.g);

    // --- Block: Fang & Optionen ---
    const gf = App.grp('Fang & Optionen', true, 'cad');
    App.boolRow(gf.body, 'Objektfang (F3)', () => ed.snap, v => { ed.snap = v; App.buildSidebar(); renderCad(); });
    if (ed.snap) {
      const sg = document.createElement('div'); sg.style.display = 'grid'; sg.style.gridTemplateColumns = '1fr 1fr'; sg.style.gap = '4px'; sg.style.margin = '2px 0 4px';
      [['snapEnd', 'Endpunkt'], ['snapMid', 'Mittelpunkt/Zentrum'], ['snapInt', 'Kreuzung'], ['snapPerp', 'Perpendikular'], ['snapQuad', 'Quadrant'], ['snapTan', 'Tangente'], ['snapNear', 'Nächster']].forEach(([key, label]) => { const b = document.createElement('button'); b.textContent = T(label); if (ed[key]) { b.style.background = 'var(--accent)'; b.style.color = '#04121f'; b.style.borderColor = 'var(--accent)'; } b.onclick = () => { ed[key] = !ed[key]; App.buildSidebar(); renderCad(); }; sg.appendChild(b); });
      gf.body.appendChild(sg);
    }
    App.boolRow(gf.body, 'Ortho (F8)', () => ed.ortho, v => { ed.ortho = v; renderCad(); }, 'Zwingt den nächsten Punkt waagrecht/senkrecht zum vorigen. Objektfang hat Vorrang.');
    App.numRow(gf.body, 'Fadenkreuz-Größe (%)', () => ed.crossSize || 100, v => { ed.crossSize = Math.max(1, Math.min(100, Math.round(v))); renderCad(); }, { step: 5, min: 1, max: 100, norender: true, hint: '100 = Linien über die ganze Fläche, kleiner = kurzes Kreuz am Cursor.' });
    App.boolRow(gf.body, 'Dynamische Eingabe am Cursor', () => ed.dynIn !== false, v => { ed.dynIn = v; renderCad(); }, 'Eingabefeld mit Prompt und Länge/Winkel neben dem Fadenkreuz (wie in AutoCAD). Tippen geht immer dorthin, solange ein Befehl läuft.');
    App.boolRow(gf.body, 'Ursprung (0,0) anzeigen', () => ed.showOrigin, v => { ed.showOrigin = v; renderCad(); });
    const bm2p = document.createElement('button'); bm2p.textContent = T('Mitte zwischen 2 Punkten (m2p)');
    bm2p.title = T('Erst Werkzeug wählen, dann hier klicken und zwei Punkte angeben — der Mittelpunkt wird als Zeichenpunkt verwendet.');
    bm2p.onclick = cadStartM2P; gf.body.appendChild(bm2p);
    const bfit = document.createElement('button'); bfit.textContent = T('⤢ Ausschnitt an Alles anpassen');
    bfit.title = T('Der Ausschnitt folgt sonst NICHT den Objekten — mit Mausrad zoomen, mittlere Maustaste/Ziehen verschieben, Doppelklick setzt Zoom/Verschiebung zurück.');
    bfit.onclick = cadFitView; gf.body.appendChild(bfit);
    App.boolRow(gf.body, 'Raster anzeigen', () => ed.showGrid, v => { ed.showGrid = v; renderCad(); });
    App.boolRow(gf.body, 'Am Raster fangen', () => ed.gridSnap, v => { ed.gridSnap = v; renderCad(); });
    App.numRow(gf.body, 'Rasterweite (mm)', () => ed.gridStep, v => { ed.gridStep = Math.max(0.1, v); renderCad(); }, { step: 1, min: 0.1, norender: true });
    App.hint(gf.body, T('Befehlszeile unten links: Kurzbefehl (l, pl, ci, rec, o, dr, sk …) ODER Koordinaten (x,y · @dx,dy · Länge<Winkel), Enter bestätigt. Buchstabe tippen füllt die Zeile automatisch. Liste aller Kürzel: „⌨ Befehle" oben rechts.'));
    side.appendChild(gf.g);

    // --- Block: Export ---
    const gx = App.grp('Export', true, 'cad');
    const be = document.createElement('button'); be.className = 'primary'; be.textContent = T('Als DXF exportieren'); be.onclick = cadExportDxf; DEMO.btn(be); gx.body.appendChild(be);
    if (DEMO.on) App.hint(gx.body, DEMO.msg);
    const bf = document.createElement('button'); bf.textContent = T('In DXF-Formen übernehmen'); bf.title = T('Die (sichtbaren) Konturen in den Reiter DXF-Formen übergeben — z. B. für den Turmschnitt.'); bf.onclick = cadExportToDxfForms; gx.body.appendChild(bf);
    side.appendChild(gx.g);

    buildCadBgSidebar(side);
  }


  // ---- Verdrahtung des Reiters (2026-09-12 aus app.js hierher geholt) ----
  // app.js ruft cadWireUp() beim Start geschützt auf. So bringt Reiter „CAD-Bearbeitung“
  // seine Ereignisse selbst mit und die Datei lässt sich als Funktion abwählen.
  function cadWireUp() {
    const setupNav = App.setupNav, buildSidebar = App.buildSidebar;
    setupNav('cCad', 'cad', renderCad);      // Zoom/Pan im CAD-Editor
    const ccad = document.getElementById('cCad');
    if (ccad) {
      ccad.addEventListener('mousedown', ev => { cadEditDown(ev); }, true);
      ccad.addEventListener('mousemove', ev => { cadEditMove(ev); });
      ccad.addEventListener('dblclick', ev => { const t = state.cad.edit.tool; if (t === 'polyline' || t === 'spline' || t === 'splinetan') { ev.preventDefault(); ev.stopPropagation(); cadFinishDraft(false); } }, true);
      window.addEventListener('mouseup', ev => { if (state.activeTab === 'cad') cadEditUp(ev); });
    }
    // Befehlsliste (rechts) aufbauen, Toggle verdrahten, gemerkten Zustand setzen.
    cadBuildCmdList();
    const cct = document.getElementById('cadCmdToggle');
    if (cct) cct.onclick = () => cadToggleCmdList();
    try { if (localStorage.getItem('cadCmdList') === '1') cadToggleCmdList(true); } catch (e) {}
    const cci = document.getElementById('cadCoordInput');
    try { state.cad.edit.relCoords = localStorage.getItem('cadRelCoords') !== '0'; } catch (e) { state.cad.edit.relCoords = true; }
    const cab = document.getElementById('cadAbsBtn'), crb = document.getElementById('cadRelBtn');
    if (cab) cab.onclick = () => { cadSetRel(false); if (cci) cci.focus(); };
    if (crb) crb.onclick = () => { cadSetRel(true); if (cci) cci.focus(); };
    cadUpdateRelButtons();
    if (cci) cci.addEventListener('keydown', ev => cadInputKey(ev, cci));
    const cdi = document.getElementById('cadDynInput');
    if (cdi) { cdi.addEventListener('keydown', ev => cadInputKey(ev, cdi)); cdi.addEventListener('input', () => { if (cci) cci.value = cdi.value; }); }
    if (cci) cci.addEventListener('input', () => { if (cdi) cdi.value = cci.value; });
    if (cci) cci.addEventListener('input', () => cadSuggest(cci.value));
    if (cci) cci.addEventListener('blur', () => setTimeout(() => cadSuggest(''), 150));
    // CAD-Tastatur: F3 Objektfang, F8 Ortho, Esc/Enter/Entf, Strg+Z/Y.
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'cad') return;
      const ed = state.cad.edit;
      const inField = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === 'F3') { e.preventDefault(); ed.snap = !ed.snap; cadFlash('Objektfang ' + (ed.snap ? 'AN' : 'AUS')); buildSidebar(); renderCad(); return; }
      if (e.key === 'F8') { e.preventDefault(); ed.ortho = !ed.ortho; cadFlash('Ortho ' + (ed.ortho ? 'AN' : 'AUS')); buildSidebar(); renderCad(); return; }
      // „C" während des Zeichnens schließt die laufende Polylinie/Spline.
      if ((e.key === 'c' || e.key === 'C') && !inField && !e.ctrlKey && !e.metaKey && ed.draft && (ed.draft.type === 'poly' || ed.draft.type === 'spline') && ed.draft.pts.length >= 2) { e.preventDefault(); cadFinishDraft(true); return; }
      // Einzelne Optionstaste (S/Z/D/B/J/N …) des laufenden Prompts direkt ausführen.
      if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && /[a-z]/i.test(e.key)) {
        const o = cadMatchOption(e.key.toLowerCase());
        if (o) { e.preventDefault(); cadLog('> ' + o.l); o.fn(); buildSidebar(); renderCad(); return; }
      }
      // „J" verbindet die gewählten Konturen (Linien/Polylinien/Splines).
      if ((e.key === 'j' || e.key === 'J') && !inField && !e.ctrlKey && !e.metaKey && ed.sel.length >= 2) { e.preventDefault(); cadJoinSelection(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { if (inField) return; e.preventDefault(); cadUndo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { if (inField) return; e.preventDefault(); cadRedo(); return; }
      if (e.key === 'Escape') { if (!inField) cadCancel(); }
      else if ((e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && !inField) { e.preventDefault(); cadEnterKey(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && ed.sel.length && !inField) { e.preventDefault(); cadEraseSelection(); }
      // Tippt der Nutzer sonst einen Buchstaben/Ziffer, wandert die Eingabe in die
      // Befehlszeile (Kurzbefehle wie „pl", „l", „ci" bzw. Koordinaten).
      else if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && /[a-z0-9@<.,\-]/i.test(e.key)) {
        const inp = document.getElementById('cadCoordInput');
        const dyn = App.cadDynVisible ? document.getElementById('cadDynInput') : null;
        if (dyn) { e.preventDefault(); dyn.focus(); dyn.value += e.key; if (inp) inp.value = dyn.value; }
        else if (inp) { e.preventDefault(); inp.focus(); inp.value += e.key; cadSuggest(inp.value); }
      }
    });
  }

  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { cadWireUp });
  Object.assign(App, { ACI_HEX, CAD_ACTIONS, CAD_ACTION_ALIASES, CAD_ACTION_REV, CAD_ALIASES, CAD_ALIASES_REV, CAD_ICON, CAD_LAYER_PALETTE });
  Object.assign(App, { CAD_NOEXPORT, CAD_PRESETS, CAD_SVG, CAD_TOOLBAR, D2R, buildCadBgSidebar, buildCadSidebar, cadAddDim });
  Object.assign(App, { cadAddEntity, cadAddPoint, cadAddXline, cadAfterEdit, cadAfterSelect, cadAng, cadApplySnap, cadArcPoints });
  Object.assign(App, { cadArcPts, cadArcSteps, cadAreaAt, cadBreakApply, cadBuildCmdList, cadBuildToolbar, cadCancel, cadCatmullRom });
  Object.assign(App, { cadCircleFrom3, cadClearAsk, cadCloneLoop, cadCmdName, cadCoordApply, cadCornerEnd, cadCornerGeom, cadDefaultLayer });
  Object.assign(App, { cadDist, cadDistToLoop, cadDoCorner, cadDraftRef, cadDrawGrid, cadDynEl, cadDynInput, cadEditDown });
  Object.assign(App, { cadEditMove, cadEditUp, cadEnsureLayer, cadEnterKey, cadEntities, cadEntityCenter, cadEntsInBox, cadEraseSelection });
  Object.assign(App, { cadExplodeSelection, cadExportAvail, cadExportDxf, cadExportToDxfForms, cadExtendAt, cadFinishAlign, cadFinishArrayPolar, cadFinishArrayRect });
  Object.assign(App, { cadFinishDraft, cadFinishMirror, cadFinishPolyline, cadFinishRotate, cadFinishScale, cadFinishSpline, cadFinishSplineTan, cadFinishStretch });
  Object.assign(App, { cadFitView, cadFlash, cadHexToAci, cadHexToRgb, cadHist, cadHitEntity, cadHitText, cadImportDxfFile });
  Object.assign(App, { cadImportDxfText, cadImportSelection, cadInputKey, cadIsCircle, cadIsPointTool, cadJoinSelection, cadLayerColor, cadLayerDash });
  Object.assign(App, { cadLayerLtype, cadLayerStyle, cadLoadBgImage, cadLoadFromDxf, cadLoadModelSelection, cadLoadRibSelection, cadLog, cadLoopOf });
  Object.assign(App, { cadLoopSub, cadM2PPoint, cadMakeCircle, cadMakePolygon, cadMatchOption, cadMirrorSelection, cadModelImportCfg, cadMoveSelToLayer });
  Object.assign(App, { cadNearestCtrl, cadNearestVertex, cadNumInput, cadOffsetLoop, cadOsnap, cadOverlay, cadPickToggle, cadPosPoint });
  Object.assign(App, { cadPreset, cadPreviewSel, cadProjOnSeg, cadPromptSpec, cadPushUndo, cadRebuildCurve, cadRedo, cadReverseSelection });
  Object.assign(App, { cadRibImportCfg, cadRot, cadRotVec, cadScl, cadSegCross, cadSelBounds, cadSelCentroid, cadSelectAll });
  Object.assign(App, { cadSelectPrev, cadSelectSimilar, cadSetOrigin, cadSetRel, cadSetTool, cadSideOf, cadSnap, cadStartM2P });
  Object.assign(App, { cadStretchCollect, cadSuggest, cadTangentAt, cadTangentSpline, cadToggleCmdList, cadToolGrid, cadToolHint, cadToolLabel });
  Object.assign(App, { cadToolPoint, cadTransformSelection, cadTranslateSelection, cadTrimAt, cadUndo, cadUndoPoint, cadUpdateDyn, cadUpdatePrompt });
  Object.assign(App, { cadUpdateRelButtons, cadVisible, cadWorld, cadZoomAll, cadZoomPrev, cadZoomSel, cadZoomTo, renderCad });
  Object.assign(App, { cadForWings, cadMultiWing, cadStackOffsets, cadWingLayer, cadWingPicker, cadWingSel, cadWingSelIsActive });
  Object.defineProperty(App, 'cadDraw', { get: () => cadDraw, set: v => { cadDraw = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'cadDynVisible', { get: () => cadDynVisible, set: v => { cadDynVisible = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'cadFlashT', { get: () => cadFlashT, set: v => { cadFlashT = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'cadPromptKey', { get: () => cadPromptKey, set: v => { cadPromptKey = v; }, enumerable: true, configurable: true });
})();
