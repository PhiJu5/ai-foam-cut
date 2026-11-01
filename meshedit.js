/* meshedit.js — Reiter „3D-Bearbeitung" (Feature „meshedit", braucht „model3d")
 *
 * Lädt STL, OBJ, STEP und IGES (Parser aus model3d.js: Model3D.parseFile / Model3D.occtReady)
 * als einzelne Körper, setzt sie zusammen und bearbeitet sie:
 *   Körper   verschieben, drehen, skalieren, spiegeln, duplizieren, vereinen (Berührflächen
 *            entfernen), in Einzelteile trennen, Löcher schließen, Normalen umdrehen,
 *            „Fläche an Fläche setzen" (Stirnflächen zweier Segmente aufeinander),
 *            aneinanderreihen, an einer Ebene strecken / verlängern (gleicher Querschnitt
 *            eingefügt oder Bereich proportional gestreckt bzw. gestaucht)
 *   Flächen  verschieben (entlang der Normale oder frei, angrenzende Flächen dehnen mit),
 *            extrudieren (neue Seitenwände), drehen, skalieren, ebnen, löschen
 * Ein Körper ist ein indiziertes Dreiecksnetz {V Float64Array, F Uint32Array, G Int32Array};
 * G = Flächengruppe je Dreieck (STEP: echte CAD-Flächen aus OpenCascade, STL/OBJ: Bereiche
 * ohne Knick über dem Knickwinkel). Alle Operationen ersetzen die Felder statt sie zu ändern
 * — so teilen sich die Rückgängig-Stände unveränderte Körper.
 * Ergebnis: STL speichern oder an den Reiter „3D-Modell" übergeben (Zerlegen, G-Code).
 * Echte CAD-Volumen (Feature „occad", meshocc.js): STEP-Körper behalten zusätzlich ihre exakte Form
 * (b.brep, OpenCascade); das Netz wird daraus erzeugt. Gültig nur, solange b.V/b.F die daraus erzeugten
 * Felder sind (brepOk) — Netz-Operationen ohne CAD-Gegenstück machen den Körper zum reinen Netz (Hinweis).
 * Andere Module rufen nur geschützt (App.meshedSidebar && …, window.MeshEdit).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r3 = v => Math.round(v * 1000) / 1000;
  const AX = { x: 0, y: 1, z: 2 };
  const AXN = ['X', 'Y', 'Z'];

  // ---------- Einstellungen (state.cfg.meshed, nur Bedienwerte; Netze in E) ---------------------
  const DEF = {
    mode: 'body',                                   // Auswahl: 'body' Körper | 'face' Fläche
    angle: 25,                                      // Knickwinkel der Flächenerkennung (STL/OBJ, °)
    mv: { dx: 0, dy: 0, dz: 0 },                    // Körper verschieben (mm)
    rot: { axis: 'z', ang: 90, piv: 'body' },       // Körper drehen: Achse, Winkel, Drehpunkt body|sel|origin
    sc: { uni: true, f: 1, fx: 1, fy: 1, fz: 1 },   // Körper skalieren
    mir: 'x',                                       // Spiegeln an der Ebene senkrecht zu dieser Achse
    st: { axis: 'x', pos: null, d: 50, kind: 'insert', band: 50, show: true },   // Strecken / Verlängern
    fc: { d: 5, dx: 0, dy: 0, dz: 0, ext: 10, axis: 'n', ang: 10, f: 1.1 },        // Fläche bearbeiten
    mate: { gap: 0, flip: false },                  // Fläche an Fläche setzen
    chain: { axis: 'x', gap: 0, center: true },     // aneinanderreihen
    br: { rings: 8, soft: 0.6 },                    // Teile verbinden: Zwischenringe, Weichheit (0 = gerade)
    gap: { mode: 'solid', tension: 0.35, rings: 16 }, // Lücke füllen (tangential): Ergebnis solid|face, Spannung, Zwischenringe (Netz)
    exp: { fmt: 'stl', each: false },               // Ausgabe: Format, je Körper eine Datei
    occ: { q: 'mid', r: 2, ch: 1, th: 2, eTol: 0.02, eAng: 3 },   // CAD-Volumen: Darstellungsfeinheit, Rundungsradius, Fase, Wandstärke, Export-Netz (Sehnenfehler mm, Winkel °)
    rp: { len: 'auto', up: 'auto', upSign: 'auto', nose: 'auto', nFr: 14, tol: 0.5, nodes: 10, fin: true, wing: true, canopy: false, frTol: 1.5, type: 'free', outMax: 60, glass: 1 },
    kh: { trim: true, hideMold: true, transp: true, alpha: 0.35 },             // Kabinenhaube aus Negativform: an Ausschnittkante beschneiden, Form danach ausblenden   // Übergabe an Rumpf
    lock: '',                                       // Ziehen mit der Maus nur entlang X/Y/Z ('' = frei / Normale)
    wire: false, edges: true, axes: true
  };
  function cfg() {
    let c = state.cfg.meshed;
    if (!c || typeof c !== 'object') c = state.cfg.meshed = JSON.parse(JSON.stringify(DEF));
    for (const k in DEF) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEF[k]));
    for (const k of ['mv', 'rot', 'sc', 'st', 'fc', 'mate', 'chain', 'br', 'exp', 'occ', 'gap', 'rp', 'kh']) for (const q in DEF[k]) if (c[k][q] === undefined) c[k][q] = DEF[k][q];
    return c;
  }

  // ---------- Zustand ---------------------------------------------------------------------------
  const E = {
    bodies: [],           // [{id, name, color, V, F, G, ng, hidden, ver}]
    selB: new Set(),      // Körpermodus: ausgewählte Körper-ids
    selF: new Map(),      // Flächenmodus: Körper-id → Set(Flächengruppen)
    undo: [], redo: [],
    mate: null,           // Assistent „Fläche an Fläche": {step:1|2, a:{id,g}}
    drag: null            // laufendes Ziehen mit der Maus
  };
  let uid = 1;
  const UNDO_MAX = 30;
  const PALETTE = ['#5aa0d8', '#e0a050', '#7cc47a', '#d77fb8', '#a48be0', '#d8c35a', '#5ec8c0', '#e07a6a', '#9ab0c8', '#c8a07a'];
  function mkBody(name, V, F, G, color) {
    let ng = 0; for (let i = 0; i < G.length; i++) if (G[i] >= ng) ng = G[i] + 1;
    return { id: uid++, name: name || T('Körper'), color: color || PALETTE[(E.bodies.length) % PALETTE.length], V, F, G, ng, hidden: false, ver: 1 };
  }
  const byId = id => E.bodies.find(b => b.id === id) || null;
  function touch(b) { b.ver = (b.ver || 0) + 1; b._edges = null; b._stats = null; }
  function snap() {
    E.undo.push(E.bodies.map(b => Object.assign({}, b)));
    if (E.undo.length > UNDO_MAX) E.undo.shift();
    E.redo = [];
  }
  function undo() {
    if (!E.undo.length) return;
    E.redo.push(E.bodies.map(b => Object.assign({}, b)));
    E.bodies = E.undo.pop(); cleanSel(); changed(true);
  }
  function redo() {
    if (!E.redo.length) return;
    E.undo.push(E.bodies.map(b => Object.assign({}, b)));
    E.bodies = E.redo.pop(); cleanSel(); changed(true);
  }
  function cleanSel() {
    for (const id of [...E.selB]) if (!byId(id)) E.selB.delete(id);
    for (const [id, gs] of [...E.selF]) { const b = byId(id); if (!b) { E.selF.delete(id); continue; } for (const g of [...gs]) if (g >= b.ng) gs.delete(g); if (!gs.size) E.selF.delete(id); }
  }
  // nach jeder Änderung: neu zeichnen, bei Bedarf Seitenleiste neu
  function changed(sidebar) {
    const lost = [];
    for (const b of E.bodies) if (b.brep && !brepOk(b)) { b.brep = null; lost.push(b.name); sidebar = true; }
    if (lost.length && App.toast) App.toast(lost.join(', ') + ': ' + T('jetzt reines Netz — diese Bearbeitung gibt es nur für Netze, die exakten CAD-Flächen sind aufgegeben (Rückgängig holt sie zurück).'));
    if (sidebar && App.buildSidebar && state.activeTab === 'meshed') App.buildSidebar(); draw();
    if (window.MeshSection) MeshSection.changed();   // Schnittfenster nachführen
  }
  // ---------- CAD-Volumen (OpenCascade, meshocc.js) ----------
  const OCC = () => (window.MeshOCC && MeshOCC.available() ? MeshOCC : null);
  const brepOk = b => !!(b && b.brep && b.V === b.brepV && b.F === b.brepF);
  const OCC_Q = { fine: [1.5e-4, 0.08], mid: [4e-4, 0.15], coarse: [1.5e-3, 0.35] };
  // Export-Netz eines Körpers: CAD-Volumen eigens fein vernetzt (Sehnenfehler/Winkel aus cfg.occ.eTol/eAng,
  // an einer Kopie der Form, damit das Anzeigenetz unberührt bleibt), sonst das Netz selbst
  function expBody(b) {
    if (!brepOk(b)) return b;
    const c = cfg().occ, tol = Math.max(0.001, +c.eTol || 0.02), ang = clamp(+c.eAng || 3, 1, 30), key = tol + '|' + ang;
    if (b._exp && b._exp.brep === b.brep && b._exp.key === key) return b._exp.body;
    const cp = MeshOCC.transform(b.brep), r = MeshOCC.tess(cp, tol, ang * Math.PI / 180);
    try { for (const f of cp.__faces || []) f.delete(); cp.delete(); } catch (e) {}   // Kopie samt Netz freigeben (Speicher für den nächsten Körper)
    const w = weld(r.soup, weldTol(r.soup), r.grp);
    const body = { name: b.name, color: b.color, V: w.V, F: w.F, G: w.G, ng: r.nf };
    b._exp = { brep: b.brep, key, body };
    return body;
  }
  // Körper für Körper vernetzen, dazwischen die Ansicht aktualisieren (Fortschritt); null bei Fehler
  async function expListAsync(list) {
    const out = [], n = list.filter(brepOk).length; let k = 0;
    for (const b of list) {
      if (brepOk(b)) { k++; setInfo(T('Vernetze CAD-Volumen für den Export: Körper ') + k + '/' + n + ' (' + b.name + ') …'); await nextFrame(); }
      const x = expRun(() => expBody(b)); if (!x) { draw(); return null; }
      out.push(x);
    }
    draw(); return out;
  }
  // Dreiecke des Export-Netzes grob schätzen (aus dem Anzeigenetz: Winkel quadratisch, Sehnenfehler linear) und vor
  // zu feinen Werten warnen: OpenCascade braucht je Dreieck rund 1,6 KB WASM-Speicher, über ~2 GB stürzt es ab
  // (gemessen: Flügel bei 1° → 1,1 Mio. Dreiecke, 200 s, 1,9 GB). true = weitermachen
  function expCheck(list) {
    const c = cfg().occ, tol = Math.max(0.001, +c.eTol || 0.02), ang = clamp(+c.eAng || 3, 1, 30) * Math.PI / 180;
    // Speicher wird je Körper wiederverwendet → Grenze gilt für den größten Körper, die Zeit für die Summe
    let est = 0, big = 0, bigName = '';
    for (const b of list) {
      if (!brepOk(b) || (b._exp && b._exp.brep === b.brep && b._exp.key === tol + '|' + clamp(+c.eAng || 3, 1, 30))) continue;
      const q = b._tq || { lin: tol, ang, n: b.F.length / 3 }, e = q.n * Math.max(1, (q.ang / ang) ** 2, q.lin / tol);
      est += e; if (e > big) { big = e; bigName = b.name; }
    }
    if (big * 0.0016 > 1500) { alert(T('Der Körper „') + bigName + T('“ würde mit diesen Werten etwa ') + (big / 1e6).toFixed(1) + T(' Mio. Dreiecke bekommen — dafür reicht der Speicher von OpenCascade nicht. Bitte den Winkel vergrößern (z. B. 3–5°) oder den Sehnenfehler (z. B. 0,02 mm).')); return false; }
    if (est < 3e5) return true;
    const mio = (est / 1e6).toFixed(1), mb = Math.round(est * 50 / 1e6), sec = Math.round(est * 65e-6);
    return confirm(T('Das Export-Netz wird etwa ') + mio + T(' Mio. Dreiecke groß (≈ ') + mb + T(' MB STL). Das Vernetzen dauert schätzungsweise ') + (sec >= 90 ? Math.round(sec / 60) + T(' min') : sec + T(' s')) + T(' (Körper für Körper, Fortschritt oben in der Ansicht). Fortfahren?'));
  }
  function expRun(fn) {   // Export-Vernetzung mit Fehlermeldung
    try { return fn(); }
    catch (e) { const m = e && e.message ? e.message : (typeof e === 'number' && MeshOCC.oc && MeshOCC.oc.getExceptionMessage ? String(MeshOCC.oc.getExceptionMessage(e)) : String(e)); alert(T('Export-Vernetzung fehlgeschlagen: ') + m + (/memory|bounds/i.test(m) ? T(' — Speicher voll: Projekt speichern und die Seite neu laden.') : '')); return null; }
  }
  // Netz aus der exakten Form erzeugen (jede CAD-Fläche eine Flächengruppe)
  function setShape(b, shape) {
    const bb = MeshOCC.bboxOf(shape), d = Math.hypot(bb.mx[0] - bb.mn[0], bb.mx[1] - bb.mn[1], bb.mx[2] - bb.mn[2]) || 1;
    const q = OCC_Q[cfg().occ.q] || OCC_Q.mid, lin = Math.max(1e-3, d * q[0]), r = MeshOCC.tess(shape, lin, q[1], true);
    if (!r.grp.length) throw new Error(T('Die Form ergibt keine Flächen.'));
    const w = weld(r.soup, weldTol(r.soup), r.grp, r.nrm);
    b.V = w.V; b.F = w.F; b.G = w.G; b.ng = r.nf; b.brep = shape; b.brepV = b.V; b.brepF = b.F; b.cad = true; touch(b);
    b.NC = w.NC; b.ncV = b.V; b.ncF = b.F;   // exakte Flächennormalen je Dreiecksecke (gültig solange V/F unverändert)
    b._tq = { lin, ang: q[1], n: r.grp.length };
    return b;
  }
  function bodyFromShape(name, shape, color) { const b = mkBody(name, new Float64Array(0), new Uint32Array(0), new Int32Array(0), color); return setShape(b, shape); }
  // Körper als Ganzes bewegen: Netz und (falls gültig) exakte Form gleich transformieren
  function xformBody(b, M, c, t, flip) {
    const ok = brepOk(b), nOk = b.NC && b.ncV === b.V && b.ncF === b.F;
    b.V = xform(b.V, null, M, c, t); if (flip) b.F = flipF(b.F);
    if (nOk) {   // Normalen drehen (Maßstab herausnormiert); Spiegeln vertauscht die Ecken 2 und 3 wie flipF
      const N = b.NC, out = new Float32Array(N.length);
      for (let i = 0; i < N.length; i += 3) {
        let x = N[i], y = N[i + 1], z = N[i + 2];
        if (M) { const X = M[0] * x + M[1] * y + M[2] * z, Y = M[3] * x + M[4] * y + M[5] * z, Z = M[6] * x + M[7] * y + M[8] * z, L = Math.hypot(X, Y, Z) || 1; x = X / L; y = Y / L; z = Z / L; }
        out[i] = x; out[i + 1] = y; out[i + 2] = z;
      }
      if (flip) for (let t = 0; t < out.length; t += 9) for (let k = 0; k < 3; k++) { const s = out[t + 3 + k]; out[t + 3 + k] = out[t + 6 + k]; out[t + 6 + k] = s; }
      b.NC = out; b.ncV = b.V; b.ncF = b.F;
    }
    if (ok) { try { b.brep = MeshOCC.transform(b.brep, M, c, t); b.brepV = b.V; b.brepF = b.F; } catch (e) { console.warn('3D-Bearbeitung: CAD-Transformation', e); } }
    touch(b);
  }
  // CAD-Operation mit Fehlermeldung; fn liefert true bei Erfolg
  function occTry(what, fn) {
    try { return fn(); }
    catch (e) { const m = e && e.message ? e.message : (typeof e === 'number' && MeshOCC.oc && MeshOCC.oc.getExceptionMessage ? String(MeshOCC.oc.getExceptionMessage(e)) : String(e)); alert(T(what) + ': ' + m); return false; }
  }

  // ---------- Netz-Grundlagen ---------------------------------------------------------------------
  function bboxV(V) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < V.length; i += 3) for (let k = 0; k < 3; k++) { const v = V[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    return { mn, mx };
  }
  function bboxUsed(b) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], V = b.V, F = b.F;
    for (let i = 0; i < F.length; i++) { const o = F[i] * 3; for (let k = 0; k < 3; k++) { const v = V[o + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; } }
    return { mn, mx };
  }
  const bbCenter = bb => [(bb.mn[0] + bb.mx[0]) / 2, (bb.mn[1] + bb.mx[1]) / 2, (bb.mn[2] + bb.mx[2]) / 2];
  const bbDiag = bb => Math.hypot(bb.mx[0] - bb.mn[0], bb.mx[1] - bb.mn[1], bb.mx[2] - bb.mn[2]);
  // Eckpunkte verschweißen: Dreieckssuppe (9 Werte je Dreieck) → indiziertes Netz. Gleiche
  // Rasterzelle (Kantenlänge tol) = derselbe Punkt; entartete Dreiecke fallen weg.
  function weld(soup, tol, grp, nrm) {
    const n = soup.length / 3, inv = 1 / tol, map = new Map(), idx = new Int32Array(n);
    const V = [], K = [];
    for (let i = 0; i < n; i++) {
      const x = soup[i * 3], y = soup[i * 3 + 1], z = soup[i * 3 + 2];
      const kx = Math.round(x * inv), ky = Math.round(y * inv), kz = Math.round(z * inv);
      const h = (Math.imul(kx, 73856093) ^ Math.imul(ky, 19349663) ^ Math.imul(kz, 83492791)) | 0;
      let lst = map.get(h), hit = -1;
      if (lst) for (const j of lst) if (K[j * 3] === kx && K[j * 3 + 1] === ky && K[j * 3 + 2] === kz) { hit = j; break; }
      if (hit < 0) { hit = V.length / 3; V.push(x, y, z); K.push(kx, ky, kz); if (lst) lst.push(hit); else map.set(h, [hit]); }
      idx[i] = hit;
    }
    const F = [], G = [], NC = nrm ? [] : null;
    for (let t = 0; t < n / 3; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      if (a === b || b === c || a === c) continue;
      F.push(a, b, c); G.push(grp ? grp[t] : 0);
      if (NC) for (let q = 0; q < 9; q++) NC.push(nrm[t * 9 + q]);
    }
    return { V: new Float64Array(V), F: new Uint32Array(F), G: new Int32Array(G), NC: NC ? new Float32Array(NC) : null };
  }
  // Deckkraft eines Körpers (1 = deckend); b.alpha bleibt beim Ausschalten erhalten (b.transp)
  function alphaOf(b) { return b.transp ? clamp(+b.alpha || 0.35, 0.05, 1) : 1; }
  function soupOf(b) {
    const V = b.V, F = b.F, out = new Float32Array(F.length * 3);
    for (let i = 0; i < F.length; i++) { const o = F[i] * 3; out[i * 3] = V[o]; out[i * 3 + 1] = V[o + 1]; out[i * 3 + 2] = V[o + 2]; }
    return out;
  }
  function triNormal(V, F, t, out) {
    const a = F[t * 3] * 3, b = F[t * 3 + 1] * 3, c = F[t * 3 + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2];
    out[0] = uy * wz - uz * wy; out[1] = uz * wx - ux * wz; out[2] = ux * wy - uy * wx;
    return out;   // Länge = doppelte Fläche
  }
  // Glatte Eckennormalen für die Darstellung: je Eckpunkt UND Flächengruppe gemittelt (flächengewichtet),
  // damit Freiformflächen rund wirken statt facettiert; Kanten zwischen Gruppen bleiben scharf.
  // Bei STL/OBJ-Gruppen zusätzlich Knickschutz (> 35° Abweichung → Dreiecksnormale).
  // Normalensummen je Eckpunkt und Flächengruppe (Schlüssel v·ng + g) + Dreiecksnormalen
  function groupNormals(b) {
    const V = b.V, F = b.F, G = b.G, nt = F.length / 3, TN = new Float64Array(nt * 3), tmp = [0, 0, 0];
    const acc = new Map(), ng = Math.max(1, b.ng);
    for (let t = 0; t < nt; t++) {
      triNormal(V, F, t, tmp); TN[t * 3] = tmp[0]; TN[t * 3 + 1] = tmp[1]; TN[t * 3 + 2] = tmp[2];
      for (let e = 0; e < 3; e++) {
        const k = F[t * 3 + e] * ng + G[t]; let a = acc.get(k);
        if (!a) acc.set(k, a = [0, 0, 0]);
        a[0] += tmp[0]; a[1] += tmp[1]; a[2] += tmp[2];
      }
    }
    return { acc, TN, ng };
  }
  // tangentialer Übergang (z. B. „Lücke füllen"): die Gruppennormalen am selben Eckpunkt weichen kaum ab
  const COS_TANG = Math.cos(15 * Math.PI / 180);
  function isTangent(a, c) {
    const la = Math.hypot(a[0], a[1], a[2]), lc = Math.hypot(c[0], c[1], c[2]);
    return la > 0 && lc > 0 && (a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / (la * lc) >= COS_TANG;
  }
  function cornerNormals(b) {
    const ex = b.NC && b.ncV === b.V && b.ncF === b.F ? b.NC : null;
    if (ex) {   // CAD-Volumen: exakte Flächennormalen; nur entartete Ecken (NaN) aus der Mittelung
      let bad = false; for (let i = 0; i < ex.length; i++) if (ex[i] !== ex[i]) { bad = true; break; }
      if (!bad) return ex;
      const avg = cornerNormalsAvg(b), out = Float32Array.from(ex);
      for (let i = 0; i < out.length; i += 3) if (out[i] !== out[i] || out[i + 1] !== out[i + 1] || out[i + 2] !== out[i + 2]) { out[i] = avg[i]; out[i + 1] = avg[i + 1]; out[i + 2] = avg[i + 2]; }
      return out;
    }
    return cornerNormalsAvg(b);
  }
  function cornerNormalsAvg(b) {
    const F = b.F, G = b.G, nt = F.length / 3, { acc, TN, ng } = groupNormals(b);
    // tangential anschließende Gruppen teilen sich die Normale — sonst zeigt die Darstellung dort eine Naht,
    // obwohl die Form glatt ist
    const vg = new Map(), merged = new Map();
    for (const k of acc.keys()) { const v = Math.floor(k / ng), l = vg.get(v); if (l) l.push(k); else vg.set(v, [k]); }
    for (const ks of vg.values()) {
      if (ks.length < 2) continue;
      for (const k of ks) {
        const s = acc.get(k).slice();
        for (const k2 of ks) if (k2 !== k && isTangent(acc.get(k), acc.get(k2))) { const o = acc.get(k2); s[0] += o[0]; s[1] += o[1]; s[2] += o[2]; }
        merged.set(k, s);
      }
    }
    for (const [k, s] of merged) acc.set(k, s);
    const out = new Float32Array(nt * 9), cosK = Math.cos((b.cad ? 60 : 35) * Math.PI / 180);
    for (let t = 0; t < nt; t++) {
      const tx = TN[t * 3], ty = TN[t * 3 + 1], tz = TN[t * 3 + 2], tl = Math.hypot(tx, ty, tz) || 1;
      for (let e = 0; e < 3; e++) {
        const a = acc.get(F[t * 3 + e] * ng + G[t]), L = Math.hypot(a[0], a[1], a[2]);
        let nx = tx / tl, ny = ty / tl, nz = tz / tl;
        if (L > 0) { const ax = a[0] / L, ay = a[1] / L, az = a[2] / L; if (ax * nx + ay * ny + az * nz >= cosK) { nx = ax; ny = ay; nz = az; } }
        const q = (t * 3 + e) * 3; out[q] = nx; out[q + 1] = ny; out[q + 2] = nz;
      }
    }
    return out;
  }
  // Kanten → Dreiecke (Schlüssel min·N+max)
  function edgeTris(b) {
    const F = b.F, NV = b.V.length / 3, m = new Map();
    for (let t = 0; t < F.length / 3; t++) for (let e = 0; e < 3; e++) {
      const a = F[t * 3 + e], c = F[t * 3 + (e + 1) % 3], k = a < c ? a * NV + c : c * NV + a;
      const l = m.get(k); if (l) l.push(t); else m.set(k, [t]);
    }
    return m;
  }
  // Flächengruppen aus dem Knickwinkel: Nachbardreiecke über eine Kante mit genau zwei
  // Dreiecken gehören zusammen, solange ihre Normalen weniger als `ang` Grad abweichen.
  function autoGroups(b, ang) {
    const F = b.F, nt = F.length / 3, N = new Float64Array(nt * 3), tmp = [0, 0, 0];
    for (let t = 0; t < nt; t++) { triNormal(b.V, F, t, tmp); const L = Math.hypot(tmp[0], tmp[1], tmp[2]) || 1; N[t * 3] = tmp[0] / L; N[t * 3 + 1] = tmp[1] / L; N[t * 3 + 2] = tmp[2] / L; }
    const et = edgeTris(b), NV = b.V.length / 3, cosT = Math.cos(clamp(+ang || 25, 0.5, 179) * Math.PI / 180);
    const G = new Int32Array(nt).fill(-1); let ng = 0; const st = [];
    for (let s = 0; s < nt; s++) {
      if (G[s] >= 0) continue;
      G[s] = ng; st.push(s);
      while (st.length) {
        const t = st.pop();
        for (let e = 0; e < 3; e++) {
          const a = F[t * 3 + e], c = F[t * 3 + (e + 1) % 3], l = et.get(a < c ? a * NV + c : c * NV + a);
          if (!l || l.length !== 2) continue;
          const u = l[0] === t ? l[1] : l[0];
          if (G[u] >= 0) continue;
          if (N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2] < cosT) continue;
          G[u] = ng; st.push(u);
        }
      }
      ng++;
    }
    return { G, ng };
  }
  // unbenutzte Eckpunkte entfernen
  function compact(V, F) {
    const nv = V.length / 3, map = new Int32Array(nv).fill(-1); let n = 0;
    for (let i = 0; i < F.length; i++) if (map[F[i]] < 0) map[F[i]] = n++;
    if (n === nv) return { V, F };
    const V2 = new Float64Array(n * 3), F2 = new Uint32Array(F.length);
    for (let i = 0; i < nv; i++) if (map[i] >= 0) { V2[map[i] * 3] = V[i * 3]; V2[map[i] * 3 + 1] = V[i * 3 + 1]; V2[map[i] * 3 + 2] = V[i * 3 + 2]; }
    for (let i = 0; i < F.length; i++) F2[i] = map[F[i]];
    return { V: V2, F: F2 };
  }
  // Kennzahlen: Dreiecke, offene / mehrfach genutzte Kanten, Volumen, Oberfläche
  function stats(b) {
    if (b._stats) return b._stats;
    const et = edgeTris(b); let open = 0, nonman = 0;
    for (const l of et.values()) { if (l.length === 1) open++; else if (l.length > 2) nonman++; }
    const V = b.V, F = b.F; let vol = 0, area = 0; const tmp = [0, 0, 0];
    for (let t = 0; t < F.length / 3; t++) {
      const a = F[t * 3] * 3, c = F[t * 3 + 1] * 3, d = F[t * 3 + 2] * 3;
      vol += V[a] * (V[c + 1] * V[d + 2] - V[c + 2] * V[d + 1]) - V[a + 1] * (V[c] * V[d + 2] - V[c + 2] * V[d]) + V[a + 2] * (V[c] * V[d + 1] - V[c + 1] * V[d]);
      triNormal(V, F, t, tmp); area += Math.hypot(tmp[0], tmp[1], tmp[2]) / 2;
    }
    return (b._stats = { ntri: F.length / 3, open, nonman, vol: vol / 6, area });
  }
  // Fläche(n) gs eines Körpers: Mittelpunkt (flächengewichtet), Normale, Fläche, Eckpunkte
  function faceFrame(b, gs) {
    const V = b.V, F = b.F, G = b.G, tmp = [0, 0, 0], n = [0, 0, 0], c = [0, 0, 0]; let A = 0;
    const vs = new Set();
    for (let t = 0; t < G.length; t++) {
      if (!gs.has(G[t])) continue;
      triNormal(V, F, t, tmp); const a2 = Math.hypot(tmp[0], tmp[1], tmp[2]);
      n[0] += tmp[0]; n[1] += tmp[1]; n[2] += tmp[2];
      for (let e = 0; e < 3; e++) { const o = F[t * 3 + e]; vs.add(o); for (let k = 0; k < 3; k++) c[k] += V[o * 3 + k] * a2 / 3; }
      A += a2;
    }
    if (!(A > 0)) return null;
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    // Ebenheit: größter Abstand der Eckpunkte zur Ausgleichsebene
    const C = c.map(x => x / A), N = n.map(x => x / L); let dev = 0;
    for (const o of vs) dev = Math.max(dev, Math.abs((V[o * 3] - C[0]) * N[0] + (V[o * 3 + 1] - C[1]) * N[1] + (V[o * 3 + 2] - C[2]) * N[2]));
    return { c: C, n: N, area: A / 2, verts: vs, dev, flat: L / A };   // flat = 1 bei ebener Fläche
  }
  // ---------- Drehungen ----------
  function rotAxis(u, ang) {   // Rodrigues, u Einheitsvektor, ang rad → 3×3 zeilenweise
    const c = Math.cos(ang), s = Math.sin(ang), C = 1 - c, [x, y, z] = u;
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
            y * x * C + z * s, c + y * y * C, y * z * C - x * s,
            z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  }
  function arcRot(a, b) {      // kürzeste Drehung, die a auf b dreht (beide Einheitsvektoren)
    const d = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
    let u = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], L = Math.hypot(u[0], u[1], u[2]);
    if (L < 1e-9) {
      if (d > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
      u = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]]; L = Math.hypot(u[0], u[1], u[2]);
      return rotAxis(u.map(x => x / L), Math.PI);
    }
    return rotAxis(u.map(x => x / L), Math.atan2(L, d));
  }
  // v' = M·(v − c) + c + t für die Eckpunkte idx (null = alle), neues Feld
  function xform(V, idx, M, c, t) {
    const out = Float64Array.from(V); c = c || [0, 0, 0]; t = t || [0, 0, 0];
    const one = o => {
      const x = V[o] - c[0], y = V[o + 1] - c[1], z = V[o + 2] - c[2];
      out[o] = (M ? M[0] * x + M[1] * y + M[2] * z : x) + c[0] + t[0];
      out[o + 1] = (M ? M[3] * x + M[4] * y + M[5] * z : y) + c[1] + t[1];
      out[o + 2] = (M ? M[6] * x + M[7] * y + M[8] * z : z) + c[2] + t[2];
    };
    if (idx) for (const i of idx) one(i * 3); else for (let o = 0; o < V.length; o += 3) one(o);
    return out;
  }
  function flipF(F) { const out = Uint32Array.from(F); for (let t = 0; t < out.length; t += 3) { const s = out[t + 1]; out[t + 1] = out[t + 2]; out[t + 2] = s; } return out; }

  // ---------- Laden ---------------------------------------------------------------------------------
  function setInfo(html, bad) { const el = document.getElementById('meshedInfo'); if (el) { el.innerHTML = html; el.style.color = bad ? '#f88' : ''; } }
  const nextFrame = () => new Promise(r => { let d = false; const go = () => { if (!d) { d = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 60); });
  // Feinheit wie im Reiter „3D-Modell" (feiner = OpenCascade sehr langsam); glatt wirken die
  // Freiformflächen über cornerNormals in der Darstellung
  const CAD_MESH = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0005, angularDeflection: 0.2 };
  function weldTol(soup) { const bb = bboxV(soup); return Math.max(bbDiag(bb) * 1e-7, 1e-6); }
  // STEP/IGES: jedes Volumen ein Körper, jede CAD-Fläche (brep_faces) eine Flächengruppe
  async function parseOCCBodies(file) {
    const O = await MeshOCC.ready(), sh = O.readSTEP(new Uint8Array(await file.arrayBuffer())), L = O.splitBodies(sh);
    if (!L.length) throw new Error(T('Die Datei enthält keine Flächen (nur Kurven/Punkte?).'));
    const base = file.name.replace(/\.[^.]+$/, '');
    return L.map((s, k) => bodyFromShape(L.length > 1 ? base + ' ' + (k + 1) : base, s));
  }
  async function parseCADBodies(file, ext) {
    if ((ext === 'stp' || ext === 'step') && OCC()) {
      try { return await parseOCCBodies(file); } catch (e) { console.warn('3D-Bearbeitung: STEP über OpenCascade nicht lesbar, Netz-Import:', e); }
    }
    if (!(window.Model3D && Model3D.occtReady)) throw new Error(T('STEP-/IGES-Import ist in dieser Ausgabe nicht enthalten.'));
    const occt = await Model3D.occtReady(), data = new Uint8Array(await file.arrayBuffer());
    const r = (ext === 'igs' || ext === 'iges') ? occt.ReadIgesFile(data, CAD_MESH) : occt.ReadStepFile(data, CAD_MESH);
    if (!r || !r.success) throw new Error(T('STEP-/IGES-Datei nicht lesbar.'));
    const out = [], base = file.name.replace(/\.[^.]+$/, '');
    (r.meshes || []).forEach((m, k) => {
      const P = m.attributes && m.attributes.position && m.attributes.position.array, I = m.index && m.index.array;
      if (!P || !I || I.length < 3) return;
      const nt = I.length / 3, soup = new Float32Array(I.length * 3), grp = new Int32Array(nt);
      for (let i = 0; i < I.length; i++) { const j = I[i] * 3; soup[i * 3] = P[j]; soup[i * 3 + 1] = P[j + 1]; soup[i * 3 + 2] = P[j + 2]; }
      const bf = Array.isArray(m.brep_faces) ? m.brep_faces : [];
      if (bf.length) { grp.fill(-1); bf.forEach((f, j) => { for (let t = Math.max(0, f.first); t <= Math.min(nt - 1, f.last); t++) grp[t] = j; }); let nx = bf.length; for (let t = 0; t < nt; t++) if (grp[t] < 0) grp[t] = nx; }
      const w = weld(soup, weldTol(soup), grp);
      if (!w.F.length) return;
      const nm = (m.name && String(m.name).trim()) || ((r.meshes.length > 1) ? base + ' ' + (k + 1) : base);
      const b = mkBody(nm, w.V, w.F, w.G);
      // ohne CAD-Flächen oder facettiertes STEP (überwiegend Einzeldreiecke, z. B. aus einem Netz exportiert): Knickwinkel
      const faceted = bf.length > 0.3 * nt;
      if (!bf.length || faceted) { const ag = autoGroups(b, cfg().angle); b.G = ag.G; b.ng = ag.ng; }
      b.cad = !!bf.length && !faceted;
      out.push(b);
    });
    if (!out.length) throw new Error(T('Die Datei enthält keine Flächen (nur Kurven/Punkte?).'));
    return out;
  }
  async function loadFiles(files) {
    files = Array.from(files || []); if (!files.length) return;
    if (!(window.Model3D && Model3D.parseFile)) { alert(T('Die 3D-Bearbeitung braucht den Reiter „3D-Modell" (Funktion model3d).')); return; }
    const errs = [], added = [];
    for (const f of files) {
      setInfo(T('Lädt ') + f.name + ' (' + (f.size / 1e6).toFixed(1) + ' MB) …'); await nextFrame();
      try {
        const ext = ((f.name || '').split('.').pop() || '').toLowerCase();
        if (/^(stp|step|igs|iges)$/.test(ext)) { for (const b of await parseCADBodies(f, ext)) added.push(b); continue; }
        const soup = await Model3D.parseFile(f, []);
        if (!soup || soup.length < 9) throw new Error(T('Keine Dreiecke gefunden.'));
        const w = weld(soup, weldTol(soup)), b = mkBody(f.name.replace(/\.[^.]+$/, ''), w.V, w.F, w.G);
        const ag = autoGroups(b, cfg().angle); b.G = ag.G; b.ng = ag.ng;
        added.push(b);
      } catch (e) { errs.push(f.name + ': ' + (e && e.message ? e.message : e)); }
    }
    if (added.length) {
      snap();
      const fresh = !E.bodies.length;
      added.forEach((b, i) => { b.color = PALETTE[(E.bodies.length + i) % PALETTE.length]; });
      E.bodies.push(...added);
      if (fresh) resetCam();
    }
    changed(true);
    if (errs.length) setInfo(T('Fehler beim Laden: ') + errs.join(' · '), true);
  }
  async function pickFiles() {
    const ext = ['.stl', '.obj', '.stp', '.step', '.igs', '.iges'];
    if (App.FS_SUPPORTED && window.showOpenFilePicker) {
      try {
        const opts = Object.assign({}, App.pickerOpts ? App.pickerOpts('ldStl', '.stl') : {}, { multiple: true,
          types: [{ description: T('3D-Modelle (STL, OBJ, STEP, IGES)'), accept: { 'model/stl': ext } }] });
        const hs = await window.showOpenFilePicker(opts);
        if (App.markDirUsed) App.markDirUsed('ldStl', '.stl');
        return Promise.all(hs.map(h => h.getFile()));
      } catch (e) { if (e && e.name === 'AbortError') return null; }
    }
    return new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = ext.join(',');
      inp.onchange = () => res(inp.files.length ? Array.from(inp.files) : null); inp.click();
    });
  }
  // aus dem Reiter „3D-Modell" übernehmen: Baugruppe → je Teil ein Körper (Weltlage), sonst das Modell
  function fromModel3D() {
    const M = window.Model3D && Model3D.state;
    if (!M || !M.verts) { alert(T('Im Reiter „3D-Modell" ist kein Modell geladen.')); return; }
    const src = (M.parts && M.parts.length && M.partVerts && M.partVerts.length === M.parts.length)
      ? M.parts.map((p, i) => ({ name: (p.name || T('Teil')).replace(/\.[^.]+$/, ''), v: M.partVerts[i] }))
      : [{ name: (M.name || 'modell').replace(/\.[^.]+$/, ''), v: M.verts }];
    snap(); const fresh = !E.bodies.length;
    for (const s of src) {
      const w = weld(s.v, weldTol(s.v)), b = mkBody(s.name, w.V, w.F, w.G);
      const ag = autoGroups(b, cfg().angle); b.G = ag.G; b.ng = ag.ng; E.bodies.push(b);
    }
    if (fresh) resetCam();
    changed(true);
  }
  // an den Reiter „3D-Modell" übergeben (als Baugruppe oder ein Modell)
  async function toModel3D(asParts) {
    const list = E.bodies.filter(b => !b.hidden && b.F.length);
    if (!list.length) { alert(T('Keine sichtbaren Körper.')); return; }
    if (!(window.Model3D && Model3D.loadMesh)) { alert(T('Reiter „3D-Modell" ist in dieser Ausgabe nicht enthalten.')); return; }
    if (!expCheck(list)) return;
    const xl = await expListAsync(list); if (!xl) return;
    if (asParts && xl.length > 1 && Model3D.loadParts) Model3D.loadParts(xl.map(b => ({ name: b.name, verts: soupOf(b), color: b.color })));
    else Model3D.loadMesh(mergedSoup(xl), xl.length === 1 ? xl[0].name : T('Baugruppe'));
    const btn = document.querySelector('#tabs button[data-view="model"], button[data-view="model"]');
    if (btn) btn.click();
  }
  // an „Rumpf" übergeben: Seiten-/Draufsicht, Dickenlinie und Querschnitte aus den gewählten (sonst allen sichtbaren)
  // Körpern ableiten (Anzeigenetz genügt) — ersetzt Umrisse und Spanten dort.
  function toRumpfPro() {
    if (!(window.RumpfPro && RumpfPro.fromMesh)) { alert(T('Reiter „Rumpf" ist in dieser Ausgabe nicht enthalten.')); return; }
    const sel = cfg().mode === 'body' ? selBodies().filter(b => !b.hidden && b.F.length) : [];
    const all = sel.length ? sel : E.bodies.filter(b => !b.hidden && b.F.length);
    const molds = E.bodies.filter(b => isMold(b) && b.F.length), list = all.filter(b => !isMold(b) && !(molds.length && b.rpCanopy));   // Formteile zählen auch ausgeblendet; die Haube kommt dann aus der Form
    if (!list.length) { alert(T('Keine sichtbaren Körper.')); return; }
    if (!confirm(T('Umrisse und Spanten im Reiter „Rumpf" durch die Ableitung aus ') + list.length + T(' Körper(n) ersetzen?') +
      (molds.length ? '\n' + T('Haubenform: ') + molds.map(b => b.name).join(', ') : ''))) return;
    let rep;
    const rp = cfg().rp, gl = Math.max(0, +rp.glass || 0);
    try { rep = window.RumpfPro.fromMesh(mergedSoup(list), Object.assign({}, rp, molds.length ? { mold: molds.map(b => offsetSoup(b, gl)), glass: gl } : {})); }
    catch (e) { alert(T('Ableitung fehlgeschlagen: ') + (e && e.message || e)); return; }
    E.rpRep = rep;
    const btn = document.querySelector('[data-view="rpro"]');
    if (btn) btn.click();
    setTimeout(() => alert(T('Rumpf übernommen: Länge ') + rep.len + ' mm, ' + rep.nFr + T(' Spanten, Umrisspunkte oben/unten/Breite ') + rep.pts.join('/') +
      T(', größte Abweichung Umrisse ') + Math.max(rep.errs.top, rep.errs.bot, rep.errs.w).toFixed(2) + ' mm' +
      (rep.fin ? T('. Seitenleitwerk an ') + rep.fin + T(' Stationen abgetrennt') : '') + (rep.wing ? T('. Flächenanschluss an ') + rep.wing + T(' Stationen entfernt') : '') + T(', größte Abweichung Rumpf ') + rep.dev.toFixed(1) + ' mm' +
      (rep.kh ? T('. Haubenlinie aus der Ausschnittkante: X ') + rep.kh.x0 + '–' + rep.kh.x1 + ' mm, ' + rep.kh.n + T(' Punkte, Haubenstärke ') + gl + ' mm' : (molds.length ? T('. Keine Ausschnittkante gefunden') : '')) +
      (rep.canZones && rep.canZones.length ? T('. Haube überbrückt bei X ') + rep.canZones.map(z => z.join('–')).join(', ') + ' mm' : (cfg().rp.canopy ? T('. Keinen Haubenabsatz gefunden') : '')) + '.'), 50);
  }
  // Haubenform (Laminierform/Negativ des Tiefziehklotzes): Name enthält Form/Klotz/Laminier/Negativ, sonst per Häkchen
  function isMold(b) { return b.rpMold != null ? !!b.rpMold : /form|klotz|lamin|negativ/i.test(b.name || ''); }
  // Dreiecke des Körpers je Eckpunkt um t entlang der (flächengewichteten) Eckpunktnormale in die Wand verschoben:
  // Hohlraum der Form = Tiefziehklotz = Haube innen -> versetzt = Haube außen.
  function offsetSoup(b, t) {
    const V = b.V, F = b.F, N = new Float64Array(V.length), n = [0, 0, 0]; let vol = 0;
    for (let f = 0; f < F.length / 3; f++) {
      triNormal(V, F, f, n);
      const a = F[f * 3] * 3, c = F[f * 3 + 1] * 3, d = F[f * 3 + 2] * 3;
      vol += (V[a] * (V[c + 1] * V[d + 2] - V[c + 2] * V[d + 1]) - V[a + 1] * (V[c] * V[d + 2] - V[c + 2] * V[d]) + V[a + 2] * (V[c] * V[d + 1] - V[c + 1] * V[d])) / 6;
      for (const v of [a, c, d]) { N[v] += n[0]; N[v + 1] += n[1]; N[v + 2] += n[2]; }
    }
    const sg = vol >= 0 ? 1 : -1, out = new Float32Array(F.length * 3);
    for (let i = 0; i < F.length; i++) {
      const o = F[i] * 3, L = Math.hypot(N[o], N[o + 1], N[o + 2]) || 1, k = t * sg / L;
      out[i * 3] = V[o] - N[o] * k; out[i * 3 + 1] = V[o + 1] - N[o + 1] * k; out[i * 3 + 2] = V[o + 2] - N[o + 2] * k;
    }
    return out;
  }
  // Kabinenhaube aus der Negativform als eigener Körper (RumpfPro.canopyFromMold): Formhohlraum = Haube innen, außen um die
  // Haubenstärke versetzt; auf Wunsch an der ersten Kante des Haubenausschnitts im Rumpf beschnitten.
  function canopyFromMold() {
    if (!(window.RumpfPro && RumpfPro.canopyFromMold)) { alert(T('Dafür wird der Reiter „Rumpf" gebraucht (in dieser Ausgabe nicht enthalten).')); return; }
    const c = cfg(), molds = E.bodies.filter(b => isMold(b) && b.F.length);
    if (!molds.length) { alert(T('Erst die Teile der Haubenform ankreuzen.')); return; }
    const fus = E.bodies.filter(b => !isMold(b) && !b.rpCanopy && !b.hidden && b.F.length);   // Rumpf: Lage/Achsen, Ausschnittkante
    if (c.kh.trim && !fus.length) { alert(T('Zum Beschneiden an der Ausschnittkante die Rumpfteile einblenden — oder „an der Ausschnittkante beschneiden" abschalten.')); return; }
    let r;
    try { r = window.RumpfPro.canopyFromMold(fus.length ? mergedSoup(fus) : null, molds.map(soupOf), Object.assign({ t: Math.max(0, +c.rp.glass || 0), trim: !!c.kh.trim }, { len: c.rp.len, up: c.rp.up, upSign: c.rp.upSign, nose: c.rp.nose })); }
    catch (e) { alert(T('Haube nicht ableitbar: ') + T(e && e.message || String(e))); return; }
    if (!r || r.err) { alert(T('Haube nicht ableitbar: ') + (r ? r.err : '')); return; }
    snap();
    const old = E.bodies.findIndex(b => b.rpCanopy);
    const w = weld(r.soup, weldTol(r.soup)), b = mkBody(T('Kabinenhaube'), w.V, w.F, w.G, '#9fd3ff');
    const ag = autoGroups(b, c.angle); b.G = ag.G; b.ng = ag.ng; b.rpCanopy = true; b.transp = !!c.kh.transp; b.alpha = c.kh.alpha;
    if (old >= 0) E.bodies.splice(old, 1, b); else E.bodies.push(b);
    if (c.kh.hideMold) molds.forEach(m => { m.hidden = true; });
    E.khRep = r; changed(true); if (App.buildSidebar) App.buildSidebar();
  }
  function mergedSoup(list) {
    const parts = list.map(soupOf); let n = 0; for (const p of parts) n += p.length;
    const out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // ---------- Auswahl ---------------------------------------------------------------------------------
  function selBodies() {   // Körper, auf die Körper-Werkzeuge wirken
    if (cfg().mode === 'face') return [...E.selF.keys()].map(byId).filter(Boolean);
    return [...E.selB].map(byId).filter(Boolean);
  }
  function selCount() { if (cfg().mode === 'face') { let n = 0; for (const s of E.selF.values()) n += s.size; return n; } return E.selB.size; }
  function clearSel() { E.selB.clear(); E.selF.clear(); }
  function clickSelect(hit, add) {
    const c = cfg();
    if (!hit) { if (!add) clearSel(); return; }
    const b = hit.b;
    if (c.mode === 'face') {
      const g = b.G[hit.t];
      if (!add) { const had = E.selF.size === 1 && E.selF.get(b.id) && E.selF.get(b.id).size === 1 && E.selF.get(b.id).has(g); clearSel(); if (had) return; }
      let s = E.selF.get(b.id); if (!s) E.selF.set(b.id, s = new Set());
      if (s.has(g)) { s.delete(g); if (!s.size) E.selF.delete(b.id); } else s.add(g);
    } else {
      if (!add) { const had = E.selB.size === 1 && E.selB.has(b.id); clearSel(); if (had) return; }
      if (E.selB.has(b.id)) E.selB.delete(b.id); else E.selB.add(b.id);
    }
  }
  // Mittelpunkt der Auswahl (Flächen: flächengewichtet, Körper: Bbox-Mitte aller)
  function selCenter() {
    if (cfg().mode === 'face') {
      let A = 0; const c = [0, 0, 0];
      for (const [id, gs] of E.selF) { const f = faceFrame(byId(id), gs); if (f) { for (let k = 0; k < 3; k++) c[k] += f.c[k] * f.area; A += f.area; } }
      return A > 0 ? c.map(x => x / A) : null;
    }
    const bs = selBodies(); if (!bs.length) return null;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const b of bs) { const bb = bboxUsed(b); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], bb.mn[k]); mx[k] = Math.max(mx[k], bb.mx[k]); } }
    return bbCenter({ mn, mx });
  }

  // ---------- Körper-Werkzeuge --------------------------------------------------------------------------
  function needBodies() { const bs = selBodies(); if (!bs.length) { alert(T('Erst einen Körper auswählen (anklicken).')); return null; } return bs; }
  function pivotFor(b, mode) {
    if (mode === 'origin') return [0, 0, 0];
    if (mode === 'sel') return selCenter() || bbCenter(bboxUsed(b));
    return bbCenter(bboxUsed(b));
  }
  function opMove(dv) {
    const bs = needBodies(); if (!bs) return; snap();
    for (const b of bs) xformBody(b, null, null, dv);
    changed(false);
  }
  function opRotate(axis, deg, piv) {
    const bs = needBodies(); if (!bs) return; snap();
    const u = [0, 0, 0]; u[AX[axis]] = 1; const M = rotAxis(u, deg * Math.PI / 180);
    const pc = piv === 'sel' ? selCenter() : null;
    for (const b of bs) xformBody(b, M, pc || pivotFor(b, piv));
    changed(false);
  }
  function opScale(f, piv) {
    const bs = needBodies(); if (!bs) return;
    if (!(f[0] > 0 && f[1] > 0 && f[2] > 0)) { alert(T('Faktoren müssen größer 0 sein.')); return; }
    snap();
    const pc = piv === 'sel' ? selCenter() : null;
    const uni = f[0] === f[1] && f[1] === f[2];   // ungleichmäßig gibt es nur für Netze
    for (const b of bs) { const M = [f[0], 0, 0, 0, f[1], 0, 0, 0, f[2]], c = pc || pivotFor(b, piv); if (uni) xformBody(b, M, c); else { b.V = xform(b.V, null, M, c); touch(b); } }
    changed(false);
  }
  function opMirror(axis, piv) {
    const bs = needBodies(); if (!bs) return; snap();
    const M = [1, 0, 0, 0, 1, 0, 0, 0, 1]; M[AX[axis] * 4] = -1;
    const pc = piv === 'sel' ? selCenter() : null;
    for (const b of bs) xformBody(b, M, pc || pivotFor(b, piv), null, true);   // Spiegeln dreht die Umlaufrichtung
    changed(false);
  }
  function opFlip() {
    const bs = needBodies(); if (!bs) return; snap();
    for (const b of bs) { const ok = brepOk(b); b.F = flipF(b.F); if (ok) { b.brep = MeshOCC.reverse(b.brep); b.brepF = b.F; } touch(b); }
    changed(false);
  }
  function opToOrigin(kind) {
    const bs = needBodies(); if (!bs) return; snap();
    for (const b of bs) {
      const bb = bboxUsed(b), c = bbCenter(bb);
      const t = kind === 'floor' ? [-c[0], -bb.mn[1], -c[2]] : [-c[0], -c[1], -c[2]];
      xformBody(b, null, null, t);
    }
    changed(false);
  }
  function opDuplicate() {
    const bs = needBodies(); if (!bs) return; snap();
    clearSel();
    for (const b of bs) {
      const c = mkBody(b.name + ' ' + T('Kopie'), b.V, b.F, b.G); c.cad = b.cad;
      if (brepOk(b)) { c.brep = b.brep; c.brepV = b.V; c.brepF = b.F; }
      E.bodies.push(c); E.selB.add(c.id);
    }
    if (cfg().mode !== 'body') cfg().mode = 'body';
    changed(true);
  }
  function opDelete() {
    const c = cfg();
    if (c.mode === 'face') return opDeleteFaces();
    const bs = needBodies(); if (!bs) return; snap();
    const ids = new Set(bs.map(b => b.id)); E.bodies = E.bodies.filter(b => !ids.has(b.id)); clearSel();
    changed(true);
  }
  // in zusammenhängende Einzelteile trennen
  function opSplit() {
    const bs = needBodies(); if (!bs) return; snap(); let made = 0;
    for (const b of bs) {
      if (brepOk(b)) {   // CAD: je Volumen ein Körper
        const L = MeshOCC.splitBodies(b.brep); if (L.length < 2) continue;
        const nb = []; if (!occTry('Trennen', () => { L.forEach((s, k) => nb.push(bodyFromShape(b.name + ' ' + (k + 1), s, k ? null : b.color))); return true; })) continue;
        E.bodies.splice(E.bodies.indexOf(b), 1, ...nb); made += nb.length; continue;
      }
      const nv = b.V.length / 3, par = new Int32Array(nv); for (let i = 0; i < nv; i++) par[i] = i;
      const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      const F = b.F; for (let t = 0; t < F.length; t += 3) { const a = find(F[t]), c = find(F[t + 1]), d = find(F[t + 2]); par[c] = a; par[find(d)] = a; }
      const comp = new Map();
      for (let t = 0; t < F.length / 3; t++) { const r = find(F[t * 3]); let l = comp.get(r); if (!l) comp.set(r, l = []); l.push(t); }
      if (comp.size < 2) continue;
      const pieces = [...comp.values()].sort((x, y) => y.length - x.length), at = E.bodies.indexOf(b), nb = [];
      pieces.forEach((ts, k) => {
        const F2 = new Uint32Array(ts.length * 3), G2 = new Int32Array(ts.length);
        ts.forEach((t, i) => { F2[i * 3] = F[t * 3]; F2[i * 3 + 1] = F[t * 3 + 1]; F2[i * 3 + 2] = F[t * 3 + 2]; G2[i] = b.G[t]; });
        const cm = compact(b.V, F2), nbk = mkBody(b.name + ' ' + (k + 1), cm.V, cm.F, G2, k ? null : b.color); nbk.cad = b.cad; nb.push(nbk);
      });
      E.bodies.splice(at, 1, ...nb); made += nb.length;
    }
    clearSel(); changed(true);
    if (!made) alert(T('Die gewählten Körper bestehen jeweils nur aus einem zusammenhängenden Teil.'));
  }
  // Vereinen: optional ebene Berührflächen (Stirnkappen) beider Seiten entfernen, dann verschweißen
  function planarFaces(b, tol) {
    const out = [];
    for (let g = 0; g < b.ng; g++) { const f = faceFrame(b, new Set([g])); if (f && f.dev <= tol && f.flat > 0.995) { f.g = g; f.bb = bboxOfVerts(b.V, f.verts); out.push(f); } }
    return out;
  }
  function bboxOfVerts(V, vs) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const o of vs) for (let k = 0; k < 3; k++) { const v = V[o * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; } return { mn, mx }; }
  function opMerge(stripCaps) {
    const bs = needBodies(); if (!bs) return;
    if (bs.length < 2) { alert(T('Zum Vereinen mindestens zwei Körper auswählen (Umschalt+Klick).')); return; }
    if (stripCaps && bs.every(brepOk)) return occBoolean('fuse', bs);
    snap();
    let tol = 0; for (const b of bs) tol = Math.max(tol, bbDiag(bboxUsed(b)));
    tol = Math.max(0.02, tol * 2e-4);
    const drop = bs.map(() => new Set()); let removed = 0;
    if (stripCaps) {
      const pf = bs.map(b => planarFaces(b, tol));
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) for (const fa of pf[i]) for (const fb of pf[j]) {
        if (fa.n[0] * fb.n[0] + fa.n[1] * fb.n[1] + fa.n[2] * fb.n[2] > -0.995) continue;
        if (Math.abs((fb.c[0] - fa.c[0]) * fa.n[0] + (fb.c[1] - fa.c[1]) * fa.n[1] + (fb.c[2] - fa.c[2]) * fa.n[2]) > tol) continue;
        // nur deckungsgleiche Flächen (gleiche Größe, gleiche Mitte) — ein T-Stoß an einer größeren Fläche hinterließe sonst ein Loch
        if (Math.abs(fa.area - fb.area) > 0.01 * Math.max(fa.area, fb.area) || V3.len(V3.sub(fa.c, fb.c)) > Math.max(tol, 0.01 * Math.sqrt(fa.area))) continue;
        let ov = true; for (let k = 0; k < 3; k++) if (fa.bb.mx[k] < fb.bb.mn[k] - tol || fb.bb.mx[k] < fa.bb.mn[k] - tol) ov = false;
        if (!ov) continue;
        drop[i].add(fa.g); drop[j].add(fb.g); removed += 2;
      }
    }
    const soups = [], grps = []; let goff = 0;
    bs.forEach((b, k) => {
      const keep = []; for (let t = 0; t < b.G.length; t++) if (!drop[k].has(b.G[t])) keep.push(t);
      const s = new Float32Array(keep.length * 9), g = new Int32Array(keep.length);
      keep.forEach((t, i) => { for (let e = 0; e < 3; e++) { const o = b.F[t * 3 + e] * 3; s[i * 9 + e * 3] = b.V[o]; s[i * 9 + e * 3 + 1] = b.V[o + 1]; s[i * 9 + e * 3 + 2] = b.V[o + 2]; } g[i] = b.G[t] + goff; });
      soups.push(s); grps.push(g); goff += b.ng;
    });
    let n = 0; for (const s of soups) n += s.length;
    const soup = new Float32Array(n), grp = new Int32Array(n / 9); let o = 0, og = 0;
    soups.forEach((s, k) => { soup.set(s, o); grp.set(grps[k], og); o += s.length; og += grps[k].length; });
    const w = weld(soup, Math.max(1e-5, tol * 0.05), grp);
    const at = E.bodies.indexOf(bs[0]), ids = new Set(bs.map(b => b.id));
    const m = mkBody(bs[0].name + ' + ' + (bs.length - 1), w.V, w.F, w.G, bs[0].color); m.cad = bs.every(b => b.cad);
    E.bodies = E.bodies.filter(b => !ids.has(b.id)); E.bodies.splice(Math.min(at, E.bodies.length), 0, m);
    clearSel(); E.selB.add(m.id); cfg().mode = 'body';
    changed(true);
    const st = stats(m);
    if (App.toast) App.toast(T('Vereint') + (stripCaps ? ' · ' + T('Berührflächen entfernt: ') + removed : '') + ' · ' + T('offene Kanten: ') + st.open);
  }
  // CAD-Boolean: fuse = vereinen, cut = ersten minus die übrigen, common = Schnittmenge
  function occBoolean(kind, bs) {
    bs = bs || needBodies(); if (!bs) return;
    if (bs.length < 2) { alert(T('Mindestens zwei Körper auswählen (Umschalt+Klick).')); return; }
    if (!bs.every(brepOk)) { alert(T('Nur mit CAD-Volumenkörpern (aus STEP geladen und nicht als Netz bearbeitet).')); return; }
    const L = bs.slice().sort((x, y) => E.bodies.indexOf(x) - E.bodies.indexOf(y)), S = L.map(b => b.brep);
    let m = null;
    if (!occTry(kind === 'fuse' ? 'Vereinen' : kind === 'cut' ? 'Abziehen' : 'Schnittmenge', () => {
      let s = S[0];
      if (kind === 'fuse') s = MeshOCC.fuseAll(S);
      else for (let i = 1; i < S.length; i++) s = kind === 'cut' ? MeshOCC.cut(s, S[i]) : MeshOCC.common(s, S[i]);
      m = bodyFromShape(L[0].name + (kind === 'fuse' ? ' + ' + (L.length - 1) : kind === 'cut' ? ' − ' + (L.length - 1) : ' ∩ ' + (L.length - 1)), s, L[0].color);
      return true;
    })) return;
    snap();
    const at = E.bodies.indexOf(L[0]), ids = new Set(L.map(b => b.id));
    E.bodies = E.bodies.filter(b => !ids.has(b.id)); E.bodies.splice(Math.min(at, E.bodies.length), 0, m);
    clearSel(); E.selB.add(m.id); cfg().mode = 'body';
    changed(true);
    if (App.toast) App.toast(T('CAD-Volumen') + ' · ' + m.ng + ' ' + T('Flächen') + (MeshOCC.valid(m.brep) ? '' : ' · ' + T('Achtung: Form nicht gültig')));
  }
  // CAD-Formoperation auf gewählten Körpern / Flächen: fn(b, gs) → neue Form
  function occShapeOp(what, list, fn) {
    if (!list.every(x => brepOk(x.b))) { alert(T('Nur mit CAD-Volumenkörpern (aus STEP geladen und nicht als Netz bearbeitet).')); return; }
    const res = [];
    if (!occTry(what, () => { for (const x of list) { const s = fn(x.b, x.gs); if (!MeshOCC.valid(s)) throw new Error(T('Ergebnis ist kein gültiger Körper (Wert zu groß?).')); res.push([x.b, s]); } return true; })) return;
    snap();
    for (const [b, s] of res) occTry(what, () => setShape(b, s));
    clearSel(); for (const [b] of res) E.selB.add(b.id); if (cfg().mode === 'face') cfg().mode = 'body';
    changed(true);
  }
  function occFaceList() {   // Flächenmodus: gewählte Flächen je Körper; Körpermodus: ganze Körper (gs leer)
    if (cfg().mode === 'face') return [...E.selF].map(([id, gs]) => ({ b: byId(id), gs: [...gs] })).filter(x => x.b);
    return selBodies().map(b => ({ b, gs: [] }));
  }
  function opFillet(chamfer) {
    const L = occFaceList(); if (!L.length) { alert(T('Körper oder Flächen wählen.')); return; }
    const c = cfg().occ, r = +(chamfer ? c.ch : c.r) || 0; if (!(r > 0)) return;
    occShapeOp(chamfer ? 'Fasen' : 'Runden', L, (b, gs) => MeshOCC.fillet(b.brep, gs, r, chamfer));
  }
  function opHollow() {
    const L = occFaceList(); if (!L.length) { alert(T('Körper oder Flächen wählen.')); return; }
    if (L.some(x => !x.gs.length)) { alert(T('Im Modus „Fläche" mindestens eine Fläche wählen, die offen bleibt (z. B. die Deckfläche).')); return; }
    const th = +cfg().occ.th || 0; if (!(th > 0)) return;
    for (const x of L) x.gs = x.gs.filter(g => g >= 0 && g < x.b.ng);
    occShapeOp('Aushöhlen', L, (b, gs) => MeshOCC.hollow(b.brep, gs, th));
  }
  // Darstellungsfeinheit geändert: alle CAD-Körper neu vernetzen (Flächengruppen bleiben gleich)
  function occRetess() {
    for (const b of E.bodies) if (brepOk(b)) occTry('Vernetzen', () => setShape(b, b.brep));
    changed(true);
  }
  // Löcher schließen: jede Randschleife eben trianguliert (Ausgleichsebene, earcut)
  function boundaryLoops(b) {
    const F = b.F, NV = b.V.length / 3, dir = new Set();
    for (let t = 0; t < F.length; t += 3) for (let e = 0; e < 3; e++) dir.add(F[t + e] * NV + F[t + (e + 1) % 3]);
    const next = new Map();
    for (let t = 0; t < F.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = F[t + e], c = F[t + (e + 1) % 3];
      if (!dir.has(c * NV + a) && !next.has(a)) next.set(a, c);
    }
    const loops = [], seen = new Set();
    for (const s of next.keys()) {
      if (seen.has(s)) continue;
      const L = []; let v = s, guard = 0;
      while (v != null && !seen.has(v) && guard++ < 1e6) { seen.add(v); L.push(v); v = next.get(v); }
      if (v === s && L.length >= 3) loops.push(L);
    }
    return loops;
  }
  function fillLoop(V, L, out) {
    const R = L.slice().reverse();   // Füllfläche läuft gegen den Rand
    const n = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < R.length; i++) {
      const p = R[i] * 3, q = R[(i + 1) % R.length] * 3;
      n[0] += (V[p + 1] - V[q + 1]) * (V[p + 2] + V[q + 2]); n[1] += (V[p + 2] - V[q + 2]) * (V[p] + V[q]); n[2] += (V[p] - V[q]) * (V[p + 1] + V[q + 1]);
      for (let k = 0; k < 3; k++) c[k] += V[p + k] / R.length;
    }
    const L0 = Math.hypot(n[0], n[1], n[2]); if (!(L0 > 0)) return 0;
    const N = n.map(x => x / L0), a = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let u = [N[1] * a[2] - N[2] * a[1], N[2] * a[0] - N[0] * a[2], N[0] * a[1] - N[1] * a[0]]; const lu = Math.hypot(...u); u = u.map(x => x / lu);
    const w = [N[1] * u[2] - N[2] * u[1], N[2] * u[0] - N[0] * u[2], N[0] * u[1] - N[1] * u[0]];
    if (R.length === 3) { out.push(R[0], R[1], R[2]); return 1; }
    const ring = R.map(i => { const x = V[i * 3] - c[0], y = V[i * 3 + 1] - c[1], z = V[i * 3 + 2] - c[2]; return { x: x * u[0] + y * u[1] + z * u[2], y: x * w[0] + y * w[1] + z * w[2] }; });
    const tr = App.earcut ? App.earcut([ring]) : null;
    let k = 0;
    if (tr && tr.tris && tr.tris.length) {
      for (const [i, j, l] of tr.tris) {
        const A = R[i], B = R[j], C = R[l], tmp = [0, 0, 0];
        triNormal(V, [A, B, C], 0, tmp);
        if (tmp[0] * N[0] + tmp[1] * N[1] + tmp[2] * N[2] >= 0) out.push(A, B, C); else out.push(A, C, B);
        k++;
      }
    } else for (let i = 1; i + 1 < R.length; i++) { out.push(R[0], R[i], R[i + 1]); k++; }
    return k;
  }
  function opFillHoles() {
    const bs = needBodies(); if (!bs) return; snap(); let holes = 0;
    for (const b of bs) {
      const loops = boundaryLoops(b); if (!loops.length) continue;
      const add = [], addG = [];
      for (const L of loops) { const n0 = add.length; fillLoop(b.V, L, add); for (let i = n0; i < add.length; i += 3) addG.push(b.ng); b.ng++; holes++; }
      const F = new Uint32Array(b.F.length + add.length); F.set(b.F); F.set(add, b.F.length);
      const G = new Int32Array(b.G.length + addG.length); G.set(b.G); G.set(addG, b.G.length);
      b.F = F; b.G = G; touch(b);
    }
    changed(true);
    if (App.toast) App.toast(T('Geschlossene Löcher: ') + holes);
  }
  // aneinanderreihen in Listenreihenfolge entlang einer Achse (erster Körper bleibt liegen)
  function endCenter(b, a, pos, tol) {
    const b1 = (a + 1) % 3, b2 = (a + 2) % 3, V = b.V; let lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity, n = 0;
    for (let i = 0; i < V.length; i += 3) if (Math.abs(V[i + a] - pos) < tol) { n++; const p = V[i + b1], q = V[i + b2]; if (p < lo1) lo1 = p; if (p > hi1) hi1 = p; if (q < lo2) lo2 = q; if (q > hi2) hi2 = q; }
    return n >= 3 ? [(lo1 + hi1) / 2, (lo2 + hi2) / 2] : null;
  }
  function opChain(axis, gap, center) {
    let bs = selBodies(); if (bs.length < 2) bs = E.bodies.filter(b => !b.hidden);
    if (bs.length < 2) { alert(T('Zum Aneinanderreihen mindestens zwei Körper.')); return; }
    bs = bs.slice().sort((x, y) => E.bodies.indexOf(x) - E.bodies.indexOf(y));
    snap(); const a = AX[axis], b1 = (a + 1) % 3, b2 = (a + 2) % 3;
    let prev = bs[0], pb = bboxUsed(prev);
    for (let k = 1; k < bs.length; k++) {
      const b = bs[k], bb = bboxUsed(b), tol = Math.max(0.05, 5e-3 * Math.max(bbDiag(pb), bbDiag(bb)));
      const t = [0, 0, 0]; t[a] = pb.mx[a] + (+gap || 0) - bb.mn[a];
      let ca = center ? endCenter(prev, a, pb.mx[a], tol) : null, cb = center ? endCenter(b, a, bb.mn[a], tol) : null;
      if (!ca || !cb) { ca = [(pb.mn[b1] + pb.mx[b1]) / 2, (pb.mn[b2] + pb.mx[b2]) / 2]; cb = [(bb.mn[b1] + bb.mx[b1]) / 2, (bb.mn[b2] + bb.mx[b2]) / 2]; }
      t[b1] = ca[0] - cb[0]; t[b2] = ca[1] - cb[1];
      xformBody(b, null, null, t);
      prev = b; pb = bboxUsed(b);
    }
    changed(false);
  }
  // Fläche an Fläche setzen: Körper A so drehen + verschieben, dass seine Fläche fa
  // gegenüber (bzw. bei flip gleichgerichtet) mittig auf der Fläche fb von Körper B liegt.
  function doMate(a, bsel) {
    const A = byId(a.id), B = byId(bsel.id); if (!A || !B) return;
    if (A === B) { alert(T('Die Zielfläche muss auf einem anderen Körper liegen.')); return; }
    const fa = faceFrame(A, new Set([a.g])), fb = faceFrame(B, new Set([bsel.g])); if (!fa || !fb) return;
    const c = cfg().mate, tgt = c.flip ? fb.n : fb.n.map(x => -x);
    const R = arcRot(fa.n, tgt), gap = +c.gap || 0;
    const t = [fb.c[0] + fb.n[0] * gap - fa.c[0], fb.c[1] + fb.n[1] * gap - fa.c[1], fb.c[2] + fb.n[2] * gap - fa.c[2]];
    snap(); xformBody(A, R, fa.c, t);
    clearSel(); E.selB.add(A.id);
    changed(true);
  }
  // ---------- Teile verbinden (Übergangsfläche zwischen zwei Flächen) ----------
  // Randschleifen einer Flächenauswahl in Flächen-Umlaufrichtung (gegen den Uhrzeigersinn um die Normale).
  function regionLoops(b, gs) {
    const F = b.F, G = b.G, NV = b.V.length / 3, dir = new Set();
    for (let t = 0; t < G.length; t++) if (gs.has(G[t])) for (let e = 0; e < 3; e++) dir.add(F[t * 3 + e] * NV + F[t * 3 + (e + 1) % 3]);
    const next = new Map(); let bad = false;
    for (let t = 0; t < G.length; t++) {
      if (!gs.has(G[t])) continue;
      for (let e = 0; e < 3; e++) {
        const a = F[t * 3 + e], c = F[t * 3 + (e + 1) % 3];
        if (dir.has(c * NV + a)) continue;
        if (next.has(a)) bad = true; else next.set(a, c);
      }
    }
    const loops = [], seen = new Set();
    for (const s of next.keys()) {
      if (seen.has(s)) continue;
      const L = []; let v = s, guard = 0;
      while (v != null && !seen.has(v) && guard++ < 1e7) { seen.add(v); L.push(v); v = next.get(v); }
      if (v === s && L.length >= 3) loops.push(L); else bad = true;
    }
    return { loops, bad };
  }
  // Bogenlängen-Parameter 0…1 einer geschlossenen Schleife (Punkte P = [[x,y,z]…])
  function loopParams(P) {
    const n = P.length, c = new Float64Array(n); let L = 0;
    for (let i = 1; i <= n; i++) { L += V3.len(V3.sub(P[i % n], P[i - 1])); if (i < n) c[i] = L; }
    for (let i = 0; i < n; i++) c[i] = L > 0 ? c[i] / L : i / n;
    return c;
  }
  function loopAt(P, prm, u) {   // Punkt bei Parameter u (0…1, zyklisch)
    u = ((u % 1) + 1) % 1; const n = P.length;
    let lo = 0, hi = n - 1; if (u >= prm[n - 1]) { lo = n - 1; } else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (prm[m] <= u) lo = m; else hi = m; } }
    const p0 = prm[lo], p1 = lo + 1 < n ? prm[lo + 1] : 1, t = p1 > p0 ? (u - p0) / (p1 - p0) : 0, A = P[lo], B = P[(lo + 1) % n];
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  }
  // Reißverschluss-Triangulierung zwischen zwei gleichsinnigen Schleifen A (Kanten werden rückwärts benutzt) und
  // B (vorwärts). Parameter je Schleife aufsteigend ab dem kleinsten; es werden nur vorhandene Punkte benutzt.
  function zipper(A, pa, B, pb, out) {
    const rot = (L, p) => { let m = 0; for (let i = 1; i < p.length; i++) if (p[i] < p[m]) m = i; return { L: L.slice(m).concat(L.slice(0, m)), p: Array.from(p.slice(m)).concat(Array.from(p.slice(0, m))) }; };
    const a = rot(A, pa), b = rot(B, pb), nA = a.L.length, nB = b.L.length;
    let i = 0, k = 0;
    while (i < nA || k < nB) {
      const ta = i < nA ? (i + 1 < nA ? a.p[i + 1] : 1 + a.p[0]) : Infinity, tb = k < nB ? (k + 1 < nB ? b.p[k + 1] : 1 + b.p[0]) : Infinity;
      const ca = a.L[i % nA], cb = b.L[k % nB];
      if (ta <= tb) { out.push(a.L[(i + 1) % nA], ca, cb); i++; } else { out.push(cb, b.L[(k + 1) % nB], ca); k++; }
    }
  }
  // Auswahl → zwei Seiten {b, gs}: zwei Körper mit gewählten Flächen oder ein Körper mit genau zwei Flächen
  function bridgeSides() {
    const L = [...E.selF].map(([id, gs]) => ({ b: byId(id), gs })).filter(x => x.b && x.gs.size);
    if (L.length === 2) return L;
    if (L.length === 1 && L[0].gs.size === 2) { const [g1, g2] = [...L[0].gs]; return [{ b: L[0].b, gs: new Set([g1]) }, { b: L[0].b, gs: new Set([g2]) }]; }
    return null;
  }
  // Zwei Flächen (je eine geschlossene Randschleife) durch eine Übergangsfläche ersetzen; beide Körper werden einer.
  // rings = Zwischenringe (0 = direkt), soft = Tangentenlänge in Vielfachen des Abstands (0 = gerade Verbindung):
  // Hermite-Kurven, die senkrecht aus Fläche A heraus- und senkrecht in Fläche B hineinlaufen.
  // o.tangent (Lücke füllen): die Kurven setzen stattdessen die angrenzenden Seitenflächen tangential fort
  // (o.tension = Spannung, o.rings), o.mode 'face' = nur die Füllfläche als eigener Körper, Teile bleiben.
  // Netz: Fortsetzungsrichtung je Randpunkt aus den angrenzenden Dreiecken außerhalb der Fläche
  function rimDirs(b, gs, L, nOut) {
    const et = edgeTris(b), NV = b.V.length / 3, V = b.V, m = L.length, tmp = [0, 0, 0], out = [];
    const sideN = (i, j) => { const s = [0, 0, 0], l = et.get(i < j ? i * NV + j : j * NV + i) || []; for (const t of l) if (!gs.has(b.G[t])) { triNormal(V, b.F, t, tmp); s[0] += tmp[0]; s[1] += tmp[1]; s[2] += tmp[2]; } return s; };
    const P = i => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]];
    for (let k = 0; k < m; k++) {
      const i = L[k], a = L[(k - 1 + m) % m], c = L[(k + 1) % m], n1 = sideN(a, i), n2 = sideN(i, c), ns = V3.add(n1, n2);
      let d = V3.len(ns) > 0 ? V3.norm(V3.cross(ns, V3.sub(P(c), P(a)))) : nOut.slice();
      // Ecke zwischen zwei Seitenflächen: weiter entlang ihrer gemeinsamen Kante (nicht quer zur Sehne)
      if (V3.len(n1) > 0 && V3.len(n2) > 0 && V3.dot(V3.norm(n1), V3.norm(n2)) < 0.94) { const e = V3.cross(n1, n2); if (V3.len(e) > 0) d = V3.norm(e); }
      if (V3.dot(d, nOut) < 0) d = V3.mul(d, -1);
      if (!(V3.dot(d, nOut) > 0.02) || !isFinite(d[0])) d = nOut.slice();
      out.push(d);
    }
    return out;
  }
  function opBridge(o) {
    o = o || {}; const tang = !!o.tangent, onlyFace = tang && o.mode === 'face', what = tang ? 'Lücke füllen' : 'Verbinden';
    if (cfg().mode !== 'face') { alert(T('Erst im Modus „Fläche" die beiden Flächen wählen (Umschalt+Klick).')); return; }
    const S = bridgeSides();
    if (!S) { alert(T('Genau zwei Flächen wählen (Umschalt+Klick): je eine auf den beiden Teilen, die verbunden werden.')); return; }
    const fr = S.map(s => faceFrame(s.b, s.gs)), lp = S.map(s => regionLoops(s.b, s.gs));
    if (!fr[0] || !fr[1]) return;
    if (lp.some(l => l.bad || l.loops.length !== 1)) { alert(T('Jede der beiden Flächen muss genau einen geschlossenen Rand haben (keine Löcher, keine offenen Ränder).')); return; }
    const c = cfg().br, rings = clamp(Math.round(+(tang ? o.rings : c.rings) || 0), 0, 200), soft = Math.max(0, +c.soft || 0), tension = Math.max(0.01, +o.tension || 0.35);
    const [sa, sb] = S, same = sa.b === sb.b;
    if (tang && brepOk(sa.b) && brepOk(sb.b) && sa.gs.size === 1 && sb.gs.size === 1) {   // CAD: tangentiale B-Spline-Füllfläche
      let res = null;
      if (!occTry(what, () => { res = MeshOCC.gapFill(sa.b.brep, [...sa.gs][0], fr[0].n, sb.b.brep, [...sb.gs][0], fr[1].n, { mode: onlyFace ? 'face' : 'solid', tension }); return true; })) return;
      let nb = null;
      if (!occTry(what, () => { nb = bodyFromShape(onlyFace ? T('Füllfläche') : (same ? sa.b.name : sa.b.name + ' + ' + sb.b.name), res.shape, onlyFace ? null : sa.b.color); return true; })) return;
      snap();
      if (onlyFace) E.bodies.push(nb);
      else { const at = E.bodies.indexOf(sa.b), ids = new Set([sa.b.id, sb.b.id]); E.bodies = E.bodies.filter(b => !ids.has(b.id)); E.bodies.splice(Math.min(at, E.bodies.length), 0, nb); }
      clearSel(); E.selB.add(nb.id); cfg().mode = 'body';
      changed(true);
      if (App.toast) App.toast(T(onlyFace ? 'Füllfläche erzeugt (CAD, tangential)' : 'Lücke gefüllt (CAD, tangential)') + ' · ' + T('Randabweichung') + ' ' + res.info.dev.toFixed(4) + ' mm' + (onlyFace ? '' : ' · ' + (MeshOCC.valid(nb.brep) ? T('gültiger Volumenkörper') : T('Achtung: Form nicht gültig'))));
      return;
    }
    if (!tang && brepOk(sa.b) && brepOk(sb.b) && sa.gs.size === 1 && sb.gs.size === 1) {   // CAD: Loft zwischen den Außenrändern
      const dist = V3.len(V3.sub(fr[1].c, fr[0].c)); let nb = null;
      if (!occTry('Verbinden', () => { nb = bodyFromShape(same ? sa.b.name : sa.b.name + ' + ' + sb.b.name, MeshOCC.bridge(sa.b.brep, [...sa.gs][0], fr[0].n, sb.b.brep, [...sb.gs][0], fr[1].n, dist, soft), sa.b.color); return true; })) return;
      snap();
      const at = E.bodies.indexOf(sa.b), ids = new Set([sa.b.id, sb.b.id]);
      E.bodies = E.bodies.filter(b => !ids.has(b.id)); E.bodies.splice(Math.min(at, E.bodies.length), 0, nb);
      clearSel(); E.selB.add(nb.id); cfg().mode = 'body';
      changed(true);
      if (App.toast) App.toast(T('Verbunden (CAD-Loft)') + ' · ' + nb.ng + ' ' + T('Flächen'));
      return;
    }
    // gemeinsames Eckpunktfeld: Körper A, dahinter B (sofern anderer Körper)
    const VA = sa.b.V, VB = same ? null : sb.b.V, offB = same ? 0 : VA.length / 3;
    const V = Array.from(VA); if (VB) for (let i = 0; i < VB.length; i++) V.push(VB[i]);
    const P = i => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]];
    const LA = lp[0].loops[0].slice().reverse(), LB = lp[1].loops[0].map(i => i + offB);   // A rückwärts (Restfläche), B in Flächenrichtung
    const PA = LA.map(P), PB = LB.map(P), pA = loopParams(PA), pB0 = loopParams(PB);
    const nA = fr[0].n, nB = fr[1].n, cA = fr[0].c, cB = fr[1].c, D = V3.sub(cB, cA), dist = V3.len(D);
    if (V3.dot(nA, D) <= 0 || V3.dot(nB, D) >= 0) { if (!confirm(T('Die beiden Flächen zeigen nicht zueinander — die Übergangsfläche kann sich verdrehen oder durchdringen. Trotzdem verbinden?'))) return; }
    // tangential: Fortsetzungsrichtungen der Seitenflächen je Randpunkt (A in der Reihenfolge von LA)
    let DA = null, DB = null;
    if (tang) {
      const gsA = same ? new Set([...sa.gs, ...sb.gs]) : sa.gs, gsB = same ? gsA : sb.gs;
      DA = rimDirs(sa.b, gsA, LA, nA); DB = rimDirs(sb.b, gsB, LB.map(i => i - offB), nB);
    }
    // Startversatz von B: kleinste Summe der Abstandsquadrate der auf den Mittelpunkt bezogenen Punkte
    const M = 96; let bestS = 0, bestC = Infinity;
    for (let k = 0; k < 360; k++) {
      const s = k / 360; let cost = 0;
      for (let j = 0; j < M; j++) { const a = V3.sub(loopAt(PA, pA, j / M), cA), b = V3.sub(loopAt(PB, pB0, j / M + s), cB); cost += V3.dot(V3.sub(a, b), V3.sub(a, b)); }
      if (cost < bestC) { bestC = cost; bestS = s; }
    }
    const pB = Array.from(pB0).map(p => (((p - bestS) % 1) + 1) % 1);
    // Zwischenringe
    const N = Math.max(PA.length, PB.length, 24), TA = V3.mul(nA, dist * soft), TB = V3.mul(nB, -dist * soft), ringIdx = [], Lt = 3 * tension * dist;
    const uni = Array.from({ length: N }, (_, j) => j / N);
    for (let r = 1; r <= rings; r++) {
      const t = r / (rings + 1), h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t, R = [];
      for (let j = 0; j < N; j++) {
        const a = loopAt(PA, pA, uni[j]), b = loopAt(PB, pB0, uni[j] + bestS);
        const ta = tang ? V3.mul(V3.norm(loopAt(DA, pA, uni[j])), Lt) : TA, tb = tang ? V3.mul(V3.norm(loopAt(DB, pB0, uni[j] + bestS)), -Lt) : TB;
        R.push(V.length / 3); for (let q = 0; q < 3; q++) V.push(h00 * a[q] + h10 * ta[q] + h01 * b[q] + h11 * tb[q]);
      }
      ringIdx.push(R);
    }
    const br = [], chain = [{ L: LA, p: pA }].concat(ringIdx.map(R => ({ L: R, p: uni }))).concat([{ L: LB, p: pB }]);
    for (let k = 0; k + 1 < chain.length; k++) zipper(chain[k].L, chain[k].p, chain[k + 1].L, chain[k + 1].p, br);
    if (onlyFace) {   // nur die Füllfläche als eigener (offener) Körper
      snap();
      const cm = compact(new Float64Array(V), new Uint32Array(br)), nb = mkBody(T('Füllfläche'), cm.V, cm.F, new Int32Array(br.length / 3));
      E.bodies.push(nb); clearSel(); E.selB.add(nb.id); cfg().mode = 'body';
      changed(true);
      if (App.toast) App.toast(T('Füllfläche erzeugt (tangential)') + ' · ' + (br.length / 3) + ' ' + T('Dreiecke'));
      return;
    }
    // Dreiecke: beide Körper ohne die gewählten Flächen + Brücke
    const F = [], G = [];
    const keep = (b, gs, off, goff) => { for (let t = 0; t < b.G.length; t++) if (!gs.has(b.G[t]) && !(same && b === sa.b && (sa.gs.has(b.G[t]) || sb.gs.has(b.G[t])))) { F.push(b.F[t * 3] + off, b.F[t * 3 + 1] + off, b.F[t * 3 + 2] + off); G.push(b.G[t] + goff); } };
    if (same) keep(sa.b, new Set([...sa.gs, ...sb.gs]), 0, 0);
    else { keep(sa.b, sa.gs, 0, 0); keep(sb.b, sb.gs, offB, sa.b.ng); }
    const gBr = same ? sa.b.ng : sa.b.ng + sb.b.ng;
    for (let i = 0; i < br.length; i += 3) { F.push(br[i], br[i + 1], br[i + 2]); G.push(gBr); }
    snap();
    const cm = compact(new Float64Array(V), new Uint32Array(F));
    const nb = mkBody(same ? sa.b.name : sa.b.name + ' + ' + sb.b.name, cm.V, cm.F, new Int32Array(G), sa.b.color);
    nb.cad = sa.b.cad && (same || sb.b.cad);
    const at = E.bodies.indexOf(sa.b), ids = new Set([sa.b.id, sb.b.id]);
    E.bodies = E.bodies.filter(b => !ids.has(b.id)); E.bodies.splice(Math.min(at, E.bodies.length), 0, nb);
    clearSel(); E.selF.set(nb.id, new Set([gBr]));
    changed(true);
    const st = stats(nb);
    if (App.toast) App.toast(T(tang ? 'Lücke gefüllt (tangential)' : 'Verbunden') + ' · ' + (br.length / 3) + ' ' + T('Dreiecke im Übergang') + ' · ' + (st.open + st.nonman ? T('offene Kanten: ') + (st.open + st.nonman) : T('geschlossen')));
  }

  // Strecken / Verlängern an einer Ebene senkrecht zur Achse
  //  insert: Netz an der Ebene auftrennen, Querschnitt um d einfügen (gleicher Querschnitt)
  //  band:   Bereich [pos − band, pos] proportional auf Länge band + d strecken bzw. stauchen,
  //          alles dahinter wird um d verschoben (stetig, keine neuen Dreiecke)
  function sliceAt(b, a, pos, eps) {
    const V = Array.from(b.V), F = [], G = [], nv0 = b.V.length / 3;
    let S = new Float64Array(nv0 * 2 + 16); const sAt = i => S[i];
    for (let i = 0; i < nv0; i++) { let d = V[i * 3 + a] - pos; if (Math.abs(d) < eps) { d = 0; V[i * 3 + a] = pos; } S[i] = d; }
    const cut = new Map();
    const cutE = (i, j) => {
      const k = i < j ? i * nv0 * 4 + j : j * nv0 * 4 + i; let m = cut.get(k);
      if (m != null) return m;
      const t = S[i] / (S[i] - S[j]); m = V.length / 3;
      for (let q = 0; q < 3; q++) V.push(V[i * 3 + q] + (V[j * 3 + q] - V[i * 3 + q]) * t);
      V[m * 3 + a] = pos;
      if (m >= S.length) { const S2 = new Float64Array(S.length * 2); S2.set(S); S = S2; }
      S[m] = 0; cut.set(k, m); return m;
    };
    const sg = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
    for (let t = 0; t < b.F.length / 3; t++) {
      const v = [b.F[t * 3], b.F[t * 3 + 1], b.F[t * 3 + 2]], g = b.G[t], q = v.map(i => sg(sAt(i)));
      const pos_ = q.includes(1), neg_ = q.includes(-1);
      if (!(pos_ && neg_)) { F.push(v[0], v[1], v[2]); G.push(g); continue; }
      const z = q.indexOf(0);
      if (z >= 0) {   // eine Ecke auf der Ebene: in zwei Dreiecke
        const A = v[z], B = v[(z + 1) % 3], C = v[(z + 2) % 3], m = cutE(B, C);
        F.push(A, B, m, A, m, C); G.push(g, g);
      } else {        // eine Ecke allein auf ihrer Seite: in drei Dreiecke
        let k = 0; for (let i = 0; i < 3; i++) if (q[i] !== q[(i + 1) % 3] && q[i] !== q[(i + 2) % 3]) k = i;
        const A = v[k], B = v[(k + 1) % 3], C = v[(k + 2) % 3], m1 = cutE(A, B), m2 = cutE(A, C);
        F.push(A, m1, m2, m1, B, C, m1, C, m2); G.push(g, g, g);
      }
    }
    return { V, F, G, S };
  }
  function stretchInsert(b, a, pos, d) {
    const bb = bboxUsed(b), eps = Math.max(1e-6, bbDiag(bb) * 1e-7);
    const r = sliceAt(b, a, pos, eps), V = r.V, F = r.F, G = r.G, S = r.S, nt = F.length / 3;
    const right = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) if (S[F[t * 3 + e]] > 0) right[t] = 1;
    const dup = new Map(), nv = V.length / 3;
    const dupOf = i => { let j = dup.get(i); if (j == null) { j = V.length / 3; V.push(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]); dup.set(i, j); } return j; };
    const walls = [], wallG = [];
    for (let t = 0; t < nt; t++) {
      if (!right[t]) continue;
      for (let e = 0; e < 3; e++) {
        const i = F[t * 3 + e], j = F[t * 3 + (e + 1) % 3];
        if (S[i] === 0 && S[j] === 0) { const i2 = dupOf(i), j2 = dupOf(j); walls.push(i, j, j2, i, j2, i2); wallG.push(G[t], G[t]); }
      }
      for (let e = 0; e < 3; e++) { const i = F[t * 3 + e]; if (S[i] === 0) F[t * 3 + e] = dupOf(i); }
    }
    for (let i = 0; i < nv; i++) if (S[i] > 0) V[i * 3 + a] += d;
    for (const j of dup.values()) V[j * 3 + a] += d;
    const cm = compact(new Float64Array(V), new Uint32Array(F.concat(walls)));
    b.V = cm.V; b.F = cm.F; b.G = new Int32Array(G.concat(wallG)); touch(b);
    return dup.size;
  }
  function stretchBand(b, a, pos, band, d) {
    const p0 = pos - band, p1 = pos, k = (band + d) / band, V = Float64Array.from(b.V);
    for (let o = a; o < V.length; o += 3) { const x = V[o]; if (x >= p1) V[o] = x + d; else if (x > p0) V[o] = p0 + (x - p0) * k; }
    b.V = V; touch(b);
  }
  function stretchTargets() { const bs = selBodies(); return bs.length ? bs : E.bodies.filter(b => !b.hidden); }
  function stretchPos() {
    const c = cfg().st, a = AX[c.axis];
    if (c.pos != null && isFinite(c.pos)) return +c.pos;
    const bs = stretchTargets(); if (!bs.length) return 0;
    let lo = Infinity, hi = -Infinity; for (const b of bs) { const bb = bboxUsed(b); lo = Math.min(lo, bb.mn[a]); hi = Math.max(hi, bb.mx[a]); }
    return r3((lo + hi) / 2);
  }
  function opStretch() {
    const c = cfg().st, a = AX[c.axis], pos = stretchPos(), d = +c.d || 0, bs = stretchTargets();
    if (!bs.length) { alert(T('Keine Körper.')); return; }
    if (!d) return;
    if (c.kind === 'insert' && d < 0) { alert(T('„Querschnitt einfügen" verlängert nur (Länge > 0). Zum Kürzen „Bereich strecken / stauchen" wählen.')); return; }
    if (c.kind === 'band' && !(+c.band > 0 && +c.band + d > 0)) { alert(T('Der Bereich muss länger sein als die Kürzung.')); return; }
    snap(); let hit = 0;
    for (const b of bs) {
      const bb = bboxUsed(b);
      if (c.kind === 'insert') {
        if (pos <= bb.mn[a] || pos >= bb.mx[a]) { if (pos <= bb.mn[a]) xformBody(b, null, null, a === 0 ? [d, 0, 0] : a === 1 ? [0, d, 0] : [0, 0, d]); continue; }
        if (brepOk(b)) { if (occTry('Querschnitt einfügen', () => { const s = MeshOCC.insertSlab(b.brep, a, pos, d); if (s) { setShape(b, s); hit++; } return true; })) continue; }
        if (stretchInsert(b, a, pos, d)) hit++;
      }
      else { stretchBand(b, a, pos, +c.band, d); hit++; }
    }
    changed(true);
    if (!hit) alert(T('Die Ebene schneidet keinen der Körper.'));
  }

  // ---------- Flächen-Werkzeuge ------------------------------------------------------------------------
  function needFaces() { if (cfg().mode !== 'face' || !E.selF.size) { alert(T('Erst im Modus „Fläche" eine Fläche anklicken.')); return null; } return [...E.selF].map(([id, gs]) => ({ b: byId(id), gs })).filter(x => x.b); }
  // Eckpunkte der gewählten Flächen bewegen; angrenzende Flächen dehnen sich mit
  function opFaceMove(kind) {
    const L = needFaces(); if (!L) return; const c = cfg().fc; snap();
    for (const { b, gs } of L) {
      const f = faceFrame(b, gs); if (!f) continue;
      const t = kind === 'normal' ? f.n.map(x => x * (+c.d || 0)) : [+c.dx || 0, +c.dy || 0, +c.dz || 0];
      if (occPushPull(b, gs, f, t)) continue;
      b.V = xform(b.V, f.verts, null, null, t); touch(b);
    }
    changed(true);
  }
  // CAD: Verschiebung t einer Flächenauswahl als Push/Pull (nur entlang der Flächennormale); true = erledigt
  function occPushPull(b, gs, f, t) {
    if (!brepOk(b)) return false;
    const d = V3.dot(t, f.n), res = V3.len(V3.sub(t, V3.mul(f.n, d)));
    if (res > 1e-6 * Math.max(1, Math.abs(d)) || !d) return false;
    return occTry('Fläche verschieben', () => { setShape(b, MeshOCC.pushPull(b.brep, [...gs], f.n, d)); return true; });
  }
  function opFaceRotate() {
    const L = needFaces(); if (!L) return; const c = cfg().fc; snap();
    for (const { b, gs } of L) {
      const f = faceFrame(b, gs); if (!f) continue;
      const u = c.axis === 'n' ? f.n : (() => { const q = [0, 0, 0]; q[AX[c.axis]] = 1; return q; })();
      b.V = xform(b.V, f.verts, rotAxis(u, (+c.ang || 0) * Math.PI / 180), f.c); touch(b);
    }
    changed(false);
  }
  function opFaceScale() {
    const L = needFaces(); if (!L) return; const c = cfg().fc, s = +c.f;
    if (!(s > 0)) { alert(T('Faktoren müssen größer 0 sein.')); return; }
    snap();
    for (const { b, gs } of L) { const f = faceFrame(b, gs); if (f) { b.V = xform(b.V, f.verts, [s, 0, 0, 0, s, 0, 0, 0, s], f.c); touch(b); } }
    changed(false);
  }
  function opFacePlanar() {
    const L = needFaces(); if (!L) return; snap();
    for (const { b, gs } of L) {
      const f = faceFrame(b, gs); if (!f) continue; const V = Float64Array.from(b.V), n = f.n;
      for (const o of f.verts) { const d = (V[o * 3] - f.c[0]) * n[0] + (V[o * 3 + 1] - f.c[1]) * n[1] + (V[o * 3 + 2] - f.c[2]) * n[2]; for (let k = 0; k < 3; k++) V[o * 3 + k] -= d * n[k]; }
      b.V = V; touch(b);
    }
    changed(false);
  }
  // Extrudieren: gewählte Flächen um die Strecke entlang ihrer Normale versetzen, an ihrem Rand neue Seitenwände
  function opExtrude() {
    const L = needFaces(); if (!L) return; const dist = +cfg().fc.ext || 0; if (!dist) return; snap();
    for (const { b, gs } of L) {
      const f = faceFrame(b, gs); if (!f) continue;
      if (occPushPull(b, gs, f, f.n.map(x => x * dist))) continue;
      const F = Array.from(b.F), G = Array.from(b.G), V = Array.from(b.V), nt = G.length, inR = new Uint8Array(nt);
      for (let t = 0; t < nt; t++) if (gs.has(G[t])) inR[t] = 1;
      const et = edgeTris(b), NV = b.V.length / 3, dup = new Map();
      const dupOf = i => { let j = dup.get(i); if (j == null) { j = V.length / 3; V.push(V[i * 3] + f.n[0] * dist, V[i * 3 + 1] + f.n[1] * dist, V[i * 3 + 2] + f.n[2] * dist); dup.set(i, j); } return j; };
      const wg = b.ng++;
      for (let t = 0; t < nt; t++) {
        if (!inR[t]) continue;
        const v = [F[t * 3], F[t * 3 + 1], F[t * 3 + 2]];
        for (let e = 0; e < 3; e++) {
          const i = v[e], j = v[(e + 1) % 3], l = et.get(i < j ? i * NV + j : j * NV + i);
          const border = !l || l.length < 2 || l.some(u => !inR[u]);
          if (border) { const i2 = dupOf(i), j2 = dupOf(j); F.push(i, j, j2, i, j2, i2); G.push(wg, wg); }
        }
        for (let e = 0; e < 3; e++) F[t * 3 + e] = dupOf(v[e]);
      }
      const cm = compact(new Float64Array(V), new Uint32Array(F));
      b.V = cm.V; b.F = cm.F; b.G = new Int32Array(G); touch(b);
    }
    changed(true);
  }
  function opDeleteFaces() {
    const L = needFaces(); if (!L) return; snap();
    for (const { b, gs } of L) {
      const keep = []; for (let t = 0; t < b.G.length; t++) if (!gs.has(b.G[t])) keep.push(t);
      const F = new Uint32Array(keep.length * 3), G = new Int32Array(keep.length);
      keep.forEach((t, i) => { F[i * 3] = b.F[t * 3]; F[i * 3 + 1] = b.F[t * 3 + 1]; F[i * 3 + 2] = b.F[t * 3 + 2]; G[i] = b.G[t]; });
      const cm = compact(b.V, F); b.V = cm.V; b.F = cm.F; b.G = G; touch(b);
    }
    E.bodies = E.bodies.filter(b => b.F.length);
    clearSel(); changed(true);
  }
  function opRegroup() {
    if (!E.bodies.length) return; snap();
    const bs = selBodies().length ? selBodies() : E.bodies;
    for (const b of bs) { if (b.cad) continue; const ag = autoGroups(b, cfg().angle); b.G = ag.G; b.ng = ag.ng; touch(b); }
    E.selF.clear(); changed(true);
  }

  // ---------- STL-Ausgabe --------------------------------------------------------------------------------
  function toBinarySTL(v) {
    const n = v.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf); dv.setUint32(80, n, true); let o = 84;
    for (let i = 0; i < v.length; i += 9) {
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / L, true); dv.setFloat32(o + 4, ny / L, true); dv.setFloat32(o + 8, nz / L, true); o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, v[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }
  const safe = s => (String(s || 'koerper').replace(/[^\w\-. ]+/g, '_').trim() || 'koerper');
  async function exportStl(each) {
    const sel = selBodies(), list0 = (sel.length ? sel : E.bodies).filter(b => !b.hidden && b.F.length);
    if (!list0.length) { alert(T('Keine sichtbaren Körper.')); return; }
    if (App.demoSaveBlocked && App.demoSaveBlocked('svStl')) return;
    if (!expCheck(list0)) return;
    const list = await expListAsync(list0); if (!list) return;
    if (!each || list.length === 1) {
      const name = safe(list.length === 1 ? list[0].name : (state.projectName || 'baugruppe')) + '.stl', buf = toBinarySTL(mergedSoup(list));
      if (typeof App.download === 'function') App.download(name, buf, 'model/stl', 'svStl'); else App.anchorDownload(name, buf, 'model/stl');
      return;
    }
    const used = new Set();
    const files = list.map(b => { let n = safe(b.name), k = 2; while (used.has(n)) n = safe(b.name) + '_' + k++; used.add(n); return { name: n + '.stl', v: soupOf(b) }; });
    if (App.stlSaveMany) { await App.stlSaveMany(files, 'svStl'); return; }
    let i = 0; for (const f of files) setTimeout(() => App.anchorDownload(f.name, toBinarySTL(f.v), 'model/stl'), 300 * i++);
  }

  // ---------- OBJ- und STEP-Ausgabe ----------
  function toOBJ(list) {
    const L = ['# AI Foam Cut — 3D-Bearbeitung', '# Einheit: mm']; let off = 1;
    for (const b of list) {
      L.push('o ' + safe(b.name).replace(/\s+/g, '_'));
      const V = b.V, F = b.F;
      for (let i = 0; i < V.length; i += 3) L.push('v ' + +V[i].toFixed(6) + ' ' + +V[i + 1].toFixed(6) + ' ' + +V[i + 2].toFixed(6));
      let g = -1;
      for (let t = 0; t < F.length / 3; t++) {
        if (b.G[t] !== g) { g = b.G[t]; L.push('g ' + safe(b.name).replace(/\s+/g, '_') + '_f' + g); }
        L.push('f ' + (F[t * 3] + off) + ' ' + (F[t * 3 + 1] + off) + ' ' + (F[t * 3 + 2] + off));
      }
      off += V.length / 3;
    }
    return L.join('\n') + '\n';
  }
  // STEP AP214 mit ebenen Flächen: geschlossene Körper MANIFOLD_SOLID_BREP (CLOSED_SHELL, gemeinsame Kanten), offene als
  // SHELL_BASED_SURFACE_MODEL (OPEN_SHELL). Ebene Flächen mit sauberen Randschleifen werden zu EINER
  // STEP-Fläche (Polygon, Löcher als FACE_BOUND), alles andere Dreieck für Dreieck.
  function toSTEP(list, name) {
    const out = []; let id = 0;
    const E_ = s => { out.push('#' + (++id) + '=' + s + ';'); return '#' + id; };
    const f = x => { const v = +x; if (!isFinite(v)) return '0.'; const s = String(+v.toFixed(6)); return /[.eE]/.test(s) ? s : s + '.'; };
    const str = s => "'" + String(s || '').replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '_') + "'";
    const ctx1 = E_("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    E_("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000," + ctx1 + ')');
    const pctx = E_("PRODUCT_CONTEXT(''," + ctx1 + ",'mechanical')");
    const prod = E_('PRODUCT(' + str(name) + ',' + str(name) + ",''," + '(' + pctx + '))');
    const pdf = E_("PRODUCT_DEFINITION_FORMATION('',''," + prod + ')');
    const pdc = E_("PRODUCT_DEFINITION_CONTEXT('part definition'," + ctx1 + ",'design')");
    const pd = E_("PRODUCT_DEFINITION('design',''," + pdf + ',' + pdc + ')');
    const pds = E_("PRODUCT_DEFINITION_SHAPE(''," + "''," + pd + ')');
    E_("PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(" + prod + '))');
    const uL = E_('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
    const uA = E_('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
    const uS = E_('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
    const unc = E_("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06)," + uL + ",'distance_accuracy_value','confusion accuracy')");
    const gctx = E_('(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((' + unc + '))GLOBAL_UNIT_ASSIGNED_CONTEXT((' + uL + ',' + uA + ',' + uS + "))REPRESENTATION_CONTEXT('Context3D','3D Context'))");
    const o0 = E_("CARTESIAN_POINT('',(0.,0.,0.))"), dz = E_("DIRECTION('',(0.,0.,1.))"), dx = E_("DIRECTION('',(1.,0.,0.))");
    const ax = E_("AXIS2_PLACEMENT_3D(''," + o0 + ',' + dz + ',' + dx + ')');
    const items = []; let allClosed = true, nFaces = 0;
    for (const b of list) {
      const st = stats(b), closed = !st.open && !st.nonman; if (!closed) allClosed = false;
      const pts = new Map(), vts = new Map(), eds = new Map(), V = b.V, NV = V.length / 3;
      const P3 = i => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]];
      const cp = p => E_("CARTESIAN_POINT('',(" + f(p[0]) + ',' + f(p[1]) + ',' + f(p[2]) + '))');
      const dirE = d => E_("DIRECTION('',(" + f(d[0]) + ',' + f(d[1]) + ',' + f(d[2]) + '))');
      const pt = i => { let r = pts.get(i); if (!r) { r = cp(P3(i)); pts.set(i, r); } return r; };
      const vx = i => { let r = vts.get(i); if (!r) { r = E_("VERTEX_POINT(''," + pt(i) + ')'); vts.set(i, r); } return r; };
      // gemeinsame Kante (einmal je Kantenpaar, Richtung kleiner → größer Index), im Umlauf als ORIENTED_EDGE
      const oe = (i, j) => {
        const a = Math.min(i, j), c = Math.max(i, j), k = a * NV + c; let e = eds.get(k);
        if (!e) {
          const d = V3.sub(P3(c), P3(a)), L = V3.len(d) || 1e-9;
          const ln = E_("LINE(''," + pt(a) + ',' + E_("VECTOR(''," + dirE(V3.mul(d, 1 / L)) + ',' + f(L) + ')') + ')');
          e = E_("EDGE_CURVE(''," + vx(a) + ',' + vx(c) + ',' + ln + ',.T.)'); eds.set(k, e);
        }
        return E_("ORIENTED_EDGE('',*,*," + e + ',' + (i < j ? '.T.' : '.F.') + ')');
      };
      const loopE = L => E_("EDGE_LOOP('',(" + L.map((v, k) => oe(v, L[(k + 1) % L.length])).join(',') + '))');
      const planeE = (n, p0, p1) => {
        let r = V3.sub(p1, p0); r = V3.sub(r, V3.mul(n, V3.dot(r, n)));
        if (V3.len(r) < 1e-12) r = Math.abs(n[0]) < 0.9 ? V3.cross(n, [1, 0, 0]) : V3.cross(n, [0, 1, 0]);
        return E_("PLANE(''," + E_("AXIS2_PLACEMENT_3D(''," + cp(p0) + ',' + dirE(n) + ',' + dirE(V3.norm(r)) + ')') + ')');
      };
      const faces = [], done = new Uint8Array(b.G.length), tol = Math.max(1e-4, bbDiag(bboxUsed(b)) * 1e-6);
      const groups = new Map(); for (let t = 0; t < b.G.length; t++) { let l = groups.get(b.G[t]); if (!l) groups.set(b.G[t], l = []); l.push(t); }
      for (const [g, ts] of groups) {
        if (ts.length < 2) continue;
        const gs = new Set([g]), fr = faceFrame(b, gs);
        if (!fr || fr.dev > tol || fr.flat < 0.9999) continue;
        const rl = regionLoops(b, gs); if (rl.bad || !rl.loops.length) continue;
        // äußere Schleife = größte Fläche (Projektion auf die Flächenebene)
        const area = L => { let s = [0, 0, 0]; for (let i = 0; i < L.length; i++) { const p = L[i] * 3, q = L[(i + 1) % L.length] * 3; s = V3.add(s, V3.cross([V[p], V[p + 1], V[p + 2]], [V[q], V[q + 1], V[q + 2]])); } return V3.dot(s, fr.n) / 2; };
        const ar = rl.loops.map(area); let oi = 0; for (let i = 1; i < ar.length; i++) if (ar[i] > ar[oi]) oi = i;
        if (!(ar[oi] > 0)) continue;
        const bounds = rl.loops.map((L, i) => E_((i === oi ? 'FACE_OUTER_BOUND' : 'FACE_BOUND') + "(''," + loopE(L) + ',.T.)'));
        const L0 = rl.loops[oi];
        faces.push(E_("ADVANCED_FACE('',(" + bounds.join(',') + '),' + planeE(fr.n, P3(L0[0]), P3(L0[1])) + ',.T.)'));
        for (const t of ts) done[t] = 1;
      }
      const tmp = [0, 0, 0];
      for (let t = 0; t < b.G.length; t++) {
        if (done[t]) continue;
        const L = [b.F[t * 3], b.F[t * 3 + 1], b.F[t * 3 + 2]];
        triNormal(V, b.F, t, tmp); const n = V3.norm(tmp);
        faces.push(E_("ADVANCED_FACE('',(" + E_("FACE_OUTER_BOUND(''," + loopE(L) + ',.T.)') + '),' + planeE(n, P3(L[0]), P3(L[1])) + ',.T.)'));
      }
      nFaces += faces.length;
      const shell = E_((closed ? 'CLOSED_SHELL' : 'OPEN_SHELL') + "(" + str(b.name) + ',(' + faces.join(',') + '))');
      items.push({ shell, closed, name: b.name });
    }
    let rep;
    if (allClosed) rep = E_('ADVANCED_BREP_SHAPE_REPRESENTATION(' + str(name) + ',(' + ax + ',' + items.map(it => E_('MANIFOLD_SOLID_BREP(' + str(it.name) + ',' + it.shell + ')')).join(',') + '),' + gctx + ')');
    else rep = E_('MANIFOLD_SURFACE_SHAPE_REPRESENTATION(' + str(name) + ',(' + ax + ',' + items.map(it => E_('SHELL_BASED_SURFACE_MODEL(' + str(it.name) + ',(' + it.shell + '))')).join(',') + '),' + gctx + ')');
    E_('SHAPE_DEFINITION_REPRESENTATION(' + pds + ',' + rep + ')');
    const now = new Date().toISOString().slice(0, 19);
    const head = ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('AI Foam Cut faceted model'),'2;1');",
      'FILE_NAME(' + str(name + '.step') + ",'" + now + "',(''),(''),'AI Foam Cut','AI Foam Cut','');",
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", 'ENDSEC;', 'DATA;'];
    return { text: head.concat(out, ['ENDSEC;', 'END-ISO-10303-21;']).join('\n') + '\n', faces: nFaces, closed: allClosed };
  }
  // STEP: CAD-Körper exakt über OpenCascade; reine Netze wie bisher (gemischt: Netze über OpenCascade eingelesen)
  function stepText(L, nm) {
    if (!L.some(brepOk) || !(window.MeshOCC && MeshOCC.isReady())) return toSTEP(L, nm).text;
    const shapes = L.map(b => brepOk(b) ? b.brep : MeshOCC.fromText(toSTEP([b], b.name).text));
    return MeshOCC.writeSTEP(shapes);
  }
  // Ausgabe in allen drei Formaten: gewählte (sonst alle sichtbaren) Körper, zusammen oder je Körper eine Datei
  async function exportAs(fmt, each) {
    if (fmt === 'stl') return exportStl(each);
    const sel = selBodies(), list = (sel.length ? sel : E.bodies).filter(b => !b.hidden && b.F.length);
    if (!list.length) { alert(T('Keine sichtbaren Körper.')); return; }
    if (App.demoSaveBlocked && App.demoSaveBlocked('svStl')) return;
    const ext = fmt === 'obj' ? '.obj' : '.step', mime = fmt === 'obj' ? 'model/obj' : 'model/step';
    let xmap = null;
    if (fmt === 'obj') { if (!expCheck(list)) return; const xl = await expListAsync(list); if (!xl) return; xmap = new Map(list.map((b, i) => [b, xl[i]])); }
    const make = (L, nm) => fmt === 'obj' ? toOBJ(L.map(b => xmap.get(b))) : stepText(L, nm);
    const groups = each && list.length > 1 ? list.map(b => [b]) : [list];
    const used = new Set();
    for (const L of groups) {
      let nm = safe(L.length === 1 ? L[0].name : (state.projectName || 'baugruppe')), k = 2; while (used.has(nm)) nm = safe(L[0].name) + '_' + k++; used.add(nm);
      const txt = make(L, nm); if (txt == null) return;
      if (typeof App.download === 'function') await App.download(nm + ext, txt, mime, 'svStl'); else App.anchorDownload(nm + ext, txt, mime);
    }
  }

  // ---------- Projekt ------------------------------------------------------------------------------------
  function toB64(arr) { const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(b64, Ctor) { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Ctor(u8.buffer); }
  function serialize() {
    if (!E.bodies.length) return null;
    const stepOf = b => { if (!brepOk(b)) return b.stepPending || undefined; try { return MeshOCC.writeSTEP([b.brep]); } catch (e) { return undefined; } };
    return { v: 1, bodies: E.bodies.map(b => ({ name: b.name, color: b.color, hidden: !!b.hidden, cad: !!b.cad, rpMold: b.rpMold != null ? !!b.rpMold : undefined, rpCanopy: b.rpCanopy ? true : undefined, transp: b.transp ? true : undefined, alpha: b.alpha != null ? b.alpha : undefined, step: stepOf(b), V: toB64(new Float64Array(b.V)), F: toB64(new Uint32Array(b.F)), G: toB64(new Int32Array(b.G)) })) };
  }
  function deserialize(o) {
    reset(true);
    if (!o || !Array.isArray(o.bodies)) { draw(); return false; }
    for (const q of o.bodies) {
      try { const b = mkBody(q.name, fromB64(q.V, Float64Array), fromB64(q.F, Uint32Array), fromB64(q.G, Int32Array), q.color); b.hidden = !!q.hidden; b.cad = !!q.cad; if (q.rpMold != null) b.rpMold = !!q.rpMold; if (q.rpCanopy) b.rpCanopy = true; if (q.transp) b.transp = true; if (q.alpha != null) b.alpha = +q.alpha; if (q.step) b.stepPending = q.step; E.bodies.push(b); } catch (e) {}
    }
    resetCam(); draw();
    restoreBreps();
    return true;
  }
  // gespeicherte CAD-Formen nach dem Laden eines Projekts wiederherstellen (OpenCascade startet asynchron)
  function restoreBreps() {
    const pend = E.bodies.filter(b => b.stepPending); if (!pend.length || !OCC()) return;
    MeshOCC.ready().then(O => {
      let n = 0;
      for (const b of pend) {
        const txt = b.stepPending; b.stepPending = null;
        if (!E.bodies.includes(b)) continue;
        try { const sh = O.fromText(txt), L = O.splitBodies(sh); setShape(b, L.length === 1 ? L[0] : sh); n++; } catch (e) { console.warn('3D-Bearbeitung: CAD-Form nicht wiederherstellbar', e); }
      }
      if (n) { E.selF.clear(); changed(true); }
    }).catch(e => console.warn('3D-Bearbeitung: OpenCascade nicht verfügbar', e));
  }
  function reset(quiet) { E.bodies = []; E.undo = []; E.redo = []; clearSel(); E.mate = null; E.drag = null; meas.list = []; meas.cur = null; meas.hover = null; if (!quiet) draw(); }

  // ---------- Ansicht (WebGL2, Rückfall Canvas-2D) --------------------------------------------------------
  let canvas = null, ctx = null, W = 0, H = 0, bound = false;
  const CAM0 = { yaw: 0.9, pitch: 0.45, zoom: 1, px: 0, py: 0 }, cam = Object.assign({}, CAM0);
  let center = [0, 0, 0], radius = 100, pivot = null, camFixed = false;
  const LIGHT = (() => { const l = [-0.35, 0.55, 0.75], n = Math.hypot(...l); return l.map(x => x / n); })();
  function rot(n) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), x1 = n[0] * cy + n[2] * sy, z1 = -n[0] * sy + n[2] * cy, cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [x1, n[1] * cp - z1 * sp, n[1] * sp + z1 * cp];
  }
  function invRot(c) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const y = c[1] * cp + c[2] * sp, z1 = -c[1] * sp + c[2] * cp;
    return [c[0] * cy - z1 * sy, y, c[0] * sy + z1 * cy];
  }
  const scale = () => 0.42 * Math.min(W, H) / radius * cam.zoom;
  function scr(x, y, z) { const r = rot([x - center[0], y - center[1], z - center[2]]), s = scale(); return { x: W / 2 + cam.px + s * r[0], y: H / 2 + cam.py - s * r[1], d: r[2] }; }
  // Kamera auf alle Körper einpassen (Mitte + Radius fest, damit beim Bearbeiten nichts springt)
  function resetCam() {
    const vis = E.bodies.filter(b => !b.hidden && b.F.length);
    Object.assign(cam, CAM0); pivot = null;
    if (!vis.length) { center = [0, 0, 0]; radius = 100; camFixed = false; return; }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const b of vis) { const bb = bboxUsed(b); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], bb.mn[k]); mx[k] = Math.max(mx[k], bb.mx[k]); } }
    center = bbCenter({ mn, mx }); radius = Math.max(1, bbDiag({ mn, mx }) / 2); camFixed = true;
  }
  function fit() {
    canvas = document.getElementById('cMeshed'); if (!canvas) return false;
    const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    W = r.width; H = r.height; if (!(W > 0 && H > 0)) return false;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!bound) bind();
    return true;
  }
  // vorderstes Dreieck unter dem Bildpunkt → {b, t, pt}
  function pick(mx, my) {
    let best = null; const s = scale();
    for (const b of E.bodies) {
      if (b.hidden) continue;
      const V = b.V, F = b.F, nv = V.length / 3, X = new Float32Array(nv), Y = new Float32Array(nv), D = new Float32Array(nv);
      for (let i = 0; i < nv; i++) { const r = rot([V[i * 3] - center[0], V[i * 3 + 1] - center[1], V[i * 3 + 2] - center[2]]); X[i] = W / 2 + cam.px + s * r[0]; Y[i] = H / 2 + cam.py - s * r[1]; D[i] = r[2]; }
      for (let t = 0; t < F.length / 3; t++) {
        const a = F[t * 3], c = F[t * 3 + 1], d = F[t * 3 + 2];
        const ax = X[a], ay = Y[a], bx = X[c], by = Y[c], cx = X[d], cy = Y[d];
        if (mx < Math.min(ax, bx, cx) || mx > Math.max(ax, bx, cx) || my < Math.min(ay, by, cy) || my > Math.max(ay, by, cy)) continue;
        const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;
        const u = ((by - cy) * (mx - cx) + (cx - bx) * (my - cy)) / den, w = ((cy - ay) * (mx - cx) + (ax - cx) * (my - cy)) / den, q = 1 - u - w;
        if (u < -1e-6 || w < -1e-6 || q < -1e-6) continue;
        const dd = u * D[a] + w * D[c] + q * D[d];
        if (!best || dd < best.d) best = { b, t, d: dd, pt: [0, 1, 2].map(k => u * V[a * 3 + k] + w * V[c * 3 + k] + q * V[d * 3 + k]) };
      }
    }
    return best;
  }
  function setPivotAt(x, y) {
    const h = pick(x, y); if (!h) return false;
    const q = scr(h.pt[0], h.pt[1], h.pt[2]);
    pivot = h.pt; center = h.pt.slice(); cam.px = q.x - W / 2; cam.py = q.y - H / 2;
    draw(); return true;
  }
  const isTyping = () => { const a = document.activeElement; return a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable); };
  // Ziehen mit der Maus: Strg+Ziehen auf einer Auswahl verschiebt (Körper in der Bildebene oder
  // entlang der gesperrten Achse; Flächen entlang ihrer Normale bzw. der gesperrten Achse)
  function dragDir() {
    const c = cfg(), dr = E.drag; if (c.lock) { const u = [0, 0, 0]; u[AX[c.lock]] = 1; return u; }
    return dr.kind === 'face' ? dr.n : null;
  }
  function dragDelta(dx, dy) {
    const s = scale(), u = dragDir();
    if (!u) return invRot([dx / s, -dy / s, 0]);
    const r = rot(u), sx = r[0] * s, sy = -r[1] * s, L2 = sx * sx + sy * sy;
    if (L2 < 1e-6) return [0, 0, 0];
    const t = (dx * sx + dy * sy) / L2;
    return u.map(x => x * t);
  }
  function startDrag(hit, e) {
    const c = cfg();
    if (c.mode === 'face') {
      const g = hit.b.G[hit.t], s = E.selF.get(hit.b.id);
      if (!s || !s.has(g)) { clearSel(); E.selF.set(hit.b.id, new Set([g])); }
      const items = [...E.selF].map(([id, gs]) => { const b = byId(id), f = faceFrame(b, gs); return f ? { b, f, V0: b.V } : null; }).filter(Boolean);
      if (!items.length) return false;
      snap();
      const n = items[0].f.n.slice();
      for (const it of items) it.b.V = Float64Array.from(it.V0);
      E.drag = { kind: 'face', items, n, x0: e.clientX, y0: e.clientY, delta: [0, 0, 0] };
    } else {
      if (!E.selB.has(hit.b.id)) { clearSel(); E.selB.add(hit.b.id); }
      E.drag = { kind: 'body', ids: new Set(E.selB), x0: e.clientX, y0: e.clientY, delta: [0, 0, 0] };
    }
    return true;
  }
  function moveDrag(e) {
    const dr = E.drag; dr.delta = dragDelta(e.clientX - dr.x0, e.clientY - dr.y0);
    if (dr.kind === 'face') {
      for (const it of dr.items) { const V = it.b.V, V0 = it.V0; for (const o of it.f.verts) for (let k = 0; k < 3; k++) V[o * 3 + k] = V0[o * 3 + k] + dr.delta[k]; touch(it.b); }
    }
    scheduleDraw();
  }
  function endDrag() {
    const dr = E.drag; E.drag = null; if (!dr) return;
    const moved = Math.hypot(dr.delta[0], dr.delta[1], dr.delta[2]) > 1e-9;
    if (dr.kind === 'body') {
      if (moved) { snap(); for (const id of dr.ids) { const b = byId(id); if (b) xformBody(b, null, null, dr.delta); } }
    } else if (!moved) { E.undo.pop(); for (const it of dr.items) { it.b.V = it.V0; touch(it.b); } }
    else for (const it of dr.items) {   // CAD-Körper: Push/Pull statt Eckpunkte verschieben
      const b = it.b; if (!(b.brep && it.V0 === b.brepV && b.F === b.brepF)) continue;
      const cur = b.V; b.V = it.V0;
      const gs = E.selF.get(b.id) || new Set();
      if (!occPushPull(b, gs, it.f, dr.delta)) b.V = cur;
    }
    changed(true);
  }
  let rafPending = false;
  function scheduleDraw() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); }); setTimeout(() => { if (rafPending) { rafPending = false; draw(); } }, 80); }
  function bind() {
    bound = true; let down = null;
    canvas.addEventListener('mousedown', e => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.button === 0 && (e.ctrlKey || e.metaKey) && !E.mate && !meas.on) {
        const h = pick(x, y);
        if (h && startDrag(h, e)) { e.preventDefault(); return; }
      }
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, pan: e.shiftKey || e.button !== 0, moved: false, btn: e.button, add: e.shiftKey, alt: e.altKey, cx: x, cy: y };
      e.preventDefault();
    });
    canvas.addEventListener('mousemove', e => {
      if (down || E.drag || !measActive()) return;
      const r = canvas.getBoundingClientRect(); measHoverAt(e.clientX - r.left, e.clientY - r.top, e.altKey);
    });
    canvas.addEventListener('mouseleave', () => measHoverOff());
    window.addEventListener('mousemove', e => {
      if (E.drag) { moveDrag(e); return; }
      if (!down) return;
      const dx = e.clientX - down.lx, dy = e.clientY - down.ly; down.lx = e.clientX; down.ly = e.clientY;
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return;
      down.moved = true; meas.hover = null;
      if (down.pan) { cam.px += dx; cam.py += dy; } else { cam.yaw -= dx * 0.01; cam.pitch = clamp(cam.pitch - dy * 0.01, -1.55, 1.55); }
      scheduleDraw();
    });
    window.addEventListener('mouseup', () => {
      if (E.drag) { endDrag(); return; }
      const d = down; down = null; if (!d || d.moved) return;
      if (measActive()) { if (d.btn === 0 || d.btn === 2) measClick(d.cx, d.cy, d.btn === 2, d.alt); return; }
      if (d.btn !== 0) return;
      const h = pick(d.cx, d.cy);
      if (E.mate) { mateClick(h); return; }
      clickSelect(h, d.add); changed(true);
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.zoom = clamp(cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.05, 200); scheduleDraw(); }, { passive: false });
    if (window.ViewCube && ViewCube.midDbl) ViewCube.midDbl(canvas, (x, y) => setPivotAt(x, y));
    const vb = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    const view = over => { resetCam(); Object.assign(cam, over || {}); draw(); };
    vb('meshedIso', () => view()); vb('meshedTop', () => view({ yaw: 0, pitch: 1.5 })); vb('meshedSide', () => view({ yaw: 0, pitch: 0 })); vb('meshedFront', () => view({ yaw: Math.PI / 2, pitch: 0 }));
    vb('meshedModeBody', () => setMode('body')); vb('meshedModeFace', () => setMode('face'));
    vb('meshedUndo', undo); vb('meshedRedo', redo);
    vb('meshedWire', () => { cfg().wire = !cfg().wire; draw(); });
    vb('meshedMeas', () => setMeas(!meas.on));
    vb('meshedSec', () => { if (window.MeshSection) { if (MeshSection.isOpen()) MeshSection.close(); else MeshSection.open(); } });
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'meshed' || isTyping()) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (meas.on) {
        if (k === 'escape') { if (meas.cur) meas.cur = null; else setMeas(false); buildMeasPanel(); draw(); e.preventDefault(); return; }
        if (k === 'enter' && meas.cur && meas.cur.type === 'chain') { measFinish(); buildMeasPanel(); draw(); e.preventDefault(); return; }
      }
      if (k === 'm') { setMeas(!meas.on); return; }
      if (k === 'delete') { e.preventDefault(); if (selCount()) opDelete(); return; }
      if (k === 'escape') { if (E.mate) { E.mate = null; changed(true); } else if (selCount()) { clearSel(); changed(true); } return; }
      if (E.drag && (k === 'x' || k === 'y' || k === 'z')) { const c = cfg(); c.lock = c.lock === k ? '' : k; moveDrag({ clientX: E.drag.x0 + (E.drag.lastDx || 0), clientY: E.drag.y0 + (E.drag.lastDy || 0) }); }
      if (k === 'k') setMode('body'); else if (k === 'f') setMode('face');
    });
    window.addEventListener('mousemove', e => { if (E.drag) { E.drag.lastDx = e.clientX - E.drag.x0; E.drag.lastDy = e.clientY - E.drag.y0; } }, true);
    if (window.ViewCube) ViewCube.attach({ reset: () => { resetCam(); }, canvas: () => canvas, get: () => cam, set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: () => draw(), rot: ViewCube.ROT_STD, k: [-0.01, -0.01] });
  }
  function setMode(m) { const c = cfg(); if (c.mode === m) return; c.mode = m; clearSel(); E.mate = null; changed(true); }
  function mateClick(h) {
    if (!h) return;
    const g = h.b.G[h.t];
    if (E.mate.step === 1) { E.mate = { step: 2, a: { id: h.b.id, g } }; clearSel(); E.selF.set(h.b.id, new Set([g])); changed(true); return; }
    const a = E.mate.a; E.mate = null; doMate(a, { id: h.b.id, g });
  }

  // ---------- Messwerkzeug (wie im Formenbau) ----------------------------------------------------------
  /* Abstand (mit ΔX/ΔY/ΔZ), Kette, Winkel, Radius (Kreis durch drei Punkte) und Wandstärke (Strahl senkrecht zur
   * Fläche bis zur Gegenseite). Punkte liegen auf der Oberfläche (vorderstes Dreieck), Fang auf Netzecken,
   * Flächenmitten und vorhandene Messpunkte. Messungen sind Weltpunkte (nur Sitzung) — sie bleiben stehen,
   * wenn Körper danach bewegt werden. Klick setzt Punkte statt auszuwählen, Ziehen dreht weiter. */
  const V3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]), norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };
  const MEAS_MODES = [['dist', 'Abstand'], ['chain', 'Kette'], ['angle', 'Winkel'], ['radius', 'Radius'], ['thick', 'Wandstärke']];
  const MEAS_NEED = { dist: 2, angle: 3, radius: 3 };
  const MEAS_COL = '#7CFC9A', MEAS_COL_CUR = '#ffd27a';
  const meas = { on: false, mode: 'dist', snap: true, axes: true, list: [], cur: null, hover: null, raf: 0, hx: 0, hy: 0, halt: false };
  const measActive = () => meas.on && E.bodies.some(b => !b.hidden && b.F.length);
  // vorderster Oberflächenpunkt unter (x, y): { p, n (Dreiecksnormale), b, snap }
  function measHit(x, y, noSnap) {
    const h = pick(x, y); if (!h) return null;
    const b = h.b, F = b.F, V = b.V, t = h.t, tmp = [0, 0, 0];
    triNormal(V, F, t, tmp); const n = V3.norm(tmp);
    let p = h.pt.slice(), snap = '';
    if (!noSnap && meas.snap) {
      let bd = 8;
      const tryQ = (q, kind) => { const e = scr(q[0], q[1], q[2]), dd = Math.hypot(e.x - x, e.y - y); if (dd < bd) { bd = dd; p = q.slice(); snap = kind; } };
      for (let e = 0; e < 3; e++) { const o = F[t * 3 + e] * 3; tryQ([V[o], V[o + 1], V[o + 2]], 'v'); }
      const f = faceFrame(b, new Set([b.G[t]])); if (f && f.dev < 1e-3 * radius) tryQ(f.c, 'c');   // Mitte einer ebenen Fläche
      for (const m of meas.list.concat(meas.cur ? [meas.cur] : [])) for (const q of m.pts) tryQ(q, 'm');
    }
    return { p, n, b, snap };
  }
  // Strahl P0 + t·d gegen alle Dreiecke eines Körpers (Möller–Trumbore): alle t > 1 µm aufsteigend, Doppeltreffer zusammengefasst
  function measRay(b, P0, d) {
    const V = b.V, F = b.F, out = [];
    for (let k = 0; k < F.length; k += 3) {
      const a = F[k] * 3, c = F[k + 1] * 3, e = F[k + 2] * 3, ax = V[a], ay = V[a + 1], az = V[a + 2];
      const e1x = V[c] - ax, e1y = V[c + 1] - ay, e1z = V[c + 2] - az, e2x = V[e] - ax, e2y = V[e + 1] - ay, e2z = V[e + 2] - az;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = P0[0] - ax, ty = P0[1] - ay, tz = P0[2] - az;
      const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (w < -1e-9 || u + w > 1 + 1e-9) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t > 1e-3) out.push(t);
    }
    out.sort((a, b) => a - b);
    return out.filter((t, k) => !k || t - out[k - 1] > 1e-6);
  }
  // Wandstärke: Innenseite = Richtung mit ungerader Trefferzahl (geschlossenes Netz), sonst gegen die Normale
  function measThick(h) {
    if (h.thick !== undefined) return h.thick;
    const n = h.n, a = measRay(h.b, h.p, n), c = measRay(h.b, h.p, V3.mul(n, -1));
    let dir = -1, hits = c;
    if ((a.length % 2 === 1 && c.length % 2 === 0) || !c.length) { dir = 1; hits = a; }
    if (!hits.length) return (h.thick = null);
    return (h.thick = { t: hits[0], q: V3.add(h.p, V3.mul(n, dir * hits[0])) });
  }
  function circle3(A, B, Cc) {
    const a = V3.sub(A, Cc), b = V3.sub(B, Cc), axb = V3.cross(a, b), n2 = V3.dot(axb, axb), la = V3.len(a), lb = V3.len(b);
    if (la < 1e-9 || lb < 1e-9 || Math.sqrt(n2) < 1e-6 * la * lb) return null;
    const c = V3.add(Cc, V3.mul(V3.cross(V3.sub(V3.mul(b, la * la), V3.mul(a, lb * lb)), axb), 1 / (2 * n2)));
    return { c, r: V3.len(V3.sub(A, c)), n: V3.norm(axb) };
  }
  function measCalc(m) {
    const P = m.pts, f = x => x.toFixed(2);
    if ((m.type === 'dist' || m.type === 'thick') && P.length >= 2) {
      const d = V3.sub(P[1], P[0]), L = V3.len(d);
      return m.type === 'thick' ? { v: L, main: f(L) + ' mm', sub: T('Wandstärke senkrecht zur Fläche') }
        : { v: L, main: f(L) + ' mm', sub: 'ΔX ' + f(d[0]) + ' · ΔY ' + f(d[1]) + ' · ΔZ ' + f(d[2]) + ' mm' };
    }
    if (m.type === 'chain' && P.length >= 2) {
      let L = 0; for (let i = 1; i < P.length; i++) L += V3.len(V3.sub(P[i], P[i - 1]));
      return { v: L, main: 'Σ ' + f(L) + ' mm', sub: (P.length - 1) + ' ' + T('Strecken') };
    }
    if (m.type === 'angle' && P.length >= 3) {
      const a = V3.sub(P[0], P[1]), b = V3.sub(P[2], P[1]), la = V3.len(a), lb = V3.len(b);
      if (!(la > 1e-9 && lb > 1e-9)) return null;
      const ang = Math.acos(clamp(V3.dot(a, b) / (la * lb), -1, 1)) * 180 / Math.PI;
      return { v: ang, main: ang.toFixed(2) + '°', sub: T('Ergänzung') + ' ' + (180 - ang).toFixed(2) + '° · ' + T('Schenkel') + ' ' + f(la) + ' / ' + f(lb) + ' mm' };
    }
    if (m.type === 'radius' && P.length >= 3) {
      const c = circle3(P[0], P[1], P[2]);
      return c ? { v: c.r, main: 'R ' + f(c.r) + ' mm', sub: 'Ø ' + f(2 * c.r) + ' mm · ' + T('Mitte') + ' X ' + f(c.c[0]) + ' Y ' + f(c.c[1]) + ' Z ' + f(c.c[2]) } : null;
    }
    return null;
  }
  function measTag(x, y, txt, colr) {
    ctx.font = 'bold 12px system-ui';
    const w = ctx.measureText(txt).width + 10, h = 18, bx = Math.min(Math.max(4, x + 8), W - w - 4), by = Math.min(Math.max(4, y - h - 6), H - h - 4);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, h, 4) : ctx.rect(bx, by, w, h);
    ctx.globalAlpha = 0.85; ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = colr; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 5, by + h / 2 + 0.5);
  }
  function drawMeasOne(m, k, colr, preview) {
    const Wp = m.pts, Sp = Wp.map(w => scr(w[0], w[1], w[2])), r = measCalc(m);
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const path = (pts, close) => { ctx.beginPath(); pts.forEach((w, i) => { const e = scr(w[0], w[1], w[2]); i ? ctx.lineTo(e.x, e.y) : ctx.moveTo(e.x, e.y); }); if (close) ctx.closePath(); ctx.stroke(); };
    ctx.strokeStyle = colr; ctx.lineWidth = 1.6; ctx.setLineDash(preview ? [5, 4] : []);
    let at = Sp[Sp.length - 1];
    if (m.type === 'dist' || m.type === 'thick' || m.type === 'chain') {
      for (let i = 1; i < Sp.length; i++) line(Sp[i - 1], Sp[i]);
      if (Sp.length === 2 && m.type !== 'chain') at = { x: (Sp[0].x + Sp[1].x) / 2, y: (Sp[0].y + Sp[1].y) / 2 };
      if (m.type === 'dist' && meas.axes && Wp.length === 2) {   // Achsanteile als farbiger Winkelzug
        const d = V3.sub(Wp[1], Wp[0]); let q = Wp[0].slice();
        ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const [ax, cl, nm] of [[0, '#ff8080', 'ΔX'], [1, '#ffe066', 'ΔY'], [2, '#80b8ff', 'ΔZ']]) {
          if (Math.abs(d[ax]) < 1e-6) continue;
          const q2 = q.slice(); q2[ax] += d[ax];
          const a = scr(q[0], q[1], q[2]), b = scr(q2[0], q2[1], q2[2]);
          ctx.strokeStyle = cl; ctx.globalAlpha = 0.85; line(a, b);
          if (Math.hypot(b.x - a.x, b.y - a.y) > 46) { ctx.fillStyle = cl; ctx.fillText(nm + ' ' + d[ax].toFixed(1), (a.x + b.x) / 2, (a.y + b.y) / 2 - 7); }
          q = q2;
        }
        ctx.restore(); ctx.strokeStyle = colr;
      }
    } else if (m.type === 'angle') {
      if (Sp.length >= 2) line(Sp[0], Sp[1]);
      if (Sp.length >= 3) {
        line(Sp[1], Sp[2]);
        const a = V3.sub(Wp[0], Wp[1]), b = V3.sub(Wp[2], Wp[1]), la = V3.len(a), lb = V3.len(b);
        if (la > 1e-9 && lb > 1e-9) {
          const e1 = V3.mul(a, 1 / la), bp = V3.sub(b, V3.mul(e1, V3.dot(b, e1))), lbp = V3.len(bp);
          const th = Math.acos(clamp(V3.dot(a, b) / (la * lb), -1, 1)), rr = 0.3 * Math.min(la, lb);
          if (lbp > 1e-9) {
            const e2 = V3.mul(bp, 1 / lbp), arc = [];
            for (let j = 0; j <= 32; j++) { const t = th * j / 32; arc.push(V3.add(Wp[1], V3.add(V3.mul(e1, rr * Math.cos(t)), V3.mul(e2, rr * Math.sin(t))))); }
            ctx.setLineDash([]); path(arc); ctx.setLineDash(preview ? [5, 4] : []);
            at = scr(arc[16][0], arc[16][1], arc[16][2]);
          }
        }
      }
    } else if (m.type === 'radius') {
      ctx.save(); ctx.lineWidth = 1; ctx.globalAlpha = 0.6; for (let i = 1; i < Sp.length; i++) line(Sp[i - 1], Sp[i]); ctx.restore();
      const c = Wp.length >= 3 ? circle3(Wp[0], Wp[1], Wp[2]) : null;
      if (c) {
        const u = V3.norm(V3.sub(Wp[0], c.c)), v = V3.cross(c.n, u), ring = [];
        for (let j = 0; j < 72; j++) { const t = j / 72 * Math.PI * 2; ring.push(V3.add(c.c, V3.add(V3.mul(u, c.r * Math.cos(t)), V3.mul(v, c.r * Math.sin(t))))); }
        path(ring, true);
        const ce = scr(c.c[0], c.c[1], c.c[2]);
        ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([4, 3]); line(ce, Sp[1]); ctx.restore();
        ctx.beginPath(); ctx.moveTo(ce.x - 5, ce.y); ctx.lineTo(ce.x + 5, ce.y); ctx.moveTo(ce.x, ce.y - 5); ctx.lineTo(ce.x, ce.y + 5); ctx.stroke();
        at = ce;
      }
    }
    ctx.setLineDash([]);
    for (const e of Sp) { ctx.beginPath(); ctx.arc(e.x, e.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = colr; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke(); }
    if (r && at) measTag(at.x, at.y, (k ? k + ': ' : '') + r.main, colr);
  }
  function drawMeas() {
    if (!measActive()) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    meas.list.forEach((m, i) => drawMeasOne(m, i + 1, MEAS_COL, false));
    const h = meas.hover;
    if (meas.mode === 'thick' && h && !meas.cur) { const th = measThick(h); if (th) drawMeasOne({ type: 'thick', pts: [h.p, th.q] }, 0, MEAS_COL_CUR, true); }
    else if (meas.cur) drawMeasOne(h ? { type: meas.cur.type, pts: meas.cur.pts.concat([h.p]) } : meas.cur, 0, MEAS_COL_CUR, true);
    if (h) {   // Cursor: Kreis = frei, Quadrat = Netzecke, Dreieck = Flächenmitte, Raute = Messpunkt
      const e = scr(h.p[0], h.p[1], h.p[2]);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
      if (h.snap === 'v') ctx.rect(e.x - 5, e.y - 5, 10, 10);
      else if (h.snap === 'c') { ctx.moveTo(e.x, e.y - 7); ctx.lineTo(e.x + 6, e.y + 5); ctx.lineTo(e.x - 6, e.y + 5); ctx.closePath(); }
      else if (h.snap === 'm') { ctx.moveTo(e.x, e.y - 7); ctx.lineTo(e.x + 7, e.y); ctx.lineTo(e.x, e.y + 7); ctx.lineTo(e.x - 7, e.y); ctx.closePath(); }
      else { ctx.arc(e.x, e.y, 5, 0, Math.PI * 2); ctx.moveTo(e.x - 10, e.y); ctx.lineTo(e.x - 6, e.y); ctx.moveTo(e.x + 6, e.y); ctx.lineTo(e.x + 10, e.y); ctx.moveTo(e.x, e.y - 10); ctx.lineTo(e.x, e.y - 6); ctx.moveTo(e.x, e.y + 6); ctx.lineTo(e.x, e.y + 10); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function measFinish() { const m = meas.cur; meas.cur = null; if (m && measCalc(m)) meas.list.push(m); }
  // Klick: Punkt setzen; Rechtsklick = Kette beenden bzw. letzten Punkt / letzte Messung zurücknehmen
  function measClick(x, y, right, noSnap) {
    if (right) {
      if (meas.cur && meas.cur.type === 'chain' && meas.cur.pts.length >= 2) measFinish();
      else if (meas.cur) { meas.cur.pts.pop(); if (!meas.cur.pts.length) meas.cur = null; }
      else meas.list.pop();
      buildMeasPanel(); draw(); return;
    }
    const h = measHit(x, y, noSnap); if (!h) return;
    if (meas.mode === 'thick') {
      const th = measThick(h);
      if (!th) { if (App.toast) App.toast(T('Wandstärke: keine Gegenseite gefunden (Netz an dieser Stelle offen?)')); return; }
      meas.list.push({ type: 'thick', pts: [h.p, th.q] });
    } else {
      if (!meas.cur || meas.cur.type !== meas.mode) meas.cur = { type: meas.mode, pts: [] };
      const last = meas.cur.pts[meas.cur.pts.length - 1];
      if (last && V3.len(V3.sub(last, h.p)) < 1e-6) return;
      meas.cur.pts.push(h.p);
      const need = MEAS_NEED[meas.cur.type];
      if (need && meas.cur.pts.length >= need) {
        if (!measCalc(meas.cur)) { meas.cur.pts.pop(); if (App.toast) App.toast(T('Die drei Punkte liegen auf einer Geraden – anderen Punkt wählen.')); }
        else measFinish();
      }
    }
    buildMeasPanel(); draw();
  }
  function measHoverAt(x, y, noSnap) {
    meas.hx = x; meas.hy = y; meas.halt = noSnap;
    if (meas.raf) return;
    const go = () => { if (!meas.raf) return; meas.raf = 0; if (!measActive()) return; meas.hover = measHit(meas.hx, meas.hy, meas.halt); draw(); measLive(); };
    meas.raf = requestAnimationFrame(go); setTimeout(go, 80);   // Rückfall, falls kein Frame kommt
  }
  function measHoverOff() { if (meas.hover) { meas.hover = null; if (measActive()) { draw(); measLive(); } } }
  function measLive() {
    const el = document.getElementById('meshedMeasLive'); if (!el) return;
    const n = meas.cur ? meas.cur.pts.length : 0, md = meas.mode;
    const step = md === 'thick' ? T('Punkt auf der Fläche anklicken')
      : md === 'chain' ? T('Punkt') + ' ' + (n + 1) + (n >= 2 ? ' · ' + T('Rechtsklick oder Enter beendet die Kette') : '')
      : md === 'angle' ? [T('1. Schenkelpunkt'), T('Scheitelpunkt'), T('2. Schenkelpunkt')][n] || ''
      : T('Punkt') + ' ' + (n + 1) + ' / ' + MEAS_NEED[md] + (md === 'radius' ? ' ' + T('auf dem Bogen') : '');
    const h = meas.hover; let cur = '';
    if (h) {
      cur = 'X ' + h.p[0].toFixed(2) + ' · Y ' + h.p[1].toFixed(2) + ' · Z ' + h.p[2].toFixed(2);
      if (h.snap) cur += ' · ' + T(h.snap === 'v' ? 'Fang: Netzecke' : h.snap === 'c' ? 'Fang: Flächenmitte' : 'Fang: Messpunkt');
      if (md === 'thick') { const th = measThick(h); cur += '<br><b style="color:' + MEAS_COL_CUR + '">' + (th ? T('Wandstärke') + ' ' + th.t.toFixed(2) + ' mm' : T('keine Gegenseite')) + '</b>'; }
    }
    el.innerHTML = '<span style="color:' + MEAS_COL_CUR + '">' + step + '</span>' + (cur ? '<br><span style="opacity:.85">' + cur + '</span>' : '');
  }
  const measName = m => T((MEAS_MODES.find(q => q[0] === m.type) || ['', m.type])[1]);
  function setMeas(on) {
    meas.on = !!on; meas.cur = null; meas.hover = null;
    if (meas.on) { E.mate = null; E.drag = null; }
    buildMeasPanel(); draw();
  }
  // Bedienfeld rechts oben neben dem Ansichtswürfel
  function buildMeasPanel() {
    const el = document.getElementById('meshedMeasPanel'); if (!el) return;
    { const b = document.getElementById('meshedMeas'); if (b) b.classList.toggle('primary', meas.on); }
    el.innerHTML = '';
    if (!meas.on) { el.style.display = 'none'; if (canvas) canvas.style.cursor = ''; return; }
    el.style.display = ''; if (canvas) canvas.style.cursor = 'crosshair';
    const row = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;flex-wrap:wrap'; el.appendChild(d); return d; };
    const btn = (r, t, on, fn, title) => { const b = document.createElement('button'); b.textContent = T(t); b.className = on ? 'primary' : ''; b.style.cssText = 'flex:1 1 auto;padding:2px 6px;font-size:11px;min-width:0'; if (title) b.title = T(title); b.onclick = fn; r.appendChild(b); return b; };
    const ck = (r, t, on, fn, title) => { const l = document.createElement('label'); l.className = 'ck'; l.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap'; if (title) l.title = T(title); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = on; i.onchange = () => fn(i.checked); l.appendChild(i); l.appendChild(document.createTextNode(T(t))); r.appendChild(l); return l; };
    const redo = () => { buildMeasPanel(); draw(); };
    let r = row(); const h = document.createElement('b'); h.textContent = '📏 ' + T('Messen'); h.style.flex = '1'; r.appendChild(h);
    btn(r, 'aus', false, () => setMeas(false)).style.flex = '0 0 auto';
    r = row();
    const tips = { dist: 'Abstand zwischen zwei Punkten (mit ΔX / ΔY / ΔZ)', chain: 'Kette: Summe mehrerer Strecken, Rechtsklick oder Enter beendet', angle: 'Winkel aus drei Punkten, der zweite Punkt ist der Scheitel', radius: 'Radius des Kreises durch drei Punkte (z. B. Nasenradius, Übergang)', thick: 'Wandstärke: Strahl senkrecht zur Fläche nach innen bis zur Gegenseite (Profildicke, Formwand, Platte)' };
    for (const [k, t] of MEAS_MODES) btn(r, t, meas.mode === k, () => { meas.mode = k; meas.cur = null; redo(); }, tips[k]);
    r = row();
    ck(r, 'Fang', meas.snap, v => { meas.snap = v; }, 'Fang auf Netzecken, Mitten ebener Flächen und vorhandene Messpunkte im 8-px-Umkreis (Alt gedrückt = ohne Fang)');
    ck(r, 'ΔX/ΔY/ΔZ zeigen', meas.axes, v => { meas.axes = v; draw(); }, 'Beim Abstand die Achsanteile als farbigen Winkelzug einzeichnen');
    const live = document.createElement('div'); live.id = 'meshedMeasLive'; live.style.cssText = 'display:block;margin:4px 0;line-height:1.35'; el.appendChild(live);
    if (meas.list.length) {
      const lst = document.createElement('div'); lst.style.cssText = 'display:block;max-height:220px;overflow:auto;margin:4px 0;border-top:1px solid var(--line,#556);padding-top:4px';
      meas.list.forEach((m, i) => {
        const res = measCalc(m); if (!res) return;
        const it = document.createElement('div'); it.style.cssText = 'display:flex;align-items:flex-start;gap:6px;margin:3px 0';
        const tx = document.createElement('div'); tx.style.cssText = 'display:block;flex:1;min-width:0;line-height:1.3';
        tx.innerHTML = '<b style="color:' + MEAS_COL + '">' + (i + 1) + ': ' + res.main + '</b> <span style="opacity:.7">' + measName(m) + '</span><br><span style="opacity:.75;font-size:10px">' + res.sub + '</span>';
        const x = document.createElement('button'); x.textContent = '✕'; x.title = T('Messung löschen'); x.style.cssText = 'flex:0 0 auto;padding:0 6px;font-size:11px;min-width:0';
        x.onclick = () => { meas.list.splice(i, 1); redo(); };
        it.appendChild(tx); it.appendChild(x); lst.appendChild(it);
      });
      el.appendChild(lst);
      r = row();
      btn(r, '📋 Kopieren', false, () => {
        const t = meas.list.map((m, i) => { const q = measCalc(m); return q ? (i + 1) + '\t' + measName(m) + '\t' + q.main + '\t' + q.sub : ''; }).filter(Boolean).join('\n'); if (!t) return;
        const ok = () => App.toast && App.toast(T('Messwerte in die Zwischenablage kopiert'));
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, () => {}); else ok();
      }, 'Alle Messwerte als Text (tabulatorgetrennt) in die Zwischenablage');
      btn(r, 'Alle löschen', false, () => { meas.list = []; meas.cur = null; redo(); });
    }
    const hn = document.createElement('div'); hn.style.cssText = 'display:block;opacity:.6;font-size:10px;line-height:1.35;margin-top:4px';
    hn.textContent = T('Klick = Punkt auf der Oberfläche · Alt = ohne Fang · Rechtsklick = letzten Punkt bzw. letzte Messung zurücknehmen · Esc = abbrechen · Ziehen dreht weiter · Messungen bleiben stehen, wenn Körper danach bewegt werden');
    el.appendChild(hn);
    measLive();
  }

  // ----- Darstellung -----
  function cssVar(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function hexRGB(h, fb) { const m = /^#([0-9a-f]{6})$/i.exec(h || ''); return m ? [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255] : (fb || [0.6, 0.6, 0.6]); }
  function bgRGB() {
    try { ctx.fillStyle = cssVar('--bg', '#0f1216'); const n = ctx.fillStyle; let m = hexRGB(n, null); if (/^#/.test(n)) return m; m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(n); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255]; } catch (e) {}
    return [0.06, 0.07, 0.09];
  }
  const SELC = [1.0, 0.62, 0.15];
  // Kanten für die Darstellung: Flächengrenzen, offene (rot) und mehrfach genutzte Kanten
  function edgesOf(b) {
    if (b._edges) return b._edges;
    const et = edgeTris(b), F = b.F, G = b.G, NV = b.V.length / 3, feat = [], bad = [];
    let gn = null;   // tangentiale Flächengrenzen (beide Endpunkte glatt) nicht als Kante zeichnen
    const tang = (v, g1, g2) => { gn = gn || groupNormals(b); return isTangent(gn.acc.get(v * gn.ng + g1) || [0, 0, 0], gn.acc.get(v * gn.ng + g2) || [0, 0, 0]); };
    for (const [k, l] of et) {
      const i = Math.floor(k / NV), j = k - i * NV;
      if (l.length !== 2) bad.push(i, j);
      else if (G[l[0]] !== G[l[1]] && !(tang(i, G[l[0]], G[l[1]]) && tang(j, G[l[0]], G[l[1]]))) feat.push(i, j);
    }
    return (b._edges = { feat, bad, et, NV });
  }
  function faceShade(g) { const h = Math.imul(g + 1, 2654435761) >>> 0; return 0.86 + 0.14 * ((h % 1000) / 1000); }
  function selSig(b) { const c = cfg(); if (c.mode === 'face') { const s = E.selF.get(b.id); return 'f' + (s ? [...s].sort((x, y) => x - y).join(',') : ''); } return 'b' + (E.selB.has(b.id) ? 1 : 0); }
  let glc = null, gl = null, glP = null, glL = null, glVao = null, glTried = false;
  const glBufs = new Map();
  function glInit() {
    if (glTried || !canvas) return; glTried = true;
    try {
      glc = document.createElement('canvas'); glc.id = 'cMeshedGL'; glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      canvas.parentNode.insertBefore(glc, canvas);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true }); if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aPos; in float aTag; in vec3 aNrm;
        uniform vec3 uCenter; uniform float uYaw; uniform float uPitch; uniform vec4 uProj; uniform float uZScale; uniform vec3 uOff;
        out vec3 vCam; out float vTag; out vec3 vN;
        vec3 rot(vec3 p){ float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
          float x1 = p.x*cy + p.z*sy, z1 = -p.x*sy + p.z*cy; return vec3(x1, p.y*cp - z1*sp, p.y*sp + z1*cp); }
        void main(){ vec3 c = rot(aPos + uOff - uCenter); vCam = c; vTag = aTag; vN = rot(aNrm);
          gl_Position = vec4(uProj.z + uProj.x*c.x, uProj.w + uProj.y*c.y, c.z*uZScale, 1.0); }`;
      const FS = `#version 300 es
        precision highp float;
        in vec3 vCam; in float vTag; in vec3 vN; uniform vec3 uCol; uniform vec3 uSel; uniform vec3 uLight; uniform int uWire; uniform vec3 uBg; uniform float uAlpha; out vec4 o;
        void main(){
          if (uWire == 2) { o = vec4(uBg, 1.0); return; }
          if (uWire == 1) { vec3 lc = vTag > 1.5 ? vec3(1.0, 0.25, 0.2) : (vTag > 0.5 ? uSel : uCol * 0.35); o = vec4(lc, uAlpha); return; }
          if (uWire == 3) { vec3 lc = vTag > 1.5 ? vec3(1.0, 0.25, 0.2) : (vTag > 0.5 ? uSel : min(vec3(1.0), uCol * 1.25 + 0.08)); o = vec4(lc, 1.0); return; }
          vec3 col = vTag < 0.0 ? uSel : uCol * vTag;
          vec3 ng = normalize(cross(dFdx(vCam), dFdy(vCam))); if (ng.z > 0.0) ng = -ng;
          vec3 n = ng; float sl = dot(vN, vN);
          if (sl > 1e-6) { n = vN * inversesqrt(sl); if (dot(n, ng) < 0.0) n = -n; }   // glatte Normale, zur Blickseite gedreht
          float lam = max(0.0, dot(n, uLight)), a = 1.0;
          if (uAlpha < 0.999) { float g = 1.0 - abs(normalize(n).z); a = clamp(mix(uAlpha, uAlpha * 2.0 + 0.25, g * g), 0.0, 1.0); }   // durchsichtig, Ränder kräftiger
          o = vec4(col * (0.32 + 0.68*lam), a); }`;
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      glP = gl.createProgram(); gl.attachShader(glP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glP, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glP);
      if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP));
      glL = {}; for (const u of ['uCenter', 'uYaw', 'uPitch', 'uProj', 'uZScale', 'uCol', 'uSel', 'uLight', 'uWire', 'uBg', 'uOff', 'uAlpha']) glL[u] = gl.getUniformLocation(glP, u);
      glL.aPos = gl.getAttribLocation(glP, 'aPos'); glL.aTag = gl.getAttribLocation(glP, 'aTag'); glL.aNrm = gl.getAttribLocation(glP, 'aNrm');
      glVao = gl.createVertexArray();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glBufs.clear(); }, false);
    } catch (e) {
      console.warn('3D-Bearbeitung: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function glBuild(b) {
    const c = cfg(), V = b.V, F = b.F, G = b.G, nt = F.length / 3, d = new Float32Array(nt * 21), NC = cornerNormals(b);
    const fs = c.mode === 'face' ? E.selF.get(b.id) : null, bsel = c.mode === 'body' && E.selB.has(b.id);
    for (let t = 0; t < nt; t++) {
      const tag = (bsel || (fs && fs.has(G[t]))) ? -1 : (c.mode === 'face' ? faceShade(G[t]) : 1);
      for (let e = 0; e < 3; e++) { const o = F[t * 3 + e] * 3, q = (t * 3 + e) * 7, r = (t * 3 + e) * 3; d[q] = V[o]; d[q + 1] = V[o + 1]; d[q + 2] = V[o + 2]; d[q + 3] = tag; d[q + 4] = NC[r]; d[q + 5] = NC[r + 1]; d[q + 6] = NC[r + 2]; }
    }
    const ed = edgesOf(b), sel = fs, ls = [];
    const push = (i, j, tag) => { ls.push(V[i * 3], V[i * 3 + 1], V[i * 3 + 2], tag, V[j * 3], V[j * 3 + 1], V[j * 3 + 2], tag); };
    if (c.edges || c.wire) {
      if (c.wire) { for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) push(F[t * 3 + e], F[t * 3 + (e + 1) % 3], 0); }
      else for (let k = 0; k < ed.feat.length; k += 2) push(ed.feat[k], ed.feat[k + 1], 0);
    }
    for (let k = 0; k < ed.bad.length; k += 2) push(ed.bad[k], ed.bad[k + 1], 2);
    if (sel && sel.size) {   // Umriss der gewählten Flächen
      for (const [k, l] of ed.et) {
        let ns = 0; for (const u of l) if (sel.has(G[u])) ns++;
        if (ns && (l.length < 2 || ns < l.length)) { const i = Math.floor(k / ed.NV); push(i, k - i * ed.NV, 1); }
      }
    }
    return { tri: d, n: nt * 3, lin: new Float32Array(ls), nl: ls.length / 4 };
  }
  function glDraw(list) {
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(W * dpr)), h = Math.max(1, Math.round(H * dpr));
    if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; }
    const bg = bgRGB(), c = cfg();
    gl.viewport(0, 0, w, h); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const b of glBufs.values()) b.used = false;
    gl.useProgram(glP); gl.bindVertexArray(glVao); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    const s = scale();
    gl.uniform4f(glL.uProj, 2 * s / W, 2 * s / H, 2 * cam.px / W, -2 * cam.py / H); gl.uniform1f(glL.uZScale, 1 / (radius * 6));
    gl.uniform3f(glL.uCenter, center[0], center[1], center[2]); gl.uniform1f(glL.uYaw, cam.yaw); gl.uniform1f(glL.uPitch, cam.pitch);
    gl.uniform3f(glL.uLight, LIGHT[0], LIGHT[1], LIGHT[2]); gl.uniform3f(glL.uSel, SELC[0], SELC[1], SELC[2]); gl.uniform3f(glL.uBg, bg[0], bg[1], bg[2]);
    const bindB = (buf, st) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(glL.aPos); gl.vertexAttribPointer(glL.aPos, 3, gl.FLOAT, false, st, 0); gl.enableVertexAttribArray(glL.aTag); gl.vertexAttribPointer(glL.aTag, 1, gl.FLOAT, false, st, 12);
      if (glL.aNrm >= 0) { if (st > 16) { gl.enableVertexAttribArray(glL.aNrm); gl.vertexAttribPointer(glL.aNrm, 3, gl.FLOAT, false, st, 16); } else { gl.disableVertexAttribArray(glL.aNrm); gl.vertexAttrib3f(glL.aNrm, 0, 0, 0); } } };
    const drag = E.drag && E.drag.kind === 'body' ? E.drag : null;
    const items = [];
    for (const b of list) {
      const sig = b.ver + '|' + selSig(b) + '|' + c.mode + '|' + (c.edges ? 1 : 0) + (c.wire ? 1 : 0);
      let q = glBufs.get(b.id);
      if (!q || q.sig !== sig) {
        if (q) { gl.deleteBuffer(q.vbo); gl.deleteBuffer(q.lbo); }
        const d = glBuild(b); q = { sig, vbo: gl.createBuffer(), lbo: gl.createBuffer(), n: d.n, nl: d.nl };
        gl.bindBuffer(gl.ARRAY_BUFFER, q.vbo); gl.bufferData(gl.ARRAY_BUFFER, d.tri, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, q.lbo); gl.bufferData(gl.ARRAY_BUFFER, d.lin, gl.STATIC_DRAW);
        glBufs.set(b.id, q);
      }
      q.used = true; items.push({ b, q, off: drag && drag.ids.has(b.id) ? drag.delta : [0, 0, 0] });
    }
    // 1. Flächen (Drahtgitter: in Hintergrundfarbe), etwas nach hinten versetzt; durchsichtige Körper zuletzt
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 2);
    const isT = it => !c.wire && alphaOf(it.b) < 0.999;
    const face = it => {
      const col = hexRGB(it.b.color); gl.uniform3f(glL.uCol, col[0], col[1], col[2]); gl.uniform3f(glL.uOff, it.off[0], it.off[1], it.off[2]);
      gl.uniform1f(glL.uAlpha, isT(it) ? alphaOf(it.b) : 1); gl.uniform1i(glL.uWire, c.wire ? 2 : 0); bindB(it.q.vbo, 28); gl.drawArrays(gl.TRIANGLES, 0, it.q.n);
    };
    for (const it of items) if (!isT(it)) face(it);
    const trans = items.filter(isT);
    if (trans.length) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.CULL_FACE);
      for (const cf of [gl.FRONT, gl.BACK]) { gl.cullFace(cf); for (const it of trans) face(it); }
      gl.disable(gl.CULL_FACE); gl.depthMask(true); gl.disable(gl.BLEND);
    }
    gl.uniform1f(glL.uAlpha, 1);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));   // Treiberfalle: sonst gehen die Linien ab dem 2. Bild verloren
    // 2. Kanten
    for (const it of items) {
      if (!it.q.nl) continue;
      const col = hexRGB(it.b.color); gl.uniform3f(glL.uCol, col[0], col[1], col[2]); gl.uniform3f(glL.uOff, it.off[0], it.off[1], it.off[2]);
      const tr = !c.wire && alphaOf(it.b) < 0.999;
      if (tr) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(glL.uAlpha, Math.min(1, alphaOf(it.b) + 0.3)); }
      gl.uniform1i(glL.uWire, c.wire ? 3 : 1); bindB(it.q.lbo, 16); gl.drawArrays(gl.LINES, 0, it.q.nl);
      if (tr) { gl.disable(gl.BLEND); gl.uniform1f(glL.uAlpha, 1); }
    }
    gl.bindVertexArray(null);
    for (const [k, q] of glBufs) if (!q.used) { gl.deleteBuffer(q.vbo); gl.deleteBuffer(q.lbo); glBufs.delete(k); }
  }
  function drawShaded(list) {   // Rückfall ohne WebGL2: Maleralgorithmus
    const faces = [], c = cfg(), drag = E.drag && E.drag.kind === 'body' ? E.drag : null, tmp = [0, 0, 0];
    for (const b of list) {
      const V = b.V, F = b.F, col = hexRGB(b.color).map(x => x * 255), fs = c.mode === 'face' ? E.selF.get(b.id) : null, bs = c.mode === 'body' && E.selB.has(b.id);
      const off = drag && drag.ids.has(b.id) ? drag.delta : [0, 0, 0];
      for (let t = 0; t < F.length / 3; t++) {
        triNormal(V, F, t, tmp); const L = Math.hypot(...tmp) || 1; let n = rot(tmp.map(x => x / L)); if (n[2] > 0) n = n.map(x => -x);
        const p = [0, 1, 2].map(e => { const o = F[t * 3 + e] * 3; return scr(V[o] + off[0], V[o + 1] + off[1], V[o + 2] + off[2]); });
        const sel = bs || (fs && fs.has(b.G[t]));
        faces.push({ p, d: (p[0].d + p[1].d + p[2].d) / 3, l: 0.32 + 0.68 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]), c: sel ? SELC.map(x => x * 255) : col, a: c.wire ? 1 : alphaOf(b) });
      }
    }
    faces.sort((a, b) => b.d - a.d);
    for (const f of faces) {
      ctx.beginPath(); ctx.moveTo(f.p[0].x, f.p[0].y); ctx.lineTo(f.p[1].x, f.p[1].y); ctx.lineTo(f.p[2].x, f.p[2].y); ctx.closePath();
      const rgb = 'rgb(' + f.c.map(x => Math.round(x * f.l)).join(',') + ')';
      if (c.wire) { ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.strokeStyle = 'rgb(' + f.c.map(Math.round).join(',') + ')'; }
      else ctx.fillStyle = ctx.strokeStyle = (window.DrawTheme ? DrawTheme.raw(rgb) : rgb);
      ctx.globalAlpha = f.a; ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  // Achsenkreuz im Nullpunkt + Vorschau der Streck-Ebene (2D-Überlagerung)
  function drawOverlay() {
    const c = cfg();
    if (window.MeshSection) MeshSection.overlay(ctx, scr);   // Schnittebenen
    if (c.axes) {
      const L = radius * 0.25, o = scr(0, 0, 0);
      [[1, 0, 0, '#e05050', 'X'], [0, 1, 0, '#50c050', 'Y'], [0, 0, 1, '#5080e0', 'Z']].forEach(([x, y, z, col, nm]) => {
        const q = scr(x * L, y * L, z * L); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.fillStyle = col; ctx.font = '11px system-ui'; ctx.fillText(nm, q.x + 3, q.y - 3);
      });
    }
    if (c.st.show && stretchOpen && E.bodies.length) {
      const bs = stretchTargets(); if (!bs.length) return;
      const a = AX[c.st.axis], u = (a + 1) % 3, w = (a + 2) % 3, pos = stretchPos();
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const b of bs) { const bb = bboxUsed(b); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], bb.mn[k]); mx[k] = Math.max(mx[k], bb.mx[k]); } }
      const m = 0.08 * Math.max(mx[u] - mn[u], mx[w] - mn[w]);
      const quad = p => [[mn[u] - m, mn[w] - m], [mx[u] + m, mn[w] - m], [mx[u] + m, mx[w] + m], [mn[u] - m, mx[w] + m]].map(([pu, pw]) => { const P = [0, 0, 0]; P[a] = p; P[u] = pu; P[w] = pw; return scr(P[0], P[1], P[2]); });
      const poly = (Q, fill, stroke) => { ctx.beginPath(); Q.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); };
      poly(quad(pos), 'rgba(255,170,60,.16)', 'rgba(255,170,60,.9)');
      if (c.st.kind === 'band' && +c.st.band > 0) poly(quad(pos - c.st.band), 'rgba(255,170,60,.06)', 'rgba(255,170,60,.45)');
    }
  }
  let stretchOpen = false;   // Streck-Vorschau nur, solange die Gruppe offen ist
  function draw() {
    if (!ctx) { if (!fit()) return; }
    const list = E.bodies.filter(b => !b.hidden && b.F.length);
    ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fillRect(0, 0, W, H);
    if (!camFixed && list.length) resetCam();
    if (!list.length) {
      if (glc) glc.style.display = 'none';
      setInfo(T('Noch keine Körper. In der Seitenleiste „Dateien laden…" (STL, OBJ, STEP, IGES) oder aus dem Reiter „3D-Modell" übernehmen.'));
      drawModeBtns(); return;
    }
    if (!glTried) glInit();
    if (gl) { glc.style.display = ''; glDraw(list); ctx.clearRect(0, 0, W, H); } else drawShaded(list);
    drawOverlay();
    drawMeas();
    if (pivot && window.ViewCube && ViewCube.drawPivot) { const q = scr(pivot[0], pivot[1], pivot[2]); ViewCube.drawPivot(ctx, q.x, q.y); }
    drawModeBtns();
    info(list);
  }
  function drawModeBtns() {
    const c = cfg(), on = (id, v) => { const b = document.getElementById(id); if (b) b.classList.toggle('primary', !!v); };
    on('meshedModeBody', c.mode === 'body'); on('meshedModeFace', c.mode === 'face'); on('meshedWire', c.wire);
    const u = document.getElementById('meshedUndo'), r = document.getElementById('meshedRedo');
    if (u) u.disabled = !E.undo.length; if (r) r.disabled = !E.redo.length;
  }
  function info(list) {
    let nt = 0, open = 0; for (const b of list) { const s = stats(b); nt += s.ntri; open += s.open + s.nonman; }
    const c = cfg(), lines = [];
    lines.push(list.length + ' ' + T(list.length === 1 ? 'Körper' : 'Körper (sichtbar)') + ' · ' + nt + ' ' + T('Dreiecke') + (open ? ' · <span style="color:#f88">' + open + ' ' + T('offene Kanten') + '</span>' : ' · ' + T('geschlossen')));
    if (E.mate) lines.push('<b style="color:#fb6">' + T(E.mate.step === 1 ? 'Fläche an Fläche: 1. die Fläche am Körper anklicken, der bewegt wird' : 'Fläche an Fläche: 2. die Zielfläche am anderen Körper anklicken') + '</b> <span style="opacity:.7">(' + T('Esc = abbrechen') + ')</span>');
    if (E.drag) { const d = E.drag.delta; lines.push('<b style="color:#fb6">Δ ' + d.map(x => x.toFixed(2)).join(' / ') + ' mm' + (E.drag.kind === 'face' && !c.lock ? ' · ' + T('entlang der Normale') + ' ' + (d[0] * E.drag.n[0] + d[1] * E.drag.n[1] + d[2] * E.drag.n[2]).toFixed(2) + ' mm' : '') + (c.lock ? ' · ' + T('nur') + ' ' + c.lock.toUpperCase() : '') + '</b>'); }
    else {
      const sc = selCount();
      if (sc) {
        if (c.mode === 'face') {
          let A = 0; const f1 = E.selF.size === 1 ? faceFrame(byId([...E.selF.keys()][0]), [...E.selF.values()][0]) : null;
          for (const [id, gs] of E.selF) { const f = faceFrame(byId(id), gs); if (f) A += f.area; }
          lines.push(sc + ' ' + T(sc === 1 ? 'Fläche gewählt' : 'Flächen gewählt') + ' · ' + (A / 100).toFixed(2) + ' cm²'
            + (f1 ? ' · n = (' + f1.n.map(x => x.toFixed(3)).join(', ') + ')' + (f1.dev < 1e-3 * radius ? ' · ' + T('eben') : '') : ''));
        } else {
          const bs = selBodies(), b = bs[0], bb = bboxUsed(b), s = stats(b);
          lines.push(T('Auswahl') + ': ' + (bs.length === 1 ? b.name : bs.length + ' ' + T('Körper')) + ' · ' + [0, 1, 2].map(k => (bb.mx[k] - bb.mn[k]).toFixed(1)).join(' × ') + ' mm'
            + (bs.length === 1 ? ' · ' + T('Volumen') + ' ' + (Math.abs(s.vol) / 1000).toFixed(1) + ' cm³' : ''));
        }
      }
    }
    lines.push('<span style="opacity:.7">' + T('Klick = auswählen · Umschalt+Klick = dazu · Strg+Ziehen = Auswahl verschieben (X/Y/Z sperrt die Achse) · Ziehen = drehen · Umschalt/rechts = schieben · Rad = Zoom · Mausrad-Doppelklick = Drehpunkt · Strg+Z / Strg+Y · Entf') + '</span>');
    setInfo(lines.join('<br>'));
  }
  function show() { if (fit()) { buildMeasPanel(); draw(); } }
  function resize() { if (fit()) draw(); }

  // ---------- Seitenleiste --------------------------------------------------------------------------------
  function meshedSidebar(side) {
    const { grp, hint, numRow, boolRow, selectRow, subhead, buildSidebar } = App;
    const c = cfg(), RB = () => { buildSidebar(); draw(); };
    const btnRow = (body, defs) => {
      const d = document.createElement('div'); d.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
      for (const [txt, fn, tip, primary, dis] of defs) { const b = document.createElement('button'); b.textContent = T(txt); if (tip) b.title = T(tip); if (primary) b.className = 'primary'; b.disabled = !!dis; b.onclick = fn; d.appendChild(b); }
      body.appendChild(d); return d;
    };
    const num = (body, label, get, set, step, h) => numRow(body, label, get, v => { set(v); draw(); }, { step: step || 1, norender: true, hint: h });
    const AXES = [['x', 'X'], ['y', 'Y'], ['z', 'Z']];

    // --- Körper laden / Liste ---
    const g0 = grp('3D-Bearbeitung', true, 'meshed', { key: 'meshedMain' });
    hint(g0.body, 'STL-, OBJ-, STEP- und IGES-Dateien als einzelne Körper laden, zusammensetzen und bearbeiten. STEP/IGES behalten ihre CAD-Flächen; bei STL/OBJ werden Flächen über den Knickwinkel erkannt. Ergebnis als STL speichern oder an den Reiter „3D-Modell" übergeben (Zerlegen, G-Code).');
    btnRow(g0.body, [
      [E.bodies.length ? '+ Weitere Dateien laden…' : 'Dateien laden… (STL/OBJ/STEP/IGES)', async () => { const fs = await pickFiles(); if (fs && fs.length) await loadFiles(fs); }, 'Mehrfachauswahl möglich; jede Datei (bei STEP jedes Volumen) wird ein eigener Körper.', !E.bodies.length],
      ['Aus „3D-Modell" übernehmen', fromModel3D, 'Das Modell bzw. die Teile der Baugruppe aus dem Reiter „3D-Modell" als Körper übernehmen (in ihrer Lage).']
    ]);
    if (E.bodies.length) {
      subhead(g0.body, T('Körper') + ' (' + E.bodies.length + ')');
      E.bodies.forEach(b => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center';
        const ci = document.createElement('input'); ci.type = 'color'; ci.value = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#888888'; ci.title = T('Farbe');
        ci.style.cssText = 'width:30px;height:24px;padding:0 2px;flex:none;cursor:pointer'; ci.oninput = () => { b.color = ci.value; draw(); };
        row.appendChild(ci);
        const nb = document.createElement('button'), s = stats(b);
        nb.textContent = b.name; nb.title = b.name + ' · ' + s.ntri + ' ' + T('Dreiecke') + (s.open ? ' · ' + s.open + ' ' + T('offene Kanten') : '') + (brepOk(b) ? ' · ' + T('CAD-Volumen (exakte Flächen)') : b.cad ? ' · ' + T('CAD-Flächen (Netz)') : '');
        if (brepOk(b)) nb.textContent = '◆ ' + b.name;
        nb.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left' + (b.hidden ? ';opacity:.45' : '');
        const isSel = c.mode === 'body' ? E.selB.has(b.id) : E.selF.has(b.id);
        if (isSel) nb.className = 'primary';
        nb.onclick = e => { if (c.mode !== 'body') { c.mode = 'body'; clearSel(); } if (!e.shiftKey) { const had = E.selB.size === 1 && E.selB.has(b.id); clearSel(); if (!had) E.selB.add(b.id); } else if (E.selB.has(b.id)) E.selB.delete(b.id); else E.selB.add(b.id); RB(); };
        row.appendChild(nb);
        const mini = (txt, tip, fn, dis) => { const x = document.createElement('button'); x.textContent = txt; x.title = T(tip); x.disabled = !!dis; x.style.padding = '2px 7px'; x.onclick = fn; row.appendChild(x); };
        const i = E.bodies.indexOf(b);
        mini(b.hidden ? '◌' : '●', b.hidden ? 'Einblenden' : 'Ausblenden', () => { b.hidden = !b.hidden; RB(); });
        mini(b.transp ? '◐' : '○', b.transp ? 'Deckend darstellen' : 'Durchsichtig darstellen', () => { b.transp = !b.transp; RB(); });
        mini('↑', 'Nach vorne (Reihenfolge beim Aneinanderreihen)', () => { E.bodies.splice(i, 1); E.bodies.splice(i - 1, 0, b); RB(); }, i === 0);
        mini('✕', 'Körper entfernen', () => { snap(); E.bodies.splice(i, 1); cleanSel(); RB(); });
        g0.body.appendChild(row);
      });
      const nameRow = selBodies().length === 1 && c.mode === 'body' ? selBodies()[0] : null;
      if (nameRow) App.txtRow ? App.txtRow(g0.body, 'Name', () => nameRow.name, v => { nameRow.name = v; }) : null;
      btnRow(g0.body, [['Alle Körper entfernen', () => { if (confirm(T('Alle Körper entfernen?'))) { snap(); E.bodies = []; clearSel(); RB(); } }]]);
    }
    side.appendChild(g0.g);
    if (!E.bodies.length) return;

    // --- Auswahl ---
    const g1 = grp('Auswahl', true, 'meshed', { key: 'meshedSel' });
    selectRow(g1.body, 'Auswählen', [['body', 'Körper'], ['face', 'Fläche']], () => c.mode, v => { setMode(v); },
      'Körper: ganze Teile verschieben, drehen, zusammensetzen. Fläche: einzelne Flächen anklicken (Umschalt+Klick für mehrere) und verschieben, extrudieren, drehen. Tasten K / F.');
    selectRow(g1.body, 'Strg+Ziehen nur entlang', [['', c.mode === 'face' ? 'Flächennormale' : 'frei (Bildebene)'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], () => c.lock || '', v => { c.lock = v; draw(); });
    numRow(g1.body, 'Flächenerkennung: Knickwinkel (°)', () => c.angle, v => { c.angle = clamp(v, 1, 90); }, { step: 1, norender: true,
      hint: 'Nur STL/OBJ: Nachbardreiecke, deren Normalen weniger als diesen Winkel abweichen, bilden eine Fläche. Kleiner = feinere Flächen (Rundungen zerfallen), größer = gröbere. STEP/IGES behalten ihre CAD-Flächen.' });
    btnRow(g1.body, [
      ['Flächen neu erkennen', opRegroup, 'Wendet den Knickwinkel auf die gewählten (sonst alle) STL/OBJ-Körper an.'],
      ['Auswahl aufheben', () => { clearSel(); RB(); }, '', false, !selCount()],
      ['↶ Rückgängig', undo, 'Strg+Z', false, !E.undo.length], ['↷ Wiederholen', redo, 'Strg+Y', false, !E.redo.length]
    ]);
    side.appendChild(g1.g);

    // --- Fläche bearbeiten ---
    if (c.mode === 'face') {
      const fc = c.fc, g2 = grp('Fläche bearbeiten', true, 'meshed', { key: 'meshedFace' }), has = selCount() > 0;
      if (!has) hint(g2.body, 'Fläche in der Ansicht anklicken. Strg+Ziehen auf der Fläche schiebt sie direkt entlang ihrer Normale (Push/Pull).');
      else {
        const L = [...E.selF].map(([id, gs]) => faceFrame(byId(id), gs)).filter(Boolean);
        if (L.length === 1) hint(g2.body, T('Fläche') + ' ' + (L[0].area / 100).toFixed(2) + ' cm² · ' + T('Mitte') + ' (' + L[0].c.map(x => x.toFixed(1)).join(', ') + ') · ' + T('Normale') + ' (' + L[0].n.map(x => x.toFixed(3)).join(', ') + ')' + (L[0].dev > 1e-3 * radius ? ' · ' + T('gewölbt, Abweichung') + ' ' + L[0].dev.toFixed(2) + ' mm' : ''));
      }
      subhead(g2.body, 'Verschieben (angrenzende Flächen dehnen sich mit)');
      num(g2.body, 'Entlang der Normale (mm)', () => fc.d, v => { fc.d = v; }, 1);
      btnRow(g2.body, [['Entlang Normale verschieben', () => opFaceMove('normal'), 'Positiv = nach außen. Bei einer Stirnfläche wird der Körper so verlängert bzw. gekürzt; die Seitenflächen werden gedehnt.', false, !has]]);
      num(g2.body, 'Verschiebung X (mm)', () => fc.dx, v => { fc.dx = v; }, 1);
      num(g2.body, 'Verschiebung Y (mm)', () => fc.dy, v => { fc.dy = v; }, 1);
      num(g2.body, 'Verschiebung Z (mm)', () => fc.dz, v => { fc.dz = v; }, 1);
      btnRow(g2.body, [['Um X/Y/Z verschieben', () => opFaceMove('vec'), '', false, !has]]);
      subhead(g2.body, 'Extrudieren (neue Seitenwände)');
      num(g2.body, 'Strecke (mm)', () => fc.ext, v => { fc.ext = v; }, 1, 'Die Fläche wird entlang ihrer Normale versetzt; an ihrem Rand entstehen neue, gerade Seitenwände. Positiv = Material anbauen (verlängern), negativ = Tasche.');
      btnRow(g2.body, [['Extrudieren', opExtrude, '', false, !has]]);
      subhead(g2.body, 'Drehen / Skalieren / Ebnen');
      selectRow(g2.body, 'Drehachse (durch die Flächenmitte)', [['n', 'Flächennormale'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], () => fc.axis, v => { fc.axis = v; });
      num(g2.body, 'Winkel (°)', () => fc.ang, v => { fc.ang = v; }, 5);
      btnRow(g2.body, [['Fläche drehen', opFaceRotate, 'Dreht die Eckpunkte der Fläche; angrenzende Flächen folgen (z. B. Stirnfläche schräg stellen).', false, !has]]);
      num(g2.body, 'Faktor', () => fc.f, v => { fc.f = v; }, 0.05);
      btnRow(g2.body, [
        ['Fläche skalieren', opFaceScale, 'Um die Flächenmitte (z. B. Stirnfläche verjüngen).', false, !has],
        ['Ebnen', opFacePlanar, 'Eckpunkte der Fläche auf ihre Ausgleichsebene legen.', false, !has],
        ['Fläche löschen', opDeleteFaces, 'Entf. Hinterlässt ein Loch (z. B. Stirnkappe vor dem Vereinen) — mit „Löcher schließen" wieder zu.', false, !has]
      ]);
      side.appendChild(g2.g);
    }

    // --- Körper bearbeiten ---
    const bs = selBodies(), hasB = bs.length > 0;
    const g3 = grp('Körper bearbeiten', c.mode === 'body', 'meshed', { key: 'meshedBody' });
    if (!hasB) hint(g3.body, 'Körper anklicken (Umschalt+Klick für mehrere). Strg+Ziehen verschiebt ihn direkt.');
    const pivOpts = [['body', 'je Körpermitte'], ['sel', 'Mitte der Auswahl'], ['origin', 'Nullpunkt']];
    subhead(g3.body, 'Verschieben');
    num(g3.body, 'X (mm)', () => c.mv.dx, v => { c.mv.dx = v; }); num(g3.body, 'Y (mm)', () => c.mv.dy, v => { c.mv.dy = v; }); num(g3.body, 'Z (mm)', () => c.mv.dz, v => { c.mv.dz = v; });
    btnRow(g3.body, [
      ['Verschieben', () => opMove([+c.mv.dx || 0, +c.mv.dy || 0, +c.mv.dz || 0]), '', false, !hasB],
      ['Mitte auf Nullpunkt', () => opToOrigin('center'), '', false, !hasB],
      ['Auf Y = 0 stellen', () => opToOrigin('floor'), 'Mitte in X/Z auf den Nullpunkt, Unterseite auf Y = 0.', false, !hasB]
    ]);
    subhead(g3.body, 'Drehen');
    selectRow(g3.body, 'Achse', AXES, () => c.rot.axis, v => { c.rot.axis = v; });
    num(g3.body, 'Winkel (°)', () => c.rot.ang, v => { c.rot.ang = v; }, 15);
    selectRow(g3.body, 'Drehpunkt', pivOpts, () => c.rot.piv, v => { c.rot.piv = v; });
    btnRow(g3.body, [['Drehen', () => opRotate(c.rot.axis, +c.rot.ang || 0, c.rot.piv), '', false, !hasB], ['−90°', () => opRotate(c.rot.axis, -90, c.rot.piv), '', false, !hasB], ['+90°', () => opRotate(c.rot.axis, 90, c.rot.piv), '', false, !hasB]]);
    subhead(g3.body, 'Skalieren / Spiegeln');
    boolRow(g3.body, 'gleichmäßig', () => c.sc.uni, v => { c.sc.uni = v; RB(); });
    if (c.sc.uni) num(g3.body, 'Faktor', () => c.sc.f, v => { c.sc.f = v; }, 0.1, 'z. B. 25,4 für Zoll → mm, 0,5 = halbe Größe.');
    else { num(g3.body, 'Faktor X', () => c.sc.fx, v => { c.sc.fx = v; }, 0.1); num(g3.body, 'Faktor Y', () => c.sc.fy, v => { c.sc.fy = v; }, 0.1); num(g3.body, 'Faktor Z', () => c.sc.fz, v => { c.sc.fz = v; }, 0.1); }
    btnRow(g3.body, [['Skalieren', () => opScale(c.sc.uni ? [c.sc.f, c.sc.f, c.sc.f].map(Number) : [c.sc.fx, c.sc.fy, c.sc.fz].map(Number), c.rot.piv), 'Um den Drehpunkt (siehe „Drehen").', false, !hasB]]);
    selectRow(g3.body, 'Spiegeln an der Ebene senkrecht zu', AXES, () => c.mir, v => { c.mir = v; });
    btnRow(g3.body, [['Spiegeln', () => opMirror(c.mir, c.rot.piv), 'Durch den Drehpunkt (siehe „Drehen").', false, !hasB]]);
    subhead(g3.body, 'Netz');
    btnRow(g3.body, [
      ['Duplizieren', opDuplicate, '', false, !hasB],
      ['Löschen', opDelete, 'Entf', false, !hasB],
      ['Vereinen', () => opMerge(true), 'Gewählte Körper zu einem verbinden. Ebene Flächen, die genau aufeinander liegen (Stirnkappen getrennt exportierter Segmente), werden auf beiden Seiten entfernt und die Ränder verschweißt.', false, bs.length < 2],
      ['Vereinen (alles behalten)', () => opMerge(false), 'Nur zusammenfassen und deckungsgleiche Eckpunkte verschweißen.', false, bs.length < 2],
      ['In Einzelteile trennen', opSplit, 'Nicht zusammenhängende Netzteile werden eigene Körper.', false, !hasB],
      ['Löcher schließen', opFillHoles, 'Jede offene Randschleife eben füllen.', false, !hasB],
      ['Normalen umdrehen', opFlip, 'Innen und außen tauschen (z. B. nach falsch orientiertem Export).', false, !hasB]
    ]);
    if (hasB && bs.length === 1 && brepOk(bs[0])) hint(g3.body, '◆ ' + T('CAD-Volumen mit exakten Flächen') + ' · ' + bs[0].ng + ' ' + T('Flächen') + ' · ' + T('Volumen') + ' ' + (MeshOCC.volume(bs[0].brep) / 1000).toFixed(2) + ' cm³');
    if (hasB && bs.length === 1) { const s = stats(bs[0]); hint(g3.body, s.ntri + ' ' + T('Dreiecke') + ' · ' + (s.open ? s.open + ' ' + T('offene Kanten') : T('geschlossen')) + (s.nonman ? ' · ' + s.nonman + ' ' + T('mehrfach genutzte Kanten') : '') + ' · ' + T('Oberfläche') + ' ' + (s.area / 100).toFixed(1) + ' cm²'); }
    side.appendChild(g3.g);

    // --- CAD-Volumen ---
    if (OCC()) {
      const oc_ = c.occ, gC = grp('CAD-Volumen (exakte Flächen)', false, 'meshed', { key: 'meshedOcc' });
      const L = occFaceList(), any = E.bodies.some(brepOk), okSel = L.length && L.every(x => brepOk(x.b));
      hint(gC.body, 'STEP-Dateien werden als echte Volumenkörper geladen (◆ in der Liste): Verschieben, Drehen, Spiegeln, gleichmäßig Skalieren, Fläche an Fläche, Aneinanderreihen, Vereinen, Trennen, Flächen entlang der Normale verschieben bzw. extrudieren (Push/Pull), Querschnitt einfügen und Teile verbinden (Loft) rechnen exakt auf den Freiformflächen. Alle anderen Bearbeitungen machen den Körper zum reinen Netz. STEP-Export schreibt die exakten Flächen.');
      if (!any) hint(gC.body, T('Noch kein CAD-Volumen geladen.'));
      if (c.mode === 'face' && E.selF.size === 1) { const [[id, gs]] = [...E.selF]; const b = byId(id); if (brepOk(b) && gs.size === 1) hint(gC.body, T('Flächenart') + ': ' + (MeshOCC.faceType(b.brep, [...gs][0]) || '?')); }
      selectRow(gC.body, 'Darstellung', [['fine', 'fein'], ['mid', 'mittel'], ['coarse', 'grob']], () => oc_.q, v => { oc_.q = v; occRetess(); }, 'Feinheit des Anzeige- und STL-Netzes der CAD-Körper. Die exakten Flächen (STEP-Export) bleiben unverändert.');
      subhead(gC.body, 'Kanten');
      hint(gC.body, 'Körpermodus: alle Kanten des Körpers; Flächenmodus: alle Kanten der gewählten Flächen.');
      num(gC.body, 'Radius (mm)', () => oc_.r, v => { oc_.r = Math.max(0, v); }, 0.5);
      btnRow(gC.body, [['Kanten runden', () => opFillet(false), '', false, !okSel]]);
      num(gC.body, 'Fase (mm)', () => oc_.ch, v => { oc_.ch = Math.max(0, v); }, 0.5);
      btnRow(gC.body, [['Kanten fasen', () => opFillet(true), '', false, !okSel]]);
      subhead(gC.body, 'Aushöhlen');
      num(gC.body, 'Wandstärke (mm)', () => oc_.th, v => { oc_.th = Math.max(0, v); }, 0.5, 'Im Flächenmodus die Flächen wählen, die offen bleiben (z. B. Deckel); die Wand wächst nach innen.');
      btnRow(gC.body, [['Aushöhlen', opHollow, '', false, !(okSel && c.mode === 'face')]]);
      subhead(gC.body, 'Boolesche Operationen');
      hint(gC.body, 'Körper in Listenreihenfolge: der erste gewählte ist der Grundkörper.');
      const bsC = selBodies(), ok2 = bsC.length >= 2 && bsC.every(brepOk);
      btnRow(gC.body, [
        ['Vereinen', () => occBoolean('fuse'), '', false, !ok2],
        ['Abziehen', () => occBoolean('cut'), 'Vom ersten Körper alle weiteren abziehen.', false, !ok2],
        ['Schnittmenge', () => occBoolean('common'), 'Nur das Volumen, das alle gewählten Körper gemeinsam haben.', false, !ok2]
      ]);
      side.appendChild(gC.g);
    }

    // --- Zusammensetzen ---
    const g4 = grp('Zusammensetzen', false, 'meshed', { key: 'meshedAsm' });
    subhead(g4.body, 'Fläche an Fläche setzen');
    hint(g4.body, 'Erst die Fläche am Körper anklicken, der bewegt wird (z. B. Stirnfläche von Segment 2), dann die Zielfläche am anderen Körper (Stirnfläche von Segment 1). Der erste Körper wird gedreht und verschoben, bis beide Flächen mittig aufeinander liegen.');
    num(g4.body, 'Abstand der Flächen (mm)', () => c.mate.gap, v => { c.mate.gap = v; }, 0.5);
    boolRow(g4.body, 'gleiche Richtung (nicht gegenüber)', () => c.mate.flip, v => { c.mate.flip = v; });
    btnRow(g4.body, [[E.mate ? 'Abbrechen (Esc)' : 'Flächen wählen…', () => { E.mate = E.mate ? null : { step: 1 }; clearSel(); RB(); }, '', !E.mate]]);
    subhead(g4.body, 'Aneinanderreihen');
    hint(g4.body, 'Die gewählten (sonst alle sichtbaren) Körper in Listenreihenfolge lückenlos entlang der Achse aneinandersetzen; der erste bleibt liegen.');
    selectRow(g4.body, 'Achse', AXES, () => c.chain.axis, v => { c.chain.axis = v; });
    num(g4.body, 'Fugenabstand (mm)', () => c.chain.gap, v => { c.chain.gap = v; }, 0.5);
    boolRow(g4.body, 'Stoßflächen mittig ausrichten', () => c.chain.center, v => { c.chain.center = v; });
    btnRow(g4.body, [['Aneinanderreihen', () => opChain(c.chain.axis, c.chain.gap, c.chain.center)]]);
    subhead(g4.body, 'Teile verbinden (Übergangsfläche)');
    hint(g4.body, 'Im Modus „Fläche" die beiden Flächen wählen, die einander gegenüberliegen (Umschalt+Klick), z. B. die Oberkante des einen und die Unterkante des anderen Teils. Beide Flächen werden entfernt und durch eine Übergangsfläche ersetzt; aus den zwei Teilen wird ein geschlossener Körper. Die Ränder dürfen verschieden groß, verschieden fein und gegeneinander versetzt sein.');
    num(g4.body, 'Weichheit (0 = gerade)', () => c.br.soft, v => { c.br.soft = Math.max(0, v); }, 0.1, '0 = gerade Verbindung der Ränder. Größer = die Übergangsfläche läuft senkrecht aus beiden Flächen heraus und biegt weich um (Hermite-Kurven, Tangentenlänge = Faktor × Abstand der Flächenmitten). Üblich 0,3 … 1.');
    num(g4.body, 'Zwischenringe', () => c.br.rings, v => { c.br.rings = clamp(Math.round(v), 0, 200); }, 1, 'Anzahl der Querschnitte im Übergang. 0 = Ränder direkt verbinden (nur sinnvoll bei Weichheit 0).');
    { const bs2 = c.mode === 'face' ? bridgeSides() : null; btnRow(g4.body, [['Verbinden', () => opBridge(), '', true, !bs2]]); if (c.mode === 'face' && !bs2) hint(g4.body, 'Noch nicht zwei Flächen gewählt.'); }
    side.appendChild(g4.g);

    // --- Lücke füllen (tangential) ---
    {
      const gp = c.gap, gG = grp('Lücke füllen (tangential)', false, 'meshed', { key: 'meshedGap' }), bs3 = c.mode === 'face' ? bridgeSides() : null;
      hint(gG.body, 'Füllt die Lücke zwischen zwei Teilen: im Modus „Fläche" die beiden Stirnflächen wählen, die einander gegenüberliegen (Umschalt+Klick). Die Füllfläche setzt die angrenzenden Seitenflächen beider Teile tangential fort (ohne Knick). Bei CAD-Volumen (◆) entsteht eine exakte B-Spline-Fläche, sonst ein Netz.');
      selectRow(gG.body, 'Ergebnis', [['solid', 'Volumen (Teile + Füllung = ein Körper)'], ['face', 'nur Fläche (eigener Körper)']], () => gp.mode, v => { gp.mode = v; });
      num(gG.body, 'Spannung', () => gp.tension, v => { gp.tension = clamp(v, 0.02, 2); }, 0.05, 'Wie weit die Fläche der Richtung der Seitenflächen folgt, bevor sie zum anderen Teil umbiegt (Vielfaches des Abstands). Klein = kurzer, straffer Übergang; groß = bauchiger. Üblich 0,25 … 0,5.');
      num(gG.body, 'Zwischenringe (nur Netz)', () => gp.rings, v => { gp.rings = clamp(Math.round(v), 1, 200); }, 1, 'Anzahl der Querschnitte in der Füllung bei Netzkörpern. CAD-Volumen bekommen eine glatte Fläche ohne Ringe.');
      btnRow(gG.body, [['Lücke füllen', () => opBridge({ tangent: true, mode: gp.mode, tension: gp.tension, rings: gp.rings }), '', true, !bs3]]);
      if (!bs3) hint(gG.body, c.mode === 'face' ? 'Noch nicht zwei Flächen gewählt.' : 'Erst in den Modus „Fläche" wechseln.');
      side.appendChild(gG.g);
    }

    // --- Strecken / Verlängern ---
    const st = c.st, g5 = grp('Strecken / Verlängern', false, 'meshed', { key: 'meshedStretch' });
    stretchOpen = g5.body.style.display !== 'none';
    g5.g.querySelector('h3').addEventListener('click', () => { stretchOpen = g5.body.style.display !== 'none'; draw(); });
    hint(g5.body, 'Verlängert oder kürzt die gewählten (sonst alle sichtbaren) Körper an einer Ebene quer zur Achse — z. B. ein Rumpfsegment um 50 mm länger. Die Ebene wird in der Ansicht orange angezeigt.');
    selectRow(g5.body, 'Art', [['insert', 'Querschnitt einfügen (gleicher Querschnitt)'], ['band', 'Bereich strecken / stauchen']], () => st.kind, v => { st.kind = v; RB(); },
      'Querschnitt einfügen: das Netz wird an der Ebene aufgetrennt und der dortige Querschnitt um die Länge gerade verlängert — die Form davor und dahinter bleibt exakt erhalten. Bereich strecken: der Bereich vor der Ebene wird proportional gedehnt bzw. gestaucht (auch zum Kürzen), alles dahinter verschoben.');
    selectRow(g5.body, 'Achse', AXES, () => st.axis, v => { st.axis = v; st.pos = null; RB(); });
    numRow(g5.body, 'Lage der Ebene (mm)', () => stretchPos(), v => { st.pos = v; draw(); }, { step: 5, norender: true });
    btnRow(g5.body, [['Ebene in die Mitte', () => { st.pos = null; RB(); }]]);
    num(g5.body, st.kind === 'insert' ? 'Verlängern um (mm)' : 'Länge ändern um (mm, negativ = kürzen)', () => st.d, v => { st.d = v; }, 5);
    if (st.kind === 'band') num(g5.body, 'Bereich vor der Ebene (mm)', () => st.band, v => { st.band = Math.max(0.1, v); }, 5, 'Länge des Bereichs, der gedehnt bzw. gestaucht wird. Beim Kürzen muss er länger sein als die Kürzung.');
    boolRow(g5.body, 'Ebene anzeigen', () => st.show, v => { st.show = v; draw(); });
    btnRow(g5.body, [['Anwenden', opStretch, '', true]]);
    side.appendChild(g5.g);

    // --- Ansicht & Ausgabe ---
    const g6 = grp('Ansicht & Ausgabe', true, 'meshed', { key: 'meshedOut' });
    boolRow(g6.body, 'Flächenkanten zeigen', () => c.edges, v => { c.edges = v; draw(); });
    boolRow(g6.body, 'Drahtgitter', () => c.wire, v => { c.wire = v; draw(); });
    boolRow(g6.body, 'Achsenkreuz im Nullpunkt', () => c.axes, v => { c.axes = v; draw(); });
    hint(g6.body, 'Rote Kanten = offene oder mehrfach genutzte Kanten (Netz nicht geschlossen).');
    subhead(g6.body, 'Export');
    selectRow(g6.body, 'Format', [['stl', 'STL (Dreiecksnetz, binär)'], ['obj', 'OBJ (Wavefront, mit Flächengruppen)'], ['step', 'STEP (AP214)']], () => c.exp.fmt, v => { c.exp.fmt = v; RB(); },
      'STEP: CAD-Volumen (◆) werden mit ihren exakten Freiformflächen geschrieben. Reine Netze: geschlossene Körper als Volumenkörper aus ebenen Flächen, offene als Flächenmodell. Ebene Flächen werden zu je einer STEP-Fläche zusammengefasst, gewölbte bleiben Dreiecke — CAD-Programme (FreeCAD, Fusion, SolidWorks) lesen das als Volumen, aber nicht als glatte Freiformfläche. Große Netze ergeben große Dateien; zum reinen Netzaustausch sind STL oder OBJ schneller.');
    boolRow(g6.body, 'je Körper eine Datei', () => c.exp.each, v => { c.exp.each = v; });
    if (E.bodies.some(brepOk) && c.exp.fmt !== 'step') {
      num(g6.body, 'CAD-Volumen: Sehnenfehler (mm)', () => c.occ.eTol, v => { c.occ.eTol = clamp(v, 0.001, 5); }, 0.01, 'STL/OBJ und Übergabe an „3D-Modell": CAD-Volumen (◆) werden dafür eigens fein vernetzt. Größter Abstand eines Dreiecks von der exakten Fläche. Kleiner = glatter, aber mehr Dreiecke (größere Datei, langsamer).');
      num(g6.body, 'CAD-Volumen: Winkel je Dreieck (°)', () => c.occ.eAng, v => { c.occ.eAng = clamp(v, 1, 30); }, 0.5, 'Größte Richtungsänderung der Fläche über ein Dreieck (mindestens 1°). 2–3° ergibt auch bei Glanzlack keine sichtbaren Facetten. Jede Halbierung vervierfacht etwa die Dreieckszahl — vor sehr großen Netzen wird gewarnt.');
    }
    btnRow(g6.body, [[{ stl: 'STL speichern…', obj: 'OBJ speichern…', step: 'STEP speichern…' }[c.exp.fmt] || 'STL speichern…', () => exportAs(c.exp.fmt, c.exp.each), 'Gewählte (sonst alle sichtbaren) Körper.', true]]);
    btnRow(g6.body, [
      ['An „3D-Modell" als Baugruppe', () => toModel3D(true), 'Jeder sichtbare Körper wird ein Teil der Baugruppe im Reiter „3D-Modell" (Segmente zusammensetzen, Zerlegen, G-Code).'],
      ['An „3D-Modell" als ein Modell', () => toModel3D(false), 'Alle sichtbaren Körper als ein Netz übergeben.']
    ]);
    side.appendChild(g6.g);

    // --- Übergabe an Rumpf ---
    if (window.RumpfPro && RumpfPro.fromMesh) {
      const g7 = grp('An „Rumpf" übergeben', false, 'meshed', { key: 'meshedRpro' });
      const rp = c.rp, AXA = [['auto', 'automatisch'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']];
      hint(g7.body, 'Leitet aus dem Rumpf (gewählte, sonst alle sichtbaren Körper) Seitenansicht (Ober-/Unterkante), Draufsicht (halbe Breite), Dickenlinie und Querschnitte ab und ersetzt damit Umrisse und Spanten im Reiter „Rumpf" — dort ist danach alles normal bearbeitbar. Der Rumpf wird dazu in Querebenen geschnitten; Lage und Achsen werden erkannt (Längsachse = längste, Hochachse = die mit wandernder Mitte, Nase = breiteres Ende). Alle beteiligten Körper werden verschmolzen abgegriffen (äußere Hülle) — z. B. Rumpfteile und Kabinenhaube zusammen laden.');
      selectRow(g7.body, 'Längsachse', AXA, () => rp.len, v => { rp.len = v; });
      selectRow(g7.body, 'Hochachse', AXA, () => rp.up, v => { rp.up = v; });
      selectRow(g7.body, 'Oben ist', [['auto', 'automatisch'], ['1', '+ Richtung'], ['-1', '− Richtung']], () => String(rp.upSign), v => { rp.upSign = v; });
      selectRow(g7.body, 'Nase liegt bei', [['auto', 'automatisch'], ['min', 'kleinstem Wert'], ['max', 'größtem Wert']], () => rp.nose, v => { rp.nose = v; });
      num(g7.body, 'Spanten höchstens', () => rp.nFr, v => { rp.nFr = clamp(Math.round(v), 2, 80); }, 1, 'Spanten werden sparsam gesetzt: erst Nase, dickste Stelle und Heck, dann jeweils dort ein weiterer, wo der Rumpf am weitesten vom Netz abweicht — bis die Toleranz passt oder diese Zahl erreicht ist.');
      num(g7.body, 'Toleranz Spanten (mm)', () => rp.frTol, v => { rp.frTol = clamp(v, 0.1, 20); }, 0.1, 'Größte erlaubte Abweichung des fertigen Rumpfs vom Netz. Größer = weniger Spanten.');
      selectRow(g7.body, 'Spanten als', [['free', 'frei (formgetreue Knoten)'], ['egg', 'Ei (nur Dickenlinie gemessen)']], () => rp.type, v => { rp.type = v; RB(); },
        'frei: jeder Querschnitt wird mit Bezier-Knoten nachgebildet (Dickenlinie steckt in der breitesten Stelle). Ei: einfache Spanten aus zwei Ellipsen, die gemessene Dickenlinie ist ihr Parameter (yw).');
      if (rp.type === 'free') num(g7.body, 'Knoten je Spant (höchstens)', () => rp.nodes, v => { rp.nodes = clamp(Math.round(v), 3, 30); }, 1, 'Alle Spanten bekommen denselben Knotenaufbau (oben, breiteste Stelle, unten und Knoten dazwischen an gleicher Lage), damit Überblendung und Dickenlinie glatt bleiben; die Zahl wächst, bis die Querschnitte passen.');
      num(g7.body, 'Toleranz Umrisse (mm)', () => rp.tol, v => { rp.tol = clamp(v, 0.02, 10); }, 0.05, 'Punkte der Seiten-/Draufsicht werden eingefügt, bis der Spline überall so nah am Netz liegt.');
      num(g7.body, 'Umrisspunkte je Linie (höchstens)', () => rp.outMax, v => { rp.outMax = clamp(Math.round(v), 4, 120); }, 1);
      boolRow(g7.body, 'Seitenleitwerk abtrennen', () => rp.fin, v => { rp.fin = v; }, 'Lange, dünne Teile oben im Querschnitt (Seitenleitwerk) werden abgeschnitten; die Rumpfoberkante dort wird aus dem Querschnitt darunter gerundet. Das Leitwerk legt man im Reiter Rumpf neu an.');
      boolRow(g7.body, 'Flächenanschluss nicht berücksichtigen', () => rp.wing, v => { rp.wing = v; }, 'Wurzelrippe/Anformung der Tragfläche (ebene Fläche parallel zur Symmetrieebene mit Absatz) wird aus jedem Querschnitt entfernt und die Kontur dort tangential geschlossen. Den Tragflächenanschluss legt man im Reiter Rumpf neu an.');
      const mNames = E.bodies.filter(isMold).map(b => b.name);
      hint(g7.body, mNames.length
        ? T('Haubenform: ') + mNames.join(', ') + ' · ' + T('Haubenstärke ') + rp.glass + ' mm ' + T('(Gruppe „Kabinenhaube aus Negativform"). Ihre Innenseite + Haubenstärke wird dort, wo der Rumpf offen ist, als Haube mit dem Rumpf verschmolzen; die erste Kante des Haubenausschnitts geht als Haubenlinie an Rumpf.')
        : T('Liegt die Haube nur als Negativform vor: deren Teile in der Gruppe „Kabinenhaube aus Negativform" ankreuzen.'));
      boolRow(g7.body, 'Kabinenhaube nicht berücksichtigen', () => rp.canopy, v => { rp.canopy = v; }, 'Im Querschnitt wird am Haubenabsatz (Auflage, Rahmen, Ausschnittkante — die Kontur springt dort nach innen) abgeschnitten; die Oberkante läuft unter der Haube glatt durch, die Spanten bekommen dort eine runde Kuppe. Die Haube selbst legt man im Reiter Rumpf unter „Kabinenhaube" neu an.');
      btnRow(g7.body, [['Ableiten und an „Rumpf" übergeben', toRumpfPro, 'Ersetzt Umrisse und Spanten im Reiter „Rumpf".', true]]);
      if (E.rpRep) hint(g7.body, T('Zuletzt: Achsen ') + E.rpRep.axes + T(', Nase bei ') + (E.rpRep.noseMin ? 'min' : 'max') + T(', Symmetrieebene ') + E.rpRep.zc + ' mm.');
      side.appendChild(g7.g);
    }

    // --- Kabinenhaube aus Negativform ---
    if (window.RumpfPro && RumpfPro.canopyFromMold) {
      const g8 = grp('Kabinenhaube aus Negativform', false, 'meshed', { key: 'meshedKh' }), kh = c.kh, rp = c.rp;
      hint(g8.body, 'Liegt die Haube nur als Form vor (z. B. Laminierform des Tiefziehklotzes): Teile der Form ankreuzen. Der Formhohlraum ist der Tiefziehklotz, also die Haube innen; außen kommt die Haubenstärke dazu. Ergebnis ist ein eigener Körper „Kabinenhaube", der wie jeder andere angezeigt, verschoben und gespeichert werden kann. Erneutes Ableiten ersetzt ihn.');
      subhead(g8.body, 'Teile der Form');
      E.bodies.filter(b => !b.rpCanopy).forEach(b => boolRow(g8.body, b.name, () => isMold(b), v => { b.rpMold = !!v; RB(); }));
      num(g8.body, 'Haubenstärke (mm)', () => rp.glass, v => { rp.glass = clamp(v, 0, 10); }, 0.1, 'Materialstärke der tiefgezogenen Haube. Wird außen auf den Formhohlraum aufgeschlagen (senkrecht zur Fläche) und bei der Übergabe an Rumpf als Haubenstärke eingetragen. 0 = nur die Innenfläche.');
      boolRow(g8.body, 'an der Ausschnittkante des Rumpfs beschneiden', () => kh.trim, v => { kh.trim = v; }, 'Die Haube endet an der ersten (äußeren) Kante des Haubenausschnitts der sichtbaren Rumpfteile — die innere Stufe/das Plateau zum Abformen wird übergangen. Aus: die ganze Form-Innenseite bis zu ihrer Unterkante.');
      boolRow(g8.body, 'Form danach ausblenden', () => kh.hideMold, v => { kh.hideMold = v; });
      boolRow(g8.body, 'Haube durchsichtig darstellen', () => kh.transp, v => { kh.transp = v; E.bodies.filter(b => b.rpCanopy).forEach(b => { b.transp = v; b.alpha = kh.alpha; }); RB(); }, 'Nur Darstellung. Ein- und ausschalten lässt sich jeder Körper auch mit ◐ in der Körperliste.');
      if (kh.transp) num(g8.body, 'Deckkraft (%)', () => Math.round(kh.alpha * 100), v => { kh.alpha = clamp(v / 100, 0.05, 1); E.bodies.filter(b => b.rpCanopy).forEach(b => { b.alpha = kh.alpha; }); }, 5, '100 % = deckend. Flächen, die man streifend sieht, werden kräftiger dargestellt (Glaseindruck).');
      btnRow(g8.body, [['Kabinenhaube ableiten', canopyFromMold, 'Neuer Körper „Kabinenhaube" (ersetzt einen früher abgeleiteten).', true, !(window.RumpfPro && RumpfPro.canopyFromMold)]]);
      if (E.khRep) hint(g8.body, T('Zuletzt: X ') + E.khRep.x0 + '–' + E.khRep.x1 + ' mm, ' + E.khRep.n + T(' Dreiecke, Stärke ') + E.khRep.t + ' mm' + (E.khRep.trimmed ? T(', an der Ausschnittkante beschnitten') : '') + '.');
      side.appendChild(g8.g);
    }
  }

  Object.assign(App, { meshedSidebar });
  window.MeshEdit = { api: () => ({ bodies: () => E.bodies, redraw: draw,
    // Rumpf wie bei „An Rumpf übergeben" (sichtbar, keine Formteile, abgeleitete Haube nur ohne Form) + Achsen-Einstellungen
    fusSoup: () => { const molds = E.bodies.filter(b => isMold(b) && b.F.length), l = E.bodies.filter(b => !b.hidden && b.F.length && !isMold(b) && !(molds.length && b.rpCanopy)); return l.length ? mergedSoup(l) : null; },
    rpAxes: () => { const r = cfg().rp; return { len: r.len, up: r.up, upSign: r.upSign, nose: r.nose }; } }), show, resize, draw, serialize, deserialize, reset, loadFiles, fromModel3D, toModel3D, toRumpfPro, canopyFromMold, hasData: () => E.bodies.length > 0,
    _test: { E, cfg, isMold, offsetSoup, opBridge, toOBJ, toSTEP, regionLoops, bridgeSides, meas, measHit, measClick, measCalc, setMeas, weld, autoGroups, stats, faceFrame, sliceAt, stretchInsert, stretchBand, boundaryLoops, opFillHoles, opMerge, opExtrude, opSplit, opStretch, doMate, mkBody, edgeTris, clickSelect, undo, redo, setMode, selBodies, opFaceMove, opMove, opRotate, opChain, opDeleteFaces, soupOf, pick, scr, resetCam, brepOk, setShape, xformBody, occBoolean, opFillet, opHollow, stepText, restoreBreps, exportAs, expBody, expCheck, cornerNormals, cornerNormalsAvg } };
})();
