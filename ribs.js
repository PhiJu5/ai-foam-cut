/* ribs.js — Rippendesigner, Nasenschablone, Rippen als STL  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, applyView, dashFor, deloopPoly, parseNum, polyArea, sparAppliesTo, sparFromLE, sparOnProfile, sparPolys } = App;
  const { sparRange, sparSize, sparYc, state, stationLE, stationZ, surfaceAtX } = App;
  // Demo-Build: Rippen ansehen und maßlich prüfen ja, STL-Export nein.
  const DEMO = App.demoFeature('rib', 'Demo-Version: Der STL-Export des Rippendesigners ist in dieser Ausgabe nicht enthalten.');
  // ---------- Rippendesigner (rib) -------------------------------------
  // Leitet aus dem bestehenden Tragflächendesign an mehreren Spannweiten-
  // positionen Rippen (Querschnitte) ab. Die Kontur an einer Station ist die
  // lineare Überblendung von Wurzel- und Außenprofil des zugehörigen Schnitt-
  // paneels (wing.cuts) — genau die Fläche, die auch geschnitten würde. Vorerst
  // nur Vorschau; Export folgt.
  function ribCfg() {
    const c = state.cfg;
    if (!c.rib) c.rib = {};
    const r = c.rib;
    if (r.mode == null) r.mode = 'perSeg';       // 'perSeg' = Anzahl je Segment, 'spacing' = Abstand mm
    if (r.perSeg == null) r.perSeg = 3;
    if (r.spacing == null) r.spacing = 100;
    if (r.atJoints == null) r.atJoints = true;   // Rippe an Wurzel, Segmentstößen und Rand erzwingen
    if (r.sheetMode == null) r.sheetMode = 'wing'; // 'wing' | 'global' | 'perRib'
    if (r.sheet == null) r.sheet = 2;            // globale Beplankungsdicke (mm)
    if (r.showCore == null) r.showCore = true;   // Kernlinie (nach Beplankungsabzug) zeigen
    if (r.coreTe == null) r.coreTe = 'blunt';     // Kernende bei stumpfer Endleiste: 'blunt' (senkrecht) | 'sharp' (spitz)
    if (!r.sheetPer) r.sheetPer = {};            // je-Rippe-Werte, Schlüssel = Stationsindex
    if (!Array.isArray(r.manualZ)) r.manualZ = null;  // Positionen (mm) im Modus 'manual'
    if (r.showSpars == null) r.showSpars = true;      // Holmausschnitte in den Rippen zeigen
    if (!r.sparHide) r.sparHide = {};                 // ausgeblendete Holme (Index -> true)
    if (!r.tpl) r.tpl = {};                           // Nasenschablone (Schleifhilfe)
    const t = r.tpl;
    if (t.front == null) t.front = 12;   // Überstand vor der Nase (mm)
    if (t.back == null) t.back = 25;     // Tiefe über die Rippe nach hinten ab Nase (mm)
    if (t.height == null) t.height = 40; // Höhe des Rechtecks (mm)
    if (t.thick == null) t.thick = 8;    // Dicke der Schablone / Extrusion (mm)
    if (t.numDepth == null) t.numDepth = 1; // Tiefe der eingelassenen Nummer (mm)
    if (t.numSize == null) t.numSize = 8;   // Ziffernhöhe (mm bzw. % — siehe sizeMode)
    if (t.sizeMode == null) t.sizeMode = 'mm';   // 'mm' | 'pct' (% der Profillänge) für Überstand/Tiefe/Höhe/Ziffernhöhe
    if (t.show == null) t.show = true;   // Umriss in der Rippen-Galerie zeigen
    // Rib-eigene Profil-Einstellungen (gelten NUR im Rippendesigner):
    if (r.points == null) r.points = 160;   // Profilpunkte je Rippe
    if (r.teThk == null) r.teThk = 0;       // Endleistendicke (mm), 0 = spitz
    if (r.stlThick == null) r.stlThick = 3; // Dicke der Rippe beim STL-Export (mm)
    if (r.stlSpars == null) r.stlSpars = true; // Holmausschnitte als Löcher im STL
    // Halbrippen: Teil vorne/hinten entlang senkrechter Schnitte.
    if (!r.half) r.half = {};
    const hf = r.half;
    if (hf.mode == null) hf.mode = 'full';   // 'full' | 'front' | 'rear' | 'both'
    if (hf.posMode == null) hf.posMode = 'pct'; // 'pct' (ab Nase) | 'mm'
    if (hf.frontPos == null) hf.frontPos = 30;  // Trennung vorderer Teil
    if (hf.rearPos == null) hf.rearPos = 60;    // Trennung hinterer Teil
    return r;
  }
  // Setzt die Handpositionen aus den aktuell berechneten Stationen (beim ersten
  // Wechsel in den Modus „von Hand"), damit man von einer sinnvollen Verteilung
  // aus weiterarbeitet statt bei null.
  function ribSeedManual(fromMode) {
    const rc = ribCfg();
    if (Array.isArray(rc.manualZ) && rc.manualZ.length) return;
    ribReseedManual(fromMode);
  }
  // Positionen aus einer gleichmäßigen Verteilung (Standard: perSeg) übernehmen —
  // überschreibt vorhandene Handwerte.
  function ribReseedManual(fromMode) {
    const rc = ribCfg();
    const prev = rc.mode;
    rc.mode = (fromMode && fromMode !== 'manual') ? fromMode : 'perSeg';
    const st = ribStations(); rc.mode = prev;
    rc.manualZ = st.list.map(s => Math.round(s.z * 10) / 10);
  }
  // Stationen (absolute Spannweite z, Segment und lokaler Anteil t) der Rippen.
  function ribStations() {
    const rc = ribCfg(), segs = state.segments;
    const z0 = []; let acc = 0;
    segs.forEach(s => { z0.push(acc); acc += (s.span || 0); });
    const total = acc;
    const locate = z => {
      for (let i = 0; i < segs.length; i++) {
        const a = z0[i], sp = segs[i].span || 0;
        if (z <= a + sp + 1e-6) return { seg: i, t: sp ? Math.max(0, Math.min(1, (z - a) / sp)) : 0 };
      }
      const li = Math.max(0, segs.length - 1); return { seg: li, t: 1 };
    };
    let zs = [];
    if (rc.mode === 'manual') {
      zs = (rc.manualZ || []).slice();
    } else if (rc.mode === 'spacing') {
      const sp = Math.max(5, rc.spacing || 100);
      for (let z = 0; z <= total + 1e-6; z += sp) zs.push(z);
      if (!zs.length || zs[zs.length - 1] < total - 1e-6) zs.push(total);
    } else {
      const n = Math.max(2, Math.round(rc.perSeg || 3));
      segs.forEach((s, i) => { const sp = s.span || 0; for (let k = 0; k < n; k++) zs.push(z0[i] + sp * k / (n - 1)); });
    }
    if (rc.atJoints && rc.mode !== 'manual') { zs.push(0); z0.forEach((z, i) => { if (i > 0) zs.push(z); }); zs.push(total); }
    zs = zs.filter(z => z >= -1e-6 && z <= total + 1e-6).sort((a, b) => a - b);
    const out = [];
    zs.forEach(z => { if (!out.length || Math.abs(z - out[out.length - 1].z) > 1.0) out.push(Object.assign({ z }, locate(z))); });
    return { list: out, total };
  }
  // Rippenkontur (mm) an einer Station: punktweise Überblendung Wurzel/Außen,
  // danach rib-eigene Endleistendicke und Profilpunktzahl angewandt.
  function ribOutline(st) {
    const cut = App.wing.cuts[Math.min(st.seg, App.wing.cuts.length - 1)];
    const r = cut.root.pts, tp = cut.tip.pts, N = Math.min(r.length, tp.length);
    let pts = [];
    for (let i = 0; i < N; i++) pts.push({ x: r[i].x + (tp[i].x - r[i].x) * st.t, y: r[i].y + (tp[i].y - r[i].y) * st.t });
    const chord = cut.root.chord + (cut.tip.chord - cut.root.chord) * st.t;
    pts = ribProcessOutline(pts);
    return { pts, chord };
  }
  // Endleistendicke (stumpfe EL) + Neuabtastung mit rib-eigener Profilpunktzahl.
  // Beides gilt NUR im Rippendesigner (ändert die Tragfläche nicht).
  //
  // Damit die Endleiste GENAU wie im Tragflächendesigner aussieht, wird exakt
  // dieselbe Methode wie im Profil-Editor benutzt: erst auf die rib-eigene
  // Punktzahl neu abtasten, dann thickenTE() — Ober- und Unterseite werden um
  // die Nase gedreht, bis die Endleiste um teThk aufklafft (Ober +½ hoch, Unter
  // −½ runter). Die Nase und die Mitte der Endleiste bleiben dabei fest, sodass
  // das Profil normiert bleibt (Sehnenlinie unverändert).
  function ribProcessOutline(pts) {
    const rc = ribCfg();
    const teThk = Math.max(0, rc.teThk || 0);
    const Npts = Math.max(20, Math.round(rc.points || 160));
    let rs = Airfoil.resample(pts, Npts);
    // targetFrac von thickenTE ist der senkrechte EL-Spalt in denselben
    // Einheiten wie die Punkte (hier mm) — also direkt die Endleistendicke.
    if (teThk > 0) { const t = App.thickenTE(rs, teThk); t.name = rs.name; rs = t; }
    return ribTeVertical(rs);
  }
  // Endleiste der Rippe IMMER senkrecht: Manche (v. a. DXF-)Profile enden oben
  // und unten bei verschiedenem x (z. B. 1.0027 / 0.9973). Ohne Aufdickung ist das
  // ein flacher Zipfel, mit Aufdickung (Drehung um die Nase) eine SCHRÄGE
  // Endleiste. Daher werden Ober- und Unterseite am vorderen der beiden Enden
  // senkrecht abgeschnitten (Punkt 0 = Ende oben, letzter Punkt = Ende unten).
  function ribTeVertical(p) {
    const N = p.length; if (N < 4) return p;
    let iLE = 0; for (let i = 1; i < N; i++) if (p[i].x < p[iLE].x) iLE = i;
    const xc = Math.min(p[0].x, p[N - 1].x);
    if (Math.abs(p[0].x - p[N - 1].x) < 1e-6) return p;
    let j = 0; while (j < iLE && p[j].x > xc + 1e-9) j++;
    let k = N - 1; while (k > iLE && p[k].x > xc + 1e-9) k--;
    const at = (a, b) => { const t = (xc - a.x) / ((b.x - a.x) || 1e-9); return { x: xc, y: a.y + t * (b.y - a.y) }; };
    const out = [];
    if (j > 0) out.push(at(p[j - 1], p[j]));
    for (let i = j; i <= k; i++) out.push(p[i]);
    if (k < N - 1) out.push(at(p[k + 1], p[k]));
    out.name = p.name;
    return out;
  }
  // Polygon an einer senkrechten Linie x=xc abschneiden (Sutherland-Hodgman).
  // keepFront=true behält x<=xc (vorderer Teil), sonst x>=xc (hinterer Teil).
  function clipHalfX(poly, xc, keepFront) {
    if (!poly || poly.length < 3) return null;
    const inside = p => keepFront ? p.x <= xc + 1e-9 : p.x >= xc - 1e-9;
    const isec = (a, b) => { const t = (xc - a.x) / ((b.x - a.x) || 1e-9); return { x: xc, y: a.y + t * (b.y - a.y) }; };
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], ai = inside(a), bi = inside(b);
      if (ai) { out.push(a); if (!bi) out.push(isec(a, b)); }
      else if (bi) out.push(isec(a, b));
    }
    return out.length >= 3 ? out : null;
  }
  // Trennstelle (absolutes x) aus %-/mm-Angabe ab Nasenleiste, für eine Rippe.
  function ribCutX(pts, chord, posMode, pos) {
    const leX = Math.min.apply(null, pts.map(p => p.x));
    return leX + (posMode === 'mm' ? (pos || 0) : (pos || 0) / 100 * chord);
  }
  // Halbrippen-Stücke einer Rippe: liefert Liste von Klipp-Spezifikationen.
  // Jede Spezifikation = Array von {xc, front}. Leeres Array = ganze Rippe.
  function ribHalfSpecs(pts, chord) {
    const hf = ribCfg().half, m = hf.mode || 'full';
    if (m === 'full') return [[]];
    const xf = ribCutX(pts, chord, hf.posMode, hf.frontPos);
    const xr = ribCutX(pts, chord, hf.posMode, hf.rearPos);
    if (m === 'front') return [[{ xc: xf, front: true }]];
    if (m === 'rear') return [[{ xc: xr, front: false }]];
    // both: vorderes Stück (bis xf) UND hinteres Stück (ab xr)
    return [[{ xc: xf, front: true }], [{ xc: xr, front: false }]];
  }
  function applyHalfSpec(poly, spec) {
    let p = poly;
    for (const c of spec) { p = clipHalfX(p, c.xc, c.front); if (!p) return null; }
    return p;
  }
  // Wirksame Beplankung (oben/unten, mm) einer Rippe je nach Quelle.
  function ribSheet(st, idx) {
    const rc = ribCfg();
    if (rc.sheetMode === 'global') return { top: rc.sheet || 0, bot: rc.sheet || 0 };
    if (rc.sheetMode === 'perRib') { const g = rc.sheet || 0, v = rc.sheetPer[idx]; const t = (v == null ? g : v); return { top: t, bot: t }; }
    const sf = App.sheetFor(state.segments[st.seg]);   // 'wing' — aus dem Tragflächendesign
    return { top: sf.root.top + (sf.tip.top - sf.root.top) * st.t, bot: sf.root.bot + (sf.tip.bot - sf.root.bot) * st.t };
  }
  // Kernlinie (Kontur nach Beplankungsabzug): echter, senkrechter (normalen-)
  // Versatz der Profilkontur nach innen — Oberseite um `top`, Unterseite um `bot`,
  // um die Nase stetig überblendet. Dadurch bleibt die NASE RUND (die frühere
  // Spalten-Abtastung erzeugte dort eine gerade Linie). Wo die Restdicke ≤ 0 wird
  // (dünne/spitze Endleiste, spitze Nase), kreuzt sich der Versatz — deloopPoly
  // schneidet das sauber heraus, sodass der Kern dort schlüssig endet.
  function ribInset(pts, top, bot, sharp) {
    if (!(top > 0) && !(bot > 0)) return null;
    const n = pts.length; if (n < 3) return null;
    const s = polyArea(pts) > 0 ? 1 : -1;
    // Lokale Beplankungsdicke an einem Punkt: unten `bot`, oben `top`, dazwischen
    // (um die Nase) linear über die senkrechte Lage im Profil überblendet.
    const thickAt = p => {
      const su = surfaceAtX(pts, p.x);
      let w = 0.5;
      if (su && su.top - su.bot > 1e-6) w = Math.max(0, Math.min(1, (p.y - su.bot) / (su.top - su.bot)));
      return bot + (top - bot) * w;
    };
    const nrm = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: s * (-dy) / l, y: s * (dx) / l }; };
    // Je Kante um die (gemittelte) lokale Dicke nach innen versetzen.
    const E = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], no = nrm(a, b), d = (thickAt(a) + thickAt(b)) * 0.5;
      E.push({ px: a.x + no.x * d, py: a.y + no.y * d, dx: b.x - a.x, dy: b.y - a.y });
    }
    let off = [];
    for (let i = 0; i < n; i++) {
      const e1 = E[(i - 1 + n) % n], e2 = E[i], den = e1.dx * e2.dy - e1.dy * e2.dx;
      if (Math.abs(den) > 1e-9) {
        const t = ((e2.px - e1.px) * e2.dy - (e2.py - e1.py) * e2.dx) / den;
        off.push({ x: e1.px + t * e1.dx, y: e1.py + t * e1.dy });
      } else {
        const n1 = nrm(pts[(i - 1 + n) % n], pts[i]), n2 = nrm(pts[i], pts[(i + 1) % n]);
        let nx = n1.x + n2.x, ny = n1.y + n2.y; const l = Math.hypot(nx, ny) || 1, d = thickAt(pts[i]);
        off.push({ x: pts[i].x + nx / l * d, y: pts[i].y + ny / l * d });
      }
    }
    // Gültigkeits-Filter (robust bei kleinen Rippen / dünner Endleiste): Ein
    // Versatzpunkt ist nur gültig, wenn er zu JEDER Originalkante mindestens den
    // lokalen Abzug (der Kante) Abstand hält. Wo die Restdicke ≤ 0 wird, „stülpt"
    // sich der Versatz um und die Punkte liegen zu nah an der Gegenseite — sie
    // werden entfernt; die verbleibenden Ober-/Unterketten schließen sich direkt.
    // Erst danach räumt deloopPoly kleine Restkreuzungen auf (vorher konnte es bei
    // mehrfach überlappenden Schleifen das falsche Stück behalten).
    const segDist = (p, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      let t = L2 > 1e-12 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    const tol = Math.max(0.01, 0.03 * Math.max(top, bot));
    const inside = q => {                       // Punkt im Originalprofil (Strahltest)
      let c = false;
      for (let k = 0, m = n - 1; k < n; m = k++) {
        const a = pts[k], b = pts[m];
        if ((a.y > q.y) !== (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    const valid = off.filter(q => {
      if (!inside(q)) return false;            // Ausreißer (fast parallele Kanten → Schnittpunkt weit weg)
      for (let k = 0; k < n; k++) {
        const a = pts[k], b = pts[(k + 1) % n];
        const dk = (thickAt(a) + thickAt(b)) * 0.5;
        if (segDist(q, a, b) < dk - tol) return false;
      }
      return true;
    });
    if (valid.length < 3) return null;
    off = deloopPoly(valid);
    if (!off || off.length < 3) return null;
    // Kernende (Endleiste des Kerns), wählbar:
    //   sharp = Ober- und Unterseite bis zu ihrem Schnittpunkt verlängern → spitz
    //           (bei stumpfer Endleiste ggf. über die Profil-Endleiste hinaus);
    //   blunt = senkrecht abschneiden am vorderen der beiden Kettenenden.
    // Hintergrund: Läuft die Restdicke vor der Endleiste auf 0, enden Ober- und
    // Unterkette an verschiedenen x — die schließende Kante wäre sonst schräg.
    {
      const m = off.length; let k = 0;
      for (let i = 1; i < m; i++) if (off[i].x > off[k].x) k = i;
      const wOf = p => { const su = surfaceAtX(pts, p.x); return (su && su.top - su.bot > 1e-6) ? (p.y - su.bot) / (su.top - su.bot) : 0.5; };
      const ia = (k - 1 + m) % m, ib = (k + 1) % m, wk = wOf(off[k]);
      const acrossPrev = Math.abs(wOf(off[ia]) - wk) > Math.abs(wOf(off[ib]) - wk);
      // A = off[k] (Kettenende 1), B = Nachbar auf der Gegenseite (Kettenende 2),
      // A2/B2 = jeweils der Punkt davor auf der eigenen Kette.
      const iB = acrossPrev ? ia : ib, iA2 = acrossPrev ? ib : ia, iB2 = acrossPrev ? (ia - 1 + m) % m : (ib + 1) % m;
      const A = off[k], B = off[iB], A2 = off[iA2], B2 = off[iB2];
      const vert = Math.abs(B.x - A.x) <= 1e-6;
      if (sharp) {
        const d1x = A.x - A2.x, d1y = A.y - A2.y, d2x = B.x - B2.x, d2y = B.y - B2.y;
        const den = d1x * d2y - d1y * d2x;
        let X = null;
        if (Math.abs(den) > 1e-12) {
          const t = ((B.x - A.x) * d2y - (B.y - A.y) * d2x) / den;
          X = { x: A.x + t * d1x, y: A.y + t * d1y };
        }
        if (X && X.x >= A.x - 1e-6 && isFinite(X.x) && isFinite(X.y)) {
          const res = [];
          const iIns = acrossPrev ? iB : k;              // X folgt auf diesen Punkt (Reihenfolge B,X,A bzw. A,X,B)
          for (let i = 0; i < m; i++) {
            if (!(vert && (i === k || i === iB))) res.push(off[i]);   // senkrechte Schlusskante entfällt
            if (i === iIns) res.push(X);
          }
          off = res;
        } else if (!vert) { const cut = clipHalfX(off, B.x, true); if (cut && cut.length >= 3) off = cut; }
      } else if (!vert) {
        const cut = clipHalfX(off, B.x, true); if (cut && cut.length >= 3) off = cut;
      }
    }
    off.closed = true;
    return off;
  }
  function ribModeLabel(m) { return T(({ wing: 'aus Tragfläche', global: 'global', perRib: 'je Rippe' })[m] || m); }

  // ===== Nasenschablone (Schleifhilfe) =================================
  // 2D-Negativ der Nase: ein Rechteck über die Rippe (Überstand vorne,
  // Tiefe nach hinten, Höhe) mit ausgeschnittener Profilnase; als extrudierte
  // STL mit eingelassener, aufsteigender Nummer.
  //
  // Triangulierung (earcut mit Löchern) liegt im Kern: earcut.js → App.earcut.
  function triangulate(rings) { return App.earcut(rings); }

  // --- 7-Segment-Ziffern als Rechtecke (für die eingelassene Nummer) ----
  const SEG7 = { '0': 'ABCDEF', '1': 'BC', '2': 'ABGED', '3': 'ABGCD', '4': 'FGBC', '5': 'AFGCD', '6': 'AFGEDC', '7': 'ABC', '8': 'ABCDEFG', '9': 'ABCFGD' };
  function digitRects(ch, ox, oy, dw, dh) {
    const s = Math.min(dw, dh) * 0.18, e = s * 0.16;   // Strichstärke, Trennspalt
    const R = (x0, y0, x1, y1) => [{ x: x0 + e, y: y0 + e }, { x: x1 - e, y: y0 + e }, { x: x1 - e, y: y1 - e }, { x: x0 + e, y: y1 - e }];
    const seg = {
      A: [ox + s, oy + dh - s, ox + dw - s, oy + dh], B: [ox + dw - s, oy + dh / 2, ox + dw, oy + dh - s],
      C: [ox + dw - s, oy + s, ox + dw, oy + dh / 2], D: [ox + s, oy, ox + dw - s, oy + s],
      E: [ox, oy + s, ox + s, oy + dh / 2], F: [ox, oy + dh / 2, ox + s, oy + dh - s],
      G: [ox + s, oy + dh / 2 - s / 2, ox + dw - s, oy + dh / 2 + s / 2]
    };
    return (SEG7[ch] || '').split('').map(k => R.apply(null, seg[k]));
  }
  // Ziffern-Rechtecke einer Zahl, zentriert in region {x0,y0,x1,y1}.
  function numberRects(num, region) {
    const str = String(num), n = str.length;
    const availH = region.y1 - region.y0, availW = region.x1 - region.x0;
    // Höhe = frei gewählte Ziffernhöhe (mm, ggf. aus % aufgelöst in region.numH).
    // Nur ein Sicherheits-Clamp an die Regionhöhe, damit die Vertiefung im Material bleibt.
    const wantH = region.numH != null ? region.numH : Math.max(1, ribCfg().tpl.numSize);
    const dh = Math.min(wantH, availH - 1.5);
    let dw = dh * 0.62, gap = dw * 0.32;
    let totW = n * dw + (n - 1) * gap;
    // Bei Platzmangel NUR die Breite stauchen — die Höhe bleibt wie gewählt.
    if (totW > availW - 1.5) { const k = (availW - 1.5) / totW; dw *= k; gap *= k; totW = n * dw + (n - 1) * gap; }
    let ox = (region.x0 + region.x1) / 2 - totW / 2;
    const oy = (region.y0 + region.y1) / 2 - dh / 2;
    let rects = [];
    for (let i = 0; i < n; i++) { rects = rects.concat(digitRects(str[i], ox, oy, dw, dh)); ox += dw + gap; }
    return rects;
  }

  // --- 2D-Negativ der Nase (in Rippen-mm, LE-Bereich) ------------------
  function ribTemplate2D(pts) {
    const tp = ribCfg().tpl;
    // Nase FEIN auflösen: Kontur auf hohe Punktzahl bringen (Airfoil.resample
    // clustert per Kosinus dicht an der Nasenleiste). Der Nasenbogen wird dann
    // direkt aus diesen echten Konturpunkten gebaut — nicht mehr grob in x
    // abgetastet (dort war die Nase, wo x kaum variiert, viel zu grob).
    const fine = (Airfoil.resample(pts, 400)) || pts;
    const xs = fine.map(p => p.x), leX = Math.min.apply(null, xs), teX = Math.max.apply(null, xs);
    const chord = (teX - leX) || 1;
    // Größen wahlweise in mm oder in % der Profillänge (Sehne dieser Rippe).
    const sz = v => tp.sizeMode === 'pct' ? (v || 0) / 100 * chord : (v || 0);
    const xF = leX - Math.max(0, sz(tp.front)), xR = leX + Math.max(1, sz(tp.back));
    const sR = surfaceAtX(fine, xR); if (!sR) return { ok: false };
    const yc = (sR.top + sR.bot) / 2;
    let H = Math.max(1, sz(tp.height)); const need = (sR.top - sR.bot) + 6; if (H < need) H = need;
    const numH = Math.max(1, sz(tp.numSize));   // aufgelöste Ziffernhöhe (mm)
    const yB = yc - H / 2, yT = yc + H / 2;
    // Nasenbogen = alle Konturpunkte mit x<=xR (inkl. exakter Kreuzungen bei xR),
    // in Kontur-Reihenfolge: obere Kreuzung -> Nase -> untere Kreuzung.
    const arc = [], n = fine.length;
    for (let i = 0; i < n; i++) {
      const a = fine[i], b = fine[(i + 1) % n], ai = a.x <= xR, bi = b.x <= xR;
      if (ai) arc.push({ x: a.x, y: a.y });
      if (ai !== bi) { const t = (xR - a.x) / ((b.x - a.x) || 1e-9); arc.push({ x: xR, y: a.y + t * (b.y - a.y) }); }
    }
    if (arc.length < 3) return { ok: false };
    const yUR = arc[0].y, yLR = arc[arc.length - 1].y;
    const ring = [];
    const push = p => { const q = ring[ring.length - 1]; if (!q || Math.hypot(q.x - p.x, q.y - p.y) > 1e-4) ring.push(p); };
    push({ x: xF, y: yB }); push({ x: xR, y: yB });
    for (let i = arc.length - 1; i >= 0; i--) push(arc[i]);   // untere Kreuzung -> Nase -> obere Kreuzung
    push({ x: xR, y: yT }); push({ x: xF, y: yT });
    // Nummer-Bereich: VOR der Rippe, im vorderen Überstand (solider Block vor der
    // Nasenleiste). Ist der Überstand zu schmal, Rückfall auf die obere Leiste
    // über der Nase.
    let region;
    if ((leX - 1) - (xF + 1.5) >= 6)
      region = { x0: xF + 1.5, y0: yB + 1.5, x1: leX - 1, y1: yT - 1.5, numH };
    else
      region = { x0: leX + 2, y0: yUR + 1.5, x1: xR - 1.5, y1: yT - 1.5, numH };
    return { ok: true, ring, region, rect: { xF, xR, yB, yT }, xLE: leX };
  }

  // --- STL: Umriss (ggf. mit Nummer-Taschen) extrudieren ---------------
  function stlFacet(A, B, C) {
    let nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
    let ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    let nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const f = v => v.map(n => (Math.abs(n) < 1e-9 ? 0 : n).toFixed(4)).join(' ');
    return `facet normal ${f([nx, ny, nz])}\nouter loop\nvertex ${f(A)}\nvertex ${f(B)}\nvertex ${f(C)}\nendloop\nendfacet\n`;
  }
  // Ein Schablonen-Volumen als Dreiecks-Array [[A,B,C],…] (A/B/C = [x,y,z]).
  // yOff verschiebt in Y (Aufreihung). Wird für STL UND 3D-Vorschau genutzt.
  function templateTris(tpl, T, depth, yOff) {
    const F = [];
    const ring = tpl.ring, holes = tpl.holes || [];
    const off = p => [p.x, p.y + yOff];
    const capTop = triangulate([ring].concat(holes));
    const capBot = triangulate([ring]);
    const emitCap = (tr, z, up) => tr.tris.forEach(t => {
      let a = tr.V[t[0]], b = tr.V[t[1]], c = tr.V[t[2]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if ((up && cross < 0) || (!up && cross > 0)) { const tmp = b; b = c; c = tmp; }
      F.push([[a[0], a[1] + yOff, z], [b[0], b[1] + yOff, z], [c[0], c[1] + yOff, z]]);
    });
    emitCap(capBot, 0, false);       // Unterseite z=0
    emitCap(capTop, T, true);        // Oberseite z=T (mit Löchern)
    const wall = (loop, zLo, zHi) => {
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i], q = loop[(i + 1) % loop.length];
        const P = off(p), Q = off(q);
        F.push([[P[0], P[1], zLo], [Q[0], Q[1], zLo], [Q[0], Q[1], zHi]]);
        F.push([[P[0], P[1], zLo], [Q[0], Q[1], zHi], [P[0], P[1], zHi]]);
      }
    };
    wall(ring, 0, T);
    holes.forEach(hl => {
      const fl = triangulate([hl]);
      fl.tris.forEach(t => { const a = fl.V[t[0]], b = fl.V[t[1]], c = fl.V[t[2]]; F.push([[a[0], a[1] + yOff, T - depth], [b[0], b[1] + yOff, T - depth], [c[0], c[1] + yOff, T - depth]]); });
      wall(hl, T - depth, T);
    });
    return F;
  }
  // Alle Schablonen als ein Dreiecks-Array (mit Y-Aufreihung wie im Export).
  function ribTemplateTris(templates) {
    const tp = ribCfg().tpl, T = Math.max(1, tp.thick), depth = Math.min(tp.numDepth, T - 0.5);
    let all = [], yOff = 0;
    templates.forEach(tpl => { all = all.concat(templateTris(tpl, T, depth, yOff)); yOff += (tpl.rect.yT - tpl.rect.yB) + 15; });
    return all;
  }
  function ribTemplateSTL(templates) {
    let body = '';
    ribTemplateTris(templates).forEach(t => { body += stlFacet(t[0], t[1], t[2]); });
    return 'solid nasenschablonen\n' + body + 'endsolid nasenschablonen\n';
  }
  // Schablonen für die aktuelle Rippenliste erzeugen (mit Nummern).
  function ribCollectTemplates() {
    if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) return [];
    const { list } = ribStations(), templates = [];
    list.forEach((st, i) => {
      const o = ribOutline(st), tpl = ribTemplate2D(o.pts);
      if (!tpl.ok) return;
      tpl.holes = numberRects(i + 1, tpl.region);
      templates.push(tpl);
    });
    return templates;
  }
  function exportRibTemplates() {
    if (DEMO.blocked()) return;
    if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) { alert(T('Keine Tragfläche.')); return; }
    const templates = ribCollectTemplates();
    if (!templates.length) { alert(T('Keine gültige Nasenschablone erzeugt (Höhe/Tiefe prüfen).')); return; }
    // Wie „Projekt speichern": immer der Windows-Explorer-Dialog zur Wahl des
    // Speicherorts (nicht still in einen gemerkten Ordner schreiben).
    const wt = App.wingFileTag ? App.wingFileTag() : '';   // mehrere Tragflächen: Name voranstellen
    App.exportViaPicker((wt ? wt + '_' : '') + 'nasenschablonen.stl', ribTemplateSTL(templates), 'model/stl', 'save');
  }

  // ===== Rippen als STL (Volumenkörper) ================================
  // Jede Rippe (bzw. Halbrippen-Stück) wird als Außenkontur auf die gewählte
  // Dicke extrudiert; Holmausschnitte werden als durchgehende Löcher ausgespart.
  // Ein Körper als Dreiecks-Array; outer/holes bereits auf den lokalen Ursprung
  // geschoben. yOff reiht in Y auf (STL + Vorschau).
  function ribBodyTris(outer, holes, T, yOff) {
    const F = [];
    const cap = triangulate([outer].concat(holes));
    const emitCap = (z, up) => cap.tris.forEach(t => {
      let a = cap.V[t[0]], b = cap.V[t[1]], c = cap.V[t[2]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if ((up && cross < 0) || (!up && cross > 0)) { const tmp = b; b = c; c = tmp; }
      F.push([[a[0], a[1] + yOff, z], [b[0], b[1] + yOff, z], [c[0], c[1] + yOff, z]]);
    });
    emitCap(0, false);   // Unterseite z=0
    emitCap(T, true);    // Oberseite z=T
    const wall = loop => {
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i], q = loop[(i + 1) % loop.length];
        F.push([[p.x, p.y + yOff, 0], [q.x, q.y + yOff, 0], [q.x, q.y + yOff, T]]);
        F.push([[p.x, p.y + yOff, 0], [q.x, q.y + yOff, T], [p.x, p.y + yOff, T]]);
      }
    };
    wall(outer); holes.forEach(wall);
    return F;
  }
  // Rippenkörper der aktuellen Rippenliste sammeln (Außenkontur + Holmlöcher),
  // je Halbrippen-Stück ein eigener Körper — wie in der Vorschau.
  function ribCollectBodies() {
    if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) return [];
    const rc = ribCfg(), { list } = ribStations(), bodies = [];
    list.forEach(st => {
      const o = ribOutline(st);
      const sparFull = [];
      if (rc.stlSpars) (state.spars || []).forEach((sp, j) => {
        if (rc.sparHide[j] || !sparAppliesTo(sp, st.seg)) return;
        const fl = sparFromLE(sp, st.seg, 'root') + (sparFromLE(sp, st.seg, 'tip') - sparFromLE(sp, st.seg, 'root')) * st.t;
        const g = sparOnProfile(sp, o.pts, null, fl, sparYc(sp), st.t < 0.5 ? 'root' : 'tip', App.sparCoreFromSheet(o.pts, ribSheet(st, list.indexOf(st))));
        sparPolys(g).forEach(pl => sparFull.push(pl));
      });
      ribHalfSpecs(o.pts, o.chord).forEach(spec => {
        const outer = applyHalfSpec(o.pts, spec); if (!outer || outer.length < 3) return;
        const holes = sparFull.map(sp => applyHalfSpec(sp, spec)).filter(h => h && h.length >= 3);
        const xs = outer.map(p => p.x), ys = outer.map(p => p.y);
        const minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
        const miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
        bodies.push({ outer, holes, minx, miny, w: maxx - minx, h: maxy - miny });
      });
    });
    return bodies;
  }
  // Alle Rippenkörper als ein Dreiecks-Array (Y-Aufreihung wie beim Export).
  function ribBodyTrisAll(bodies, T) {
    let all = [], yOff = 0;
    bodies.forEach(b => {
      const outer = b.outer.map(p => ({ x: p.x - b.minx, y: p.y - b.miny }));
      const holes = b.holes.map(h => h.map(p => ({ x: p.x - b.minx, y: p.y - b.miny })));
      all = all.concat(ribBodyTris(outer, holes, T, yOff));
      yOff += b.h + 15;
    });
    return all;
  }
  function ribBodySTL(bodies, T) {
    let body = '';
    ribBodyTrisAll(bodies, T).forEach(t => { body += stlFacet(t[0], t[1], t[2]); });
    return 'solid rippen\n' + body + 'endsolid rippen\n';
  }
  function exportRibBodies() {
    if (DEMO.blocked()) return;
    if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) { alert(T('Keine Tragfläche.')); return; }
    const bodies = ribCollectBodies();
    if (!bodies.length) { alert(T('Keine Rippen.')); return; }
    const Tk = Math.max(0.5, ribCfg().stlThick || 3);
    const wt = App.wingFileTag ? App.wingFileTag() : '';
    App.exportViaPicker((wt ? wt + '_' : '') + 'rippen.stl', ribBodySTL(bodies, Tk), 'model/stl', 'save');
  }
  // 3D-Vorschau der Rippen-STL (nutzt denselben Mini-Renderer/Modal).
  function ribBodyPreviewOpen() {
    const bodies = ribCollectBodies();
    if (!bodies.length) { alert(T('Keine Rippen.')); return; }
    const Tk = Math.max(0.5, ribCfg().stlThick || 3);
    stlView.tris = ribBodyTrisAll(bodies, Tk);
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    stlView.tris.forEach(t => t.forEach(p => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } }));
    stlView.center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    stlView.size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
    stlView.rx = -1.05; stlView.ry = 0.6; stlView.zoom = 1; stlView.ox = 0; stlView.oy = 0;
    document.getElementById('ribStlModal').classList.add('open');
    requestAnimationFrame(renderStlPreview);
  }

  // ---- 3D-Vorschau der Schablonen-STL (eigener Mini-Renderer) ---------
  const stlView = { rx: -1.05, ry: 0.6, zoom: 1, ox: 0, oy: 0, tris: null, drag: null };
  function ribStlPreviewOpen() {
    const templates = ribCollectTemplates();
    if (!templates.length) { alert(T('Keine gültige Nasenschablone erzeugt (Höhe/Tiefe prüfen).')); return; }
    stlView.tris = ribTemplateTris(templates);
    // Auf Ursprung zentrieren (Mittelpunkt der Bounding-Box).
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    stlView.tris.forEach(t => t.forEach(p => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } }));
    stlView.center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    stlView.size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
    stlView.rx = -1.05; stlView.ry = 0.6; stlView.zoom = 1; stlView.ox = 0; stlView.oy = 0;
    document.getElementById('ribStlModal').classList.add('open');
    requestAnimationFrame(renderStlPreview);
  }
  function ribStlPreviewClose() { document.getElementById('ribStlModal').classList.remove('open'); }
  function renderStlPreview() {
    const cv = document.getElementById('cRibStl'); if (!cv || !stlView.tris) return;
    const { ctx, w, h } = App.fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0e12'; ctx.fillRect(0, 0, w, h);
    const cx = stlView.center, sr = Math.sin(stlView.rx), cr = Math.cos(stlView.rx), sy = Math.sin(stlView.ry), cy = Math.cos(stlView.ry);
    const scale = (Math.min(w, h) / (stlView.size * 1.5)) * stlView.zoom;
    // Rotation Y dann X; orthographische Projektion. Lichtrichtung fest.
    const rot = p => {
      let x = p[0] - cx[0], y = p[1] - cx[1], z = p[2] - cx[2];
      let x1 = x * cy + z * sy, z1 = -x * sy + z * cy;      // um Y
      let y2 = y * cr - z1 * sr, z2 = y * sr + z1 * cr;     // um X
      return [x1, y2, z2];
    };
    const L = (() => { const v = [0.4, 0.5, 0.75], m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; })();
    const faces = stlView.tris.map(t => {
      const A = rot(t[0]), B = rot(t[1]), C = rot(t[2]);
      const nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
      const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
      const nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      const nl = Math.hypot(nx, ny, nz) || 1;
      const lit = Math.max(0.12, Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / nl));
      const depth = (A[2] + B[2] + C[2]) / 3;
      return { A, B, C, lit, depth };
    });
    faces.sort((a, b) => a.depth - b.depth);   // Painter (hinten zuerst)
    const X = p => w / 2 + stlView.ox + p[0] * scale;
    const Y = p => h / 2 + stlView.oy - p[1] * scale;
    faces.forEach(f => {
      const g = Math.round(70 + f.lit * 150);
      ctx.beginPath(); ctx.moveTo(X(f.A), Y(f.A)); ctx.lineTo(X(f.B), Y(f.B)); ctx.lineTo(X(f.C), Y(f.C)); ctx.closePath();
      ctx.fillStyle = 'rgb(' + Math.round(g * 0.55) + ',' + Math.round(g * 0.72) + ',' + g + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,28,38,.55)'; ctx.lineWidth = 0.4; ctx.stroke();
    });
    const info = document.getElementById('ribStlInfo');
    if (info) info.textContent = stlView.tris.length + T(' Dreiecke · Ziehen = drehen · Shift+Ziehen = schieben · Rad = Zoom');
  }
  function setupStlPreviewNav() {
    const cv = document.getElementById('cRibStl'); if (!cv || cv._navSet) return; cv._navSet = true;
    cv.addEventListener('mousedown', e => { stlView.drag = { x: e.clientX, y: e.clientY, rx: stlView.rx, ry: stlView.ry, ox: stlView.ox, oy: stlView.oy, shift: e.shiftKey }; });
    window.addEventListener('mousemove', e => {
      if (!stlView.drag) return; const dx = e.clientX - stlView.drag.x, dy = e.clientY - stlView.drag.y;
      if (stlView.drag.shift) { stlView.ox = stlView.drag.ox + dx; stlView.oy = stlView.drag.oy + dy; }
      else { stlView.ry = stlView.drag.ry - dx * 0.01; stlView.rx = stlView.drag.rx - dy * 0.01; }   // invertiert (wie Simulator)
      renderStlPreview();
    });
    window.addEventListener('mouseup', () => { stlView.drag = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); stlView.zoom *= Math.exp(-e.deltaY * 0.0015); renderStlPreview(); }, { passive: false });
    cv.addEventListener('dblclick', () => { stlView.rx = -1.05; stlView.ry = 0.6; stlView.zoom = 1; stlView.ox = 0; stlView.oy = 0; renderStlPreview(); });
  }

  function buildRibSidebar(side) {
    const rc = ribCfg();
    const gv = App.grp('Rippenverteilung', true, 'rib');
    App.selectRow(gv.body, 'Anordnung',
      [['perSeg', 'Anzahl je Segment'], ['spacing', 'Abstand (mm)'], ['manual', 'Positionen von Hand']],
      () => rc.mode, v => { const old = rc.mode; rc.mode = v; if (v === 'manual') ribSeedManual(old); App.buildSidebar(); renderRib(); },
      'Wie die Rippen über die Spannweite verteilt werden: eine feste Anzahl je '
      + 'Segment (inkl. beider Enden), ein gleichmäßiger Abstand über die gesamte '
      + 'Spannweite, oder jede Position (z ab Wurzel, mm) von Hand.');
    if (rc.mode === 'spacing')
      App.numRow(gv.body, 'Rippenabstand (mm)', () => rc.spacing, v => { rc.spacing = Math.max(5, v); renderRib(); },
        { step: 5, min: 5, norender: true });
    else if (rc.mode === 'manual') {
      const total = state.segments.reduce((a, s) => a + (s.span || 0), 0);
      App.hint(gv.body, 'Startwerte aus gleichmäßiger Verteilung übernommen — hier je Rippe '
        + 'die Spannweitenposition (mm ab Wurzel, 0…' + Math.round(total) + ') von Hand anpassen. '
        + 'Reihenfolge egal, sortiert wird beim Zeichnen.');
      const rs = document.createElement('button');
      rs.textContent = T('↻ Aus gleichmäßiger Verteilung'); rs.title = T('Positionen aus „Anzahl je Segment" neu übernehmen (überschreibt Handwerte)');
      rs.onclick = () => { ribReseedManual('perSeg'); App.buildSidebar(); renderRib(); };
      gv.body.appendChild(rs);
      (rc.manualZ || []).forEach((z, i) => {
        const row = document.createElement('div'); row.className = 'row';
        const l = document.createElement('label'); l.textContent = 'R' + (i + 1) + ' · z (mm)';
        const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.value = z;
        inp.style.width = '100%';
        inp.oninput = () => { const v = parseNum(inp.value); if (!isNaN(v)) { rc.manualZ[i] = Math.max(0, Math.min(total, v)); renderRib(); } };
        const del = document.createElement('button'); del.textContent = '✕'; del.title = T('Rippe entfernen');
        del.style.padding = '4px 8px';
        del.onclick = () => { rc.manualZ.splice(i, 1); App.buildSidebar(); renderRib(); };
        const wrap = document.createElement('div'); wrap.style.display = 'grid';
        wrap.style.gridTemplateColumns = '1fr 28px'; wrap.style.gap = '6px';
        wrap.appendChild(App.wrapWithSpinner(inp, { step: 5, min: 0, max: total })); wrap.appendChild(del);
        row.appendChild(l); row.appendChild(wrap); gv.body.appendChild(row);
      });
      const add = document.createElement('button'); add.textContent = T('+ Rippe hinzufügen'); add.className = 'primary';
      add.onclick = () => {
        const arr = rc.manualZ || (rc.manualZ = []);
        const last = arr.length ? arr[arr.length - 1] : 0;
        arr.push(Math.min(total, Math.round(last + (total ? total / 8 : 50))));
        App.buildSidebar(); renderRib();
      };
      gv.body.appendChild(add);
    } else
      App.numRow(gv.body, 'Rippen je Segment', () => rc.perSeg, v => { rc.perSeg = Math.max(2, Math.round(v)); renderRib(); },
        { int: true, min: 2, max: 40, norender: true });
    if (rc.mode !== 'manual')
      App.boolRow(gv.body, 'Rippen an Wurzel/Stößen/Rand', () => rc.atJoints,
        v => { rc.atJoints = v; renderRib(); },
        'Erzwingt zusätzlich eine Rippe an der Wurzel, an jedem Segmentstoß und am '
        + 'Randbogen — unabhängig von der Verteilung.');
    side.appendChild(gv.g);

    // --- Profil (nur Rippendesigner): Punktzahl + Endleistendicke ---------
    const gp = App.grp('Profil (nur Rippen)', true, 'rib');
    App.hint(gp.body, 'Gilt nur im Rippendesigner — die Tragfläche/der G-Code bleiben unberührt.');
    App.selectRow(gp.body, 'Profilpunkte',
      [['60', '60 (grob)'], ['100', '100'], ['160', '160 (Standard)'], ['240', '240'], ['320', '320 (fein)']],
      () => String(rc.points || 160), v => { rc.points = parseInt(v, 10) || 160; renderRib(); },
      'Anzahl der Stützpunkte je Rippenkontur. Mehr = feiner, größere Dateien.');
    App.numRow(gp.body, 'Endleistendicke (mm)', () => rc.teThk, v => { rc.teThk = Math.max(0, v); renderRib(); },
      { step: 0.1, min: 0, norender: true,
        hint: 'Stumpfe Endleiste: Ober- und Unterseite werden um die Nase (Scharnier) '
          + 'gedreht, bis die Endleiste um diesen Wert aufklafft (identisch zum '
          + 'Profil-Editor im Tragflächendesigner). 0 = spitz auslaufend.' });
    side.appendChild(gp.g);

    // --- Halbrippen: Teil vorne/hinten entlang senkrechter Schnitte -------
    const hf = rc.half;
    const gr = App.grp('Halbrippen', true, 'rib');
    App.selectRow(gr.body, 'Umfang',
      [['full', 'Ganze Rippe'], ['front', 'Nur vorderer Teil'], ['rear', 'Nur hinterer Teil'], ['both', 'Vorne + hinten (Mitte weg)']],
      () => hf.mode, v => { hf.mode = v; App.buildSidebar(); renderRib(); },
      'Schneidet die Rippe an senkrechten Linien: nur der vordere Teil (bis zur '
      + 'Trennung), nur der hintere, oder vorderer UND hinterer Teil (die Mitte '
      + 'entfällt, z. B. für einen Holm-/D-Box-Bereich).');
    if (hf.mode !== 'full') {
      App.selectRow(gr.body, 'Trennung angeben in',
        [['pct', '% ab Nasenleiste'], ['mm', 'mm ab Nasenleiste']],
        () => hf.posMode, v => { hf.posMode = v; App.buildSidebar(); renderRib(); });
      const unit = hf.posMode === 'mm' ? 'mm' : '%';
      if (hf.mode === 'front' || hf.mode === 'both')
        App.numRow(gr.body, T('Trennung vorne (') + unit + ')', () => hf.frontPos, v => { hf.frontPos = Math.max(0, v); renderRib(); },
          { step: hf.posMode === 'mm' ? 1 : 1, min: 0, norender: true });
      if (hf.mode === 'rear' || hf.mode === 'both')
        App.numRow(gr.body, T('Trennung hinten (') + unit + ')', () => hf.rearPos, v => { hf.rearPos = Math.max(0, v); renderRib(); },
          { step: hf.posMode === 'mm' ? 1 : 1, min: 0, norender: true });
      if (hf.mode === 'both')
        App.hint(gr.body, 'Vorne < hinten wählen — dazwischen (Mitte) wird entfernt.');
    }
    side.appendChild(gr.g);

    const gs = App.grp('Beplankung', true, 'rib');
    App.selectRow(gs.body, 'Beplankung', [
      ['wing', 'Aus Tragfläche übernehmen'],
      ['global', 'Globaler Wert'],
      ['perRib', 'Jede Rippe einzeln']
    ], () => rc.sheetMode, v => { rc.sheetMode = v; App.buildSidebar(); renderRib(); },
      '„Aus Tragfläche": nutzt die im Tragflächendesigner eingestellte Beplankung '
      + '(global/segmentweise, oben/unten). „Globaler Wert": ein Wert für alle '
      + 'Rippen. „Jede Rippe einzeln": pro Rippe eigener Wert.');
    if (rc.sheetMode === 'global')
      App.numRow(gs.body, 'Beplankungsdicke (mm)', () => rc.sheet, v => { rc.sheet = Math.max(0, v); renderRib(); },
        { step: 0.1, min: 0, norender: true });
    else if (rc.sheetMode === 'wing')
      App.hint(gs.body, 'Übernimmt die Beplankung aus dem Reiter „Tragflächendesigner“ → „Beplankung“.');
    else if (rc.sheetMode === 'perRib') {
      const st = ribStations();
      App.hint(gs.body, 'Dicke (mm) je Rippe — R1 = Wurzel. Leer/0 = keine Beplankung.');
      st.list.forEach((s, i) => {
        const g0 = rc.sheet || 0;
        App.numRow(gs.body, 'R' + (i + 1) + ' (z=' + s.z.toFixed(0) + ')',
          () => rc.sheetPer[i] != null ? rc.sheetPer[i] : g0,
          v => { rc.sheetPer[i] = Math.max(0, v); renderRib(); }, { step: 0.1, min: 0, norender: true });
      });
    }
    App.boolRow(gs.body, 'Kernlinie zeigen (nach Abzug)', () => rc.showCore,
      v => { rc.showCore = v; renderRib(); },
      'Zeichnet zusätzlich die um die Beplankung nach innen versetzte Kontur '
      + '(die eigentliche Rippe unter der Beplankung).');
    if (rc.showCore)
      App.selectRow(gs.body, 'Kernende an der Endleiste', [
        ['blunt', 'stumpf (senkrecht)'], ['sharp', 'spitz'],
      ], () => rc.coreTe, v => { rc.coreTe = v; renderRib(); },
        '„Stumpf": Kern endet senkrecht abgeschnitten. „Spitz": Ober- und Unterseite des Kerns '
        + 'werden bis zu ihrem Schnittpunkt verlängert (bei stumpfer Endleiste ggf. über die '
        + 'Profil-Endleiste hinaus).');
    side.appendChild(gs.g);

    // --- Holme: Auswahl, welche Holmausschnitte in den Rippen erscheinen ----
    const gh = App.grp(T('Holme') + ' (' + (state.spars ? state.spars.length : 0) + ')', true, 'rib');
    App.boolRow(gh.body, 'Holmausschnitte zeigen', () => rc.showSpars,
      v => { rc.showSpars = v; App.buildSidebar(); renderRib(); },
      'Blendet die im Tragflächendesigner definierten Holmausschnitte in den '
      + 'Rippen ein. Darunter wählbar, welche einzelnen Holme erscheinen.');
    if (rc.showSpars) {
      if (!state.spars || !state.spars.length)
        App.hint(gh.body, 'Noch keine Holme angelegt. Holme werden im Reiter „Tragflächendesigner“ → „Holmausschnitte“ definiert.');
      else state.spars.forEach((sp, j) => {
        const [a, b] = sparRange(sp);
        const range = a === b ? ('Segment ' + (a + 1)) : ('Segmente ' + (a + 1) + '–' + (b + 1));
        App.boolRow(gh.body, 'Holm ' + (j + 1) + ' · ' + range,
          () => !rc.sparHide[j],
          v => { if (v) delete rc.sparHide[j]; else rc.sparHide[j] = true; renderRib(); });
      });
    }
    side.appendChild(gh.g);

    // --- Nasenschablone (Schleifhilfe) -----------------------------------
    const tp = rc.tpl;
    const gt = App.grp('Nasenschablone (Schleifhilfe)', true, 'rib');
    App.hint(gt.body, 'Negativ der Profilnase als Schleifhilfe: ein Rechteck über die Nase, '
      + 'aus dem die Profilkontur ausgeschnitten wird. Export als STL, Schablonen '
      + 'aufsteigend nummeriert (Nummer als Vertiefung).');
    App.boolRow(gt.body, 'Umriss in Galerie zeigen', () => tp.show,
      v => { tp.show = v; renderRib(); });
    App.selectRow(gt.body, 'Maße in',
      [['mm', 'mm'], ['pct', '% der Profillänge']],
      () => tp.sizeMode, v => { tp.sizeMode = v; App.buildSidebar(); renderRib(); },
      'Einheit für Überstand, Tiefe, Höhe und Ziffernhöhe: feste mm oder ein '
      + 'Anteil der Profilsehne jeder Rippe (skaliert automatisch mit der Rippengröße).');
    const u = tp.sizeMode === 'pct' ? '%' : 'mm';
    const st = tp.sizeMode === 'pct' ? 0.5 : 1;
    App.numRow(gt.body, T('Überstand vorne (') + u + ')', () => tp.front, v => { tp.front = Math.max(0, v); renderRib(); }, { step: st, min: 0, norender: true });
    App.numRow(gt.body, T('Tiefe nach hinten (') + u + ')', () => tp.back, v => { tp.back = Math.max(0.1, v); renderRib(); }, { step: st, min: 0.1, norender: true,
      hint: 'Wie weit das Rechteck ab der Nasenleiste über die Rippe nach hinten reicht.' });
    App.numRow(gt.body, T('Höhe (') + u + ')', () => tp.height, v => { tp.height = Math.max(0.1, v); renderRib(); }, { step: st, min: 0.1, norender: true,
      hint: 'Rechteckhöhe. Wird automatisch vergrößert, falls die Profilnase höher ist.' });
    App.numRow(gt.body, 'Dicke der Schablone (mm)', () => tp.thick, v => { tp.thick = Math.max(1, v); }, { step: 0.5, min: 1, norender: true });
    App.numRow(gt.body, T('Ziffernhöhe (') + u + ')', () => tp.numSize, v => { tp.numSize = Math.max(0.5, v); renderRib(); }, { step: st, min: 0.5, norender: true });
    App.numRow(gt.body, 'Tiefe der Nummer (mm)', () => tp.numDepth, v => { tp.numDepth = Math.max(0, v); }, { step: 0.1, min: 0, norender: true,
      hint: 'Wie tief die eingelassene Nummer in die Oberseite geht.' });
    const bv = document.createElement('button');
    bv.textContent = T('▦ 3D-Vorschau der STL');
    bv.onclick = ribStlPreviewOpen;
    gt.body.appendChild(bv);
    const be = document.createElement('button'); be.className = 'primary';
    be.textContent = T('Nasenschablonen als STL exportieren');
    be.onclick = exportRibTemplates; DEMO.btn(be);
    gt.body.appendChild(be);
    if (DEMO.on) App.hint(gt.body, DEMO.msg);
    side.appendChild(gt.g);

    // --- Rippen als STL (Volumenkörper) ----------------------------------
    const gb = App.grp('Rippen als STL', false, 'rib');
    App.hint(gb.body, 'Die Rippen-Außenkonturen werden auf die gewählte Dicke extrudiert '
      + '(Halbrippen als getrennte Körper). Holmausschnitte werden – falls aktiv – '
      + 'als durchgehende Löcher ausgespart. Aufgereiht wie in der Galerie.');
    App.numRow(gb.body, 'Dicke der Rippe (mm)', () => rc.stlThick, v => { rc.stlThick = Math.max(0.5, v); }, { step: 0.5, min: 0.5, norender: true });
    App.boolRow(gb.body, 'Holmausschnitte als Löcher', () => rc.stlSpars, v => { rc.stlSpars = v; });
    const bvr = document.createElement('button');
    bvr.textContent = T('▦ 3D-Vorschau der STL');
    bvr.onclick = ribBodyPreviewOpen;
    gb.body.appendChild(bvr);
    const ber = document.createElement('button'); ber.className = 'primary';
    ber.textContent = T('Rippen als STL exportieren');
    ber.onclick = exportRibBodies; DEMO.btn(ber);
    gb.body.appendChild(ber);
    if (DEMO.on) App.hint(gb.body, DEMO.msg);
    side.appendChild(gb.g);
  }
  // LE/TE (chord-x) je Station und interpoliert an beliebiger Spannweite z.
  function ribLeTeArr() {
    return App.wing.stations.map(s => { const xs = s.pts.map(p => p.x); return { z: s.z, le: Math.min.apply(null, xs), te: Math.max.apply(null, xs) }; });
  }
  function ribLeTeAt(z, arr) {
    if (z <= arr[0].z) return arr[0];
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      if (z <= b.z + 1e-6) { const t = (z - a.z) / ((b.z - a.z) || 1); return { z, le: a.le + (b.le - a.le) * t, te: a.te + (b.te - a.te) * t }; }
    }
    return arr[arr.length - 1];
  }
  // Grundriss der Rippen-Ansicht: Planform mit einer Chord-Linie je Rippe und den
  // ausgewählten Holmen als Linien über ihren Segmentbereich. LE liegt oben.
  function renderRibPlan() {
    const cv = document.getElementById('cRibPlan'); if (!cv) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    if (!App.wing || !App.wing.stations || App.wing.stations.length < 2) return;
    const rc = ribCfg(), arr = ribLeTeArr();
    const le = arr.map(s => ({ x: s.z, y: -s.le })), te = arr.map(s => ({ x: s.z, y: -s.te }));
    const outline = le.concat(te.slice().reverse());
    const V = App.makeView(w, h, App.bounds(outline), 40, App.nav.ribplan);
    App.grid(ctx, w, h, V);
    // Planform-Fläche
    App.poly(ctx, V, outline, true);
    ctx.fillStyle = App.hexA('#4aa3ff', 0.08); ctx.strokeStyle = App.PAL.profInner; ctx.lineWidth = 1.6;
    ctx.fill(); ctx.stroke();
    // Holme (nur ausgewählte) in WAHRER Breite als Band über ihren Segmentbereich.
    if (rc.showSpars) (state.spars || []).forEach((sp, j) => {
      if (rc.sparHide[j]) return;
      const [a, b] = sparRange(sp);
      const front = [], back = [];
      for (let k = a; k <= b + 1; k++) {
        const which = k === a ? 'root' : 'tip';
        const dLE = k === a ? sparFromLE(sp, a, 'root') : sparFromLE(sp, k - 1, 'tip');
        const st = App.wing.stations[k]; if (!st) continue;
        const xc = stationLE(k) + dLE;
        const surf = surfaceAtX(st.pts, xc), thick = surf ? surf.top - surf.bot : 0;
        const u = sp.sizeMode === 'mm' ? 1 : thick / 100;
        const sz = sparSize(sp, which);
        let W = Math.max(0.01, (sz.w || 0) * u);
        if (sp.shape === 'circle') W = Math.max(0.01, (sz.h || 0) * u);
        // Doppel-T: wahre Breite = breitestes der drei Rechtecke (Gurte/Steg).
        if (sp.shape === 'doubleT') W = Math.max(0.01, Math.max(sp.dtOtW != null ? sp.dtOtW : 60, sp.dtStW != null ? sp.dtStW : 14, sp.dtUbW != null ? sp.dtUbW : 60) * u);
        const z = stationZ(k);
        front.push({ x: z, y: -(xc - W / 2) });
        back.push({ x: z, y: -(xc + W / 2) });
      }
      if (front.length < 2) return;
      const band = front.concat(back.slice().reverse());
      App.poly(ctx, V, band, true);
      ctx.fillStyle = App.hexA(App.PAL.spar, 0.18); ctx.strokeStyle = App.PAL.spar; ctx.lineWidth = 1.2;
      ctx.setLineDash(dashFor('spar', [])); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    });
    // Rippenlinien (Chord an jeder Station)
    const { list } = ribStations();
    ctx.font = '10px system-ui';
    list.forEach((st, i) => {
      const lt = ribLeTeAt(st.z, arr);
      ctx.strokeStyle = App.PAL.profOuter; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(V.X(st.z), V.Y(-lt.le)); ctx.lineTo(V.X(st.z), V.Y(-lt.te)); ctx.stroke();
      ctx.fillStyle = '#e6ebf1';
      ctx.fillText('R' + (i + 1), V.X(st.z) - 6, V.Y(-lt.le) - 4);
    });
    ctx.fillStyle = '#8b98a8'; ctx.font = '11px system-ui';
    ctx.fillText(T('▲ Flugrichtung'), 12, 18);
  }
  function renderRib() {
    renderRibPlan();
    const cv = document.getElementById('cRib'); if (!cv) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    const info = document.getElementById('ribInfo');
    if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) { if (info) info.textContent = 'Keine Tragfläche.'; return; }
    const rc = ribCfg();
    const { list, total } = ribStations();
    const ribs = list.map((st, idx) => {
      const o = ribOutline(st), sh = ribSheet(st, idx);
      const xs = o.pts.map(p => p.x), ys = o.pts.map(p => p.y);
      const minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
      const miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
      const cyv = (miny + maxy) / 2;
      const norm = p => ({ x: p.x - minx, y: p.y - cyv });
      // Volle Kontur/Kern/Holme, danach in Halbrippen-Stücke geschnitten.
      const coreFull = (rc.showCore && (sh.top || sh.bot)) ? ribInset(o.pts, sh.top, sh.bot, rc.coreTe === 'sharp') : null;
      const sparFull = [];
      if (rc.showSpars) (state.spars || []).forEach((sp, j) => {
        if (rc.sparHide[j] || !sparAppliesTo(sp, st.seg)) return;
        const fl = sparFromLE(sp, st.seg, 'root') + (sparFromLE(sp, st.seg, 'tip') - sparFromLE(sp, st.seg, 'root')) * st.t;
        const g = sparOnProfile(sp, o.pts, null, fl, sparYc(sp), st.t < 0.5 ? 'root' : 'tip', App.sparCoreFromSheet(o.pts, sh));
        sparPolys(g).forEach(pl => sparFull.push(pl));
      });
      const pieces = ribHalfSpecs(o.pts, o.chord).map(spec => {
        const outer = applyHalfSpec(o.pts, spec); if (!outer) return null;
        const core = coreFull ? applyHalfSpec(coreFull, spec) : null;
        const spars = sparFull.map(sp => applyHalfSpec(sp, spec)).filter(Boolean);
        return { outer: outer.map(norm), core: core ? core.map(norm) : null, spars: spars.map(s => s.map(norm)) };
      }).filter(Boolean);
      let tpl = null;
      if (rc.tpl.show) {
        const t2 = ribTemplate2D(o.pts);
        if (t2.ok) tpl = { ring: t2.ring.map(norm), nums: numberRects(idx + 1, t2.region).map(rc2 => rc2.map(norm)) };
      }
      return { pieces, tpl, chord: o.chord, z: st.z, w: maxx - minx, h: maxy - miny };
    });
    const cols = Math.max(1, Math.ceil(Math.sqrt(ribs.length)));
    const cellW = Math.max.apply(null, ribs.map(r => r.w)) + 25;
    const cellH = Math.max.apply(null, ribs.map(r => r.h)) + 32;
    const allx = [], ally = [];
    ribs.forEach((r, i) => {
      r.px = (i % cols) * cellW; r.py = -Math.floor(i / cols) * cellH;
      allx.push(r.px, r.px + r.w); ally.push(r.py - r.h / 2 - 16, r.py + r.h / 2);
    });
    const b = { minx: Math.min.apply(null, allx), maxx: Math.max.apply(null, allx),
                miny: Math.min.apply(null, ally), maxy: Math.max.apply(null, ally) };
    const V = App.makeView(w, h, b, 50, App.nav.rib);
    App.grid(ctx, w, h, V);
    ribs.forEach((r, i) => {
      const tr = p => ({ x: p.x + r.px, y: p.y + r.py });
      (r.pieces || []).forEach(pc => {
        ctx.lineWidth = 1.8; ctx.strokeStyle = App.PAL.profInner;
        App.poly(ctx, V, pc.outer.map(tr), true); ctx.stroke();
        if (pc.core) {
          ctx.lineWidth = 1.2; ctx.strokeStyle = App.PAL.profOuter; ctx.setLineDash([5, 4]);
          App.poly(ctx, V, pc.core.map(tr), true); ctx.stroke(); ctx.setLineDash([]);
        }
        (pc.spars || []).forEach(spp => {
          ctx.lineWidth = 1.2; ctx.strokeStyle = App.PAL.spar; ctx.setLineDash(dashFor('spar', []));
          App.poly(ctx, V, spp.map(tr), true); ctx.fillStyle = App.hexA(App.PAL.spar, 0.16); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        });
      });
      if (r.tpl) {
        ctx.lineWidth = 1.2; ctx.strokeStyle = '#57d38c'; ctx.setLineDash([3, 3]);
        App.poly(ctx, V, r.tpl.ring.map(tr), true); ctx.stroke(); ctx.setLineDash([]);
        // Nummer (Ziffern-Segmente) der Schablone gefüllt anzeigen.
        (r.tpl.nums || []).forEach(seg => {
          App.poly(ctx, V, seg.map(tr), true); ctx.fillStyle = '#57d38c'; ctx.fill();
        });
      }
      ctx.fillStyle = '#e6ebf1'; ctx.font = '11px system-ui';
      ctx.fillText('R' + (i + 1) + '  z=' + r.z.toFixed(0) + T('  Sehne ') + r.chord.toFixed(1) + ' mm',
        V.X(r.px), V.Y(r.py - r.h / 2) + 14);
    });
    if (info) info.innerHTML = '<b>' + ribs.length + '</b>' + T(' Rippen · Spannweite ')
      + total.toFixed(0) + T(' mm · Beplankung: ') + '<b>' + ribModeLabel(rc.sheetMode) + '</b>'
      + '<div class="hint" style="margin-top:5px">' + T('Ziehen = verschieben · Rad = Zoom · Doppelklick = zurück. ')
      + T('Durchgezogen = Außenkontur, gestrichelt = Kern nach Beplankungsabzug, orange = Holmausschnitte. ')
      + T('Grundriss oben zeigt die Lage der Rippen & Holme.') + '</div>';
  }



  // ---- Verdrahtung des Reiters (2026-09-12 aus app.js hierher geholt) ----
  // app.js ruft ribWireUp() beim Start geschützt auf. So bringt Reiter „Rippendesigner“
  // seine Ereignisse selbst mit und die Datei lässt sich als Funktion abwählen.
  function ribWireUp() {
    const setupNav = App.setupNav, buildSidebar = App.buildSidebar;
    setupNav('cRib', 'rib', renderRib);            // Zoom/Pan in der Rippen-Vorschau
    setupNav('cRibPlan', 'ribplan', renderRibPlan);// Zoom/Pan im Rippen-Grundriss
    // Nasenschablonen-3D-Vorschau: schließen (×, Hintergrund, Esc) + Nav.
    setupStlPreviewNav();
    const rsm = document.getElementById('ribStlModal'), rsc = document.getElementById('ribStlClose');
    if (rsc) rsc.onclick = ribStlPreviewClose;
    if (rsm) rsm.addEventListener('mousedown', e => { if (e.target === rsm) ribStlPreviewClose(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && rsm && rsm.classList.contains('open')) ribStlPreviewClose(); });
  }

  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { ribWireUp });
  Object.assign(App, { SEG7, applyHalfSpec, buildRibSidebar, clipHalfX, digitRects });
  Object.assign(App, { exportRibBodies, exportRibTemplates, numberRects });
  Object.assign(App, { renderRib, renderRibPlan, renderStlPreview, ribBodyPreviewOpen, ribBodySTL, ribBodyTris });
  Object.assign(App, { ribBodyTrisAll, ribCfg, ribCollectBodies, ribCollectTemplates, ribCutX, ribHalfSpecs, ribInset, ribLeTeArr });
  Object.assign(App, { ribInset, ribLeTeAt, ribModeLabel, ribOutline, ribProcessOutline, ribReseedManual, ribSeedManual, ribSheet, ribStations });
  Object.assign(App, { ribStlPreviewClose, ribStlPreviewOpen, ribTemplate2D, ribTemplateSTL, ribTemplateTris, setupStlPreviewNav, stlFacet, stlView });
  Object.assign(App, { templateTris, triangulate });
})();
