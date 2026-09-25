/* profedit.js — Profilbearbeitung  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, boolRow, exportProfileDat, exportProfileDxf, grp, hint, numRow, render, renderProfEdit, state } = App;
  // ---------- Profilbearbeitung ---------------------------------------
  // Zielprofile: Wurzel + jedes Segment-Außenprofil. Jedes Profil ist auf die
  // Sehne 1 normiert; die Sehne des Ziels macht die mm-Angaben (Endleistendicke)
  // anschaulich.
  function profEditTargets() {
    const t = [{ id: 'root', label: T('Wurzelprofil') }];
    state.segments.forEach((s, i) => t.push({ id: i, label: 'Segment ' + (i + 1) + T(' (außen)') }));
    return t;
  }
  // Gültiges Ziel sicherstellen (Segment könnte gelöscht worden sein).
  function profNormTarget() {
    const id = state.profEdit.target;
    if (id !== 'root' && !(state.segments[id])) state.profEdit.target = 'root';
    return state.profEdit.target;
  }
  function profEditGet(id) { return id === 'root' ? state.root.profile : state.segments[id].profile; }
  function profEditSetProf(id, prof) { if (id === 'root') state.root.profile = prof; else state.segments[id].profile = prof; }
  function profEditChord(id) { return (id === 'root' ? state.root.chord : state.segments[id].chord) || 1; }
  // Ausgangsprofil (unbearbeitet) je Ziel — für nicht-destruktives Neurechnen.
  function profBaseFor(id) {
    const key = String(id);
    if (!state.profBase[key]) {
      const src = profEditGet(id);
      const b = src.map(p => ({ x: p.x, y: p.y })); b.name = src.name;
      state.profBase[key] = b;
    }
    return state.profBase[key];
  }
  // Kennwerte eines Profils (in Sehnenanteilen): max. Dicke + Lage, max. Wölbung
  // + Lage, Endleistendicke. Nutzt die punktweise Zuordnung Ober-/Unterseite
  // (i <-> N-1-i), die nach dem Resampling (LE mittig) gilt.
  function profMetrics(pts) {
    const N = pts.length;
    let iLE = 0; for (let i = 1; i < N; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    const le = pts[iLE];
    const teMid = { x: (pts[0].x + pts[N - 1].x) / 2, y: (pts[0].y + pts[N - 1].y) / 2 };
    const slope = (teMid.y - le.y) / ((teMid.x - le.x) || 1);
    let thickMax = 0, thickX = 0, camMax = 0, camX = 0;
    const half = Math.min(iLE, N - 1 - iLE);
    for (let i = 0; i <= half; i++) {
      const a = pts[i], b = pts[N - 1 - i];
      const th = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2;
      if (th > thickMax) { thickMax = th; thickX = mx - le.x; }
      const cam = (a.y + b.y) / 2 - (le.y + (mx - le.x) * slope);
      if (Math.abs(cam) > Math.abs(camMax)) { camMax = cam; camX = mx - le.x; }
    }
    const teFrac = Math.hypot(pts[0].x - pts[N - 1].x, pts[0].y - pts[N - 1].y);
    const chord = Math.hypot(teMid.x - le.x, teMid.y - le.y) || 1;
    return { n: N, chord, thickMax, thickX, camMax, camX, teFrac, iLE,
             name: pts.name || 'Profil' };
  }
  // Endleistendicke ändern durch Drehung der Ober- und Unterseite um die Nase
  // (LE). Ober- und Unterseite werden als starre Kurven jeweils um den LE-Punkt
  // gedreht, bis der senkrechte EL-Spalt = targetFrac (Sehnenanteil) erreicht
  // ist. Die Nase bleibt fest -> stetiger Übergang.
  function thickenTE(pts, targetFrac) {
    const N = pts.length; if (N < 4) return pts;
    let iLE = 0; for (let i = 1; i < N; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    const le = pts[iLE], Pu = pts[0], Pl = pts[N - 1];
    const g0 = Pu.y - Pl.y;                    // aktueller senkrechter EL-Spalt
    const addHalf = (targetFrac - g0) / 2;     // je Seite hinzuzufügen
    // Newton: Drehwinkel a um le, sodass sich P.y um delta ändert.
    const solve = (P, delta) => {
      const dx = P.x - le.x, dy = P.y - le.y;
      let a = delta / (dx || 1);
      for (let k = 0; k < 40; k++) {
        const s = Math.sin(a), c = Math.cos(a);
        const f = s * dx + c * dy - dy - delta, df = c * dx - s * dy;
        if (Math.abs(df) < 1e-12) break;
        const na = a - f / df;
        if (!isFinite(na)) break;
        if (Math.abs(na - a) < 1e-13) { a = na; break; }
        a = na;
      }
      return a;
    };
    const aU = solve(Pu, +addHalf), aL = solve(Pl, -addHalf);
    const rot = (P, a) => {
      const s = Math.sin(a), c = Math.cos(a), dx = P.x - le.x, dy = P.y - le.y;
      return { x: le.x + c * dx - s * dy, y: le.y + s * dx + c * dy };
    };
    const out = [];
    for (let i = 0; i < N; i++)
      out.push(i < iLE ? rot(pts[i], aU) : i > iLE ? rot(pts[i], aL) : { x: pts[i].x, y: pts[i].y });
    out.name = pts.name;
    return out;
  }
  /* Endleiste eines frisch geladenen Profils auf Dicke 0 schließen (scharfe EL) —
   * Ober-/Unterseite werden um die Nase gedreht, bis der EL-Spalt 0 ist (thickenTE
   * mit Ziel 0). Das Profil ist normiert (Sehne = 1), also ist Ziel-frac = 0. */
  function closeLoadedTE(prof) {
    if (!prof || prof.length < 4) return prof;
    const closed = thickenTE(prof, 0);
    closed.name = prof.name;
    return closed;
  }
  // Dicke und Wölbung skalieren: das Profil wird paarweise (Ober-/Unterseite,
  // Index i und N-1-i) in Skelettlinie (Mittel) und Dickenverteilung (halbe
  // Differenz) zerlegt; beide werden separat mit ts/cs multipliziert und wieder
  // zusammengesetzt. Die Nase bleibt fest, x-Werte unverändert.
  function scaleThickCam(pts, ts, cs) {
    const N = pts.length; if (N < 4) return pts;
    let iLE = 0; for (let i = 1; i < N; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    const out = pts.map(p => ({ x: p.x, y: p.y }));
    const half = Math.min(iLE, N - 1 - iLE);
    for (let i = 0; i <= half; i++) {
      if (i === iLE) continue;                 // LE-Punkt fest
      const j = N - 1 - i;
      const yc = (pts[i].y + pts[j].y) / 2;    // Skelettlinie (Wölbung)
      const yt = (pts[i].y - pts[j].y) / 2;    // halbe Dicke
      const nyc = yc * cs, nyt = yt * ts;
      out[i].y = nyc + nyt;
      out[j].y = nyc - nyt;
    }
    out.name = pts.name;
    return out;
  }
  // Editiertes Profil aus dem Ausgangsprofil neu berechnen und in den Slot
  // schreiben (der Tragflächendesigner nutzt es direkt weiter).
  function applyProfEdit() {
    const id = profNormTarget();
    const base = profBaseFor(id);
    const n = Math.max(20, Math.min(600, state.profEdit.points | 0));
    let pts = Airfoil.resample(base, n);
    // Dicke/Wölbung auf Zielwerte (% der Sehne) skalieren.
    const bm = profMetrics(pts);
    let ts = 1, cs = 1;
    if (state.profEdit.thickPct != null && bm.thickMax > 1e-6)
      ts = (state.profEdit.thickPct / 100) / bm.thickMax;
    if (state.profEdit.camPct != null && Math.abs(bm.camMax) > 1e-6)
      cs = (state.profEdit.camPct / 100) / bm.camMax;
    if (Math.abs(ts - 1) > 1e-6 || Math.abs(cs - 1) > 1e-6) {
      pts = scaleThickCam(pts, ts, cs); pts.name = base.name;
    }
    if (state.profEdit.teMM != null && state.profEdit.teMM >= 0) {
      const frac = state.profEdit.teMM / profEditChord(id);
      pts = thickenTE(pts, frac);
    }
    pts.name = base.name;
    profEditSetProf(id, pts);
    render();                                  // Tragflächen-/Schnittbild mitziehen
    renderProfEdit();
  }
  function profReset() {
    const id = state.profEdit.target, base = profBaseFor(id);
    const cp = base.map(p => ({ x: p.x, y: p.y })); cp.name = base.name;
    profEditSetProf(id, cp);
    state.profEdit.points = base.length;
    { const bm = profMetrics(base);
      state.profEdit.teMM = +(bm.teFrac * profEditChord(id)).toFixed(2);
      state.profEdit.thickPct = +(bm.thickMax * 100).toFixed(1);
      state.profEdit.camPct = +(bm.camMax * 100).toFixed(2); }
    buildProfEditControls();   // Eingabefelder auf die Ausgangswerte zurücksetzen
    render(); renderProfEdit();
  }

  // Profilbearbeitung als eigenes Fenster (je Profil aus dem Tragflächendesigner).
  let profModalOpen = false;
  function openProfModal(id) {
    state.profEdit.target = id;
    profNormTarget(); id = state.profEdit.target;
    const key = String(id), fresh = !state.profBase[key];
    const base = profBaseFor(id);
    if (fresh) {
      const bm = profMetrics(base);
      state.profEdit.points = base.length;
      state.profEdit.teMM = +(bm.teFrac * profEditChord(id)).toFixed(2);
      state.profEdit.thickPct = +(bm.thickMax * 100).toFixed(1);
      state.profEdit.camPct = +(bm.camMax * 100).toFixed(2);
    }
    profModalOpen = true;
    document.getElementById('profEditModal').classList.add('open');
    const lbl = (profEditTargets().find(t => String(t.id) === String(id)) || {}).label || 'Profil';
    document.getElementById('profEditTitle').textContent = T('Profil bearbeiten — ') + lbl;
    buildProfEditControls();
    requestAnimationFrame(renderProfEdit);   // Canvas erst nach dem Einblenden vermessen
  }
  function closeProfModal() {
    profModalOpen = false;
    document.getElementById('profEditModal').classList.remove('open');
  }
  function buildProfEditControls() {
    const box = document.getElementById('profEditCtrl');
    if (!box) return;
    box.textContent = '';
    const id = profNormTarget();

    const e = grp('Bearbeitung', true);
    numRow(e.body, 'Punktzahl', () => state.profEdit.points,
      v => { state.profEdit.points = v; applyProfEdit(); },
      { int: true, min: 20, max: 600, norender: true,
        hint: 'Punkte des Profils (Selig-Kontur). Cosinus-verdichtet an Nase & Endleiste.' });
    numRow(e.body, 'Max. Profildicke (%)', () => state.profEdit.thickPct,
      v => { state.profEdit.thickPct = v; applyProfEdit(); },
      { step: 0.1, min: 1, max: 60, norender: true,
        hint: 'Ziel-Maximaldicke in % der Sehne. Die Dickenverteilung wird proportional '
            + 'skaliert, die Skelettlinie (Wölbung) bleibt unverändert.' });
    numRow(e.body, 'Max. Profilwölbung (%)', () => state.profEdit.camPct,
      v => { state.profEdit.camPct = v; applyProfEdit(); },
      { step: 0.1, min: -20, max: 20, norender: true,
        hint: 'Ziel-Maximalwölbung in % der Sehne. Die Skelettlinie wird proportional skaliert, '
            + 'die Dickenverteilung bleibt unverändert. Bei symmetrischen Profilen (0 %) '
            + 'lässt sich keine Wölbung hinzufügen.' });
    numRow(e.body, 'Endleistendicke (mm)', () => state.profEdit.teMM,
      v => { state.profEdit.teMM = v; applyProfEdit(); },
      { step: 0.1, min: 0, norender: true,
        hint: T('Ziel-Dicke an der Endleiste. Ober- und Unterseite werden dazu um die Nase gedreht, bis diese Dicke erreicht ist (bezogen auf die Sehne ')
            + profEditChord(id).toFixed(0) + T(' mm dieses Profils).') });
    const br = document.createElement('button'); br.textContent = T('Zurücksetzen (Ausgangsprofil)');
    br.onclick = profReset; e.body.appendChild(br);
    box.appendChild(e.g);

    const a = grp('Anzeige', true);
    boolRow(a.body, 'Skelettlinie', () => state.cfg.profShowSkel !== false,
      v => { state.cfg.profShowSkel = v; renderProfEdit(); });
    boolRow(a.body, 'Sehnenlinie', () => state.cfg.profShowChord !== false,
      v => { state.cfg.profShowChord = v; renderProfEdit(); });
    boolRow(a.body, 'Punkte markieren', () => !!state.cfg.profShowPts,
      v => { state.cfg.profShowPts = v; renderProfEdit(); });
    boolRow(a.body, 'Dicken-/Wölbungsmaße', () => state.cfg.profShowDim !== false,
      v => { state.cfg.profShowDim = v; renderProfEdit(); });
    hint(a.body, 'Mausrad = Zoom, Ziehen = Verschieben, Doppelklick = zurück.');
    box.appendChild(a.g);

    const ex = grp('Export', true);
    const bed = document.createElement('button'); bed.textContent = T('.dat exportieren…');
    bed.onclick = () => exportProfileDat(id);
    ex.body.appendChild(bed);
    const bex = document.createElement('button'); bex.textContent = T('DXF exportieren…');
    bex.onclick = () => exportProfileDxf(id);
    ex.body.appendChild(bex);
    hint(ex.body, 'Export des aktuell bearbeiteten Profils. .dat: normierte Selig-Kontur '
      + '(LE x=0, TE x=1). DXF: geschlossene Polylinie in mm anhand der Sehne dieses Profils.');
    box.appendChild(ex.g);
  }


  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { applyProfEdit, buildProfEditControls, closeLoadedTE, closeProfModal, openProfModal, profBaseFor, profEditChord, profEditGet });
  Object.assign(App, { profEditSetProf, profEditTargets, profMetrics, profNormTarget, profReset, scaleThickCam, thickenTE });
  Object.defineProperty(App, 'profModalOpen', { get: () => profModalOpen, set: v => { profModalOpen = v; }, enumerable: true, configurable: true });
})();
