/* ausschnitt.js — Reiter „Tragflächenausschnitt": ein Profil (Wurzelprofil einer
 * Tragfläche oder ein eigenes Profil) als Ausschnitt aus einem Block schneiden,
 * z. B. die Flächenaufnahme im Rumpfblock oder ein Profilstück (Funktion
 * „ausschnitt", optional — andere Module rufen nur geschützt).
 *
 * KONZEPT
 *   Profil   : Wurzelprofil (state.root bzw. ruhende Tragfläche aus state.wings)
 *              oder eigenes Profil (.dat / Profildatenbank), normiert (Sehne 1).
 *              Profiltiefe, Maßstab, Einstellwinkel (Drehpunkt Endleiste), Nasenrichtung.
 *              Lage (Nase ↔ Blockvorderseite/-unterkante) gilt für das ungedrehte Profil,
 *              die Endleiste bleibt beim Drehen stehen.
 *   Block    : Breite/Höhe automatisch (Profil + Rand) oder fest, Lage des Profils
 *              mittig oder frei (Nase ↔ Blockvorderseite, Nasenhöhe über Unterkante).
 *              Blocklage X/Y (Abstand zum Nullpunkt) wie im Reiter „G-Code".
 *   Bahn     : Parallelversatz der Kontur — Block behalten (Loch): Spiel nach außen,
 *              Abbrand/2 nach innen; Profilstück behalten: Abbrand/2 nach außen.
 *              Schlaufen (spitze Endleiste) werden lokal entfernt.
 *   Anfahrt  : von oben / unten / vorne (Nasenseite) / hinten (Endleistenseite):
 *              in Luft zum Anfahrpunkt vor der Blockfläche, senkrecht zur Fläche
 *              hinein bis auf die Höhe/Lage des Startpunkts, Startpunkt, Umlauf in
 *              gewählter Richtung, auf demselben Weg zurück, in Luft zum Nullpunkt.
 *   Start    : Befehl „Startpunkt wählen" + Klick auf die Kontur (gespeichert als Bogenlängen-
 *              Anteil der normierten Kontur → bleibt bei Maßstab/Winkel gültig),
 *              sonst automatisch der Anfahrfläche nächstgelegene Punkt.
 *   G-Code   : ausschnitt_gcode.js (Funktion „gcodegen") macht aus den Fahrten
 *              (Daten) den Text. XY = UV (gerader Draht, Prisma). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const { grp, hint, numRow, selectRow, buildSidebar } = App;
  const TAB = 'ausschnitt';

  // ---------- Konfiguration (state.cfg.wa*) --------------------------------
  const DEF = {
    waSrc: 'root',          // 'root' (Wurzelprofil einer Tragfläche) | 'own' (eigenes Profil)
    waWing: null,           // Tragflächen-id (null = aktive Tragfläche)
    waProf: null,           // eigenes Profil { name, pts:[[x,y],…] } normiert (Sehne 1)
    waChord: 200,           // Profiltiefe eigenes Profil (mm)
    waScale: 100,           // Maßstab Wurzelprofil (%)
    waAngle: 0,             // Einstellwinkel (°), + = Nase hoch, Drehpunkt Endleiste
    waNose: 'left',         // Nase zeigt nach 'left' (Standard) | 'right' (Ansicht von vorne)
    waPts: 200,             // Punkte der Kontur
    waKeep: 'block',        // 'block' (Ausschnitt = Loch) | 'profile' (Profilstück)
    waClear: 0,             // Spiel: Ausschnitt um so viel größer als das Profil (mm)
    waMatId: null,          // Werkstoff (null = globale Auswahl)
    waKerfMode: 'mat',      // 'mat' | 'manual' | 'off'
    waKerf: 1.0,            // Abbrand manuell (mm)
    waBlockW: 0, waBlockH: 0,   // Blockmaße (0 = automatisch aus Profil + Rand)
    waMargin: 40,           // Rand um das Profil bei automatischer Blockgröße (mm)
    waDepth: 100,           // Blockdicke entlang des Drahts (mm)
    waPosMode: 'manual',    // 'manual' (Standard) | 'center'
    waPosX: 40,             // Nase ↔ Blockvorderseite (Nasenseite) (mm)
    waPosY: 50,             // Nasenhöhe über Blockunterkante (mm)
    waApproach: 'top',      // 'top' | 'bottom' | 'front' (Nasenseite) | 'rear' (Endleistenseite)
    waApproachDist: 10,     // Anfahrpunkt vor der Blockfläche (mm)
    waStart: null,          // Startpunkt: Bogenlängen-Anteil 0…1 der Kontur, null = automatisch
    waDir: 'cw',            // Umlauf 'cw' (Uhrzeigersinn) | 'ccw' — wie in der Ansicht
    waView: { fill: true, cut: true, arrows: true, dims: true }
  };
  if (App.GRP_OPEN_DEFAULT && App.GRP_OPEN_DEFAULT.add) ['wa_prof', 'wa_path'].forEach(k => App.GRP_OPEN_DEFAULT.add(k));
  function C(k) {
    if (state.cfg[k] == null) {
      const d = DEF[k];
      if (d === undefined || d === null) return d;
      state.cfg[k] = (typeof d === 'object') ? JSON.parse(JSON.stringify(d)) : d;
    }
    return state.cfg[k];
  }
  function S(k, v) { state.cfg[k] = v; }
  const num = (k, d) => { const v = +C(k); return isFinite(v) ? v : d; };
  const viewCfg = () => { const v = C('waView'); return (v && typeof v === 'object') ? v : (S('waView', Object.assign({}, DEF.waView)), C('waView')); };

  // ---------- Werkstoff, Abbrand, Vorschub ----------------------------------
  const blockX = () => Math.max(0, +state.cfg.blockX || 0), blockY = () => Math.max(0, +state.cfg.blockY || 0);
  function matId() { const v = C('waMatId'); return v != null ? v : (state.material.id || ''); }
  function feed() {
    const fp = App.feedPair ? App.feedPair(matId()) : null;
    if (App.autoFeedOn && App.autoFeedOn() && fp && fp.fast > 0) return fp.fast;
    return state.cfg.feed || 200;
  }
  function kerf() {
    const m = C('waKerfMode');
    if (m === 'off') return 0;
    if (m === 'manual') return Math.max(0, num('waKerf', 0));
    const f = feed();
    return App.kerfForSpeed ? Math.max(0, App.kerfForSpeed(matId(), f, f) || 0) : 0;
  }

  // ---------- Profilquelle ---------------------------------------------------
  function wings() { return App.wingList ? App.wingList() : []; }
  function wingRec() {
    const L = wings(), id = C('waWing');
    const i = id ? L.findIndex(w => w.id === id) : -1;
    const act = state.activeWing >= 0 ? state.activeWing : 0;
    const idx = i >= 0 ? i : act;
    return { idx, root: idx === act || !L[idx] || !L[idx].root ? state.root : L[idx].root };
  }
  function wingLabel(i) { return App.wingName ? App.wingName(i) : T('Tragfläche'); }
  // → { name, pts:[{x,y}] (normiert, Selig), chord } oder null
  function profileSrc() {
    if (C('waSrc') === 'own') {
      const p = C('waProf');
      if (!p || !Array.isArray(p.pts) || p.pts.length < 5) return null;
      return { name: p.name || T('Eigenes Profil'), pts: p.pts.map(a => ({ x: a[0], y: a[1] })), chord: Math.max(1, num('waChord', 200)) };
    }
    const w = wingRec(), r = w.root;
    if (!r || !Array.isArray(r.profile) || r.profile.length < 5) return null;
    const sc = Math.max(1, num('waScale', 100)) / 100;
    return { name: (r.profile.name || T('Wurzelprofil')) + ' · ' + wingLabel(w.idx), pts: r.profile.map(p => ({ x: p.x, y: p.y })), chord: Math.max(1, (+r.chord || 200) * sc), wingIdx: w.idx };
  }

  // ---------- Geometrie-Helfer -----------------------------------------------
  function area(P) { let a = 0; for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function segX(a, b, c, d) {   // Schnittpunkt der Strecken ab und cd (echt), sonst null
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    const den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) return null;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
    return [a[0] + t * rx, a[1] + t * ry, t];
  }
  // Nächster Punkt auf dem geschlossenen Polygon: { i (Kante i→i+1), t, p, d }
  function nearestOnPoly(P, x, y) {
    let best = null;
    for (let i = 0, n = P.length; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
      const px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(px - x, py - y);
      if (!best || d < best.d) best = { i, t, p: [px, py], d };
    }
    return best;
  }
  // Parallelversatz eines geschlossenen Polygons um d (+ = nach außen).
  // Spitze Ecken (Endleiste) nach außen gefast statt langer Gehrungsspitze.
  function offsetClosed(P, d) {
    const n = P.length; if (Math.abs(d) < 1e-9) return P.map(p => p.slice());
    const sg = area(P) > 0 ? 1 : -1;   // gegen den Uhrzeigersinn: Außennormale = (dy, −dx)
    const nrm = i => { const a = P[i], b = P[(i + 1) % n]; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [sg * dy / L, -sg * dx / L]; };
    const out = [];
    for (let i = 0; i < n; i++) {
      const n1 = nrm((i - 1 + n) % n), n2 = nrm(i), p = P[i];
      let mx = n1[0] + n2[0], my = n1[1] + n2[1]; const ml = Math.hypot(mx, my);
      const cosH = ml / 2;   // cos(halber Knickwinkel der Normalen)
      if (ml < 1e-9 || cosH < 0.35) {
        // Spitze Ecke: je ein Punkt auf beiden Nachbarkanten (Fase auf der offenen
        // Seite; auf der überlappenden Seite entsteht eine Mini-Schlaufe → deloop).
        out.push([p[0] + n1[0] * d, p[1] + n1[1] * d]); out.push([p[0] + n2[0] * d, p[1] + n2[1] * d]); continue;
      }
      mx /= ml; my /= ml; const f = d / cosH;
      out.push([p[0] + mx * f, p[1] + my * f]);
    }
    return deloop(out);
  }
  // Selbstschnitte entfernen: jeweils die kleinere Schlaufe (weniger Punkte) herausnehmen.
  function deloop(Q) {
    for (let guard = 0; guard < 200; guard++) {
      const n = Q.length; if (n < 4) return Q;
      let hit = null;
      outer: for (let i = 0; i < n; i++) {
        const a = Q[i], b = Q[(i + 1) % n];
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const x = segX(a, b, Q[j], Q[(j + 1) % n]);
          if (x) { hit = { i, j, x }; break outer; }
        }
      }
      if (!hit) return Q;
      const { i, j, x } = hit, inner = j - i;   // Punkte i+1…j bilden eine Schlaufe
      const X = [x[0], x[1]];
      if (inner <= n - inner) Q = Q.slice(0, i + 1).concat([X], Q.slice(j + 1));
      else Q = [X].concat(Q.slice(i + 1, j + 1));
    }
    return Q;
  }

  // ======================================================================
  //  Berechnung
  // ======================================================================
  let lastRes = null;
  function build() {
    const warns = [], notes = [];
    const src = profileSrc();
    if (!src) { lastRes = { empty: true, msg: C('waSrc') === 'own' ? T('Kein eigenes Profil geladen — links „Profil laden…" oder die Profildatenbank benutzen.') : T('Die Tragfläche hat kein Wurzelprofil.') }; return lastRes; }
    // Kontur normiert (Sehne 1, Nase bei 0): gleichmäßig neu abtasten, schließen.
    let raw = src.pts;
    { let x0 = Infinity, x1 = -Infinity; raw.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); });
      const c = x1 - x0; if (c > 2 || c < 0.5) raw = raw.map(p => ({ x: (p.x - x0) / (c || 1), y: p.y / (c || 1) })); }
    const N = Math.max(40, Math.min(1000, Math.round(num('waPts', 200))));
    let U = (window.Airfoil && Airfoil.resample ? Airfoil.resample(raw, N) : raw).map(p => [p.x, p.y]);
    if (U.length > 3 && Math.hypot(U[0][0] - U[U.length - 1][0], U[0][1] - U[U.length - 1][1]) < 1e-6) U.pop();
    // Bogenlängen-Anteil je Punkt (für den Startpunkt).
    const sArr = [0]; for (let i = 1; i < U.length; i++) sArr.push(sArr[i - 1] + Math.hypot(U[i][0] - U[i - 1][0], U[i][1] - U[i - 1][1]));
    const sTot = sArr[sArr.length - 1] + Math.hypot(U[0][0] - U[U.length - 1][0], U[0][1] - U[U.length - 1][1]) || 1;
    const sN = sArr.map(s => s / sTot);
    // Maßstab, Einstellwinkel (Drehpunkt Endleiste (c,0), + = Nase hoch), Nasenrichtung.
    const c = src.chord, al = num('waAngle', 0) * Math.PI / 180, ca = Math.cos(al), sa = Math.sin(al);
    const noseRight = C('waNose') === 'right';
    // Profil-Grundlage: Nase bei x=0, Endleiste bei +x (fliegt nach −x). Bei „Nase rechts" spiegeln.
    const loc = U.map(([u, v]) => { const x = u * c - c, y = v * c; const xr = c + x * ca + y * sa, yr = -x * sa + y * ca; return [noseRight ? -xr : xr, yr]; });
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    loc.forEach(p => { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); });
    const pw = bx1 - bx0, ph = by1 - by0;
    // Block
    const mg = Math.max(0, num('waMargin', 40));
    // Automatische Blockgröße: mittig = Profil + Rand ringsum; bei „Abstand angeben"
    // = Abstand Nase/Nasenhöhe + Profil bis zur fernen Kante + Rand (Nase bei lokal 0,0).
    const manualPos = C('waPosMode') === 'manual';
    const farX = noseRight ? -bx0 : bx1;   // Nase → hinterster Profilpunkt
    const W = num('waBlockW', 0) > 0 ? num('waBlockW', 0) : manualPos ? Math.max(0, num('waPosX', 40)) + farX + mg : pw + 2 * mg;
    const H = num('waBlockH', 0) > 0 ? num('waBlockH', 0) : manualPos ? Math.max(0, num('waPosY', 50)) + by1 + mg : ph + 2 * mg;
    const D = Math.max(1, num('waDepth', 100));
    const blk = { x0: blockX(), y0: blockY(), w: W, h: H, d: D }; blk.x1 = blk.x0 + W; blk.y1 = blk.y0 + H;
    // Lage: mittig oder Nase frei (Abstand zur Blockvorderseite = Nasenseite, Höhe über Unterkante).
    let dx, dy;
    if (C('waPosMode') === 'manual') {
      const px = num('waPosX', 40), py = num('waPosY', 50);
      dx = noseRight ? blk.x1 - px : blk.x0 + px; dy = blk.y0 + py;
    } else { dx = (blk.x0 + blk.x1) / 2 - (bx0 + bx1) / 2; dy = (blk.y0 + blk.y1) / 2 - (by0 + by1) / 2; }
    const contour = loc.map(p => [p[0] + dx, p[1] + dy]);
    const nose = [dx, dy];   // Bezugspunkt der Lage = Nase des UNGEDREHTEN Profils
    let iLE = 0; U.forEach((q, i) => { if (q[0] < U[iLE][0]) iLE = i; });
    const noseAct = contour[iLE];                                   // Nase nach der Drehung
    const teAct = [dx + (noseRight ? -c : c), dy];                  // Endleiste (Drehpunkt, bleibt stehen)
    // Schnittbahn: Versatz der Kontur.
    const k = kerf(), keep = C('waKeep') === 'profile' ? 'profile' : 'block';
    const clear = keep === 'block' ? Math.max(0, num('waClear', 0)) : 0;
    const off = keep === 'block' ? clear - k / 2 : k / 2;
    let path = offsetClosed(contour, off);
    if (path.length < 3) { lastRes = { empty: true, msg: T('Profil zu klein für den Abbrand.') }; return lastRes; }
    // Passt das Profil in den Block?
    { let e = Infinity; path.concat(contour).forEach(p => { e = Math.min(e, p[0] - blk.x0, blk.x1 - p[0], p[1] - blk.y0, blk.y1 - p[1]); });
      if (e < 0) warns.push(T('Das Profil ragt aus dem Block — Blockmaße oder Lage anpassen.'));
      else if (e < 2) warns.push(T('Das Profil liegt weniger als 2 mm an der Blockkante.')); }
    // Anfahrfläche (Seite im Bild): vorne = Nasenseite, hinten = Endleistenseite.
    const ap = ['top', 'bottom', 'front', 'rear'].indexOf(C('waApproach')) >= 0 ? C('waApproach') : 'top';
    const side = ap === 'top' ? 'top' : ap === 'bottom' ? 'bottom' : ((ap === 'front') === noseRight ? 'right' : 'left');
    // Startpunkt: gewählt (Bogenlänge → Konturpunkt → nächster Bahnpunkt) oder automatisch.
    let startC = null, ws = C('waStart');
    if (ws != null && isFinite(+ws)) {
      ws = ((+ws % 1) + 1) % 1;
      let i = 0; while (i < sN.length - 1 && sN[i + 1] <= ws) i++;
      const s0 = sN[i], s1 = i + 1 < sN.length ? sN[i + 1] : 1, t = s1 > s0 ? (ws - s0) / (s1 - s0) : 0;
      const a = contour[i], b = contour[(i + 1) % contour.length];
      startC = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    let i0;
    if (startC) {
      const nb = nearestOnPoly(path, startC[0], startC[1]);
      if (nb.t < 1e-6) i0 = nb.i;
      else if (nb.t > 1 - 1e-6) i0 = (nb.i + 1) % path.length;
      else { path.splice(nb.i + 1, 0, nb.p); i0 = nb.i + 1; }
    } else {
      const score = p => side === 'top' ? p[1] : side === 'bottom' ? -p[1] : side === 'right' ? p[0] : -p[0];
      i0 = 0; path.forEach((p, i) => { if (score(p) > score(path[i0]) + 1e-9) i0 = i; });
    }
    const Sp = path[i0];
    // Umlaufrichtung: in der Ansicht (x rechts, y oben) ist cw = negative Fläche.
    const A = area(path), wantCW = C('waDir') !== 'ccw';
    const fwd = wantCW ? A < 0 : A > 0;
    const loop = [];
    for (let q = 0, n = path.length; q <= n; q++) loop.push(path[((fwd ? i0 + q : i0 - q) % n + n) % n]);
    // Eintritt senkrecht zur gewählten Blockfläche.
    const dist = Math.max(0, num('waApproachDist', 10));
    const E = side === 'top' ? [Sp[0], blk.y1] : side === 'bottom' ? [Sp[0], blk.y0] : side === 'right' ? [blk.x1, Sp[1]] : [blk.x0, Sp[1]];
    let Ap = side === 'top' ? [E[0], E[1] + dist] : side === 'bottom' ? [E[0], E[1] - dist] : side === 'right' ? [E[0] + dist, E[1]] : [E[0] - dist, E[1]];
    if (Ap[1] < 0) { Ap[1] = 0; notes.push(T('Anfahrpunkt unten auf Y = 0 begrenzt (Blockhöhe über Nullpunkt kleiner als der Anfahrabstand).')); }
    if (Ap[0] < 0) { Ap[0] = 0; notes.push(T('Anfahrpunkt links auf X = 0 begrenzt (Blockabstand X kleiner als der Anfahrabstand).')); }
    // Anfahrweg durch das Profil?
    { let cross = 0; const n = path.length;
      for (let q = 0; q < n; q++) { const a = path[q], b = path[(q + 1) % n]; if (q === i0 || (q + 1) % n === i0) continue; if (segX(E, Sp, a, b)) cross++; }
      if (cross) {
        if (keep === 'profile') warns.push(T('Der Anfahrweg schneidet durch das Profilstück — anderen Startpunkt oder andere Anfahrrichtung wählen.'));
        else notes.push(T('Der Anfahrweg läuft durch den Ausschnitt (Abfall) — unkritisch.'));
      } }
    // Luftwege vom Nullpunkt zum Anfahrpunkt (um den Block herum).
    const O = [0, 0], safeTop = blk.y1 + dist;
    let route;
    if (side === 'right') route = [[0, safeTop], [Ap[0], safeTop], Ap];
    else route = [[0, Ap[1]], Ap];
    const pts = [[O[0], O[1], 'start']];
    route.forEach(p => pts.push([p[0], p[1], 'air']));
    pts.push([E[0], E[1], 'enter']); pts.push([Sp[0], Sp[1], 'enter']);
    for (let q = 1; q < loop.length; q++) pts.push([loop[q][0], loop[q][1], 'cut']);
    pts.push([E[0], E[1], 'exit']); pts.push([Ap[0], Ap[1], 'exit']);
    route.slice(0, -1).reverse().forEach(p => pts.push([p[0], p[1], 'air']));
    pts.push([O[0], O[1], 'air']);
    // Schnittlänge (im Block)
    let cutLen = 0, loopLen = 0;
    for (let q = 1; q < loop.length; q++) loopLen += Math.hypot(loop[q][0] - loop[q - 1][0], loop[q][1] - loop[q - 1][1]);
    cutLen = loopLen + 2 * Math.hypot(Sp[0] - E[0], Sp[1] - E[1]);
    lastRes = {
      empty: false, name: src.name, chord: c, angle: num('waAngle', 0), noseRight, contour, sN, path, loop, i0, Sp, E, Ap, side, ap,
      startPicked: !!startC, dirCW: wantCW, nose, noseAct, teAct, block: blk, keep, clear, k, off, feed: feed(), cutLen, loopLen, pts, warns, notes,
      pw, ph, origin: { x: 0, y: 0 }
    };
    return lastRes;
  }

  // ======================================================================
  //  Fahrten als Daten (Maschinenkoordinaten) — Text macht ausschnitt_gcode.js
  // ======================================================================
  function machineMoves() {
    const r = build(); if (!r || r.empty) return null;
    const blk = r.block, f = r.feed, maxF = state.cfg.maxFeed || 0;
    const outF = App.outsideFeed ? App.outsideFeed() : f;
    const inBlock = (a, b) => {   // Strecke berührt das Blockinnere? (Liang-Barsky)
      let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
      const clip = (p, q) => { if (Math.abs(p) < 1e-12) return q > 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
      const e = 1e-6;
      return clip(-dx, a[0] - blk.x0 - e) && clip(dx, blk.x1 - e - a[0]) && clip(-dy, a[1] - blk.y0 - e) && clip(dy, blk.y1 - e - a[1]) && t1 - t0 > 1e-9;
    };
    const moves = []; let tmin = 0;
    r.pts.forEach((p, i) => {
      if (i === 0) { moves.push({ X: p[0], Y: p[1], k: 'start', F: outF }); return; }
      const q = r.pts[i - 1], L = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (L < 1e-6) return;
      const cutting = p[2] !== 'air' && inBlock(q, p);
      const F = cutting ? (maxF > 0 ? Math.min(f, maxF) : f) : outF;
      moves.push({ X: p[0], Y: p[1], k: p[2], F, cut: cutting });
      tmin += L / Math.max(1, F);
    });
    const heat = App.heatForSpeed ? App.heatForSpeed(matId(), f) : null;
    return {
      moves, res: r,
      meta: {
        name: r.name, chord: r.chord, angle: r.angle, keep: r.keep, clear: r.clear, kerf: r.k, feed: f, outFeed: outF,
        heat, wireS: heat != null && App.wireSFor ? App.wireSFor(heat) : null,
        block: { w: r.block.w, h: r.block.h, d: r.block.d, x: r.block.x0, y: r.block.y0 },
        approach: r.ap, dirCW: r.dirCW, startPicked: r.startPicked, cutLen: r.cutLen, minutes: tmin
      }
    };
  }
  // 3D-Szene (Simulation): Block, Draht gerade (XY = UV).
  function buildScene(mm) {
    mm = mm || machineMoves();
    const mw = state.cfg.machineWidth || 900;
    const ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const lim = App.machineLimits ? App.machineLimits() : {};
    if (!mm) return { machineWidth: mw, ax, blocks: [{ seg: 0, x0: 0, x1: 1, y0: 0, y1: 1, x0t: 0, x1t: 1, y0t: 0, y1t: 1, z0: 0, z1: mw, cutZ0: 0, cutZ1: mw }], defaultSeg: 0, limits: lim };
    const b = mm.meta.block, d = Math.min(b.d, mw);
    const z0 = App.effBlockZ ? Math.max(0, Math.min(mw - d, +App.effBlockZ(d) || 0)) : (mw - d) / 2, z1 = z0 + d;
    const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
    return { machineWidth: mw, ax, blocks: [{ seg: 0, x0, x1, y0, y1, x0t: x0, x1t: x1, y0t: y0, y1t: y1, z0, z1, cutZ0: z0, cutZ1: z1 }], defaultSeg: 0, limits: lim };
  }
  // Bahnvorschau ohne G-Code-Erzeugung (pathpreview.js).
  function previewMoves() {
    const mm = machineMoves(); if (!mm) return null;
    const mv = []; let cur = { lx: 0, ly: 0, rx: 0, ry: 0 };
    mm.moves.forEach((m, i) => {
      const to = { lx: m.X, ly: m.Y, rx: m.X, ry: m.Y };
      if (i > 0) mv.push({ from: cur, to, rapid: !m.cut, feed: m.cut ? m.F : 0 });
      cur = to;
    });
    return { moves: mv, label: label() };
  }

  // ======================================================================
  //  Ansicht (Canvas)
  // ======================================================================
  let canvas = null, ctx = null, view = null, bound = false, hover = null;
  // Befehl „Startpunkt wählen": nur solange aktiv, wählt ein Klick auf die Kontur
  // den Startpunkt; danach (oder mit Esc) ist der Befehl wieder beendet.
  let pickMode = false;
  function setPickMode(on) {
    pickMode = !!on; hover = null;
    if (canvas) canvas.style.cursor = '';
    const b = document.getElementById('ausPickStart');
    if (b) { b.textContent = T(pickMode ? '■ Startpunkt wählen: AN' : '▶ Startpunkt wählen'); b.classList.toggle('primary', pickMode); }
    buildSidebar();
    if (state.activeTab === TAB) draw();
  }
  const W2S = (x, y) => [view.ox + x * view.sc, view.oy - y * view.sc];
  const S2W = (px, py) => [(px - view.ox) / view.sc, (view.oy - py) / view.sc];
  function col(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function fitCanvas() {
    canvas = document.getElementById('cAusschnitt'); if (!canvas) return false;
    const r = canvas.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return false;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  function fitView() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), res = lastRes;
    const b = res && !res.empty ? [0, 0, res.block.x1, res.block.y1] : [0, 0, 300, 150];
    if (res && !res.empty) res.pts.forEach(p => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
    const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
    const top = 120, bottom = 120, availH = Math.max(40, r.height - top - bottom);
    const sc = Math.min((r.width - 70) / bw, availH / bh);
    view = { sc, ox: (r.width - bw * sc) / 2 - b[0] * sc, oy: top + (availH + bh * sc) / 2 + b[1] * sc };
  }
  function polyPath(P, close) { ctx.moveTo(...W2S(P[0][0], P[0][1])); for (let i = 1; i < P.length; i++) ctx.lineTo(...W2S(P[i][0], P[i][1])); if (close) ctx.closePath(); }
  function arrow(a, b, color, size) {
    const [ax, ay] = W2S(a[0], a[1]), [bx, by] = W2S(b[0], b[1]);
    const L = Math.hypot(bx - ax, by - ay); if (L < 1e-6) return;
    const ux = (bx - ax) / L, uy = (by - ay) / L, s = size || 7;
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx - ux * s - uy * s * 0.55, by - uy * s + ux * s * 0.55); ctx.lineTo(bx - ux * s + uy * s * 0.55, by - uy * s - ux * s * 0.55);
    ctx.closePath(); ctx.fill();
  }
  function draw() {
    if (!canvas || !ctx) return;
    const r = canvas.getBoundingClientRect(), w = r.width, hgt = r.height, res = lastRes;
    if (!view) fitView();
    ctx.clearRect(0, 0, w, hgt);
    ctx.fillStyle = col('--panel2', '#1e242c'); ctx.fillRect(0, 0, w, hgt);
    const step = view.sc >= 4 ? 10 : view.sc >= 0.8 ? 50 : view.sc >= 0.2 ? 100 : 500;
    ctx.strokeStyle = col('--line', '#2a323c'); ctx.lineWidth = 1; ctx.beginPath();
    const wx0 = -view.ox / view.sc, wx1 = (w - view.ox) / view.sc, wy1 = view.oy / view.sc, wy0 = (view.oy - hgt) / view.sc;
    for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const [px] = W2S(x, 0); ctx.moveTo(px, 0); ctx.lineTo(px, hgt); }
    for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) { const [, py] = W2S(0, y); ctx.moveTo(0, py); ctx.lineTo(w, py); }
    ctx.stroke();
    if (!res || res.empty) {
      ctx.fillStyle = '#8b98a8'; ctx.font = '13px Segoe UI, sans-serif';
      ctx.fillText(res && res.msg ? res.msg : T('Kein Profil.'), 20, 140);
      updateInfo(res); return;
    }
    const V = viewCfg(), blk = res.block;
    // Block
    { const [ax, ay] = W2S(blk.x0, blk.y1), [bx, by] = W2S(blk.x1, blk.y0);
      ctx.fillStyle = 'rgba(200,170,110,0.07)'; ctx.fillRect(ax, ay, bx - ax, by - ay);
      ctx.strokeStyle = '#a08a5a'; ctx.lineWidth = 1.5; ctx.strokeRect(ax, ay, bx - ax, by - ay);
      ctx.fillStyle = '#a08a5a'; ctx.font = '11px Segoe UI, sans-serif';
      ctx.fillText(T('Block') + ' ' + blk.w.toFixed(0) + ' × ' + blk.h.toFixed(0) + ' × ' + blk.d.toFixed(0) + ' mm', ax + 4, ay - 5); }
    // Anfahrfläche hervorheben
    { const s = res.side, a = s === 'top' ? [blk.x0, blk.y1, blk.x1, blk.y1] : s === 'bottom' ? [blk.x0, blk.y0, blk.x1, blk.y0] : s === 'right' ? [blk.x1, blk.y0, blk.x1, blk.y1] : [blk.x0, blk.y0, blk.x0, blk.y1];
      const [p1x, p1y] = W2S(a[0], a[1]), [p2x, p2y] = W2S(a[2], a[3]);
      ctx.strokeStyle = 'rgba(255,180,84,0.55)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke(); }
    // Profil
    ctx.beginPath(); polyPath(res.contour, true);
    if (V.fill) { ctx.fillStyle = res.keep === 'block' ? 'rgba(255,255,255,0.05)' : 'rgba(74,163,255,0.22)'; ctx.fill(); }
    ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.4; ctx.stroke();
    // Nase
    if (Math.abs(res.angle) > 1e-6) {   // Drehpunkt Endleiste
      const [tx, ty] = W2S(res.teAct[0], res.teAct[1]); ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.moveTo(tx - 8, ty); ctx.lineTo(tx + 8, ty); ctx.moveTo(tx, ty - 8); ctx.lineTo(tx, ty + 8); ctx.stroke();
      ctx.fillStyle = '#4aa3ff'; ctx.font = '10px Segoe UI, sans-serif'; const tl = T('Drehpunkt Endleiste') + ' ' + res.angle.toFixed(1) + '°'; ctx.fillText(tl, res.noseRight ? tx + 8 : tx - 8 - ctx.measureText(tl).width, ty + 18);
    }
    { const [nx, ny] = W2S(res.noseAct[0], res.noseAct[1]); ctx.fillStyle = '#4aa3ff'; ctx.font = '10px Segoe UI, sans-serif'; ctx.fillText(T('Nase'), nx + (res.noseRight ? 6 : -30), ny - 6); }
    if (V.cut) {
      // Abbrand in wahrer Dicke
      if (App.kerfBand && App.kerfTrueOn && App.kerfTrueOn('ausschnitt') && res.k > 0) {
        const VB = { s: view.sc, X: x => view.ox + x * view.sc, Y: y => view.oy - y * view.sc };
        App.kerfBand(ctx, VB, [res.loop, [res.E, res.Sp]], { view: 'ausschnitt', k: res.k, color: '#ff5a3c' });
      }
      // Luftwege und Anfahrt
      const P = res.pts;
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], kd = b[2];
        if (kd === 'cut') continue;
        ctx.beginPath(); ctx.moveTo(...W2S(a[0], a[1])); ctx.lineTo(...W2S(b[0], b[1]));
        if (kd === 'air') { ctx.strokeStyle = '#6b7888'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.1; }
        else { ctx.strokeStyle = '#ffb454'; ctx.setLineDash([]); ctx.lineWidth = 2; }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // Umlauf
      ctx.beginPath(); polyPath(res.loop, false); ctx.strokeStyle = '#ff5a3c'; ctx.lineWidth = 1.4; ctx.stroke();
      if (V.arrows) {
        // Pfeile in gleichen Abständen entlang des Umlaufs (Richtung)
        const L = res.loopLen, nA = Math.max(4, Math.min(14, Math.round(L * view.sc / 90)));
        let acc = 0, next = L / nA * 0.5;
        for (let q = 1; q < res.loop.length; q++) {
          const a = res.loop[q - 1], b = res.loop[q], sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
          while (acc + sl >= next && sl > 0) {
            const t = (next - acc) / sl, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            const e = 0.5 / view.sc, u = [(b[0] - a[0]) / sl, (b[1] - a[1]) / sl];
            arrow([p[0] - u[0] * e * 8, p[1] - u[1] * e * 8], [p[0] + u[0] * e * 8, p[1] + u[1] * e * 8], '#ff8a6b', 8);
            next += L / nA;
          }
          acc += sl;
        }
        // Anfahrt-Pfeil
        const mid = [(res.E[0] + res.Sp[0]) / 2, (res.E[1] + res.Sp[1]) / 2];
        arrow(res.E, mid, '#ffb454', 9);
      }
    }
    // Startpunkt
    { const [sx, sy] = W2S(res.Sp[0], res.Sp[1]);
      ctx.fillStyle = res.startPicked ? '#3ddc84' : '#ffb454'; ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#e6ebf1'; ctx.font = '11px Segoe UI, sans-serif';
      ctx.fillText(T(res.startPicked ? 'Start (gewählt)' : 'Start (automatisch)'), sx + 8, sy - 8); }
    // Hover: Punkt, der beim Klick Startpunkt wird
    if (hover) {
      const [hx, hy] = W2S(hover.p[0], hover.p[1]);
      ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.stroke();
    }
    // Maße: Nullpunkt → Block → Nase (waagrecht unter dem Block), Höhen (senkrecht links bzw. an der Nase).
    if (V.dims !== false) drawDims(res);
    // Nullpunkt
    { const [ox, oy] = W2S(0, 0); ctx.strokeStyle = col('--bad', '#ff6b6b'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy); ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke();
      ctx.fillStyle = col('--bad', '#ff6b6b'); ctx.font = '10px Segoe UI, sans-serif'; ctx.fillText('X0 Y0', ox + 6, oy + 13); }
    const barH = ((canvas.parentElement && canvas.parentElement.querySelector('.simbar')) || {}).offsetHeight || 44;
    ctx.fillStyle = '#8b98a8'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText(T('Raster') + ' ' + step + ' mm · ' + T('blau = Profil · rot = Schnittbahn (mit Abbrand) · orange = Anfahrt · grau = Luftweg'), 8, hgt - barH - 8);
    if (pickMode) {
      const msg = T('Wahlmodus AKTIV: einen Punkt der Kontur anklicken — dort beginnt der Schnitt.') + ' ' + T('(Esc = abbrechen)');
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      const tw = ctx.measureText(msg).width, x0 = Math.max(8, (w - tw) / 2 - 10);
      ctx.fillStyle = 'rgba(61,220,132,0.16)'; ctx.fillRect(x0, hgt - barH - 50, tw + 20, 26);
      ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 1; ctx.strokeRect(x0, hgt - barH - 50, tw + 20, 26);
      ctx.fillStyle = '#3ddc84'; ctx.fillText(msg, x0 + 10, hgt - barH - 32);
    }
    updateInfo(res);
  }
  // Maßkette in Bildschirmkoordinaten: Hilfslinien, Maßlinie mit Pfeilen, Text mittig.
  function dimLine(ax, ay, bx, by, text, vertical) {
    const L = Math.hypot(bx - ax, by - ay); if (L < 2) return;
    ctx.strokeStyle = '#9fb0c4'; ctx.fillStyle = '#9fb0c4'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const ux = (bx - ax) / L, uy = (by - ay) / L, s = Math.min(6, L / 3);
    [[ax, ay, ux, uy], [bx, by, -ux, -uy]].forEach(([x, y, dx, dy]) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * s - dy * s * 0.45, y + dy * s + dx * s * 0.45); ctx.lineTo(x + dx * s + dy * s * 0.45, y + dy * s - dx * s * 0.45); ctx.closePath(); ctx.fill();
    });
    ctx.font = '11px Segoe UI, sans-serif';
    const tw = ctx.measureText(text).width, mx = (ax + bx) / 2, my = (ay + by) / 2;
    ctx.save(); ctx.translate(mx, my); if (vertical) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = col('--panel2', '#1e242c'); ctx.fillRect(-tw / 2 - 3, -14, tw + 6, 13);
    ctx.fillStyle = '#c9d4e0'; ctx.fillText(text, -tw / 2, -4); ctx.restore();
  }
  function extLine(x1, y1, x2, y2) { ctx.strokeStyle = 'rgba(159,176,196,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); }
  function drawDims(res) {
    const blk = res.block, nx = res.noseAct[0], ny = res.noseAct[1], f = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + ' mm';
    const [, yb] = W2S(0, blk.y0), [, y0] = W2S(0, 0), base = Math.max(yb, y0);
    const [sx0] = W2S(0, 0), [sbx0] = W2S(blk.x0, 0), [sbx1] = W2S(blk.x1, 0), [snx, sny] = W2S(nx, ny);
    const front = res.noseRight ? sbx1 : sbx0;             // Blockvorderseite = Nasenseite
    const r1 = base + 22, r2 = base + 42;
    // Zeile 1: Nullpunkt → Block, Blockvorderseite → Nase
    extLine(snx, sny + 6, snx, r2 + 4);
    extLine(front, yb, front, r1 + 4);
    if (blk.x0 > 0.05) { extLine(sx0, y0, sx0, r2 + 4); extLine(sbx0, yb, sbx0, r1 + 4); dimLine(sx0, r1, sbx0, r1, f(blk.x0)); }
    dimLine(Math.min(front, snx), r1, Math.max(front, snx), r1, f(Math.abs(nx - (res.noseRight ? blk.x1 : blk.x0))));
    // Zeile 2: Nullpunkt → Nase (gesamt)
    dimLine(Math.min(sx0, snx), r2, Math.max(sx0, snx), r2, 'X0 → ' + T('Nase') + ' ' + f(nx));
    // Höhen: Nullpunkt → Blockunterkante (links am Block), Blockunterkante → Nase (an der Nase)
    const side = res.noseRight ? 1 : -1, vx = snx + side * 24;
    extLine(snx + side * 4, sny, vx + side * 4, sny);
    dimLine(vx, yb, vx, sny, f(ny - blk.y0), true);
    if (blk.y0 > 0.05) { const bxl = sbx0 - 24; extLine(sbx0, yb, bxl - 4, yb); extLine(sx0, y0, bxl - 4, y0); dimLine(bxl, y0, bxl, yb, f(blk.y0), true); }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const AP_NAMES = { top: 'von oben', bottom: 'von unten', front: 'von vorne (Nasenseite)', rear: 'von hinten (Endleistenseite)' };
  function updateInfo(res) {
    const el = document.getElementById('ausInfo'); if (!el) return;
    if (!res || res.empty) { el.innerHTML = esc(res && res.msg ? res.msg : T('Kein Profil.')); return; }
    const mm = v => v.toFixed(1);
    let hh = '<b>' + T('Profil') + ':</b> ' + esc(res.name) + '<br>'
      + T('Profiltiefe') + ' ' + mm(res.chord) + ' mm · ' + T('Einstellwinkel') + ' ' + res.angle.toFixed(1) + '° · '
      + T(res.keep === 'block' ? 'Ausschnitt (Block bleibt)' : 'Profilstück bleibt') + (res.clear > 0 ? ' · ' + T('Spiel') + ' ' + res.clear.toFixed(2) + ' mm' : '') + '<br>'
      + T('Anfahrt') + ' ' + T(AP_NAMES[res.ap]) + ' · ' + T(res.dirCW ? 'im Uhrzeigersinn' : 'gegen den Uhrzeigersinn') + ' · '
      + T(res.startPicked ? 'Startpunkt gewählt' : 'Startpunkt automatisch') + '<br>'
      + T('Abbrand') + ' ' + res.k.toFixed(2) + ' mm · ' + T('Vorschub') + ' ' + Math.round(res.feed) + ' mm/min · '
      + T('Schnittlänge') + ' ' + (res.cutLen / 1000).toFixed(2) + ' m (~' + (res.cutLen / Math.max(1, res.feed)).toFixed(1) + ' min)';
    if (res.warns.length) hh += '<div style="color:#ffb454;margin-top:4px">' + res.warns.map(w => '⚠ ' + esc(w)).join('<br>') + '</div>';
    if (res.notes.length) hh += '<div style="color:#8b98a8;margin-top:4px">' + res.notes.map(w => 'ℹ ' + esc(w)).join('<br>') + '</div>';
    el.innerHTML = hh;
  }
  // Klick: nächster Punkt der Profilkontur (innerhalb 14 px) → Bogenlängen-Anteil.
  function pickAt(px, py) {
    const res = lastRes; if (!res || res.empty || !view) return null;
    const [x, y] = S2W(px, py), nb = nearestOnPoly(res.contour, x, y);
    if (!nb || nb.d * view.sc > 14) return null;
    const s0 = res.sN[nb.i], s1 = nb.i + 1 < res.sN.length ? res.sN[nb.i + 1] : 1;
    return { p: nb.p, s: s0 + (s1 - s0) * nb.t };
  }
  function bindCanvas() {
    if (bound) return; canvas = document.getElementById('cAusschnitt'); if (!canvas) return;
    bound = true;
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); if (!view) return;
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      view.ox = mx - (mx - view.ox) * f; view.oy = my - (my - view.oy) * f; view.sc *= f; draw();
    }, { passive: false });
    let drag = null;
    canvas.addEventListener('mousedown', e => { if (e.button !== 0 && e.button !== 1 || !view) return; drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false, btn: e.button }; });
    window.addEventListener('mousemove', e => {
      if (drag) {
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) { drag.moved = true; canvas.style.cursor = 'grabbing'; hover = null; }
        if (drag.moved) { view.ox = drag.ox + e.clientX - drag.x; view.oy = drag.oy + e.clientY - drag.y; draw(); }
        return;
      }
      if (!pickMode) return;
      if (e.target !== canvas) { if (hover) { hover = null; draw(); } return; }
      const r = canvas.getBoundingClientRect(), h = pickAt(e.clientX - r.left, e.clientY - r.top);
      if (!!h !== !!hover || (h && hover && (h.p[0] !== hover.p[0] || h.p[1] !== hover.p[1]))) { hover = h; canvas.style.cursor = h ? 'crosshair' : ''; draw(); }
    });
    window.addEventListener('mouseup', e => {
      if (!drag) return;
      const d = drag; drag = null; canvas.style.cursor = '';
      if (d.moved || d.btn !== 0 || !pickMode) return;
      const r = canvas.getBoundingClientRect(), h = pickAt(e.clientX - r.left, e.clientY - r.top);
      if (h) { S('waStart', +h.s.toFixed(6)); pickMode = false; setPickMode(false); upd(false); }
    });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && pickMode && state.activeTab === TAB) setPickMode(false); });
    canvas.addEventListener('dblclick', () => { fitView(); draw(); });
    const tg = (id, key) => { const b = document.getElementById(id); if (!b) return; b.checked = key === 'dims' ? viewCfg()[key] !== false : !!viewCfg()[key]; b.onchange = () => { viewCfg()[key] = b.checked; draw(); }; };
    tg('ausShowFill', 'fill'); tg('ausShowCut', 'cut'); tg('ausShowArrows', 'arrows'); tg('ausShowDims', 'dims');
    { const kt = document.getElementById('ausShowKerfTrue');
      if (kt && App.kerfTrueOn) { kt.checked = App.kerfTrueOn('ausschnitt'); kt.onchange = () => App.kerfTrueSet('ausschnitt', kt.checked); } }
    const fb = document.getElementById('ausFit'); if (fb) fb.onclick = () => { fitView(); draw(); };
    const pk = document.getElementById('ausPickStart'); if (pk) pk.onclick = () => setPickMode(!pickMode);
    const au = document.getElementById('ausAutoStart'); if (au) au.onclick = () => { S('waStart', null); if (pickMode) setPickMode(false); upd(true); };
    const rv = document.getElementById('ausReverse'); if (rv) rv.onclick = () => { S('waDir', C('waDir') === 'ccw' ? 'cw' : 'ccw'); upd(true); };
  }

  // ---------- Aktualisieren -------------------------------------------------
  let upTimer = null, genTimer = null;
  function upd(rebuildSide, delay) {
    if (rebuildSide) buildSidebar();
    if (upTimer) clearTimeout(upTimer);
    upTimer = setTimeout(() => {
      upTimer = null;
      if (state.activeTab === TAB) { build(); draw(); }
      if (state.cfg.gcodeSource === TAB) { if (genTimer) clearTimeout(genTimer); genTimer = setTimeout(() => { genTimer = null; App.render(); }, 120); }
    }, delay || 60);
  }
  function show() { bindCanvas(); if (!fitCanvas()) return; const had = lastRes && !lastRes.empty; build(); if (!had || !view) fitView(); draw(); }
  function resize() { if (state.activeTab !== TAB) return; if (fitCanvas()) draw(); }
  function refresh() { if (state.activeTab !== TAB) return; build(); draw(); }

  // ---------- Eigenes Profil ---------------------------------------------------
  function setOwn(prof, name) {
    const n = (window.Airfoil && Airfoil.normalize) ? Airfoil.normalize(prof) : prof;
    S('waProf', { name: name || prof.name || T('Eigenes Profil'), pts: n.map(p => [+p.x.toFixed(6), +p.y.toFixed(6)]) });
    S('waSrc', 'own'); S('waStart', null);
    upd(true);
  }
  async function loadDat() {
    try {
      let f = null;
      if (App.pickTextFile && App.FS_SUPPORTED) f = await App.pickTextFile({ 'text/plain': ['.dat', '.bez', '.txt', '.cor'] }, 'ldDat');
      else f = await new Promise(res => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.dat,.bez,.txt,.cor';
        i.onchange = async () => { const x = i.files[0]; res(x ? { name: x.name, text: await x.text() } : null); };
        i.click();
      });
      if (!f) return;
      const prof = Airfoil.parseDat(f.text);
      if (window.FoilDB) window.FoilDB.add(prof, { file: f.name });
      setOwn(prof, (prof.name && !/^Profil$/i.test(prof.name)) ? prof.name : f.name.replace(/\.[^.]+$/, ''));
    } catch (e) { if (e && e.name !== 'AbortError') App.toast && App.toast(T('Profil nicht lesbar.')); }
  }

  // ======================================================================
  //  Seitenleiste
  // ======================================================================
  function ausschnittSidebar(side) {
    const nr = (body, label, k, opt) => numRow(body, label, () => num(k, DEF[k]), v => { S(k, v); upd(opt && opt.side); }, Object.assign({ norender: true }, opt || {}));
    const sel = (body, label, k, opts, h, sideRebuild) => selectRow(body, label, opts, () => C(k), v => { S(k, v); upd(sideRebuild); }, h);
    const res = lastRes && !lastRes.empty ? lastRes : null;

    // --- Profil -------------------------------------------------------------
    const g1 = grp('Tragflächenausschnitt: Profil', true, TAB, { key: 'wa_prof' });
    sel(g1.body, 'Profil', 'waSrc', [['root', 'Wurzelprofil der Tragfläche'], ['own', 'eigenes Profil']],
      'Wurzelprofil: Profil und Profiltiefe der Wurzelrippe aus dem Tragflächendesigner (ändert sich mit). Eigenes Profil: .dat-Datei oder Profildatenbank, Profiltiefe frei.', true);
    if (C('waSrc') === 'own') {
      const p = C('waProf');
      hint(g1.body, p ? T('Geladen: ') + p.name : 'Noch kein Profil geladen.');
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0';
      const b = document.createElement('button'); b.textContent = T('📂 Profil laden (.dat)…'); b.title = T('Profildatei im Selig- oder Lednicer-Format laden'); b.onclick = loadDat; bar.appendChild(b);
      if (C('waSrc') === 'own' && wingRec().root && wingRec().root.profile) {
        const r = document.createElement('button'); r.textContent = T('Wurzelprofil übernehmen'); r.title = T('Das Wurzelprofil der aktiven Tragfläche als eigenes Profil kopieren (danach unabhängig davon)');
        r.onclick = () => { const w = wingRec().root; S('waChord', +(+w.chord || 200).toFixed(1)); setOwn(w.profile, w.profile.name || T('Wurzelprofil')); };
        bar.appendChild(r);
      }
      g1.body.appendChild(bar);
      if (window.FoilDB && window.FoilDB.fillSelect) {
        const row = document.createElement('div'); row.className = 'row full';
        const s = document.createElement('select'); s.style.width = '100%';
        window.FoilDB.fillSelect(s, {});
        s.onchange = () => { const pr = window.FoilDB.profile(s.value); if (pr) setOwn(pr, pr.name); };
        row.appendChild(s); g1.body.appendChild(row);
      }
      nr(g1.body, 'Profiltiefe (mm)', 'waChord', { step: 1, min: 1 });
    } else {
      const L = wings();
      if (L.length > 1) {
        const opts = L.map((w, i) => [w.id, wingLabel(i)]);
        selectRow(g1.body, 'Tragfläche', opts, () => (C('waWing') && L.some(w => w.id === C('waWing'))) ? C('waWing') : (L[state.activeWing] || L[0]).id,
          v => { S('waWing', v); S('waStart', null); upd(true); });
      }
      const w = wingRec().root;
      hint(g1.body, T('Wurzelprofil: ') + ((w && w.profile && w.profile.name) || '—') + ' · ' + T('Profiltiefe ') + ((w && +w.chord) || 0).toFixed(1) + ' mm');
      nr(g1.body, 'Maßstab (%)', 'waScale', { step: 1, min: 1, hint: '100 % = Profiltiefe der Wurzelrippe.' });
    }
    nr(g1.body, 'Einstellwinkel (°)', 'waAngle', { step: 0.5, hint: 'Drehung um die Endleiste (sie bleibt stehen): positiv = Nase hoch.' });
    sel(g1.body, 'Nase zeigt nach', 'waNose', [['left', 'links'], ['right', 'rechts']], 'Ansicht von vorne auf die Maschine. „Vorne" bei der Anfahrt ist immer die Nasenseite.');
    nr(g1.body, 'Punkte der Kontur', 'waPts', { step: 10, min: 40, max: 1000, int: true });
    side.appendChild(g1.g);

    // --- Block & Lage ---------------------------------------------------------
    const g2 = grp('Tragflächenausschnitt: Block & Lage', false, TAB, { key: 'wa_block' });
    sel(g2.body, 'Was bleibt stehen', 'waKeep', [['block', 'Block (Ausschnitt = Loch)'], ['profile', 'Profilstück']],
      'Bestimmt die Seite des Abbrands: beim Ausschnitt läuft der Draht um den halben Abbrand innerhalb der Kontur (das Loch wird genau so groß wie das Profil plus Spiel), beim Profilstück außerhalb.', true);
    if (C('waKeep') !== 'profile') nr(g2.body, 'Spiel (mm)', 'waClear', { step: 0.1, min: 0, hint: 'Ausschnitt ringsum um diesen Betrag größer als das Profil (Passung, Beplankung, Kleber).' });
    if (App.matOptions) {
      const mo = [['', '— kein Werkstoff —']].concat(App.matOptions());
      selectRow(g2.body, 'Werkstoff', mo, () => (C('waMatId') != null ? C('waMatId') : (state.material.id || '')), v => { S('waMatId', v); upd(true); },
        'Werkstoff des Blocks (Abbrand, Heizung, Vorschub automatisch).');
    }
    sel(g2.body, 'Abbrand', 'waKerfMode', [['mat', 'aus Werkstoff-Kalibrierung'], ['manual', 'manuell'], ['off', 'aus (0)']], null, true);
    if (C('waKerfMode') === 'manual') nr(g2.body, 'Abbrand (Schnittspalt, mm)', 'waKerf', { step: 0.05, min: 0 });
    else hint(g2.body, T('Abbrand aktuell: ') + kerf().toFixed(2) + ' mm');
    nr(g2.body, 'Blockbreite fest (mm, 0 = auto)', 'waBlockW', { step: 5, min: 0 });
    nr(g2.body, 'Blockhöhe fest (mm, 0 = auto)', 'waBlockH', { step: 5, min: 0 });
    if (!(num('waBlockW', 0) > 0 && num('waBlockH', 0) > 0)) nr(g2.body, 'Rand um das Profil (mm, bei auto)', 'waMargin', { step: 1, min: 0 });
    nr(g2.body, 'Blockdicke entlang des Drahts (mm)', 'waDepth', { step: 5, min: 1 });
    sel(g2.body, 'Lage des Profils', 'waPosMode', [['center', 'mittig im Block'], ['manual', 'Abstand angeben']], null, true);
    if (C('waPosMode') === 'manual') {
      nr(g2.body, 'Nase ↔ Blockvorderseite (mm)', 'waPosX', { step: 1, hint: 'Vorderseite = Blockseite auf der Nasenseite. Beide Werte gelten für das ungedrehte Profil (Einstellwinkel 0°); beim Drehen bleibt die Endleiste stehen, die Nase wandert. Die Maße in der Ansicht zeigen die gedrehte Nase.' });
      nr(g2.body, 'Nasenhöhe über Blockunterkante (mm)', 'waPosY', { step: 1 });
    }
    hint(g2.body, 'Blocklage (Abstand X/Y vom Nullpunkt, Lage zwischen den Portalen) und Vorschub stellt der Reiter „G-Code" ein.');
    side.appendChild(g2.g);

    // --- Anfahrt, Startpunkt & Richtung ------------------------------------------
    const g3 = grp('Tragflächenausschnitt: Anfahrt, Startpunkt & Richtung', true, TAB, { key: 'wa_path' });
    sel(g3.body, 'Anfahrt', 'waApproach', [['top', 'von oben'], ['bottom', 'von unten'], ['front', 'von vorne (Nasenseite)'], ['rear', 'von hinten (Endleistenseite)']],
      'Blockfläche, durch die der Draht einfährt: senkrecht zur Fläche bis auf Höhe bzw. Lage des Startpunkts, dann zum Startpunkt; nach dem Umlauf auf demselben Weg hinaus.');
    nr(g3.body, 'Anfahrt-Abstand zur Blockfläche (mm)', 'waApproachDist', { step: 1, min: 0, hint: 'Bis zu diesem Punkt vor der Blockfläche fährt der Draht in Luft.' });
    { const ws = C('waStart');
      hint(g3.body, ws != null
        ? T('Startpunkt gewählt (bei ') + (ws * 100).toFixed(1) + T(' % der Konturlänge, ab Endleiste über die Oberseite).')
        : 'Startpunkt automatisch: der Anfahrfläche nächstgelegener Punkt der Kontur.');
      hint(g3.body, 'Befehl „Startpunkt wählen": danach einen Punkt der Profilkontur anklicken (grüner Kreis zeigt ihn). Der Befehl endet mit dem Klick oder mit Esc.');
      if (pickMode) App.warn ? App.warn(g3.body, T('Wahlmodus AKTIV: einen Punkt der Kontur anklicken — dort beginnt der Schnitt.')) : null;
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0';
      const p = document.createElement('button'); p.textContent = T(pickMode ? '■ Startpunkt wählen: AN' : '▶ Startpunkt wählen'); if (pickMode) p.className = 'primary';
      p.onclick = () => { if (state.activeTab !== TAB && App.switchView) App.switchView(TAB); setPickMode(!pickMode); }; bar.appendChild(p);
      const a = document.createElement('button'); a.textContent = T('Startpunkt automatisch'); a.disabled = ws == null; a.onclick = () => { S('waStart', null); if (pickMode) setPickMode(false); upd(true); }; bar.appendChild(a);
      g3.body.appendChild(bar); }
    sel(g3.body, 'Schnittrichtung', 'waDir', [['cw', 'im Uhrzeigersinn ↻'], ['ccw', 'gegen den Uhrzeigersinn ↺']],
      'Umlaufrichtung um das Profil, wie in der Ansicht (von vorne) gesehen. Die Pfeile auf der Schnittbahn zeigen sie an.');
    if (res && res.warns.length) res.warns.forEach(w => App.warn ? App.warn(g3.body, w) : hint(g3.body, w));
    if (document.getElementById('gcodeView')) {
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
      const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('⚙ G-Code'); b.title = T('Zum Reiter „G-Code" wechseln, Quelle „Tragflächenausschnitt"');
      b.onclick = () => { const t = document.getElementById('ausToGcode'); if (t) t.click(); }; bar.appendChild(b);
      g3.body.appendChild(bar);
    }
    side.appendChild(g3.g);
  }

  // Neues Projekt / Projekt laden: Projektwerte des Reiters auf Anfang.
  function reset() {
    Object.keys(DEF).forEach(k => { delete state.cfg[k]; });
    lastRes = null; view = null; hover = null; pickMode = false;
    setTimeout(() => { if (state.activeTab === TAB) show(); }, 0);
  }
  function label() { const r = lastRes && !lastRes.empty ? lastRes : build(); return T('Tragflächenausschnitt') + (r && !r.empty ? ' · ' + r.name : ''); }
  function fileBase() {
    const r = lastRes && !lastRes.empty ? lastRes : build();
    return ('ausschnitt_' + (r && !r.empty ? r.name : '')).replace(/[^\wäöüÄÖÜß\-]+/g, '_').replace(/_+$/g, '').slice(0, 50) || 'ausschnitt';
  }

  Object.assign(App, { ausschnittSidebar, buildAusschnittScene: () => buildScene() });
  window.Ausschnitt = {
    show, resize, refresh, build, draw, machineMoves, buildScene, previewMoves, reset, label, fileBase,
    _test: { offsetClosed, deloop, area, kerf, feed, C, S }
  };
})();
