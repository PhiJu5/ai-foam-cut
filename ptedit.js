/* ptedit.js — Punkte-Editor (Kern-/Negativschale)  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { activeIdx, boolRow, buildSidebar, draw, grp, hint, negProjection, poly, projectCut, recompute } = App;
  const { rect, render, selectRow, state } = App;
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);
  // ==================== Punkte-Editor (Kern-/Negativschale) ============
  // Bearbeitet die Kontur-STÜTZPUNKTE (normierte Profile) des aktiven Segments
  // direkt im Querschnitt. Wurzel- und Randprofil werden strukturell synchron
  // gehalten: gleiche Punktzahl, gleicher Index. Da Wing.build beide Rippen
  // ohnehin auf cfg.points neu abtastet, bleibt der 4-Achs-Schnitt immer gültig.
  const PT_MIN = 8;                  // Mindest-Stützpunktzahl je Profil
  let profDraw = null, negDraw = null;   // gespeicherte Ansichts-Transforms (für Hit-Test)

  // Platzierung mm <-> normiert (invertiert Wing.place inkl. Verwindung/V-Form/Flip).
  function normFromMM(pl, X, Ymm) {
    const Y = pl.flip ? -Ymm : Ymm;
    const ry = (Y - pl.shift) / (pl.chord || 1);
    const rx = (X - pl.leOffset) / (pl.chord || 1) - pl.twistRef;
    const a = -(pl.twist || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);   // Vorzeichen wie Wing.place (TE unten = +)
    return { x: pl.twistRef + ca * rx + sa * ry, y: -sa * rx + ca * ry };
  }
  function mmFromNorm(pl, nx, ny) {
    const a = -(pl.twist || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);   // Vorzeichen wie Wing.place (TE unten = +)
    const px = pl.twistRef, rx = (nx - px) * ca - ny * sa, ry = (nx - px) * sa + ny * ca;
    const X = (rx + px) * (pl.chord || 1) + pl.leOffset;
    let Y = ry * (pl.chord || 1) + pl.shift;
    if (pl.flip) Y = -Y;
    return { x: X, y: Y };
  }
  // Getter/Setter der beiden Stützpunkt-Arrays (normiert) des aktiven Segments.
  // Wurzel = geteiltes Stoßprofil des Vorgängers, Rand = Profil dieses Segments.
  function ptRibArrays() {
    const idx = activeIdx();
    const getR = () => idx === 0 ? state.root.profile : state.segments[idx - 1].profile;
    const setR = a => { if (idx === 0) state.root.profile = a; else state.segments[idx - 1].profile = a; };
    return { idx, getR, setR, getT: () => state.segments[idx].profile, setT: a => { state.segments[idx].profile = a; } };
  }
  // Platzierungs-Transforms des aktiven Cuts.
  function ptRibPl() {
    const cut = App.wing.cuts[Math.min(activeIdx(), App.wing.cuts.length - 1)];
    return { root: cut.root.pl, tip: cut.tip.pl };
  }
  // Beim Aktivieren: beide Rippen auf gleiche Punktzahl bringen (Index-Synchron).
  function ptEditBake() {
    const r = ptRibArrays();
    const N = Math.max(PT_MIN, state.cfg.points | 0);
    const rp = Airfoil.resample(r.getR(), N), tp = Airfoil.resample(r.getT(), N);
    rp.name = r.getR().name; tp.name = r.getT().name;
    r.setR(rp); r.setT(tp);
  }
  // Wirksames Ziel je Canvas: Negativschale immer Profil (dort ist der Schnitt-
  // pfad die Schalenkontur, kein freier Polygonzug wie im Kerndesign).
  function ptTarget(which) {
    if (which !== 'neg') return state.ptEdit.target;
    return state.ptEdit.negTarget === 'burn' ? 'negburn' : 'neg';
  }
  // Kavität-Override (Schalengeometrie) des Segments sicherstellen: den aktuell
  // abgeleiteten negShell-Nennumriss (Cut-mm, VOR Abbrand) einfrieren, falls noch
  // keiner existiert. Punkt-Edits gehen NUR in den Override — das Originalprofil
  // (und damit Kern-/Tragflächendesign) bleibt unberührt.
  function negEditEnsure(idx) {
    if (!state.negEdit[idx]) {
      const P = negProjection(idx);
      state.negEdit[idx] = { root: P.root.path.map(p => ({ x: p.x, y: p.y })), tip: P.tip.path.map(p => ({ x: p.x, y: p.y })) };
    }
    return state.negEdit[idx];
  }
  // Schnittverlauf-Override (Abbrandlinie) des Segments sicherstellen: die aktuell
  // abgeleitete kerf-kompensierte Drahtbahn (Cut-mm, NACH Abbrand) einfrieren.
  function negBurnEditEnsure(idx) {
    if (!state.negBurnEdit[idx]) {
      const P = negProjection(idx);
      state.negBurnEdit[idx] = { root: P.rp.map(p => ({ x: p.x, y: p.y })), tip: P.tp.map(p => ({ x: p.x, y: p.y })) };
    }
    return state.negBurnEdit[idx];
  }
  // Schnittpfad-Override des Segments sicherstellen (aus dem generierten Pfad
  // einfrieren, falls noch keiner existiert).
  function pathEditEnsure(idx) {
    if (!state.pathEdit[idx]) {
      const cut = App.wing.cuts[Math.min(idx, App.wing.cuts.length - 1)];
      const seg = state.segments[Math.min(idx, state.segments.length - 1)];
      const pr = projectCut(cut, seg);   // noch kein Override -> generierter Pfad
      // seam (Nahtstelle an der Nase, Schnittrichtung „von vorne") mit einfrieren.
      const cp = p => (p.seam ? { x: p.x, y: p.y, seam: true } : { x: p.x, y: p.y });
      state.pathEdit[idx] = { root: pr.rootPath.map(cp), tip: pr.tipPath.map(cp) };
    }
    return state.pathEdit[idx];
  }
  // Einheitliches Editier-Modell für Profil ODER Schnittpfad des aktiven Segments.
  //  getR/getT/setR/setT = Punkt-Arrays (gespeicherte Form)
  //  place(rib,p)   = gespeicherter Punkt -> mm (Cut-Frame, ohne Anzeige-Versatz)
  //  unplace(rib,mx,my) = mm -> gespeicherter Punkt
  function ptModel(target) {
    const idx = activeIdx();
    if (target === 'path') {
      // Ansicht: vorhandenen Override ODER den live generierten Pfad (nicht
      // eingefroren) zeigen. Erst eine ECHTE Bearbeitung (setR/setT) friert ein.
      const live = () => {
        if (state.pathEdit[idx]) return state.pathEdit[idx];
        const cut = App.wing.cuts[Math.min(idx, App.wing.cuts.length - 1)];
        const seg = state.segments[Math.min(idx, state.segments.length - 1)];
        const pr = projectCut(cut, seg);
        return { root: pr.rootPath, tip: pr.tipPath };
      };
      return { kind: 'path', idx, min: 4,
        getR: () => live().root, getT: () => live().tip,
        setR: a => { pathEditEnsure(idx); state.pathEdit[idx].root = a; },
        setT: a => { pathEditEnsure(idx); state.pathEdit[idx].tip = a; },
        place: (rib, p) => ({ x: p.x, y: p.y }), unplace: (rib, mx, my) => ({ x: mx, y: my }) };
    }
    if (target === 'neg') {
      // Negativschale, Ziel „Kavität": bearbeitet die Schalengeometrie (negShell-
      // Nennumriss, VOR Abbrand), NICHT das geteilte Originalprofil. Erste echte
      // Bearbeitung friert den Umriss als Override ein. Kein Kerndesign-Bezug.
      const live = () => {
        if (state.negEdit[idx]) return state.negEdit[idx];
        const P = negProjection(idx);
        return { root: P.root.path, tip: P.tip.path };
      };
      return { kind: 'neg', idx, min: PT_MIN,
        getR: () => live().root, getT: () => live().tip,
        setR: a => { negEditEnsure(idx); state.negEdit[idx].root = a; },
        setT: a => { negEditEnsure(idx); state.negEdit[idx].tip = a; },
        place: (rib, p) => ({ x: p.x, y: p.y }), unplace: (rib, mx, my) => ({ x: mx, y: my }) };
    }
    if (target === 'negburn') {
      // Negativschale, Ziel „Schnittverlauf": bearbeitet die kerf-kompensierte
      // Abbrandlinie (tatsächliche Drahtbahn, NACH Abbrand). Erste echte Bearbeitung
      // friert die Bahn als Override ein. Kein Kerndesign-/Originalprofil-Bezug.
      const live = () => {
        if (state.negBurnEdit[idx]) return state.negBurnEdit[idx];
        const P = negProjection(idx);
        return { root: P.rp, tip: P.tp };
      };
      return { kind: 'negburn', idx, min: PT_MIN,
        getR: () => live().root, getT: () => live().tip,
        setR: a => { negBurnEditEnsure(idx); state.negBurnEdit[idx].root = a; },
        setT: a => { negBurnEditEnsure(idx); state.negBurnEdit[idx].tip = a; },
        place: (rib, p) => ({ x: p.x, y: p.y }), unplace: (rib, mx, my) => ({ x: mx, y: my }) };
    }
    const r = ptRibArrays(), pl = ptRibPl();
    return { kind: 'profile', idx, min: PT_MIN,
      getR: r.getR, getT: r.getT, setR: r.setR, setT: r.setT,
      place: (rib, n) => mmFromNorm(rib === 'root' ? pl.root : pl.tip, n.x, n.y),
      unplace: (rib, mx, my) => normFromMM(rib === 'root' ? pl.root : pl.tip, mx, my) };
  }
  function ptSnap(m) { return { kind: m.kind, idx: m.idx, root: m.getR().map(p => ({ x: p.x, y: p.y })), tip: m.getT().map(p => ({ x: p.x, y: p.y })) }; }
  function ptSnapApply(s) {
    if (s.kind === 'path') { state.pathEdit[s.idx] = { root: s.root.map(p => ({ x: p.x, y: p.y })), tip: s.tip.map(p => ({ x: p.x, y: p.y })) }; return; }
    if (s.kind === 'neg') { state.negEdit[s.idx] = { root: s.root.map(p => ({ x: p.x, y: p.y })), tip: s.tip.map(p => ({ x: p.x, y: p.y })) }; return; }
    if (s.kind === 'negburn') { state.negBurnEdit[s.idx] = { root: s.root.map(p => ({ x: p.x, y: p.y })), tip: s.tip.map(p => ({ x: p.x, y: p.y })) }; return; }
    const idx = s.idx, setR = a => { if (idx === 0) state.root.profile = a; else state.segments[idx - 1].profile = a; };
    setR(s.root.map(p => ({ x: p.x, y: p.y }))); state.segments[idx].profile = s.tip.map(p => ({ x: p.x, y: p.y }));
  }
  function ptPushUndo(m) {
    state.ptEdit.undo.push(ptSnap(m));
    if (state.ptEdit.undo.length > 60) state.ptEdit.undo.shift();
    state.ptEdit.redo.length = 0;
  }
  function ptCurModel() { return ptModel(state.activeTab === 'neg' ? ptTarget('neg') : state.ptEdit.target); }
  function ptUndo() { const u = state.ptEdit.undo; if (!u.length) return; state.ptEdit.redo.push(ptSnap(ptCurModel())); ptSnapApply(u.pop()); recompute(); render(); }
  function ptRedo() { const rd = state.ptEdit.redo; if (!rd.length) return; state.ptEdit.undo.push(ptSnap(ptCurModel())); ptSnapApply(rd.pop()); recompute(); render(); }
  // Platzierte (mm) Punkte einer Rippe inkl. Anzeige-Versatz dy.
  function ptPlacedM(m, rib, dy) { return m[rib === 'root' ? 'getR' : 'getT']().map(p => { const q = m.place(rib, p); return { x: q.x, y: q.y + (dy || 0) }; }); }
  // Nächsten Punkt (über beide Rippen) zum Weltpunkt finden; Toleranz in px.
  function ptHitVertex(draw, m, wx, wy, tolPx) {
    const V = draw.V; let best = null;
    [['root', draw.dyR], ['tip', draw.dyT]].forEach(([rib, dy]) => {
      ptPlacedM(m, rib, dy).forEach((p, i) => {
        const d = Math.hypot(V.X(p.x) - V.X(wx), V.Y(p.y) - V.Y(wy));
        if (d <= tolPx && (!best || d < best.d)) best = { d, rib, i };
      });
    });
    return best;
  }
  // Nächste KANTE (Segment i..i+1) zum Weltpunkt finden (für „Punkt hinzufügen").
  function ptHitEdge(draw, m, wx, wy, tolPx) {
    const V = draw.V; let best = null;
    [['root', draw.dyR], ['tip', draw.dyT]].forEach(([rib, dy]) => {
      const P = ptPlacedM(m, rib, dy);
      for (let i = 0; i < P.length - 1; i++) {
        const a = { x: V.X(P[i].x), y: V.Y(P[i].y) }, b = { x: V.X(P[i + 1].x), y: V.Y(P[i + 1].y) };
        const mx = V.X(wx), my = V.Y(wy);
        const dx = b.x - a.x, dyv = b.y - a.y, L2 = dx * dx + dyv * dyv || 1;
        let t = ((mx - a.x) * dx + (my - a.y) * dyv) / L2; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(a.x + t * dx - mx, a.y + t * dyv - my);
        if (d <= tolPx && (!best || d < best.d)) best = { d, rib, i, t };
      }
    });
    return best;
  }
  function ptWorld(draw, ev) {
    const cv = ev.currentTarget || ev.target;
    const rect = cv.getBoundingClientRect();
    return draw.V.inv(ev.clientX - rect.left, ev.clientY - rect.top);
  }
  // Maus-Handler (gemeinsam für Kerndesign 'prof' und Negativschale 'neg').
  // Bedienung ohne Werkzeugwahl: Linksklick halten = verschieben,
  // Doppelklick links auf Kante = Punkt hinzufügen, Rechtsklick auf Griff = löschen.
  function ptEditDown(which, ev) {
    const draw = which === 'neg' ? negDraw : profDraw;
    if (!state.ptEdit.on || !draw || !App.wing) return;
    if (ev.button !== 0 && ev.button !== 2) return;
    ev.preventDefault(); ev.stopPropagation();
    const w = ptWorld(draw, ev), tol = 10, m = ptModel(ptTarget(which));
    if (ev.button === 2) {   // Rechtsklick: Punkt löschen (beide Rippen, gleicher Index)
      const h = ptHitVertex(draw, m, w.x, w.y, tol); if (!h) return;
      if (m.getR().length <= m.min) { flash('Zu wenige Punkte zum Löschen.'); return; }
      ptPushUndo(m);
      const ra = m.getR().slice(), ta = m.getT().slice();
      const i = Math.min(h.i, ra.length - 1, ta.length - 1);
      ra.splice(i, 1); ta.splice(i, 1); m.setR(ra); m.setT(ta);
      state.ptEdit.drag = null;
      recompute(); render(); return;
    }
    // Linksklick: Griff fassen; Undo-Eintrag erst bei der ersten echten Bewegung
    // (so erzeugt ein Doppelklick keine leeren Undo-Schritte).
    const h = ptHitVertex(draw, m, w.x, w.y, tol); if (!h) { state.ptEdit.drag = null; return; }
    state.ptEdit.drag = { which, rib: h.rib, i: h.i, moved: false };
    render();
  }
  // Doppelklick links: neuen Punkt auf der getroffenen Kante einfügen.
  function ptEditDbl(which, ev) {
    const draw = which === 'neg' ? negDraw : profDraw;
    if (!state.ptEdit.on || !draw || !App.wing) return;
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    state.ptEdit.drag = null;
    const w = ptWorld(draw, ev), m = ptModel(ptTarget(which));
    const e = ptHitEdge(draw, m, w.x, w.y, 16); if (!e) return;
    ptPushUndo(m);
    const ra = m.getR().slice(), ta = m.getT().slice();
    // Neuer Punkt an der geklickten Position (getroffene Rippe exakt, andere als
    // Kanten-Interpolation am gleichen Index -> synchron).
    const cArr = e.rib === 'root' ? ra : ta, oArr = e.rib === 'root' ? ta : ra;
    const dyC = e.rib === 'root' ? draw.dyR : draw.dyT;
    cArr.splice(e.i + 1, 0, m.unplace(e.rib, w.x, w.y - (dyC || 0)));
    const oa = oArr[e.i] || oArr[oArr.length - 1], ob = oArr[e.i + 1] || oa;
    oArr.splice(e.i + 1, 0, { x: (oa.x + ob.x) / 2, y: (oa.y + ob.y) / 2 });
    m.setR(ra); m.setT(ta); recompute(); render();
  }
  function ptEditMove(which, ev) {
    const draw = which === 'neg' ? negDraw : profDraw;
    if (!state.ptEdit.on || !draw) return;
    const dg = state.ptEdit.drag; if (!dg || dg.which !== which) return;
    const w = ptWorld(draw, ev), m = ptModel(ptTarget(which));
    const dy = dg.rib === 'root' ? draw.dyR : draw.dyT;
    const arr = (dg.rib === 'root' ? m.getR() : m.getT()).slice();
    if (dg.i >= arr.length) { state.ptEdit.drag = null; return; }
    if (!dg.moved) { ptPushUndo(m); dg.moved = true; }
    arr[dg.i] = m.unplace(dg.rib, w.x, w.y - (dy || 0));
    if (dg.rib === 'root') m.setR(arr); else m.setT(arr);
    recompute(); render();
  }
  function ptEditUp() { if (state.ptEdit.drag) { state.ptEdit.drag = null; render(); } }
  // Editable Kontur + Punkt-Griffe zeichnen (Overlay im Bearbeiten-Modus).
  function ptDrawHandles(ctx, draw, which) {
    if (!state.ptEdit.on || !draw || !App.wing) return;
    const V = draw.V, m = ptModel(ptTarget(which)), path = m.kind === 'path';
    [['root', draw.dyR, '#4aa3ff', []], ['tip', draw.dyT, '#ffb454', [5, 4]]].forEach(([rib, dy, col, dash]) => {
      const P = ptPlacedM(m, rib, dy);
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash(dash);
      poly(ctx, V, P, false); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col;
      P.forEach(p => { ctx.beginPath(); ctx.arc(V.X(p.x), V.Y(p.y), path ? 2.2 : 2.6, 0, 2 * Math.PI); ctx.fill(); });
    });
  }
  function flash(msg) { const el = document.getElementById('stat'); if (el) { el.innerHTML = '<span style="color:var(--accent2)">' + msg + '</span>'; setTimeout(() => { if (el.innerHTML.indexOf(msg) >= 0) render(); }, 1400); } }

  // Sidebar-Menü „Punkte bearbeiten" (Kerndesign & Negativschale).
  function ptEditMenu(side, tab) {
    const g = grp('Punkte bearbeiten', true, tab);
    const negTab = tab === 'neg';
    const pathTgt = tab === 'core' && state.ptEdit.target === 'path';
    // Nur das Kern-„Profil"-Ziel tastet die geteilte Kontur neu ab (bake). Das
    // Negativdesign bearbeitet seinen EIGENEN Override -> niemals baken.
    boolRow(g.body, 'Bearbeiten aktiv', () => state.ptEdit.on,
      v => { state.ptEdit.on = v; if (v && !pathTgt && !negTab) { ptEditBake(); } state.ptEdit.undo.length = 0; state.ptEdit.redo.length = 0; state.ptEdit.drag = null; buildSidebar(); render(); },
      'Zeigt die Stützpunkte des AKTIVEN Segments (Wurzel blau, Rand orange) als Griffe. '
      + 'Linksklick halten = verschieben, Doppelklick links auf eine Kante = Punkt hinzufügen, Rechtsklick auf einen Griff = Punkt löschen. Wurzel und Rand bleiben index-synchron.');
    if (state.ptEdit.on) {
      if (tab === 'core')
        selectRow(g.body, 'Ziel',
          [['profile', 'Profil (Kontur)'], ['path', 'Schneidepfad (mit Abbrand)']],
          () => state.ptEdit.target, v => { state.ptEdit.target = v; if (v === 'profile') ptEditBake(); state.ptEdit.drag = null; state.ptEdit.undo.length = 0; state.ptEdit.redo.length = 0; buildSidebar(); render(); },
          '„Profil": die normierte Profilkontur bearbeiten (wird für den Schnitt neu abgetastet). '
          + '„Schneidepfad": den FERTIGEN Drahtweg (inkl. Abbrand, Verlängerungen, Stapeln) direkt bearbeiten. '
          + 'Der Pfad wird dabei EINGEFROREN — Beplankung/Abbrand/Stapeln ändern ihn dann nicht mehr, bis zurückgesetzt.');
      if (negTab)
        selectRow(g.body, 'Ziel',
          [['cavity', 'Schalengeometrie'], ['burn', 'Schnittverlauf (Abbrandlinie)']],
          () => state.ptEdit.negTarget, v => { state.ptEdit.negTarget = v; state.ptEdit.drag = null; state.ptEdit.undo.length = 0; state.ptEdit.redo.length = 0; buildSidebar(); render(); },
          '„Schalengeometrie": den Nennumriss der Formhälften (VOR Abbrand) bearbeiten. '
          + '„Schnittverlauf": die kerf-kompensierte Abbrandlinie bearbeiten — die tatsächliche Drahtbahn (NACH Abbrand). '
          + 'Beides wirkt NUR auf die Negativschale, nie auf das Originalprofil oder das Kerndesign. Beim ersten Ziehen eingefroren.');
      const bar = document.createElement('div'); bar.style.display = 'flex'; bar.style.gap = '6px';
      const mk = (txt, fn) => { const b = document.createElement('button'); b.textContent = txt; b.style.flex = '1'; b.onclick = fn; return b; };
      bar.appendChild(mk('↶ Rückgängig', ptUndo));
      bar.appendChild(mk('↷ Wiederholen', ptRedo));
      g.body.appendChild(bar);
      if (pathTgt && state.pathEdit[activeIdx()]) {
        const rb = mk('⟲ Schneidepfad zurücksetzen (aus Profil neu)', () => { delete state.pathEdit[activeIdx()]; state.ptEdit.undo.length = 0; state.ptEdit.redo.length = 0; render(); });
        rb.style.color = 'var(--bad)'; g.body.appendChild(rb);
      }
      if (negTab) {
        const burnTgt = state.ptEdit.negTarget === 'burn';
        const store = burnTgt ? state.negBurnEdit : state.negEdit;
        if (store[activeIdx()]) {
          const lbl = burnTgt ? '⟲ Schnittverlauf zurücksetzen (aus Tragflächendesign neu)'
                              : '⟲ Schalengeometrie zurücksetzen (aus Tragflächendesign neu)';
          const rb = mk(lbl, () => { delete store[activeIdx()]; state.ptEdit.undo.length = 0; state.ptEdit.redo.length = 0; render(); });
          rb.style.color = 'var(--bad)'; g.body.appendChild(rb);
        }
      }
      hint(g.body, 'Bedienung: Griff anklicken und halten = verschieben · Doppelklick links auf Kante = Punkt hinzufügen · Rechtsklick auf Griff = Punkt löschen.');
      hint(g.body, negTab
        ? (state.ptEdit.negTarget === 'burn'
          ? 'Schnittverlauf-Modus: Bearbeitet wird die kerf-kompensierte Abbrandlinie — die tatsächliche Drahtbahn. '
            + 'Beim ersten Ziehen eingefroren; wirkt direkt im G-Code. Originalprofil und Kerndesign bleiben unberührt. Strg+Z / Strg+Y.'
          : 'Schalengeometrie-Modus: Bearbeitet wird der Nennumriss (vor Abbrand); die Abbrandlinie folgt daraus. '
            + 'Beim ersten Ziehen eingefroren. Nur die Negativschale ist betroffen — Originalprofil und Kerndesign bleiben unberührt. Strg+Z / Strg+Y.')
        : pathTgt
        ? 'Schneidepfad-Modus: Der Drahtweg dieses Segments ist eingefroren und wird direkt bearbeitet '
          + '(wirkt sofort im G-Code). Beplankung/Abbrand/Stapeln greifen erst nach „Zurücksetzen" wieder. Strg+Z / Strg+Y.'
        : 'Profil-Modus: Wurzel/Rand bleiben synchron, der 4-Achs-Schnitt bleibt gültig. Verschieben wirkt nur '
          + 'auf die gezogene Rippe. Wirkt auf Kerndesign, Negativschale und G-Code. Strg+Z / Strg+Y.');
    } else {
      hint(g.body, T('Bearbeitet die Stützpunkte des aktiven Segments direkt im Querschnitt — ')
        + T(tab === 'core' ? 'Profilkontur ODER Schneidepfad. ' : negTab ? 'Schalengeometrie ODER Schnittverlauf (Abbrandlinie). ' : 'Profilkontur. ')
        + T('Änderungen wirken auf Vorschau und G-Code.'));
    }
    side.appendChild(g.g);
  }


  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { PT_MIN, flash, mmFromNorm, negBurnEditEnsure, negEditEnsure, normFromMM, pathEditEnsure, ptCurModel });
  Object.assign(App, { ptDrawHandles, ptEditBake, ptEditDbl, ptEditDown, ptEditMenu, ptEditMove, ptEditUp, ptHitEdge, ptHitVertex });
  Object.assign(App, { ptModel, ptPlacedM, ptPushUndo, ptRedo, ptRibArrays, ptRibPl, ptSnap, ptSnapApply });
  Object.assign(App, { ptTarget, ptUndo, ptWorld });
  Object.defineProperty(App, 'negDraw', { get: () => negDraw, set: v => { negDraw = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'profDraw', { get: () => profDraw, set: v => { profDraw = v; }, enumerable: true, configurable: true });
})();
