/* compute.js — Berechnung, Segment-Operationen, Einlauf, Kern stapeln  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, applySparCuts, blockExt, buildSidebar, effBlockZ, mkSeg, render, saveSettings, state } = App;
  // ---------- Segment-Operationen -------------------------------------
  function addSeg() {
    const last = state.segments[state.segments.length - 1];
    state.segments.push(mkSeg(last ? {
      profile: last.profile, chord: Math.round(last.chord * 0.8), span: 250,
      sweep: 15, washout: last.washout, dihMode: last.dihMode, dih: last.dih,
      leExt: last.leExt, leExtTip: last.leExtTip, leExtProp: last.leExtProp,
      leExt2: last.leExt2, leExt2Tip: last.leExt2Tip, leExt2Prop: last.leExt2Prop,
      teExt: last.teExt, teExtTip: last.teExtTip, teExtProp: last.teExtProp,
      bLE: last.bLE, bLETip: last.bLETip, bLEProp: last.bLEProp,
      bTE: last.bTE, bTETip: last.bTETip, bTEProp: last.bTEProp
    } : {}));
    state.activeSeg = state.segments.length - 1;
    buildSidebar(); render();
  }
  function removeSeg(i) {
    if (state.segments.length <= 1) { alert(T('Mindestens ein Segment nötig.')); return; }
    state.segments.splice(i, 1);
    if (state.activeSeg !== 'all' && state.activeSeg >= state.segments.length) state.activeSeg = state.segments.length - 1;
    buildSidebar(); render();
  }
  function moveSeg(i, d) {
    const j = i + d; if (j < 0 || j >= state.segments.length) return;
    const t = state.segments[i]; state.segments[i] = state.segments[j]; state.segments[j] = t;
    buildSidebar(); render();
  }

  // Zwischenprofil an Bruchteil t (0..1) zwischen zwei Profilen: beide auf N
  // Punkte resamplen und punktweise linear interpolieren (normierte Kontur).
  function lerpProfile(a, b, t, N) {
    const ra = Airfoil.resample(a, N), rb = Airfoil.resample(b, N);
    const out = [];
    for (let i = 0; i < N; i++)
      out.push({ x: ra[i].x + (rb[i].x - ra[i].x) * t, y: ra[i].y + (rb[i].y - ra[i].y) * t });
    out.name = T('Teilung');
    return out;
  }

  // Teilt Segment idx an einer Stelle in Spannweitenrichtung (mode 'pct' = Prozent
  // der Segment-Spannweite, 'mm' = Länge ab Innenende) in ZWEI Segmente. Am
  // Teilungsschnitt entsteht ein interpoliertes Zwischenprofil; Sehne, Schränkung,
  // Rückpfeilung, V-Form und Scharnierlage werden linear geteilt.
  function splitSeg(idx, mode, val) {
    const seg = state.segments[idx];
    const span = seg.span || 0;
    const t = mode === 'pct' ? (val || 0) / 100 : (span ? (val || 0) / span : 0);
    if (!(t > 0.001 && t < 0.999)) {
      alert(T('Teilungsstelle muss innerhalb des Segments liegen (0 < Position < Spannweite).'));
      return;
    }
    // Innenwerte des Segments (gemeinsamer Stoß mit dem Vorsegment bzw. Wurzel).
    const rootProfile = idx === 0 ? state.root.profile : state.segments[idx - 1].profile;
    const rootChord   = idx === 0 ? state.root.chord   : state.segments[idx - 1].chord;
    const rootTwist   = idx === 0 ? 0                   : state.segments[idx - 1].washout;
    const defTR = state.cfg.twistRef != null ? state.cfg.twistRef : 0.25;
    const rootTR = idx === 0
      ? (state.root.twistRef != null ? state.root.twistRef : defTR)
      : (state.segments[idx - 1].twistRef != null ? state.segments[idx - 1].twistRef : defTR);
    const tipTR = seg.twistRef != null ? seg.twistRef : defTR;
    const N = Math.max(state.cfg.points || 160, 80);
    const midProfile = lerpProfile(rootProfile, seg.profile, t, N);
    // Das am Teilungsstoß entstehende Strakprofil aussagekräftig benennen.
    { const rn = (rootProfile && rootProfile.name) || 'Profil';
      const tn = (seg.profile && seg.profile.name) || 'Profil';
      midProfile.name = rn === tn ? T('Strak ') + rn
        : T('Strak ') + rn + ' → ' + tn; }
    const midChord   = rootChord + (seg.chord - rootChord) * t;
    const midWashout = rootTwist + ((seg.washout || 0) - rootTwist) * t;
    const midHinge   = (seg.hingePct || 0) + ((seg.hingePctTip || 0) - (seg.hingePct || 0)) * t;

    const inner = Object.assign({}, seg);
    const outer = Object.assign({}, seg);
    inner.span = span * t;
    outer.span = span - inner.span;
    inner.profile = midProfile;
    inner.chord = +midChord.toFixed(3);
    inner.washout = +midWashout.toFixed(3);
    inner.twistRef = +(rootTR + (tipTR - rootTR) * t).toFixed(4);   // Drehpunkt am Teilungsstoß interpolieren
    inner.hingePctTip = +midHinge.toFixed(2);
    outer.hingePct = +midHinge.toFixed(2);
    inner.sweep = +(seg.sweep * t).toFixed(3);
    outer.sweep = +(seg.sweep - inner.sweep).toFixed(3);
    if (seg.dihMode === 'mm') {
      inner.dih = +((seg.dih || 0) * t).toFixed(3);
      outer.dih = +((seg.dih || 0) - inner.dih).toFixed(3);
    } // 'deg': gleicher Winkel in beiden Hälften -> dih unverändert übernehmen
    outer.dihRoot = 0;   // Außenhälfte bündig an die Innenhälfte anschließen
    delete inner.splitUI; delete outer.splitUI;
    state.segments.splice(idx, 1, inner, outer);
    state.activeSeg = idx;   // Innenhälfte aktiv lassen
    buildSidebar(); render();
  }

  // ---------- Berechnung ----------------------------------------------
  // Zugaben-/Verlängerungsfelder je Kante (Wurzel/außen/proportional).
  const EXT_FIELDS = [
    { r: 'bLE', t: 'bLETip', p: 'bLEProp' },
    { r: 'bTE', t: 'bTETip', p: 'bTEProp' },
    { r: 'leExt', t: 'leExtTip', p: 'leExtProp' },
    { r: 'leExt2', t: 'leExt2Tip', p: 'leExt2Prop' },
    { r: 'teExt', t: 'teExtTip', p: 'teExtProp' }
  ];
  // Wirksamer Außenwert eines Segments (wie in blockExt/projectCut).
  function extEffTip(seg, rootChord, tipChord, f) {
    const ratio = rootChord ? tipChord / rootChord : 1;
    return seg[f.p] ? (seg[f.r] || 0) * ratio : (seg[f.t] || 0);
  }
  // Wurzelwerte der Zugaben werden — analog zum Profil — vom Vorsegment
  // übernommen: Wurzel von Segment k = wirksamer Außenwert von Segment k-1
  // (gemeinsamer Stoß). Nur das erste Segment hat eigene Wurzelwerte.
  function inheritRootExtensions() {
    for (let k = 1; k < state.segments.length; k++) {
      const prev = state.segments[k - 1];
      const prc = k - 1 === 0 ? state.root.chord : state.segments[k - 2].chord;
      const ptc = prev.chord;
      EXT_FIELDS.forEach(f => { state.segments[k][f.r] = +extEffTip(prev, prc, ptc, f).toFixed(3); });
    }
  }
  function recompute() {
    inheritRootExtensions();
    // Scharnierlinien-Pfeilung: berechnete LE-Versätze in geklonten Segmenten an
    // Wing.build geben; die manuell eingestellten seg.sweep bleiben erhalten.
    let segs = state.segments;
    if (state.cfg.hingeAlign) {
      state._hingeSweeps = computeHingeSweeps(state);
      segs = state.segments.map((s, i) => Object.assign({}, s, { sweep: state._hingeSweeps[i] }));
    } else state._hingeSweeps = null;
    App.wing = Wing.build({
      root: state.root, segments: segs,
      twistRef: state.cfg.twistRef, points: state.cfg.points,
      dihedralCut: state.cfg.dihedralCut, flipY: state.cfg.flipY,
      align: state.cfg.align, globalDih: state.cfg.globalDih
    });
    App.segZ = []; let z = 0;
    state.segments.forEach(s => { App.segZ.push({ z0: z, z1: z + s.span }); z += s.span; });
  }
  /* Scharnierlinien-Pfeilung: leitet je Segment den LE-Versatz (sweep) so ab, dass
   * die Scharnierlinie je Segmentgruppe eine GERADE bildet. Gruppen entstehen über
   * `hingeGroupStart` (Segment 0 startet Gruppe 0). Pfeilung je Gruppe über Winkel
   * (°) oder mm; ab der 2. Gruppe im deg-Modus RELATIV zur Vorgruppe (Winkel
   * zwischen den Geraden), im mm-Modus als eigener x-Versatz über die Gruppen-
   * Spannweite. Rückgabe: Array sweep[k].
   *
   * Scharnier-x einer Station i (Planform, Wurzel-LE = 0):
   *   h(i) = cumLE(i) + chord(i)·(1 − pct(i)/100)
   * Bei bekannter Ziel-Geraden h umgekehrt: cumLE(i) = h(i) − chord(i)·(1 − pct/100),
   * sweep[k] = cumLE(k+1) − cumLE(k). Stationen: 0 = Wurzel, k+1 = Außenende Segm. k. */
  function computeHingeSweeps(state) {
    const segs = state.segments, n = segs.length;
    if (!n) return [];
    const chordAt = i => (i === 0 ? (state.root.chord || 1) : (segs[i - 1].chord || 1));
    const pctAt = i => {
      const p = i === 0 ? segs[0].hingePct : segs[i - 1].hingePctTip;
      return p != null ? p : 25;
    };
    const z = [0]; for (let k = 0; k < n; k++) z.push(z[k] + (segs[k].span || 0));
    // Abstand LE→Bezugslinie je Station. Bezug wählbar: 'le' (Nasenleiste, 0),
    // 'te' (Endleiste, volle Sehne) oder 'hinge' (Scharnierlinie, % von hinten).
    const ref = state.cfg.sweepRef || 'hinge';
    const back = i => {
      if (ref === 'le') return 0;
      if (ref === 'te') return chordAt(i);
      return chordAt(i) * (1 - Math.max(0, Math.min(100, pctAt(i))) / 100);
    };
    const hTarget = new Array(n + 1);
    hTarget[0] = back(0);                    // cumLE(0) = 0
    let cumAngle = 0, curSlope = 0;
    for (let k = 0; k < n; k++) {
      if (k === 0 || segs[k].hingeGroupStart) {
        const gs = segs[k], mode = gs.hingeSweepMode || 'deg', val = gs.hingeSweep || 0;
        if (mode === 'deg') {
          cumAngle = (k === 0) ? val : cumAngle + val;    // erste Gruppe absolut, weitere relativ
          curSlope = Math.tan(cumAngle * Math.PI / 180);
        } else {
          let gz = 0; for (let j = k; j < n && (j === k || !segs[j].hingeGroupStart); j++) gz += (segs[j].span || 0);
          curSlope = gz > 0 ? val / gz : 0;               // mm-Versatz über die Gruppen-Spannweite
          cumAngle = Math.atan(curSlope) * 180 / Math.PI;
        }
      }
      hTarget[k + 1] = hTarget[k] + curSlope * (z[k + 1] - z[k]);
    }
    const sweeps = new Array(n);
    let prevCumLE = 0;                        // cumLE(0)
    for (let k = 0; k < n; k++) {
      const cumLE = hTarget[k + 1] - back(k + 1);
      sweeps[k] = cumLE - prevCumLE; prevCumLE = cumLE;
    }
    return sweeps;
  }
  // Wirksamer LE-Versatz je Segment: bei aktiver Scharnierlinien-Pfeilung der
  // berechnete Wert, sonst der manuell eingestellte.
  function effSweep(i) {
    if (state.cfg.hingeAlign) {
      const sw = state._hingeSweeps || computeHingeSweeps(state);
      return sw[i] || 0;
    }
    return state.segments[i].sweep || 0;
  }
  function activeIdx() { return state.activeSeg === 'all' ? 0 : state.activeSeg; }
  function activeCut() { return App.wing.cuts[Math.min(activeIdx(), App.wing.cuts.length - 1)]; }
  /* Auswahl, welche Segment-Profile im Profilbild (Tragflächendesigner) gezeigt
   * werden. state.cfg.profSegs = Array von Segment-Indizes; leer/undefiniert ->
   * nur das aktive Segment (bisheriges Verhalten). */
  function profShowIndices() {
    const n = state.segments.length;
    let arr = state.cfg.profSegs;
    if (!Array.isArray(arr)) return [activeIdx()];
    arr = arr.filter(i => i >= 0 && i < n);
    return arr.length ? arr.slice().sort((a, b) => a - b) : [activeIdx()];
  }
  function profSet() { return new Set(profShowIndices()); }
  function profIsAll() { const s = profSet(); return state.segments.length > 0 && state.segments.every((_, i) => s.has(i)); }
  function profToggle(i, on) {
    const s = profSet();
    if (on) s.add(i); else s.delete(i);
    state.cfg.profSegs = Array.from(s).sort((a, b) => a - b);
  }
  /* Schnittspalt (kerf) hängt von Drahttemperatur und Vorschub ab: langsamer
   * Schnitt / heißerer Draht -> breiterer Spalt, schneller Schnitt -> schmaler.
   * Je Werkstoff gibt es daher zwei Werte (langsam/schnell). Die Werte aus der
   * Werkstoff-Datenbank sind Richtwerte und lassen sich je Werkstoff manuell
   * überschreiben (state.material.kerf[id] = { slow, fast }). */
  // Betriebspunkt-Kennwerte (langsam/schnell) je Werkstoff: kerf, Vorschub und
  // Drahtheizung. `map` = Name des Override-Feldes in state.material, `keys` =
  // Feldnamen in der Werkstoff-Datenbank, `fb` = Rückfallwerte.
  function matPair(id, map, keys, fb) {
    const m = window.Materials ? Materials.get(id) : null;
    const def = {
      slow: m && m[keys.slow] != null ? m[keys.slow] : fb.slow,
      fast: m && m[keys.fast] != null ? m[keys.fast] : fb.fast
    };
    const o = state.material[map] && state.material[map][id];
    return {
      slow: o && o.slow != null ? o.slow : def.slow,
      fast: o && o.fast != null ? o.fast : def.fast
    };
  }
  function setPair(map, field, val) {
    const id = state.material.id;
    if (!state.material[map]) state.material[map] = {};
    const cur = Object.assign({}, state.material[map][id]);
    cur[field] = val;
    state.material[map][id] = cur;
  }
  // Keine Voreinstellungen: Ohne eigene Kalibrierung des AKTUELL gewählten
  // Werkstoffs gibt es keinen erfundenen Abbrand/Vorschub. Rückfallwert 0 =
  // „noch nicht kalibriert" -> Abbrand 0 (kein Versatz), bis der Benutzer die
  // Stützpunkte des Werkstoffs selbst einträgt. So folgt der Abbrand IMMER den
  // Daten des ausgewählten Werkstoffs und nie einem globalen Standardwert.
  function kerfPair(id) {
    const base = matField(id, 'kerf', 0);
    return matPair(id, 'kerf', { slow: 'kerfSlow', fast: 'kerfFast' }, { slow: base, fast: base });
  }
  function feedPair(id) {
    const base = matField(id, 'feed', 0);
    return matPair(id, 'feed', { slow: 'feedSlow', fast: 'feedFast' }, { slow: base, fast: base });
  }
  // Beliebige Werkstoff-Eigenschaft: eigener Wert (Override) hat Vorrang vor dem
  // Datenbank-Wert. So sind ALLE angeführten Eigenschaften selbst eingebbar.
  function matField(id, field, def) {
    const o = state.material.props && state.material.props[id] && state.material.props[id][field];
    if (o != null && o !== '') return o;
    const m = window.Materials ? Materials.get(id) : null;
    return m && m[field] != null ? m[field] : def;
  }
  function setMatField(field, val) {
    const id = state.material.id;
    if (!state.material.props) state.material.props = {};
    if (!state.material.props[id]) state.material.props[id] = {};
    state.material.props[id][field] = val;
  }
  // Benutzerdefinierte Werkstoffe. Es gibt KEINE Voreinstellungen: Der Benutzer
  // legt jeden Werkstoff (inkl. Name) selbst an. Die Reihenfolge/Existenz steht
  // in state.material.mats (Liste von IDs), alle Eigenschaften in props/kerf/…
  // je ID. Fällt auf die (leere) Datenbank zurück, falls doch eine gepflegt wird.
  function matOptions() {
    if (Array.isArray(state.material.mats) && state.material.mats.length)
      return state.material.mats.map(id => [id, matField(id, 'name', id)]);
    return window.Materials ? Materials.options() : [];
  }
  function addMaterial(name) {
    const nm = (name || '').trim();
    if (!nm) return null;
    const id = 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    if (!Array.isArray(state.material.mats)) state.material.mats = [];
    state.material.mats.push(id);
    state.material.id = id;
    setMatField('name', nm);
    saveSettings();
    return id;
  }
  function delMaterial(id) {
    if (Array.isArray(state.material.mats)) {
      const i = state.material.mats.indexOf(id);
      if (i >= 0) state.material.mats.splice(i, 1);
    }
    ['props', 'kerf', 'feed', 'heat', 'heatSlow', 'cal'].forEach(k => { if (state.material[k]) delete state.material[k][id]; });
    if (state.material.id === id)
      state.material.id = (state.material.mats && state.material.mats[0]) || '';
    // Zuweisungen in allen Tragflächen lösen (null = nicht zugewiesen).
    if (App.wingList) App.wingList().forEach((w, i) => {
      const c = i === state.activeWing ? state.cfg : (w.cfg || {});
      ['matId', 'negMatId'].forEach(k => { if (c[k] === id) c[k] = null; });
    });
    ['dxfMatId', 'modelMatId', 'scMatId'].forEach(k => { if (state.cfg[k] === id) state.cfg[k] = null; });
    saveSettings();
  }
  // Drahtheizung ist ein EINZELWERT je Werkstoff (konstant, tempo-unabhängig).
  function matHeat(id) {
    const o = state.material.heat && state.material.heat[id];
    if (o != null) return o;
    const m = window.Materials ? Materials.get(id) : null;
    return m && m.heat != null ? m.heat : 40;
  }
  function setHeat(val) {
    const id = state.material.id;
    if (!state.material.heat) state.material.heat = {};
    state.material.heat[id] = val;
  }
  // Zweiter Heizungs-Kalibrierpunkt am LANGSAMEN Vorschub (optional). Ist er
  // gesetzt, folgt die Heizung dem Vorschub über die Gerade
  // (feedSlow,heatSlow)-(feedFast,heat) — genauso wie der Abbrand. Fehlt er
  // (null), bleibt die Heizung konstant (bisheriges Verhalten).
  function matHeatSlow(id) {
    const o = state.material.heatSlow && state.material.heatSlow[id];
    return o != null ? o : null;
  }
  function setHeatSlow(val) {
    const id = state.material.id;
    if (!state.material.heatSlow) state.material.heatSlow = {};
    if (val == null) delete state.material.heatSlow[id]; else state.material.heatSlow[id] = val;
  }
  function heatPair(id) {
    const fast = matHeat(id), slow = matHeatSlow(id);
    return { slow: slow != null ? slow : fast, fast, varies: slow != null };
  }
  function heatForSpeed(id, v) {
    const hp = heatPair(id);
    if (!hp.varies) return hp.fast;
    const fp = feedPair(id), dv = fp.fast - fp.slow;
    if (Math.abs(dv) < 1e-6) return hp.fast;
    const h = hp.slow + (hp.fast - hp.slow) * (v - fp.slow) / dv;
    return Math.round(Math.min(100, Math.max(0, h)) * 10) / 10;
  }
  // Heizung-Prozent -> S-Wert (M3 S…), skaliert auf $30 des Firmware-Profils.
  function wireSFor(h) {
    if (h == null) return null;
    const sMax = (window.GrblPanel && GrblPanel.sMax && GrblPanel.sMax()) || 1000;
    return Math.round(h / 100 * sMax);
  }
  const setKerf = (f, v) => setPair('kerf', f, v);
  const setFeed = (f, v) => setPair('feed', f, v);
  // Der im G-Code eingegebene Vorschub (state.cfg.feed) ist die Referenz, auf der
  // der kerf basiert. Der kerf wird aus diesem Vorschub über die Kalibriergerade
  // (feedSlow,kerfSlow)-(feedFast,kerfFast) des Werkstoffs interpoliert.
  // `ref` = der VORGEGEBENE (programmierte) Vorschub, `v` = lokale Drahtgeschwindig-
  // keit (kürzere Rippe läuft langsamer). Ohne `ref` gilt v selbst als Vorgabe.
  // Mit aktivem Kalibrierpunkt 3 (Heizstrom folgt dem Vorschub) ist der Heizstrom
  // so kalibriert, dass der Abbrand bei der Vorgabe GLEICH dem von Punkt 1 bleibt
  // — der Abbrand darf sich dann mit dem vorgegebenen Vorschub NICHT ändern. Nur
  // Abweichungen innerhalb eines Schnitts (v ≠ ref) folgen der Steigung aus 1+2.
  function kerfForSpeed(id, v, ref) {
    const kp = kerfPair(id), fp = feedPair(id);
    const dv = fp.fast - fp.slow;
    if (Math.abs(dv) < 1e-6) return Math.max(0, (kp.slow + kp.fast) / 2);
    const slope = (kp.fast - kp.slow) / dv;
    if (heatPair(id).varies) return Math.max(0, kp.fast + slope * (v - (ref != null ? ref : v)));
    return Math.max(0, kp.slow + slope * (v - fp.slow));
  }
  // Warnung „gleiche Vorschübe" im Werkstoff-Reiter live aktualisieren (ohne
  // Sidebar-Neubau, damit das Tippen in den Feldern nicht abbricht).
  function updateFeedWarn(el) {
    el = el || document.getElementById('matFeedWarn');
    if (!el) return;
    const fp = feedPair(state.material.id);
    if (state.material.id && Math.abs(fp.fast - fp.slow) < 1e-6) {
      el.textContent = T('⚠ „Vorschub langsam" und „Vorschub schnell" sind gleich (')
        + fp.slow + T(' mm/min). Dann lässt sich der Abbrand nicht vorschubabhängig '
        + 'berechnen — es wird der Mittelwert beider Abbrand-Werte verwendet. Für die '
        + 'Interpolation bei „schnell" einen GRÖSSEREN Vorschub eintragen als bei „langsam".');
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }
  // Vorschub automatisch: Der „Vorschub schnell" des gewählten Werkstoffs (der
  // Betriebspunkt, mit dem der Abbrand kalibriert wurde) wird in ALLE Vorschub-
  // felder der G-Code-Quellen übernommen (Kern, Guillotine, Block vertikal/
  // horizontal, 3D-Modell/Platte). Manuelles Umstellen nur bei cfg.feedAuto = false.
  function autoFeedOn() { return state.cfg.feedAuto !== false; }
  function autoFeedVal() { const f = feedPair(matIdFor()).fast; return f > 0 ? f : 0; }
  function syncAutoFeed() {
    if (!autoFeedOn()) return false;
    const f = autoFeedVal();
    if (!f) return false;
    state.cfg.feed = f;
    if (state.guillotine) state.guillotine.feed = f;
    if (state.block) state.block.feed = f;
    if (state.blockH) state.blockH.feed = f;
    if (state.modelGcode) state.modelGcode.feed = f;
    return true;
  }
  // ---- Werkstoff-Zuweisung je Tragfläche (Reiter „Projektübersicht") ----
  // Kontext 'wing' = Kern (Tragflächendesigner/Kerndesign/G-Code/Block), 'neg' =
  // Negativschalen. Ohne Angabe: aus der G-Code-Quelle (bzw. App.matCtxOverride,
  // das renderNeg/negGcode während ihrer Arbeit setzen). null-Werte in cfg =
  // nicht zugewiesen -> Rückfall auf die globale Auswahl (state.material).
  // Kontexte: 'wing' (Kern), 'neg' (Negativschalen), 'dxf' (DXF-Formen), 'model' (3D-Modell/Platte), 'schrift' (Reiter „Schriften“).
  function matCtx() {
    if (App.matCtxOverride) return App.matCtxOverride;
    const src = state.cfg.gcodeSource;
    return src === 'neg' ? 'neg' : src === 'dxf' ? 'dxf' : (src === 'model' || src === 'plate') ? 'model' : src === 'schrift' ? 'schrift' : 'wing';
  }
  function matIdFor(ctx) {
    ctx = ctx || matCtx();
    const v = ctx === 'neg' ? state.cfg.negMatId : ctx === 'dxf' ? state.cfg.dxfMatId : ctx === 'model' ? state.cfg.modelMatId : ctx === 'schrift' ? state.cfg.scMatId : state.cfg.matId;
    return v != null ? v : (state.material.id || '');
  }
  function blockH(ctx) {
    ctx = ctx || matCtx();
    const v = ctx === 'neg' ? state.cfg.negMatHeight : state.cfg.matHeight;
    return (v != null && isFinite(v)) ? +v : (+state.material.height || 0);
  }
  function currentFeed() { syncAutoFeed(); return state.cfg.feed; }
  function currentKerf() { return kerfForSpeed(matIdFor(), state.cfg.feed); }
  // Wirksame Heizung beim aktuellen Vorschub (konstant, solange kein zweiter
  // Heizungs-Kalibrierpunkt „langsam" eingetragen ist).
  function currentHeat() { return heatForSpeed(matIdFor(), state.cfg.feed); }
  // Heizung-Prozent -> S-Wert für M3, skaliert auf $30 (sMax) des aktiven
  // Firmware-Profils — GENAUSO wie die Handsteuerung (grbl.wire). Ohne diese
  // Skalierung sendet der G-Code den rohen Prozentwert (z. B. S40 = 4 % Duty
  // bei $30=1000) und der Draht wird kaum warm, während die Handsteuerung S400
  // schickt und funktioniert.
  function currentWireS() { return wireSFor(currentHeat()); }

  /* Schnittspalt (kerf) je Rippe eines (trapezförmigen) Segments. Beide Türme
   * fahren den Schnitt in derselben Zeit -> die LÄNGERE Sehne läuft mit dem
   * eingegebenen Vorschub (schmaler Spalt), die kürzere entsprechend dem
   * Sehnenverhältnis langsamer (breiter). Der kerf wird je Rippe aus der lokalen
   * Geschwindigkeit über die Kalibriergerade interpoliert. */
  function cutKerf(rootChord, tipChord) {
    const id = state.material.id;
    const cmd = state.cfg.feed;                        // eingegebener Vorschub = Referenz
    const longC = Math.max(rootChord, tipChord) || 1;
    return {
      root: kerfForSpeed(id, cmd * ((rootChord || 0) / longC), cmd),
      tip:  kerfForSpeed(id, cmd * ((tipChord  || 0) / longC), cmd)
    };
  }
  function polyPerim(p) { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += Math.hypot(q.x - p[i].x, q.y - p[i].y); } return s; }
  /* Abbrand-Halboffset (mm) einer Holmtasche je Rippe (Wurzel/Außen), abhängig vom
   * gewählten Bezug (state.cfg.sparKerfBasis):
   *   'profile' — dem PROFIL gleichgesetzt: Abbrand aus dem Sehnen-/Vorschub-
   *               Verhältnis der Rippen (cutKerf), wie beim Kernschnitt.
   *   'local'   — aus der lokalen Geschwindigkeit BEIM HOLMSCHNITT: beide Türme
   *               umfahren die Tasche synchron in derselben Zeit, also läuft die
   *               GRÖSSERE Tasche (größerer Umfang) mit dem Vorschub (schmal) und
   *               die kleinere langsamer (breit); je Rippe über die Kalibriergerade.
   * Vorzeichen aus sparKerfMode: 'in' nach innen, 'out' nach außen, 'none' = 0.
   * Modus und Bezug kommen global aus state.cfg, können aber je Holm (sp.kerfMode
   * / sp.kerfBasis, sofern gesetzt und ≠ 'global') überschrieben werden. */
  function sparKerfHalf(sp, cut, grPoly, gtPoly) {
    const km = (sp && sp.kerfMode && sp.kerfMode !== 'global') ? sp.kerfMode : (state.cfg.sparKerfMode || 'none');
    if (km === 'none') return { root: 0, tip: 0 };
    const sign = km === 'out' ? -1 : 1;
    const basis = (sp && sp.kerfBasis && sp.kerfBasis !== 'global') ? sp.kerfBasis : (state.cfg.sparKerfBasis || 'local');
    let kr, kt;
    if (basis === 'local') {
      const id = matIdFor(), cmd = state.cfg.feed;
      const rP = polyPerim(grPoly), tP = polyPerim(gtPoly), longP = Math.max(rP, tP) || 1;
      kr = kerfForSpeed(id, cmd * (rP / longP), cmd);
      kt = kerfForSpeed(id, cmd * (tP / longP), cmd);
    } else {
      const ck = cutKerf(cut.root.chord, cut.tip.chord);
      kr = ck.root; kt = ck.tip;
    }
    return { root: sign * kr / 2, tip: sign * kt / 2 };
  }
  /* Wirksame Beplankung eines Segments auflösen -> { root:{top,bot}, tip:{top,bot} }.
   * Bezieht Modus (global/segmentweise) und Seiten (gleich/asymmetrisch) ein.
   * Segmentwerte, die null sind, erben den globalen Wert. */
  function sheetFor(seg) {
    const c = state.cfg;
    const asym = c.sheetSides === 'asym';
    const gTop = asym ? (c.sheetTop || 0) : (c.sheeting || 0);
    const gBot = asym ? (c.sheetBot || 0) : (c.sheeting || 0);
    if (c.sheetMode !== 'segment' || !seg) {
      return { root: { top: gTop, bot: gBot }, tip: { top: gTop, bot: gBot } };
    }
    const v = (x, d) => (x == null ? d : x);
    if (asym) {
      return {
        root: { top: v(seg.sheetRootTop, gTop), bot: v(seg.sheetRootBot, gBot) },
        tip:  { top: v(seg.sheetTipTop,  gTop), bot: v(seg.sheetTipBot,  gBot) }
      };
    }
    const g = c.sheeting || 0;
    const r = v(seg.sheetRoot, g), t = v(seg.sheetTip, g);
    return { root: { top: r, bot: r }, tip: { top: t, bot: t } };
  }
  // Gibt es überhaupt eine Beplankung (>0 irgendwo)?
  function sheetActive(sf) { return !!(sf && (sf.root.top || sf.root.bot || sf.tip.top || sf.tip.bot)); }

  /* Liegt die Wurzel des KERNschnitts am RECHTEN Portal (z = machineWidth)?
   * Von hinten (Nase vorne): rechte Fläche -> Wurzel links, linke Fläche -> rechts.
   * Von vorne (Nase zum Nullpunkt) ist der Block um 180° um die Hochachse gedreht:
   * Nase UND Portalseite tauschen — sonst entstünde das Spiegelbild (aus der
   * rechten würde eine linke Fläche). Negativschale/DXF-Formen: immer wie „von hinten". */
  function rootAtRight() { return (state.cfg.side === 'left') !== (state.cfg.cutDir === 'front'); }
  function projectCut(cut, seg) {
    // Außenwert = proportional (Wurzel · Sehnenverhältnis) oder eigener Wert.
    const ratio = cut.root.chord ? cut.tip.chord / cut.root.chord : 1;
    const tip = (root, tipV, prop) => prop ? root * ratio : tipV;
    // Wirksame Schnittverlängerungen (Wurzel/außen).
    let leR = seg.leExt,  leT  = tip(seg.leExt,  seg.leExtTip,  seg.leExtProp);
    let l2R = seg.leExt2, l2T  = tip(seg.leExt2, seg.leExt2Tip, seg.leExt2Prop);
    let teR = seg.teExt,  teT  = tip(seg.teExt,  seg.teExtTip,  seg.teExtProp);

    // „Schnittverlängerung immer über Block": die wirksame Länge wird so
    // hochgezogen, dass ihre Reichweite den Block-Überstand + Abstand überragt.
    // Nur vorhandene Verlängerungen (>0) werden angehoben — keine neue erzeugt.
    // Getrennt für Nasen- und Endleiste (extOverBlockLE/TE + eigener Abstand).
    if (state.cfg.extOverBlockLE || state.cfg.extOverBlockTE) {
      const be = blockExt(seg, cut.root.chord, cut.tip.chord);   // leR/leT/teR/teT = Block-Überstände
      if (state.cfg.extOverBlockLE) {
        const CLR = state.cfg.extOverBlockClearLE != null ? state.cfg.extOverBlockClearLE : 5;
        // Nasenleiste: bei X-Schlaufe trägt die Schräge nur mit cos(Winkel) zur
        // Vorwärts-Reichweite bei (plus die horizontale Strecke B) -> entsprechend
        // aufbohren, damit die tatsächliche Reichweite den Block überragt.
        const isX = state.cfg.leStyle === 'x';
        const cosf = isX ? Math.max(Math.cos((state.cfg.leAngle || 45) * Math.PI / 180), 0.2) : 1;
        const needLE = (block, b) => Math.max(0, (block + CLR) - (isX ? b : 0)) / cosf;
        if (state.cfg.leStyle === 'x' || state.cfg.leStyle === 'horizontal') {
          if (leR > 0) leR = Math.max(leR, needLE(be.leR, l2R));
          if (leT > 0) leT = Math.max(leT, needLE(be.leT, l2T));
        }
      }
      if (state.cfg.extOverBlockTE) {
        const CLR = state.cfg.extOverBlockClearTE != null ? state.cfg.extOverBlockClearTE : 5;
        // Endleiste: der Steg läuft gerade nach hinten -> volle Reichweite.
        if (teR > 0) teR = Math.max(teR, be.teR + CLR);
        if (teT > 0) teT = Math.max(teT, be.teT + CLR);
      }
    }
    // Trapez-Kompensation. 'ratio': ein kerf je Rippe aus dem Profillängen-
    // Verhältnis. 'speed': lokal je Schnittsegment aus der Bahngeschwindigkeit
    // (in HotWire.project berechnet, braucht die Kalibrierwerte).
    const ck = cutKerf(cut.root.chord, cut.tip.chord);
    const kp = kerfPair(matIdFor()), fp = feedPair(matIdFor());
    const pr = HotWire.project({
      wing: cut, machineWidth: state.cfg.machineWidth, blockZ: effBlockZ(cut.span),
      // Rechte Fläche -> Wurzel am LINKEN Portal (z=0, kein mirror); linke Fläche
      // -> Wurzel am RECHTEN Portal (z=machineWidth, mirror). blockZ = Abstand ab
      // dem Portal auf der Wurzelseite. Schnittrichtung „von vorne": getauscht (rootAtRight).
      mirror: rootAtRight(),
      kerf: currentKerf(), kerfRoot: ck.root, kerfTip: ck.tip,
      kerfMode: state.cfg.kerfMode, kerfDatum: state.cfg.kerfDatum,
      kerfCal: { kerfSlow: kp.slow, kerfFast: kp.fast, feedSlow: fp.slow, feedFast: fp.fast, feed: currentFeed() },
      sheeting: sheetFor(seg),
      // Schnittverlängerungen getrennt Wurzel/außen (Rand ggf. proportional).
      leExt: leR,  leExtTip:  leT,
      leExt2: l2R, leExt2Tip: l2T,
      teExt: teR,  teExtTip:  teT,
      leAngle: state.cfg.leAngle, leGap: state.cfg.leGap,
      eightW: state.cfg.eightW, eightH: state.cfg.eightH, eightCross: state.cfg.eightCross,
      leStyle: state.cfg.leStyle, teStyle: state.cfg.teStyle
    });
    const segIdx = state.segments.indexOf(seg);
    const res = applyStack(applySparCuts(pr, cut, segIdx));
    // Manueller Schnittpfad-Override dieses Segments (falls vorhanden).
    const ovr = state.pathEdit && state.pathEdit[segIdx];
    let out = startAtTop(ovr ? applyPathOverride(res, ovr) : res);
    // Werkstück-Drehung bei starker Pfeilung (eigenständiges Modul). Läuft als
    // LETZTER Schritt und projiziert nur left/right rotiert neu — erfasst dadurch
    // Holme/Stapel/Override (alle stecken bereits in rootPath/tipPath).
    if (state.cfg.sweepRot && window.SweepRot) {
      const rotOpts = {
        machineWidth: state.cfg.machineWidth,
        mode: state.cfg.sweepRotMode,
        ref: state.cfg.sweepRotRef,
        angleDeg: state.cfg.sweepRotAngle
      };
      // Portalabstand auf den JEWEILS nächstgelegenen Punkt beziehen: Durch die
      // Drehung wandern die Blockecken in z. Wir verschieben die gedrehte
      // Geometrie in z (dz), sodass der dem Wurzelseiten-Portal am nächsten
      // gelegene Blockeckpunkt exakt blockZ entfernt liegt (statt der — nun
      // schräg stehenden — Wurzelebene).
      const rot = SweepRot.rotation(out, rotOpts);
      if (rot) {
        const e = blockExt(seg, cut.root.chord, cut.tip.chord);
        const xr = cut.root.pts.map(p => p.x), xt = cut.tip.pts.map(p => p.x);
        const corners = [
          [Math.max.apply(null, xr) + e.teR, out.zRoot], [Math.min.apply(null, xr) - e.leR, out.zRoot],
          [Math.max.apply(null, xt) + e.teT, out.zTip],  [Math.min.apply(null, xt) - e.leT, out.zTip]
        ];
        let zmin = Infinity, zmax = -Infinity;
        corners.forEach(([x, z]) => { const p = SweepRot.rotXZ(x, z, rot.a, rot.px, rot.pz); if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; });
        const mw = state.cfg.machineWidth, mirror = rootAtRight();
        // mirror: Wurzelseite am RECHTEN Portal (z=mw) -> nächster Punkt = max z.
        const bz = effBlockZ(cut.span);
        rotOpts.dz = mirror ? ((mw - bz) - zmax) : (bz - zmin);
      }
      out = SweepRot.apply(out, rotOpts);
    }
    return out;
  }
  // ---------- Einlauf IMMER oben (Maschinensicht) --------------------
  // Der Draht fährt hinten am Block ins Werkstück und läuft am gegenüber-
  // liegenden Steg-Ende wieder heraus. Die beiden Bahn-Enden sind die oberen
  // bzw. unteren Steg-Spitzen. Wird das Segment gespiegelt (Kopfüber/Stapel-
  // Spiegel) oder verdoppelt, kann die Startspitze nach UNTEN wandern. Diese
  // Normierung dreht die Bahn dann um, sodass der Schnitt — von der Maschine
  // aus betrachtet — immer oben (höchstes Y) beginnt. Wenn der Start ohnehin
  // oben liegt, bleibt die Bahn unverändert.
  // Liegt der Anfang einer Rippenbahn UNTEN (-> Bahn umdrehen)? Vergleich der
  // beiden Bahn-Enden (Steg-Spitzen). Bei spitzer Endleiste liegen beide auf
  // GLEICHER Höhe — der Unterschied ist nur Rundungsrauschen (~1e-14) oder exakt 0
  // und darf nicht entscheiden (sonst „Oberseite zuerst" = Unterseite, bzw. die
  // gespiegelte Stapel-Kopie läuft verkehrt und die Nasen-Schlaufe geht nach oben).
  // Dann entscheidet die Kontur: der Abschnitt bis zur Nase (kleinstes x) muss im
  // Mittel höher liegen.
  function startsLow(P) {
    const n = P.length;
    if (n < 3) return false;
    const dy = P[0].y - P[n - 1].y;
    if (dy > 1e-3) return false;
    if (dy < -1e-3) return true;
    let iLE = 0;
    for (let k = 1; k < n; k++) if (P[k].x < P[iLE].x) iLE = k;
    if (iLE === 0 || iLE === n - 1) return false;
    const meanY = (a, b) => { let s = 0; for (let k = a; k <= b; k++) s += P[k].y; return s / (b - a + 1); };
    return meanY(0, iLE) < meanY(iLE, n - 1);
  }
  function startAtTop(pr) {
    if (!pr || !pr.rootPath || pr.rootPath.length < 3) return pr;
    const isClosed = a => a.length > 1 &&
      Math.abs(a[0].x - a[a.length - 1].x) < 1e-6 &&
      Math.abs(a[0].y - a[a.length - 1].y) < 1e-6;
    const closed = isClosed(pr.rootPath);
    let root = closed ? pr.rootPath.slice(0, -1) : pr.rootPath.slice();
    let tip  = closed ? pr.tipPath.slice(0, -1)  : pr.tipPath.slice();
    // Start muss oben liegen (Einlauf oben). Sonst Bahn komplett umdrehen —
    // Ein-/Auslauf tauschen, beide bleiben hintere Steg-Spitzen.
    if (!startsLow(root)) return pr;                        // Start schon oben
    root.reverse(); tip.reverse();
    const rootPath = closed ? root.concat([{ x: root[0].x, y: root[0].y }]) : root;
    const tipPath  = closed ? tip.concat([{ x: tip[0].x, y: tip[0].y }])   : tip;
    // Turmbahnen (left/right) aus den umgedrehten Rippenbahnen neu projizieren.
    const zR = pr.zRoot, zT = pr.zTip, mw = state.cfg.machineWidth;
    const prj = (vr, vt, zp) => vr + ((zp - zR) / ((zT - zR) || 1)) * (vt - vr);
    const n = Math.min(rootPath.length, tipPath.length), left = [], right = [];
    for (let k = 0; k < n; k++) {
      const r = rootPath[k], t = tipPath[k];
      left.push({ x: prj(r.x, t.x, 0), y: prj(r.y, t.y, 0) });
      right.push({ x: prj(r.x, t.x, mw), y: prj(r.y, t.y, mw) });
    }
    return Object.assign({}, pr, { rootPath, tipPath, left, right });
  }
  // Ersetzt rootPath/tipPath durch den manuell bearbeiteten Pfad und projiziert
  // die Turmbahnen (left/right) neu — sonst bleibt pr unverändert.
  function applyPathOverride(pr, ovr) {
    const zR = pr.zRoot, zT = pr.zTip, mw = state.cfg.machineWidth;
    const prj = (vr, vt, zp) => vr + ((zp - zR) / ((zT - zR) || 1)) * (vt - vr);
    const n = Math.min(ovr.root.length, ovr.tip.length), left = [], right = [];
    for (let k = 0; k < n; k++) {
      const r = ovr.root[k], t = ovr.tip[k];
      left.push({ x: prj(r.x, t.x, 0), y: prj(r.y, t.y, 0) });
      right.push({ x: prj(r.x, t.x, mw), y: prj(r.y, t.y, mw) });
    }
    return Object.assign({}, pr, { rootPath: ovr.root, tipPath: ovr.tip, left, right, pathOverride: true });
  }

  // ---------- Kern stapeln (übereinander, optional gespiegelt) ----------
  // Vervielfältigt den fertigen Schnittpfad (Kern + Verlängerungen) N-mal
  // vertikal im Block. Der Stapel wächst NUR nach oben (positiv): die unterste
  // Kopie bleibt auf der Originalhöhe, weitere Kopien liegen darüber (Abstand
  // stackGap). Nie ins Negative rücken — sonst würde der Draht unter den Tisch/
  // Block fahren.
  // Bei „Spiegeln" wird jede zweite Kopie um ihre eigene Mitte gespiegelt
  // (nesten bzw. Paar links/rechts). Ein durchgehender Drahtweg verbindet die
  // Kopien hinten (Steg-Bereich) -> ein einziger Schnitt für den ganzen Stapel.
  function applyStack(pr) {
    const cnt = Math.max(1, state.cfg.stackCount | 0);
    if (!pr || cnt <= 1) return pr;
    const gap = state.cfg.stackGap || 0, mir = !!state.cfg.stackMirror;
    // Absolute Lage: Unterkante des Stapels auf feste Höhe über der Blockunterkante
    // (Maschinen-Nullpunkt Y=0) setzen — unabhängig vom Tragflächendesign. Sonst
    // relative Verschiebung stackOffset (+ = nach oben).
    const baseOn = !!state.cfg.stackBaseOn, baseY = Math.max(0, +state.cfg.stackBase || 0);
    let off = baseOn ? 0 : (state.cfg.stackOffset || 0);
    const root0 = pr.rootPath.slice(0, -1), tip0 = pr.tipPath.slice(0, -1);   // Schließpunkt weg
    const yext = arr => { let lo = Infinity, hi = -Infinity; arr.forEach(p => { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; }); return [lo, hi]; };
    const [rl, rh] = yext(root0), [tl, th] = yext(tip0);
    const cyR = (rl + rh) / 2, cyT = (tl + th) / 2;
    const pitch = Math.max(rh - rl, th - tl) + gap;   // Rastermaß je Kopie (Kernhöhe + Abstand)
    // Unterste Kopie (j = cnt-1, dy = off) hat Unterkante bei min(rl, tl) + off
    // (Spiegeln um die eigene Mitte ändert die Unterkante nicht).
    if (baseOn) off = baseY - Math.min(rl, tl);
    const root = [], tip = [];
    for (let j = 0; j < cnt; j++) {
      const dy = off + (cnt - 1 - j) * pitch;         // Kopie 0 ganz oben, letzte Kopie auf Originalhöhe (nie negativ)
      const flip = mir && (j % 2 === 1);
      // Kopie einzeln aufbauen (optional gespiegelt), dann so orientieren, dass
      // sie — von der Maschine aus betrachtet — OBEN beginnt. Kopie 0 liegt oben
      // (um (cnt-1)*pitch angehoben), die letzte Kopie auf der Originalhöhe ->
      // der ganze Stapel läuft immer von oben nach unten,
      // und jede Kopie (auch gespiegelte) startet an ihrer oberen Steg-Spitze.
      const rc = [], tc = [];
      // seam = Nahtstelle an der Nase für die Schnittrichtung „von vorne" (je Kopie).
      const cp = (p, y) => (p.seam ? { x: p.x, y, k: p.k, seam: true } : { x: p.x, y, k: p.k });
      root0.forEach(p => rc.push(cp(p, (flip ? 2 * cyR - p.y : p.y) + dy)));
      tip0.forEach(p => tc.push(cp(p, (flip ? 2 * cyT - p.y : p.y) + dy)));
      if (startsLow(rc)) { rc.reverse(); tc.reverse(); }
      for (let m = 0; m < rc.length; m++) { root.push(rc[m]); tip.push(tc[m]); }
    }
    // Kein Schließpunkt: der Stapel ist EIN offener Zug (oben rein, unten raus).
    const zR = pr.zRoot, zT = pr.zTip, mw = state.cfg.machineWidth;
    const prj = (vr, vt, zp) => vr + ((zp - zR) / ((zT - zR) || 1)) * (vt - vr);
    const n = Math.min(root.length, tip.length), left = [], right = [];
    for (let k = 0; k < n; k++) {
      const r = root[k], t = tip[k];
      left.push({ x: prj(r.x, t.x, 0), y: prj(r.y, t.y, 0) });
      right.push({ x: prj(r.x, t.x, mw), y: prj(r.y, t.y, mw) });
    }
    return Object.assign({}, pr, { rootPath: root, tipPath: tip, left, right,
      stack: { count: cnt, gap, mirror: mir, pitch, offset: off, base: baseOn ? baseY : null } });
  }


  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { EXT_FIELDS, activeCut, activeIdx, addMaterial, addSeg, applyPathOverride, applyStack, computeHingeSweeps });
  Object.assign(App, { autoFeedOn, autoFeedVal, syncAutoFeed });
  // Altprojekte/-einstellungen: ein gemeinsamer Schalter „immer über Block" +
  // Abstand -> getrennte Werte für NL und EL (einmalig, alte Keys entfallen).
  function migrateExtOverBlock(cfg) {
    if (!cfg) return;
    if (cfg.extOverBlock !== undefined) {
      if (cfg.extOverBlockLE === undefined) cfg.extOverBlockLE = !!cfg.extOverBlock;
      if (cfg.extOverBlockTE === undefined) cfg.extOverBlockTE = !!cfg.extOverBlock;
      delete cfg.extOverBlock;
    }
    if (cfg.extOverBlockClear !== undefined) {
      if (cfg.extOverBlockClearLE === undefined) cfg.extOverBlockClearLE = cfg.extOverBlockClear;
      if (cfg.extOverBlockClearTE === undefined) cfg.extOverBlockClearTE = cfg.extOverBlockClear;
      delete cfg.extOverBlockClear;
    }
    if (cfg.extOverBlockLE === undefined) cfg.extOverBlockLE = false;
    if (cfg.extOverBlockTE === undefined) cfg.extOverBlockTE = false;
    if (cfg.extOverBlockClearLE == null) cfg.extOverBlockClearLE = 5;
    if (cfg.extOverBlockClearTE == null) cfg.extOverBlockClearTE = 5;
  }
  migrateExtOverBlock(state.cfg);
  Object.assign(App, { currentFeed, currentHeat, currentKerf, currentWireS, cutKerf, delMaterial, effSweep, extEffTip, migrateExtOverBlock });
  Object.assign(App, { feedPair, inheritRootExtensions, kerfForSpeed, kerfPair, lerpProfile, matField, matHeat, matOptions });
  Object.assign(App, { heatForSpeed, heatPair, matHeatSlow, setHeatSlow, wireSFor });
  Object.assign(App, { matPair, moveSeg, polyPerim, profIsAll, profSet, profShowIndices, profToggle, projectCut, rootAtRight });
  Object.assign(App, { recompute, removeSeg, setFeed, setHeat, setKerf, setMatField, setPair, sheetActive });
  Object.assign(App, { matCtx, matIdFor, blockH, sheetFor, sparKerfHalf, splitSeg, startAtTop, updateFeedWarn });
})();
