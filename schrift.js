/* schrift.js — Reiter „Schriften": Buchstaben, Wörter und Schilder aus Schaum
 * schneiden (Funktion „schrift", optional — andere Module rufen nur geschützt).
 *
 * KONZEPT
 *   Schriftarten : eingebaute Linien-Schriften (schrift_fonts.js: nur Mittellinien)
 *                  → Strichstärke, Enden, Ecken, Bogenform, Serifen, Breite,
 *                  Neigung und x-Höhe frei einstellbar; dazu beliebige TrueType-/
 *                  OpenType-Dateien bzw. Systemschriften (Stärke per Versatz).
 *                  Eigene Schriftarten = gespeicherte Einstellungssätze.
 *   Geometrie    : über ein Abstandsfeld (Signed Distance Field) auf einem feinen
 *                  Raster. Striche, Umrisse, Verbindungsleisten/-stege werden darin
 *                  vereinigt (min), Schablonen-Lücken abgezogen (max). Die Kontur
 *                  der Buchstaben = Höhenlinie 0, die SCHNITTBAHN = Höhenlinie
 *                  Abbrand/2 (echter Parallelversatz ohne Schlaufen, Innenformen
 *                  automatisch nach innen). Konturen per Marching Squares.
 *   Verbindung   : einzeln / überlappend (optischer Abstand negativ) / Grundleiste
 *                  (Sockel) / Stege zwischen den Buchstaben; Punkte (i, j, Umlaute)
 *                  optional angebunden.
 *   Innenformen  : Einschnitt (feiner Schlitz an der dünnsten Stelle, Buchstabe bleibt
 *                  ganz) / Lücke (Schablonen-Stil) / füllen.
 *   Schnittbahn  : Heißdraht fährt vom Nullpunkt in die Fahrspur unter der Schrift,
 *                  je Teil an der tiefsten Stelle hinein, erst die Innenformen (über
 *                  den Einschnitt), dann die Außenkontur; Verbindungswege nur durch
 *                  Abfall (gerade → Fahrspur → A*-Umweg). XY = UV (gerader Draht).
 *   G-Code       : schrift_gcode.js (Funktion „gcodegen") macht aus den Fahrten
 *                  (Daten) den Text. Ohne diese Datei zeigt die Bahnvorschau.
 *
 * Koordinaten (Welt, mm): x nach rechts, y nach oben, Grundlinie der 1. Zeile y=0.
 * Maschine: X = x − Blockecke + Blocklage X, Y = y − Blockunterkante + Blocklage Y.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const SF = window.SchriftFonts;
  if (!SF) return;
  const { T, state } = App;
  const { grp, hint, subhead, numRow, boolRow, selectRow, buildSidebar } = App;
  const $ = s => document.querySelector(s);
  const BIG = 1e6;
  // Build-Tool „nur Demo (ohne Export)": DXF-Export sperren (Übergabe an CAD bleibt).
  const DEMO = App.demoFeature ? App.demoFeature('schrift') : { on: false, blocked: () => false, btn: b => b };

  // ---------- Konfiguration (state.cfg.sc*) -------------------------------
  const DEF = {
    scText: 'AI Foam Cut',
    scFont: 'grotesk',      // gewählter Eintrag der Liste: Voreinstellung-ID | 'u:<id>' eigene | 'f:<key>' Datei
    scSrc: 'skel',          // Geometriequelle: 'skel' (Linienschrift) | 'f:<key>' (Schriftdatei)
    scHeight: 100,          // Versalhöhe mm
    scWeight: 12,           // Strichstärke mm (Linienschriften)
    scBold: 0,              // Stärke-Korrektur mm (Schriftdateien): + fetter, − dünner
    scWidth: 100,           // Breite %
    scSlant: 0,             // Neigung °
    scXh: 70,               // x-Höhe in % der Versalhöhe (Linienschriften)
    scSquare: 0,            // Eckigkeit der Bögen % (0 = rund)
    scCaps: 'flat',         // Strichenden 'flat' | 'round'
    scJoin: 'miter',        // Ecken 'miter' (spitz) | 'round'
    scSerif: false, scSerifLen: 7, scSerifThk: 9,   // Serifen (mm)
    scSpaceMode: 'metric',  // 'metric' (Zeichenbreite) | 'optical' (Konturabstand)
    scTrack: 0,             // Zeichenabstand zusätzlich (mm)
    scGap: 8,               // Konturabstand bei „optisch" (mm)
    scWord: 100,            // Wortabstand %
    scLine: 140,            // Zeilenabstand % der Versalhöhe
    scAlign: 'left',        // 'left' | 'center' | 'right'
    scConn: 'none',         // 'none' | 'overlap' | 'bar' | 'bridge'
    scOverlap: 3,           // Überlappung mm
    scBarH: 12, scBarDrop: 0, scBarOver: 6, scBarR: 0,   // Grundleiste
    scBridgeY: 20, scBridgeT: 8,                          // Stege: Mitte über Grundlinie, Dicke
    scDotLink: false, scDotLinkW: 4,                      // Punkte (i, j, Umlaute) anbinden
    scHoles: 'slit',        // Innenformen 'slit' | 'gap' | 'fill'
    scHoleDir: 'auto',      // Lage 'auto' | 'down' | 'up' | 'left' | 'right'
    scHoleGap: 4,           // Lückenbreite mm
    scMatId: null,          // Werkstoff (null = globale Auswahl)
    scKerfMode: 'mat',      // 'mat' | 'manual' | 'off'
    scKerf: 1.0,            // Abbrand manuell mm
    scDepth: 100,           // Blockdicke = Buchstabentiefe (entlang des Drahts) mm
    scMarginX: 15, scMarginY: 12,   // Rand um die Schrift mm
    scBlockW: 0, scBlockH: 0,       // feste Blockmaße (0 = automatisch)
    // Blocklage X/Y/Z = dieselben Werte wie im Reiter „G-Code" (state.cfg.blockX/blockY/blockZ)
    scLane: 4,              // Fahrspur: Abstand unter der Schrift mm
    scView: { fill: true, cut: true, skel: false, num: true },
    scFontData: null,       // eingebettete Teilmenge der Schriftdatei (Projekt)
    scPresets: []           // eigene Schriftarten (Einstellungen, nicht Projekt)
  };
  // Text/Schriftart, Größe und Verbindung sind beim ersten Öffnen aufgeklappt.
  if (App.GRP_OPEN_DEFAULT && App.GRP_OPEN_DEFAULT.add) ['sc_text', 'sc_form', 'sc_conn'].forEach(k => App.GRP_OPEN_DEFAULT.add(k));
  const MACHINE = ['scPresets'];
  if (Array.isArray(App.MACHINE_KEYS)) MACHINE.forEach(k => { if (App.MACHINE_KEYS.indexOf(k) < 0) App.MACHINE_KEYS.push(k); });
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
  const viewCfg = () => { const v = C('scView'); return (v && typeof v === 'object') ? v : (S('scView', Object.assign({}, DEF.scView)), C('scView')); };

  // ---------- Schriftbibliothek (geladene Schriftdateien) -------------------
  // Voll geladene Schriften leben in `session`; eine Teilmenge (Latin-1 + €, …)
  // landet in localStorage (max. 16), damit sie beim nächsten Start in der Liste
  // steht. Im Projekt steckt nur die Teilmenge der verwendeten Zeichen (scFontData).
  const LIB_KEY = 'hw_sc_fontlib';
  const session = {};
  function libLoad() { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function libSave(lib) { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); return true; } catch (e) { return false; } }
  const fontKeyOf = f => ((f.family || f.name || 'Schrift') + (f.style && !/^(regular|normal|standard)$/i.test(f.style) ? ' ' + f.style : '')).replace(/\s+/g, ' ').trim();
  function libAdd(f) {
    const key = fontKeyOf(f);
    session[key] = f;
    const lib = libLoad();
    lib[key] = Object.assign(SF.storeFont(f), { t: Date.now() });
    const keys = Object.keys(lib).sort((a, b) => (lib[b].t || 0) - (lib[a].t || 0));
    while (keys.length > 16) delete lib[keys.pop()];
    while (!libSave(lib) && keys.length > 1) delete lib[keys.pop()];
    return key;
  }
  function libRemove(key) { const lib = libLoad(); delete lib[key]; libSave(lib); delete session[key]; }
  function libKeys() {
    const lib = libLoad(), ks = Object.keys(lib);
    Object.keys(session).forEach(k => { if (ks.indexOf(k) < 0) ks.push(k); });
    const emb = C('scFontData'); if (emb && emb.key && ks.indexOf(emb.key) < 0) ks.push(emb.key);
    return ks.sort((a, b) => a.localeCompare(b));
  }
  function fontByKey(key) {
    if (session[key]) return session[key];
    const lib = libLoad();
    if (lib[key]) return (session[key] = SF.fromStored(lib[key]));
    const emb = C('scFontData');
    if (emb && emb.key === key) return SF.fromStored(emb);
    return null;
  }
  // Projekt-Einbettung aktuell halten (alle Zeichen des Texts).
  function embedFont(key, font, text) {
    if (!font || font.stored && !session[key] && !(libLoad()[key])) return;   // nur Einbettung vorhanden
    const emb = C('scFontData');
    const chars = Array.from(new Set(Array.from(text + ' ?'))).filter(ch => ch !== '\n');
    if (emb && emb.key === key && chars.every(ch => emb.glyphs[ch] || !font.has(ch))) return;
    S('scFontData', Object.assign(SF.storeFont(font, chars.join('')), { key }));
  }

  // ---------- Eigene Schriftarten (Einstellungssätze) ----------------------
  const PKEYS = ['weightPct', 'boldPct', 'caps', 'join', 'square', 'width', 'slant', 'xh', 'serif', 'serifLenPct', 'serifThkPct',
    'spaceMode', 'track', 'gapPct', 'word', 'line', 'holes'];
  function presets() { const a = C('scPresets'); if (!Array.isArray(a)) S('scPresets', []); return C('scPresets'); }
  function currentParams() {
    const H = Math.max(1, num('scHeight', 100));
    return { src: C('scSrc'), weightPct: num('scWeight', 12) / H * 100, boldPct: num('scBold', 0) / H * 100, caps: C('scCaps'), join: C('scJoin'),
      square: num('scSquare', 0), width: num('scWidth', 100), slant: num('scSlant', 0), xh: num('scXh', 70), serif: !!C('scSerif'),
      serifLenPct: num('scSerifLen', 7) / H * 100, serifThkPct: num('scSerifThk', 9) / H * 100,
      spaceMode: C('scSpaceMode'), track: num('scTrack', 0), gapPct: num('scGap', 8) / H * 100, word: num('scWord', 100), line: num('scLine', 140), holes: C('scHoles') };
  }
  function applyParams(p, src) {
    const H = Math.max(1, num('scHeight', 100)), r = v => Math.round(v * 100) / 100;
    if (src) S('scSrc', src);
    if (p.weightPct != null) S('scWeight', r(p.weightPct * H / 100));
    if (p.boldPct != null) S('scBold', r(p.boldPct * H / 100));
    if (p.serifLenPct != null) S('scSerifLen', r(p.serifLenPct * H / 100));
    if (p.serifThkPct != null) S('scSerifThk', r(p.serifThkPct * H / 100));
    if (p.gapPct != null) S('scGap', r(p.gapPct * H / 100));
    const map = { caps: 'scCaps', join: 'scJoin', square: 'scSquare', width: 'scWidth', slant: 'scSlant', xh: 'scXh', serif: 'scSerif',
      spaceMode: 'scSpaceMode', track: 'scTrack', word: 'scWord', line: 'scLine', holes: 'scHoles' };
    Object.keys(map).forEach(k => { if (p[k] != null) S(map[k], p[k]); });
  }
  function selectFont(val) {
    S('scFont', val);
    if (val.indexOf('f:') === 0) { S('scSrc', val); return; }
    if (val.indexOf('u:') === 0) {
      const u = presets().find(x => 'u:' + x.id === val);
      if (u) applyParams(Object.assign({ serif: false, square: 0, slant: 0 }, u.p), u.p.src || 'skel');
      return;
    }
    const pr = SF.PRESETS.find(x => x.id === val);
    if (pr) applyParams(Object.assign({ holes: 'slit', spaceMode: 'metric', track: 0, word: 100 }, pr.p), 'skel');
  }
  function fontLabel() {
    const v = C('scFont');
    if (v.indexOf('f:') === 0) return v.slice(2);
    if (v.indexOf('u:') === 0) { const u = presets().find(x => 'u:' + x.id === v); return u ? u.name : '?'; }
    const pr = SF.PRESETS.find(x => x.id === v); return pr ? T(pr.name) : v;
  }

  // ---------- Stil, Werkstoff, Abbrand, Vorschub ---------------------------
  // Blocklage (global, wie Reiter „G-Code" → Blocklage): Abstand Nullpunkt → linke/untere Blockkante.
  const blockX = () => Math.max(0, +state.cfg.blockX || 0), blockY = () => Math.max(0, +state.cfg.blockY || 0);
  // Schnittfolge je Teil (global, wie „Profil-Schnittrichtung"): Oberseite zuerst (Standard) oder Unterseite zuerst.
  const topFirst = () => state.cfg.profileDir !== 'bottom';
  function matId() { const v = C('scMatId'); return v != null ? v : (state.material.id || ''); }
  function feed() {
    const fp = App.feedPair ? App.feedPair(matId()) : null;
    if (App.autoFeedOn && App.autoFeedOn() && fp && fp.fast > 0) return fp.fast;
    return state.cfg.feed || 200;                  // Vorschub wie Reiter „G-Code"
  }
  function kerf() {
    const m = C('scKerfMode');
    if (m === 'off') return 0;
    if (m === 'manual') return Math.max(0, num('scKerf', 0));
    const f = feed();
    return App.kerfForSpeed ? Math.max(0, App.kerfForSpeed(matId(), f, f) || 0) : 0;
  }
  function styleOf() {
    const H = Math.max(2, num('scHeight', 100));
    const src = C('scSrc') || 'skel';
    const font = src.indexOf('f:') === 0 ? fontByKey(src.slice(2)) : null;
    const skel = !font;
    const w = skel ? Math.max(0.2, Math.min(H * 0.45, num('scWeight', 12))) : 0;
    return {
      H, skel, font, fontKey: font ? src.slice(2) : '', w, bold: skel ? 0 : Math.max(-H * 0.2, Math.min(H * 0.3, num('scBold', 0))),
      width: Math.max(0.3, Math.min(3, num('scWidth', 100) / 100)), slant: Math.tan(Math.max(-40, Math.min(40, num('scSlant', 0))) * Math.PI / 180),
      xh: Math.max(40, Math.min(95, num('scXh', 70))), square: Math.max(0, Math.min(100, num('scSquare', 0))),
      caps: C('scCaps') === 'round' ? 'round' : 'flat', join: C('scJoin') === 'round' ? 'round' : 'miter',
      serif: skel && !!C('scSerif'), serifLen: Math.max(0, num('scSerifLen', 7)), serifThk: Math.max(0.2, num('scSerifThk', 9)),
      missingSrc: src.indexOf('f:') === 0 && !font ? src.slice(2) : ''
    };
  }

  // ======================================================================
  //  Abstandsfeld-Raster
  // ======================================================================
  // Raster g = { i0, j0, nx, ny, h, d: Float32Array } — Knoten (i,j) liegt bei
  // x = (i0+i)·h, y = (j0+j)·h. d < 0 = Material (Tinte), d = Abstand in mm.
  function mkGrid(i0, j0, nx, ny, h) { const d = new Float32Array(nx * ny); d.fill(BIG); return { i0, j0, nx, ny, h, d }; }
  // Bereich [x0,x1]×[y0,y1] (mm, um B erweitert) in Knotenindizes des Rasters.
  function span(g, x0, y0, x1, y1, B) {
    const h = g.h;
    return {
      ia: Math.max(0, Math.ceil((x0 - B) / h) - g.i0), ib: Math.min(g.nx - 1, Math.floor((x1 + B) / h) - g.i0),
      ja: Math.max(0, Math.ceil((y0 - B) / h) - g.j0), jb: Math.min(g.ny - 1, Math.floor((y1 + B) / h) - g.j0)
    };
  }
  // Grundformen: Balken (Segment mit Radius r, Verlängerung e0/e1 an den Enden,
  // Ende eckig), Kreis, konvexes Polygon, abgerundetes Rechteck.
  function capPrim(ax, ay, bx, by, r) {
    return { t: 'cap', ax, ay, bx, by, r, bb: [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r] };
  }
  function boxPrim(ax, ay, bx, by, r, e0, e1) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    if (L < 1e-9) return { t: 'circ', x: ax, y: ay, r };
    const ux = dx / L, uy = dy / L;
    const pts = [[ax - ux * e0, ay - uy * e0], [bx + ux * e1, by + uy * e1]];
    return { t: 'box', ax, ay, ux, uy, L, r, e0, e1,
      bb: [Math.min(pts[0][0], pts[1][0]) - r, Math.min(pts[0][1], pts[1][1]) - r, Math.max(pts[0][0], pts[1][0]) + r, Math.max(pts[0][1], pts[1][1]) + r] };
  }
  function primBB(p) {
    if (p.t === 'box' || p.t === 'cap') return p.bb;
    if (p.t === 'circ') return [p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r];
    if (p.t === 'rect') return [p.x0, p.y0, p.x1, p.y1];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    p.pts.forEach(q => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
    return [x0, y0, x1, y1];
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - ax - dx * t, ey = py - ay - dy * t;
    return Math.sqrt(ex * ex + ey * ey);          // Math.hypot ist in V8 deutlich langsamer (heiße Schleife)
  }
  function primDist(p, x, y) {
    if (p.t === 'box') {
      const px = x - p.ax, py = y - p.ay, u = px * p.ux + py * p.uy, v = -px * p.uy + py * p.ux;
      const qx = Math.max(-p.e0 - u, u - (p.L + p.e1)), qy = Math.abs(v) - p.r;
      const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
      return Math.sqrt(ox * ox + oy * oy) + Math.min(qx > qy ? qx : qy, 0);
    }
    if (p.t === 'circ') { const dx = x - p.x, dy = y - p.y; return Math.sqrt(dx * dx + dy * dy) - p.r; }
    if (p.t === 'cap') return segDist(x, y, p.ax, p.ay, p.bx, p.by) - p.r;
    if (p.t === 'rect') {
      const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2, rc = p.rc || 0;
      const qx = Math.abs(x - cx) - ((p.x1 - p.x0) / 2 - rc), qy = Math.abs(y - cy) - ((p.y1 - p.y0) / 2 - rc);
      const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
      return Math.sqrt(ox * ox + oy * oy) + Math.min(qx > qy ? qx : qy, 0) - rc;
    }
    // konvexes Polygon: Inneres = alle Kreuzprodukte gleiches Vorzeichen
    const P = p.pts, n = P.length; let md = Infinity, pos = 0, neg = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      md = Math.min(md, segDist(x, y, a[0], a[1], b[0], b[1]));
      const cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (cr > 0) pos++; else if (cr < 0) neg++;
    }
    return (pos === 0 || neg === 0) ? -md : md;
  }
  // Vereinigung: d = min(d, prim)  (op 'sub': d = max(d, −prim))
  function splat(g, prims, B, op) {
    const d = g.d, h = g.h;
    prims.forEach(p => {
      const bb = primBB(p), s = span(g, bb[0], bb[1], bb[2], bb[3], B);
      if (p.t === 'cap' && op !== 'sub') {           // häufigster Fall (Striche): eigene, schnelle Schleife
        const { ax, ay, r } = p, dx = p.bx - ax, dy = p.by - ay, L2 = dx * dx + dy * dy, iL2 = L2 > 0 ? 1 / L2 : 0;
        for (let j = s.ja; j <= s.jb; j++) {
          const py = (g.j0 + j) * h - ay, row = j * g.nx;
          for (let i = s.ia; i <= s.ib; i++) {
            const px = (g.i0 + i) * h - ax;
            let t = (px * dx + py * dy) * iL2; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = px - dx * t, ey = py - dy * t, dd = Math.sqrt(ex * ex + ey * ey) - r;
            const k = row + i; if (dd < d[k]) d[k] = dd;
          }
        }
        return;
      }
      if (p.t === 'box' && op !== 'sub') {
        const { ax, ay, ux, uy, L, r } = p, lo = -p.e0, hi = L + p.e1;
        for (let j = s.ja; j <= s.jb; j++) {
          const py = (g.j0 + j) * h - ay, row = j * g.nx;
          for (let i = s.ia; i <= s.ib; i++) {
            const px = (g.i0 + i) * h - ax, u = px * ux + py * uy, v = -px * uy + py * ux;
            const qx = lo - u > u - hi ? lo - u : u - hi, qy = (v < 0 ? -v : v) - r;
            let dd;
            if (qx > 0) dd = qy > 0 ? Math.sqrt(qx * qx + qy * qy) : qx;
            else dd = qy > 0 ? qy : (qx > qy ? qx : qy);
            const k = row + i; if (dd < d[k]) d[k] = dd;
          }
        }
        return;
      }
      for (let j = s.ja; j <= s.jb; j++) {
        const y = (g.j0 + j) * h, row = j * g.nx;
        for (let i = s.ia; i <= s.ib; i++) {
          const v = primDist(p, (g.i0 + i) * h, y), k = row + i;
          if (op === 'sub') { if (-v > d[k]) d[k] = -v; }
          else if (v < d[k]) d[k] = v;
        }
      }
    });
  }
  // Polygon-Menge (Schriftdatei-Umriss, Regel „nonzero") -> Abstandsfeld − Versatz.
  function polySDF(g, polys, B, off) {
    const h = g.h, n = g.nx * g.ny, dist = new Float32Array(n); dist.fill(BIG);
    polys.forEach(P => {
      const m = P.length;
      for (let e = 0; e < m; e++) {
        const a = P[e], b = P[(e + 1) % m];
        const s = span(g, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), B);
        for (let j = s.ja; j <= s.jb; j++) {
          const y = (g.j0 + j) * h, row = j * g.nx;
          for (let i = s.ia; i <= s.ib; i++) { const v = segDist((g.i0 + i) * h, y, a[0], a[1], b[0], b[1]); if (v < dist[row + i]) dist[row + i] = v; }
        }
      }
    });
    const edges = [];
    polys.forEach(P => { for (let e = 0; e < P.length; e++) { const a = P[e], b = P[(e + 1) % P.length]; if (a[1] !== b[1]) edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1], 1] : [b[0], b[1], a[0], a[1], -1]); } });
    for (let j = 0; j < g.ny; j++) {
      const y = (g.j0 + j) * h + 1e-7, xs = [];
      for (const e of edges) if (y >= e[1] && y < e[3]) xs.push([e[0] + (y - e[1]) * (e[2] - e[0]) / (e[3] - e[1]), e[4]]);
      xs.sort((p, q) => p[0] - q[0]);
      let w = 0, c = 0; const row = j * g.nx;
      for (let i = 0; i < g.nx; i++) {
        const x = (g.i0 + i) * h;
        while (c < xs.length && xs[c][0] < x) w += xs[c++][1];
        const k = row + i;
        g.d[k] = (w !== 0 ? -dist[k] : dist[k]) - off;
      }
    }
  }

  // ======================================================================
  //  Zeichen -> Abstandsfeld (Zwischenspeicher je Zeichen + Stil)
  // ======================================================================
  const glyphCache = new Map();
  // Ellipsen-/Superellipsen-Bogen adaptiv abtasten (Entwurfseinheiten -> mm).
  function arcPts(a, tf, n, tol, out) {
    const e = 2 / n, sp = (v, ex) => Math.sign(v) * Math.pow(Math.abs(v), ex);
    const at = deg => { const t = deg * Math.PI / 180; return tf(a.cx + a.rx * sp(Math.cos(t), e), a.cy + a.ry * sp(Math.sin(t), e)); };
    const steps = Math.max(4, Math.ceil(Math.abs(a.a1 - a.a0) / 22.5));
    let prev = at(a.a0); out.push(prev);
    for (let s = 1; s <= steps; s++) {
      const tA = a.a0 + (a.a1 - a.a0) * (s - 1) / steps, tB = a.a0 + (a.a1 - a.a0) * s / steps;
      const rec = (ta, pa, tb, pb, depth) => {
        const tm = (ta + tb) / 2, pm = at(tm);
        const dev = segDist(pm[0], pm[1], pa[0], pa[1], pb[0], pb[1]);
        if (dev > tol && depth < 10) { rec(ta, pa, tm, pm, depth + 1); rec(tm, pm, tb, pb, depth + 1); }
        else out.push(pb);
      };
      const pb = at(tB); rec(tA, prev, tB, pb, 0); prev = pb;
    }
  }
  function skelGlyph(ch, st, h, B) {
    let sk = SF.skeleton(ch), missing = false;
    if (!sk) { missing = true; sk = { w: 56, lc: false, strokes: [[{ t: 'M', x: 0, y: 0 }, { t: 'L', x: 56, y: 0 }, { t: 'L', x: 56, y: 100 }, { t: 'L', x: 0, y: 100 }, { t: 'L', x: 0, y: 0 }]] }; }
    const H = st.H, w = st.w, r = w / 2, s = (H - w) / 100, sx = s * st.width;
    const sb = 7 * s * Math.max(0.6, Math.min(1.4, st.width)) + (st.serif ? st.serifLen * 0.8 : 0);
    const xh = st.xh, XH = SF.XH;
    const mapY = y => !sk.lc ? y : (y <= 0 ? y : y <= XH ? y * xh / XH : xh + (y - XH) * (100 - xh) / (100 - XH));
    const tf = (x, y) => { const Y = r + mapY(y) * s; return [sb + r + x * sx + st.slant * Y, Y]; };
    const n = 2 + st.square / 100 * 6, tol = Math.max(0.02, h / 2.5);
    const lines = [], dots = [];
    sk.strokes.forEach(items => {
      if (items.length === 1 && items[0].t === 'D') { dots.push(tf(items[0].x, items[0].y)); return; }
      const pts = [];
      items.forEach(it => {
        if (it.t === 'M' || it.t === 'L') pts.push(tf(it.x, it.y));
        else if (it.t === 'A') arcPts(it, tf, n, tol, pts);
        else if (it.t === 'D') dots.push(tf(it.x, it.y));
      });
      const clean = [];
      pts.forEach(p => { const q = clean[clean.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) clean.push(p); });
      if (clean.length) lines.push(clean);
    });
    // Grundformen
    const lineP = [], freeP = [], ends = [];
    let yLo = Infinity, yHi = -Infinity;
    const miterLim = 4;
    lines.forEach(P => {
      P.forEach(p => { yLo = Math.min(yLo, p[1] - r); yHi = Math.max(yHi, p[1] + r); });
      const closed = P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-4;
      const Q = closed ? P.slice(0, -1) : P, m = Q.length;
      if (m === 1) { lineP.push(st.caps === 'round' ? { t: 'circ', x: Q[0][0], y: Q[0][1], r } : { t: 'rect', x0: Q[0][0] - r, y0: Q[0][1] - r, x1: Q[0][0] + r, y1: Q[0][1] + r }); return; }
      // Striche als Kapseln (Abstand zur Mittellinie − r): runde Gelenke und im
      // Inneren exakte Abstände (wichtig für saubere Konturen und Lücken).
      const segN = closed ? m : m - 1;
      for (let i = 0; i < segN; i++) { const a = Q[i], b = Q[(i + 1) % m]; lineP.push(capPrim(a[0], a[1], b[0], b[1], r)); }
      if (!closed) {
        [[Q[0], Q[1]], [Q[m - 1], Q[m - 2]]].forEach(([e, f]) => {
          const dx = e[0] - f[0], dy = e[1] - f[1], L = Math.hypot(dx, dy) || 1;
          // flaches Ende: Quadrat über die Rundung (Kante bündig mit der Schriftlinie)
          if (st.caps === 'flat') lineP.push(boxPrim(e[0], e[1], e[0] + dx / L * r, e[1] + dy / L * r, r, 0, 0));
          ends.push({ x: e[0], y: e[1], dx, dy });
        });
      }
      // Gelenke
      for (let i = closed ? 0 : 1; i < (closed ? m : m - 1); i++) {
        const p0 = Q[(i - 1 + m) % m], v = Q[i], p1 = Q[(i + 1) % m];
        let d1x = v[0] - p0[0], d1y = v[1] - p0[1], d2x = p1[0] - v[0], d2y = p1[1] - v[1];
        const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y); if (l1 < 1e-9 || l2 < 1e-9) continue;
        d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
        const cr = d1x * d2y - d1y * d2x, dot = d1x * d2x + d1y * d2y;
        const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (st.join === 'round' || turn < 0.35) continue;   // Kapseln ergeben bereits runde Gelenke
        const sgn = cr > 0 ? -1 : 1;      // Außenseite: rechts bei Linkskurve
        const n1 = [-d1y * sgn, d1x * sgn], n2 = [-d2y * sgn, d2x * sgn];
        const A = [v[0] + n1[0] * r, v[1] + n1[1] * r], Bp = [v[0] + n2[0] * r, v[1] + n2[1] * r];
        let bx = n1[0] + n2[0], by = n1[1] + n2[1]; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
        const ml = r / Math.max(1e-6, Math.cos(turn / 2));
        if (ml / r > miterLim) lineP.push({ t: 'poly', pts: [v, A, Bp] });
        else lineP.push({ t: 'poly', pts: [v, A, [v[0] + bx * ml, v[1] + by * ml], Bp] });
      }
    });
    // Punkte über dem Buchstaben (i, j, Umlaute) bei dicken Strichen so weit
    // anheben, dass ein Spalt zum Grundzeichen bleibt.
    const gapMin = Math.max(0.5 * w, 0.06 * H), xhInk = 2 * r + (sk.lc ? xh : 100) * s;
    dots.forEach(p => { if (p[1] > xhInk - r && p[1] < xhInk + gapMin + r) { const ny = xhInk + gapMin + r; p[0] += st.slant * (ny - p[1]); p[1] = ny; } });
    // Punktpaare (Umlaute) auf gleicher Höhe: mindestens denselben Spalt zueinander.
    for (let a = 0; a < dots.length; a++) for (let b = a + 1; b < dots.length; b++) {
      const A = dots[a], D = dots[b], dx = D[0] - A[0], need = 2 * r + gapMin;
      if (Math.abs(A[1] - D[1]) > 0.01 || Math.abs(dx) >= need) continue;
      const mx = (A[0] + D[0]) / 2, sg = dx >= 0 ? 1 : -1; A[0] = mx - sg * need / 2; D[0] = mx + sg * need / 2;
    }
    dots.forEach(p => {
      freeP.push(st.caps === 'round' ? { t: 'circ', x: p[0], y: p[1], r } : { t: 'rect', x0: p[0] - r, y0: p[1] - r, x1: p[0] + r, y1: p[1] + r });
    });
    // Serifen (Slab): an freien, steilen Strichenden auf einer Schriftlinie.
    if (st.serif && st.serifLen > 0) {
      const lineYs = [0, 100, sk.lc ? XH : 100, -28].map(y => r + mapY(y) * s);
      ends.forEach(e => {
        const Ld = Math.hypot(e.dx, e.dy); if (Ld < 1e-9 || Math.abs(e.dy) < 0.5 * Ld) return;
        if (!lineYs.some(y => Math.abs(y - e.y) < 0.02 * H)) return;
        const t = Math.min(st.serifThk, H * 0.3), half = r + st.serifLen, bottom = e.dy < 0;
        const y0 = bottom ? e.y - r : e.y + r - t, y1 = bottom ? e.y - r + t : e.y + r;
        const cx = e.x + st.slant * ((y0 + y1) / 2 - e.y);
        freeP.push({ t: 'rect', x0: cx - half, y0, x1: cx + half, y1 });
      });
    }
    const all = lineP.concat(freeP);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    all.forEach(p => { const bb = primBB(p); x0 = Math.min(x0, bb[0]); y0 = Math.min(y0, bb[1]); x1 = Math.max(x1, bb[2]); y1 = Math.max(y1, bb[3]); });
    if (!all.length) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
    const g = mkGrid(Math.floor((x0 - B) / h) - 1, Math.floor((y0 - B) / h) - 1, 0, 0, h);
    g.nx = Math.ceil((x1 + B) / h) + 2 - g.i0; g.ny = Math.ceil((y1 + B) / h) + 2 - g.j0;
    g.d = new Float32Array(g.nx * g.ny); g.d.fill(BIG);
    splat(g, lineP, B);
    if (isFinite(yLo)) {         // horizontale Enden: Striche an den Schriftlinien abschneiden
      for (let j = 0; j < g.ny; j++) {
        const y = (g.j0 + j) * h, c = Math.max(yLo - y, y - yHi), row = j * g.nx;
        for (let i = 0; i < g.nx; i++) if (c > g.d[row + i]) g.d[row + i] = c;
      }
    }
    splat(g, freeP, B);
    const adv = sb + w + sk.w * sx + sb;
    return { g, adv, missing, skelLines: lines, skelDots: dots };
  }
  // Umriss einer Schriftdatei abflachen (Font-Einheiten -> mm-Polygone).
  function flattenContours(contours, tf, tol) {
    const polys = [];
    contours.forEach(cn => {
      const P = []; let cx = 0, cy = 0;
      for (let i = 0; i < cn.length;) {
        const op = cn[i];
        if (op === 0 || op === 1) { cx = cn[i + 1]; cy = cn[i + 2]; P.push(tf(cx, cy)); i += 3; }
        else if (op === 2) {
          const p0 = tf(cx, cy), c = tf(cn[i + 1], cn[i + 2]), p1 = tf(cn[i + 3], cn[i + 4]);
          const dev = Math.hypot(p0[0] - 2 * c[0] + p1[0], p0[1] - 2 * c[1] + p1[1]) / 4;
          const nn = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(dev / tol))));
          for (let k = 1; k <= nn; k++) { const t = k / nn, u = 1 - t; P.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); }
          cx = cn[i + 3]; cy = cn[i + 4]; i += 5;
        } else {
          const p0 = tf(cx, cy), c1 = tf(cn[i + 1], cn[i + 2]), c2 = tf(cn[i + 3], cn[i + 4]), p1 = tf(cn[i + 5], cn[i + 6]);
          const dev = 0.75 * Math.max(Math.hypot(p0[0] - 2 * c1[0] + c2[0], p0[1] - 2 * c1[1] + c2[1]), Math.hypot(c1[0] - 2 * c2[0] + p1[0], c1[1] - 2 * c2[1] + p1[1]));
          const nn = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(dev / tol))));
          for (let k = 1; k <= nn; k++) {
            const t = k / nn, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
            P.push([a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]]);
          }
          cx = cn[i + 5]; cy = cn[i + 6]; i += 7;
        }
      }
      if (P.length > 2) {
        const a = P[0], b = P[P.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) P.pop();
        if (P.length > 2) polys.push(P);
      }
    });
    return polys;
  }
  function ttfGlyph(ch, st, h, B) {
    const f = st.font, sc = st.H / Math.max(1, f.capH);
    let g0 = f.glyph(ch), missing = false;
    const tf = (x, y) => { const Y = y * sc; return [x * sc * st.width + st.slant * Y, Y]; };
    let polys;
    if (!g0) {
      missing = true;
      const W = f.capH * 0.6, t = f.capH * 0.08;
      g0 = { adv: W + f.capH * 0.2, contours: [[0, 0, 0, 1, W, 0, 1, W, f.capH, 1, 0, f.capH], [0, t, t, 1, t, f.capH - t, 1, W - t, f.capH - t, 1, W - t, t]] };
    }
    polys = flattenContours(g0.contours, tf, Math.max(0.01, h / 5));
    const bold = st.bold;
    let x0 = 0, y0 = 0, x1 = 1, y1 = 1;
    if (polys.length) { x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity; polys.forEach(P => P.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); })); }
    const BB = B + Math.max(0, bold);
    const i0 = Math.floor((x0 - BB) / h) - 1, j0 = Math.floor((y0 - BB) / h) - 1;
    const g = mkGrid(i0, j0, Math.ceil((x1 + BB) / h) + 2 - i0, Math.ceil((y1 + BB) / h) + 2 - j0, h);
    if (polys.length) polySDF(g, polys, BB + Math.abs(bold), bold);
    return { g, adv: g0.adv * sc * st.width, missing };
  }
  // Zeilen-Ausdehnung der Tinte (für optischen Abstand und Stege).
  function glyphRows(G) {
    const g = G.g, lo = new Float32Array(g.ny), hi = new Float32Array(g.ny);
    let ix0 = Infinity, ix1 = -Infinity, iy0 = Infinity, iy1 = -Infinity;
    for (let j = 0; j < g.ny; j++) {
      let a = -1, b = -1; const row = j * g.nx;
      for (let i = 0; i < g.nx; i++) if (g.d[row + i] <= 0) { if (a < 0) a = i; b = i; }
      if (a < 0) { lo[j] = NaN; hi[j] = NaN; continue; }
      lo[j] = (g.i0 + a) * g.h; hi[j] = (g.i0 + b) * g.h;
      ix0 = Math.min(ix0, lo[j]); ix1 = Math.max(ix1, hi[j]); iy0 = Math.min(iy0, (g.j0 + j) * g.h); iy1 = Math.max(iy1, (g.j0 + j) * g.h);
    }
    G.rowLo = lo; G.rowHi = hi;
    G.ink = isFinite(ix0) ? [ix0, iy0, ix1, iy1] : null;
  }
  function glyphFor(ch, st, h, B) {
    const key = [st.skel ? 'S' : 'F:' + st.fontKey, ch, st.H, st.w, st.bold, st.width, st.slant, st.xh, st.square, st.caps, st.join, st.serif, st.serifLen, st.serifThk, h, B].join('|');
    let G = glyphCache.get(key);
    if (G) return G;
    G = st.skel ? skelGlyph(ch, st, h, B) : ttfGlyph(ch, st, h, B);
    glyphRows(G);
    if (glyphCache.size > 400) glyphCache.clear();
    glyphCache.set(key, G);
    return G;
  }

  // ======================================================================
  //  Satz (Zeilen, Abstände) und Gesamt-Abstandsfeld
  // ======================================================================
  function layout(st, h, B, warns) {
    const text = String(C('scText') || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
    const lines = text.split('\n');
    const H = st.H, lineStep = Math.max(0.5, num('scLine', 140) / 100) * H;
    const conn = C('scConn');
    const optical = conn === 'overlap' || C('scSpaceMode') === 'optical';
    const gapT = conn === 'overlap' ? -Math.max(0, num('scOverlap', 3)) : num('scGap', 8);
    const track = num('scTrack', 0), wordF = Math.max(0, num('scWord', 100)) / 100;
    let spaceAdv;
    if (st.skel) spaceAdv = (30 * (H - st.w) / 100 * st.width + st.w + 14 * (H - st.w) / 100) * wordF;
    else { const sg = st.font.glyph(' '); spaceAdv = (sg ? sg.adv : st.font.upm * 0.25) * st.H / st.font.capH * st.width * wordF; }
    const missing = new Set();
    const out = [];
    lines.forEach((ln, li) => {
      const baseJ = -Math.round(li * lineStep / h);        // Grundlinie in Rasterzeilen
      const items = []; let pen = 0, prev = null, prevCh = '', spaceRun = 0;
      Array.from(ln).forEach(ch => {
        if (ch === ' ' || ch === '\u00a0') { pen += spaceAdv; spaceRun += spaceAdv; prevCh = ' '; return; }
        const G = glyphFor(ch, st, h, B);
        if (G.missing) missing.add(ch);
        let px;
        if (optical && G.ink && prev && prev.G.ink) {
          // Zeilenweise: kleinster waagerechter Abstand der Tinte = Soll-Abstand.
          let need = -Infinity;
          const pg = prev.G.g, cg = G.g;
          for (let j = 0; j < cg.ny; j++) {
            const pj = cg.j0 + j - pg.j0;
            if (pj < 0 || pj >= pg.ny) continue;
            const a = prev.G.rowHi[pj], b = G.rowLo[j];
            if (isNaN(a) || isNaN(b)) continue;
            need = Math.max(need, prev.px + a - b);
          }
          if (!isFinite(need)) need = prev.px + prev.G.ink[2] - G.ink[0];
          px = need + gapT + spaceRun;
        } else if (optical && G.ink) {
          px = pen - G.ink[0];                        // erstes Zeichen der Zeile: Tinte beginnt am Stift
        } else {
          px = pen;
          if (!st.skel && prevCh && prevCh !== ' ' && st.font.kern) px += st.font.kern(prevCh, ch) * st.H / st.font.capH * st.width;
        }
        const it = { ch, G, pi: Math.round(px / h), bj: baseJ };
        it.px = it.pi * h;
        items.push(it);
        pen = (optical && G.ink) ? it.px + G.ink[2] : it.px + G.adv + track;
        prev = it; prevCh = ch; spaceRun = 0;
      });
      let x0 = Infinity, x1 = -Infinity;
      items.forEach(it => { if (it.G.ink) { x0 = Math.min(x0, it.px + it.G.ink[0]); x1 = Math.max(x1, it.px + it.G.ink[2]); } });
      out.push({ items, x0: isFinite(x0) ? x0 : 0, x1: isFinite(x1) ? x1 : 0, baseY: baseJ * h, li });
    });
    // Ausrichtung
    const Wmax = Math.max(0, ...out.map(l => l.x1 - l.x0));
    const al = C('scAlign');
    out.forEach(l => {
      const w = l.x1 - l.x0;
      const shift = al === 'center' ? (Wmax - w) / 2 - l.x0 : al === 'right' ? (Wmax - w) - l.x0 : -l.x0;
      const di = Math.round(shift / h);
      l.items.forEach(it => { it.pi += di; it.px = it.pi * h; });
      l.x0 += di * h; l.x1 += di * h;
    });
    if (missing.size) warns.push(T('Zeichen fehlen in der Schrift (als Kasten gesetzt): ') + Array.from(missing).join(' '));
    return out;
  }
  // Tinten-Ausdehnung eines gesetzten Zeichens in einem Höhenband (Weltkoordinaten).
  function inkInBand(it, ya, yb, side) {
    const g = it.G.g; let v = side === 'hi' ? -Infinity : Infinity;
    for (let j = 0; j < g.ny; j++) {
      const y = (g.j0 + j + it.bj) * g.h;
      if (y < ya || y > yb) continue;
      const q = side === 'hi' ? it.G.rowHi[j] : it.G.rowLo[j];
      if (isNaN(q)) continue;
      v = side === 'hi' ? Math.max(v, it.px + q) : Math.min(v, it.px + q);
    }
    return isFinite(v) ? v : null;
  }
  function assemble(st, h, B, lines, warns) {
    const conn = C('scConn');
    const extra = [];          // Verbindungs-Grundformen (Leisten, Stege)
    if (conn === 'bar') {
      const bh = Math.max(0.5, num('scBarH', 12)), drop = num('scBarDrop', 0), ov = num('scBarOver', 6);
      const rc = Math.max(0, Math.min(num('scBarR', 0), bh / 2));
      lines.forEach(l => { if (!l.items.length) return; extra.push({ t: 'rect', x0: l.x0 - ov, x1: l.x1 + ov, y0: l.baseY - drop, y1: l.baseY - drop + bh, rc }); });
      if (drop > bh + 1e-6) warns.push(T('Grundleiste berührt die Buchstaben nicht (Absenkung größer als Leistenhöhe).'));
    } else if (conn === 'bridge') {
      const t = Math.max(0.5, num('scBridgeT', 8)), yc = num('scBridgeY', 20);
      const miss = new Set();
      lines.forEach(l => {
        for (let k = 1; k < l.items.length; k++) {
          const a = l.items[k - 1], b = l.items[k];
          if (!a.G.ink || !b.G.ink) continue;
          const ya = l.baseY + yc - t / 2, yb = l.baseY + yc + t / 2;
          let xa = inkInBand(a, ya, yb, 'hi'), xb = inkInBand(b, ya, yb, 'lo');
          if (xa == null) { miss.add(a.ch); xa = a.px + (a.G.ink[0] + a.G.ink[2]) / 2; }
          if (xb == null) { miss.add(b.ch); xb = b.px + (b.G.ink[0] + b.G.ink[2]) / 2; }
          const e = Math.max(h * 2, Math.min(2, (st.skel ? st.w : st.H * 0.08) / 2));
          if (xb > xa - e) extra.push({ t: 'rect', x0: xa - e, x1: xb + e, y0: ya, y1: yb, rc: 0 });
        }
      });
      if (miss.size) warns.push(T('Steg trifft diese Zeichen nicht (Steghöhe ändern): ') + Array.from(miss).join(' '));
    }
    // Rastergrenzen
    let I0 = Infinity, J0 = Infinity, I1 = -Infinity, J1 = -Infinity;
    lines.forEach(l => l.items.forEach(it => {
      const g = it.G.g;
      I0 = Math.min(I0, g.i0 + it.pi); J0 = Math.min(J0, g.j0 + it.bj);
      I1 = Math.max(I1, g.i0 + it.pi + g.nx - 1); J1 = Math.max(J1, g.j0 + it.bj + g.ny - 1);
    }));
    extra.forEach(p => { const bb = primBB(p); I0 = Math.min(I0, Math.floor((bb[0] - B) / h) - 1); J0 = Math.min(J0, Math.floor((bb[1] - B) / h) - 1); I1 = Math.max(I1, Math.ceil((bb[2] + B) / h) + 1); J1 = Math.max(J1, Math.ceil((bb[3] + B) / h) + 1); });
    if (!isFinite(I0)) return null;
    const G = mkGrid(I0, J0, I1 - I0 + 1, J1 - J0 + 1, h);
    lines.forEach(l => l.items.forEach(it => {
      const g = it.G.g, oi = g.i0 + it.pi - I0, oj = g.j0 + it.bj - J0;
      for (let j = 0; j < g.ny; j++) {
        const src = j * g.nx, dst = (oj + j) * G.nx + oi;
        for (let i = 0; i < g.nx; i++) { const v = g.d[src + i]; if (v < G.d[dst + i]) G.d[dst + i] = v; }
      }
    }));
    splat(G, extra, B);
    G.extra = extra;
    return G;
  }

  // ======================================================================
  //  Konturen (Marching Squares), Vereinfachung, Teile
  // ======================================================================
  // Fall -> Kantenpaare [von, nach] (Material links = Außenkontur gegen den UZS).
  const MS = [[], [[0, 3]], [[1, 0]], [[1, 3]], [[2, 1]], null, [[2, 0]], [[2, 3]], [[3, 2]], [[0, 2]], null, [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], []];
  let msNext = new Int32Array(0), msSeen = new Uint8Array(0);   // wiederverwendete Puffer (nur benutzte Einträge zurücksetzen)
  function contours(G, L) {
    const { nx, ny, d, h, i0, j0 } = G;
    if (msNext.length < 2 * nx * ny) { msNext = new Int32Array(2 * nx * ny); msNext.fill(-1); msSeen = new Uint8Array(2 * nx * ny); }
    const next = msNext, seen = msSeen;
    const starts = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i;
        const v00 = d[k], v10 = d[k + 1], v01 = d[k + nx], v11 = d[k + nx + 1];
        const c = (v00 < L ? 1 : 0) | (v10 < L ? 2 : 0) | (v11 < L ? 4 : 0) | (v01 < L ? 8 : 0);
        if (c === 0 || c === 15) continue;
        const E = [2 * k, 2 * (k + 1) + 1, 2 * (k + nx), 2 * k + 1];
        let pairs = MS[c];
        if (!pairs) {
          const ctr = (v00 + v10 + v01 + v11) / 4 < L;
          pairs = c === 5 ? (ctr ? [[0, 1], [2, 3]] : [[0, 3], [2, 1]]) : (ctr ? [[3, 0], [1, 2]] : [[1, 0], [3, 2]]);
        }
        for (const p of pairs) { next[E[p[0]]] = E[p[1]]; starts.push(E[p[0]]); }
      }
    }
    const pt = id => {
      const k = id >> 1, j = Math.floor(k / nx), i = k - j * nx;
      const va = d[k];
      if (!(id & 1)) { const vb = d[k + 1], t = (L - va) / (vb - va); return [(i0 + i + t) * h, (j0 + j) * h]; }
      const vb = d[k + nx], t = (L - va) / (vb - va); return [(i0 + i) * h, (j0 + j + t) * h];
    };
    const loops = [];
    for (const s of starts) {
      if (seen[s]) continue;
      const P = []; let id = s, guard = 0;
      while (id >= 0 && !seen[id] && guard++ < 4e6) { seen[id] = 1; P.push(pt(id)); id = next[id]; }
      if (P.length >= 3 && id === s) loops.push(P);
    }
    for (const s of starts) { next[s] = -1; seen[s] = 0; }
    return loops;
  }
  function area(P) { let a = 0; for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function dp(P, tol) {
    const n = P.length; if (n < 3) return P.slice();
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [[0, n - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) { const d = segDist(P[i][0], P[i][1], P[a][0], P[a][1], P[b][0], P[b][1]); if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return P.filter((_, i) => keep[i]);
  }
  function simplifyClosed(P, tol) {
    const n = P.length; if (n < 8) return P;
    let far = 0, fd = -1; for (let i = 1; i < n; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > fd) { fd = d; far = i; } }
    const a = dp(P.slice(0, far + 1), tol), b = dp(P.slice(far).concat([P[0]]), tol);
    return a.slice(0, -1).concat(b.slice(0, -1));
  }
  function inPoly(x, y, P) {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[i], b = P[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  const bbOf = P => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; P.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); return [x0, y0, x1, y1]; };
  // Außen- und Innenkonturen zu Teilen gruppieren.
  function pieces(G, L, tol) {
    // Winzige Zwickel (z. B. an Strich-Anschlüssen) sind keine Innenformen/Teile.
    const minA = Math.max(Math.pow(G.h * 3, 2), Math.pow(0.02 * (G.H || 0), 2));
    const loops = contours(G, L).map(P => simplifyClosed(P, tol)).map(P => ({ P, a: area(P) })).filter(o => Math.abs(o.a) > minA);
    const outs = loops.filter(o => o.a > 0).map(o => ({ outer: o.P, area: o.a, holes: [], bb: bbOf(o.P) }));
    loops.filter(o => o.a < 0).forEach(o => {
      const p = o.P[0]; let best = null;
      outs.forEach(pc => { if (pc.area > -o.a && p[0] >= pc.bb[0] && p[0] <= pc.bb[2] && p[1] >= pc.bb[1] && p[1] <= pc.bb[3] && inPoly(p[0], p[1], pc.outer) && (!best || pc.area < best.area)) best = pc; });
      if (best) best.holes.push(o.P);
    });
    return outs;
  }
  // Nächstes Punktpaar zwischen zwei Polylinien (a: Punkte, b: Kanten).
  // accept(p, q) (optional) filtert Kandidaten — der beste zulässige gewinnt,
  // sonst der beste überhaupt.
  function nearestPair(A, Bp, dirPref, accept) {
    const cand = [];
    // A dicht abtasten (vereinfachte Konturen haben an geraden Strecken keine
    // Zwischenpunkte — sonst kämen nur Ecken als Kandidaten in Frage).
    const nA = A.length; let per = 0;
    for (let i = 0; i < nA; i++) per += Math.hypot(A[(i + 1) % nA][0] - A[i][0], A[(i + 1) % nA][1] - A[i][1]);
    const ds = Math.max(1e-3, per / 240), samples = [];
    for (let i = 0; i < nA; i++) {
      const a = A[i], b = A[(i + 1) % nA], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / ds));
      for (let j = 0; j < n; j++) samples.push({ p: [a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n], ia: i, ta: j / n });
    }
    // Nur Kanten von Bp in der Nähe von A prüfen (große verbundene Konturen haben
    // tausende Kanten). Reicht der Umkreis nicht, wird mit allen Kanten wiederholt.
    const bbA = bbOf(A), m = Bp.length;
    const scan = R => {
      const idx = [];
      for (let k = 0; k < m; k++) {
        const a = Bp[k], b = Bp[(k + 1) % m];
        if (Math.max(a[0], b[0]) < bbA[0] - R || Math.min(a[0], b[0]) > bbA[2] + R || Math.max(a[1], b[1]) < bbA[1] - R || Math.min(a[1], b[1]) > bbA[3] + R) continue;
        idx.push(k);
      }
      const out = [];
      for (const sm of samples) {
        const p = sm.p, px = p[0], py = p[1]; let bd = Infinity, bk = -1, bt = 0;
        for (const k of idx) {
          const a = Bp[k], b = Bp[(k + 1) % m];
          const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
          let t = L2 > 0 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = a[0] + dx * t - px, ey = a[1] + dy * t - py, d2 = ex * ex + ey * ey;
          if (d2 < bd) { bd = d2; bk = k; bt = t; }
        }
        if (bk < 0) continue;
        const a = Bp[bk], b = Bp[(bk + 1) % m], q = [a[0] + (b[0] - a[0]) * bt, a[1] + (b[1] - a[1]) * bt];
        out.push({ d: Math.sqrt(bd), ia: sm.ia, ta: sm.ta, p, k: bk, t: bt, q });
      }
      return out;
    };
    const R0 = Math.max(bbA[2] - bbA[0], bbA[3] - bbA[1], 1);
    let found = null;
    for (const R of [R0, 4 * R0, Infinity]) { found = scan(R); if (found.length && !found.some(c => c.d > R)) break; }
    for (const best of found) {
      const p = best.p;
      best.score = best.d;
      if (dirPref && best.d > 1e-9) { const cs = ((best.q[0] - p[0]) * dirPref[0] + (best.q[1] - p[1]) * dirPref[1]) / best.d; best.score = best.d * (1 + 3 * (1 - cs)); }
      cand.push(best);
    }
    if (!cand.length) return null;
    cand.sort((a, b) => a.score - b.score);
    if (accept) for (const c of cand) if (accept(c.p, c.q)) return c;
    return cand[0];
  }
  const DIRS = { down: [0, -1], up: [0, 1], left: [-1, 0], right: [1, 0] };

  // ======================================================================
  //  Aufbau (mit Zwischenspeicher)
  // ======================================================================
  let lastKey = '', lastRes = null;
  function buildKey(st) {
    const keys = Object.keys(DEF).filter(k => k !== 'scView' && k !== 'scPresets' && k !== 'scFontData' && k !== 'scFont');
    return JSON.stringify([keys.map(k => state.cfg[k]), st.fontKey, !!st.font, kerf(), feed(), blockX(), blockY(), topFirst()]);
  }
  function build() {
    const st = styleOf();
    const key = buildKey(st);
    if (key === lastKey && lastRes) return lastRes;
    const t0 = performance.now();
    const warns = [];
    if (st.missingSrc) warns.push(T('Schriftdatei fehlt: ') + st.missingSrc + ' — ' + T('bitte erneut laden. Ersatzweise Grotesk.'));
    const text = String(C('scText') || '');
    if (st.font && st.fontKey) embedFont(st.fontKey, st.font, text);
    const k = kerf();
    // Rasterweite: fein genug für die Schrifthöhe, Zellzahl gedeckelt.
    let h = Math.max(0.04, Math.min(0.5, st.H / 360));
    const nChars = Math.max(1, ...text.split('\n').map(l => l.length)), nLines = text.split('\n').length;
    const estA = (nChars * st.H * 0.85 * st.width + 60) * (nLines * st.H * num('scLine', 140) / 100 + st.H + 60);
    if (estA / (h * h) > 5e6) h = Math.sqrt(estA / 5e6);
    { const steps = [0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.6, 2];
      h = steps.find(v => v >= h - 1e-9) || h; }
    const B = k / 2 + 0.8 + 3 * h;       // Band mit echten Abständen: Schnittbahn + Freiraum-Prüfung der Wege
    const tm = {}, tick = (n, t) => { tm[n] = Math.round(performance.now() - t); return performance.now(); };
    let tt = performance.now();
    const lines = layout(st, h, B, warns); tt = tick('layout', tt);
    const G = assemble(st, h, B, lines, warns); tt = tick('assemble', tt);
    const res = { st, h, k, lines, warns, G, feed: feed(), text, tm };
    if (G) G.H = st.H;
    if (!G) { lastKey = key; lastRes = res; res.empty = true; return res; }
    const tol = Math.max(0.01, h * 0.3);
    let P0 = pieces(G, 0, tol); tt = tick('p0', tt);
    // Punkte (i, j, Umlaute …) an das nächste größere Teil anbinden.
    if (C('scDotLink') && P0.length > 1) {
      const W = Math.max(0.5, num('scDotLinkW', 4)), links = [];
      const areas = P0.map(pc => pc.area).sort((a, b) => a - b), med = areas[Math.floor(areas.length / 2)];
      P0.forEach(pc => {
        if (pc.area > 0.3 * med || pc.bb[3] - pc.bb[1] > 0.4 * st.H) return;   // nur kleine Teile (Punkte)
        let best = null;
        P0.forEach(o => {
          if (o === pc || o.area < pc.area * 1.8) return;
          const np = nearestPair(pc.outer, o.outer, [0, -1]);
          if (np && (!best || np.d < best.d)) best = np;
        });
        if (best && best.d < st.H * 0.6) {
          const dx = best.q[0] - best.p[0], dy = best.q[1] - best.p[1], L = Math.hypot(dx, dy) || 1;
          const e = Math.min(W, st.H * 0.05);
          links.push(boxPrim(best.p[0] - dx / L * e, best.p[1] - dy / L * e, best.q[0] + dx / L * e, best.q[1] + dy / L * e, W / 2, 0, 0));
        }
      });
      if (links.length) { splat(G, links, B); G.extra = (G.extra || []).concat(links); P0 = pieces(G, 0, tol); }
    }
    // Innenformen als Schablonen-Lücke öffnen.
    const holesMode = C('scHoles');
    if (holesMode === 'gap') {
      const gw = Math.max(0.3, num('scHoleGap', 4)), cuts = [];
      const pref = DIRS[C('scHoleDir')] || null;
      P0.forEach(pc => pc.holes.forEach(hl => {
        // Außen knapp über die Kontur hinaus; innen tiefer in die Innenform, damit
        // die Lücke auch nach dem Abbrand-Versatz (spitze Ecken ziehen sich zurück)
        // noch in die Innenform mündet. Zulässig nur, wenn diese Verlängerung frei
        // in der Innenform liegt (nicht in einer spitzen Ecke gegen die Wand läuft).
        const hb = bbOf(hl), eo = gw * 0.6 + h * 2, ei = Math.min(gw + k + h * 2, 0.5 * Math.min(hb[2] - hb[0], hb[3] - hb[1]));
        // … und außen in echten Freiraum münden (nicht in eine enge Tasche zwischen
        // überlappenden Buchstaben, die sich beim Abbrand-Versatz wieder schließt).
        const need = gw / 2 + k / 2;
        const accept = (p, q) => {
          const L = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, ux = (p[0] - q[0]) / L, uy = (p[1] - q[1]) / L;
          for (let s = h; s <= ei + 1e-9; s += Math.max(h, ei / 8)) if (sdfAt(G, p[0] + ux * s, p[1] + uy * s) < 0.8 * Math.min(s, need)) return false;
          for (let s = h; s <= eo + need + 1e-9; s += Math.max(h, (eo + need) / 8)) if (sdfAt(G, q[0] - ux * s, q[1] - uy * s) < 0.8 * Math.min(s, need)) return false;
          return true;
        };
        const np = nearestPair(hl, pc.outer, pref, accept);
        if (!np) return;
        const dx = np.q[0] - np.p[0], dy = np.q[1] - np.p[1], L = Math.hypot(dx, dy) || 1;
        cuts.push(boxPrim(np.p[0] - dx / L * ei, np.p[1] - dy / L * ei, np.q[0] + dx / L * eo, np.q[1] + dy / L * eo, gw / 2, 0, 0));
      }));
      if (cuts.length) { splat(G, cuts, B, 'sub'); G.cuts = cuts; P0 = pieces(G, 0, tol); }
      if (gw <= k + 0.05) warns.push(T('Lückenbreite ist nicht größer als der Abbrand — der Draht passt nicht durch die Lücke.'));
    }
    if (holesMode === 'fill') P0.forEach(pc => { pc.holes = []; });
    // Schnittbahn = Höhenlinie Abbrand/2
    let P1 = k > 1e-6 ? pieces(G, k / 2, tol) : P0.map(pc => ({ outer: pc.outer, area: pc.area, holes: pc.holes.slice(), bb: pc.bb }));
    if (holesMode === 'fill') P1.forEach(pc => { pc.holes = []; });
    tt = tick('p1', tt);
    if (P1.length < P0.length) warns.push(T('Teile liegen enger als der Abbrand — ihre Schnittbahnen verschmelzen. Abstand vergrößern.'));
    const nh0 = P0.reduce((s, pc) => s + pc.holes.length, 0), nh1 = P1.reduce((s, pc) => s + pc.holes.length, 0);
    if (holesMode !== 'fill' && nh1 < nh0) warns.push(T('Innenform kleiner als der Abbrand — wird nicht geschnitten.'));
    res.P0 = P0; res.P1 = P1; res.tol = tol;
    // Tinten-Box
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    P0.forEach(pc => { bx0 = Math.min(bx0, pc.bb[0]); by0 = Math.min(by0, pc.bb[1]); bx1 = Math.max(bx1, pc.bb[2]); by1 = Math.max(by1, pc.bb[3]); });
    if (!isFinite(bx0)) { res.empty = true; lastKey = key; lastRes = res; return res; }
    res.ink = [bx0, by0, bx1, by1];
    // Block
    const mx = Math.max(0, num('scMarginX', 15)), my = Math.max(0, num('scMarginY', 12));
    let BW = bx1 - bx0 + 2 * mx, BH = by1 - by0 + 2 * my;
    if (num('scBlockW', 0) > 0) { if (num('scBlockW', 0) < BW - 2 * mx + k) warns.push(T('Fester Block ist schmaler als die Schrift.')); BW = num('scBlockW', 0); }
    if (num('scBlockH', 0) > 0) { if (num('scBlockH', 0) < BH - 2 * my + k) warns.push(T('Fester Block ist niedriger als die Schrift.')); BH = num('scBlockH', 0); }
    const blk = { x0: (bx0 + bx1) / 2 - BW / 2, y0: (by0 + by1) / 2 - BH / 2 };
    if (num('scBlockH', 0) > 0) blk.y0 = by0 - Math.min(my, (BH - (by1 - by0)) / 2);
    blk.x1 = blk.x0 + BW; blk.y1 = blk.y0 + BH; blk.w = BW; blk.h = BH; blk.d = Math.max(1, num('scDepth', 100));
    res.block = blk;
    res.origin = { x: blk.x0 - blockX(), y: blk.y0 - blockY() };
    planCut(res, warns); tt = tick('plan', tt);
    res.ms = performance.now() - t0;
    lastKey = key; lastRes = res;
    return res;
  }

  // ======================================================================
  //  Schnittbahn: Reihenfolge, Einschnitte, Verbindungswege
  // ======================================================================
  function sdfAt(G, x, y) {
    const fx = x / G.h - G.i0, fy = y / G.h - G.j0;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= G.nx - 1 || j >= G.ny - 1) return BIG;
    const tx = fx - i, ty = fy - j, k = j * G.nx + i, d = G.d;
    return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - ty) + (d[k + G.nx] * (1 - tx) + d[k + G.nx + 1] * tx) * ty;
  }
  function planCut(res, warns) {
    const G = res.G, k = res.k, h = res.h, blk = res.block, S = res.origin;
    const thr = k / 2 - Math.max(0.02, h * 0.15);
    const segFree = (a, b) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / (h * 0.5)));
      const skip = Math.min(n / 2, Math.ceil(h * 0.6 / (L / n || 1)));
      for (let i = skip; i <= n - skip; i++) { const t = i / n; if (sdfAt(G, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) < thr) return false; }
      return true;
    };
    // Reihenfolge: Zeilen von unten nach oben, abwechselnd links→rechts / rechts→links.
    const lineOf = pc => {
      const cy = (pc.bb[1] + pc.bb[3]) / 2; let best = 0, bd = Infinity;
      res.lines.forEach((l, i) => { const d = Math.abs(cy - (l.baseY + res.st.H / 2)); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    const P = res.P1.map(pc => Object.assign({}, pc, { line: lineOf(pc), cx: (pc.bb[0] + pc.bb[2]) / 2 }));
    const nL = res.lines.length;
    P.sort((a, b) => (b.line - a.line) || (((nL - 1 - a.line) % 2 ? -1 : 1) * (a.cx - b.cx)));
    let minY = Infinity; P.forEach(pc => { minY = Math.min(minY, pc.bb[1]); });
    const lane = Math.max(blk.y0 + Math.min(1, (minY - blk.y0) / 2), minY - Math.max(0.5, num('scLane', 4)));
    res.laneY = lane;
    // A*-Umweg durch Abfall (grobes Raster, frei = Abstand ≥ Abbrand/2 + 0,3 mm)
    const ax0 = Math.min(S.x, blk.x0) - 5, ay0 = Math.min(S.y, blk.y0) - 5, ax1 = blk.x1 + 5, ay1 = blk.y1 + 5;
    let cs = Math.max(0.8, h * 3);
    if ((ax1 - ax0) * (ay1 - ay0) / (cs * cs) > 250000) cs = Math.sqrt((ax1 - ax0) * (ay1 - ay0) / 250000);
    const NX = Math.ceil((ax1 - ax0) / cs) + 1, NY = Math.ceil((ay1 - ay0) / cs) + 1;
    let occ = null;
    const ensureOcc = () => {
      if (occ) return;
      occ = new Uint8Array(NX * NY);
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) if (sdfAt(G, ax0 + i * cs, ay0 + j * cs) < k / 2 + 0.3) occ[j * NX + i] = 1;
    };
    const astar = (a, b) => {
      ensureOcc();
      const cell = p => [Math.max(0, Math.min(NX - 1, Math.round((p[0] - ax0) / cs))), Math.max(0, Math.min(NY - 1, Math.round((p[1] - ay0) / cs)))];
      const nearFree = c => { if (!occ[c[1] * NX + c[0]]) return c; for (let r = 1; r < 30; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const x = c[0] + dx, y = c[1] + dy; if (x >= 0 && y >= 0 && x < NX && y < NY && !occ[y * NX + x]) return [x, y]; } return null; };
      const sc = nearFree(cell(a)), gc = nearFree(cell(b)); if (!sc || !gc) return null;
      const N = NX * NY, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
      // Binär-Heap auf typisierten Feldern (Schlüssel f, Wert id)
      let hf = new Float64Array(1024), hi = new Int32Array(1024), hn = 0;
      const push = (f, id) => {
        if (hn === hf.length) { const nf = new Float64Array(hn * 2), ni = new Int32Array(hn * 2); nf.set(hf); ni.set(hi); hf = nf; hi = ni; }
        let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; hi[i] = hi[p]; i = p; } hf[i] = f; hi[i] = id;
      };
      const pop = () => {
        const top = hi[0], f = hf[--hn], id = hi[hn]; let i = 0;
        for (;;) { const l = 2 * i + 1; if (l >= hn) break; const m = (l + 1 < hn && hf[l + 1] < hf[l]) ? l + 1 : l; if (hf[m] >= f) break; hf[i] = hf[m]; hi[i] = hi[m]; i = m; }
        hf[i] = f; hi[i] = id; return top;
      };
      const sid = sc[1] * NX + sc[0], gid = gc[1] * NX + gc[0], hh = id => { const x = id % NX, y = (id / NX) | 0; return Math.hypot(x - gc[0], y - gc[1]); };
      g[sid] = 0; push(hh(sid), sid);
      let found = false, guard = 0;
      while (hn && guard++ < 600000) {
        const id = pop(); if (closed[id]) continue; closed[id] = 1;
        if (id === gid) { found = true; break; }
        const x = id % NX, y = (id / NX) | 0;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue; const nx2 = x + dx, ny2 = y + dy;
          if (nx2 < 0 || ny2 < 0 || nx2 >= NX || ny2 >= NY) continue;
          const nid = ny2 * NX + nx2; if (occ[nid] || closed[nid]) continue;
          if (dx && dy && (occ[y * NX + nx2] || occ[ny2 * NX + x])) continue;
          const ng = g[id] + (dx && dy ? Math.SQRT2 : 1);
          if (ng < g[nid]) { g[nid] = ng; came[nid] = id; push(ng + hh(nid), nid); }
        }
      }
      if (!found) return null;
      const cells = []; for (let id = gid; id >= 0; id = came[id]) cells.push([ax0 + (id % NX) * cs, ay0 + ((id / NX) | 0) * cs]);
      cells.reverse();
      const pts = [a].concat(cells, [b]), outp = [pts[0]]; let i = 0;
      while (i < pts.length - 1) { let j = pts.length - 1; for (; j > i + 1; j--) if (segFree(pts[i], pts[j])) break; outp.push(pts[j]); i = j; }
      return outp.slice(1);
    };
    let detours = 0;
    const travel = (a, b) => {
      if (segFree(a, b)) return [b];
      const l1 = [a[0], lane], l2 = [b[0], lane];
      if (segFree(a, l1) && segFree(l1, l2) && segFree(l2, b)) return [l1, l2, b];
      const r = astar(a, b); if (r) return r;
      detours++; return [l1, l2, b];
    };
    // Weg aufbauen: [x, y, Art]
    const path = [];
    const put = (p, kind) => path.push([p[0], p[1], kind]);
    put([S.x, S.y], 'start');
    put([S.x, lane], 'air');
    let cur = [S.x, lane], slits = 0, cutLen = 0;
    const pref = DIRS[C('scHoleDir')] || null;
    P.forEach((pc, idx) => {
      // Einstieg seitlich (in Laufrichtung vorne: links bzw. bei Rückwärtszeilen rechts),
      // dort am tiefsten Punkt der Seitenkante. Umlauf so, dass zuerst die OBERSEITE
      // geschnitten wird und die Unterseite zuletzt — das Teil liegt bis zum letzten
      // Zug auf dem Block auf. „Unterseite zuerst" (Profil-Schnittrichtung) dreht um.
      // pc.outer läuft gegen den Uhrzeigersinn (Material links).
      const ltr = ((nL - 1 - pc.line) % 2) === 0;
      const O = (ltr === topFirst()) ? pc.outer.slice().reverse() : pc.outer;
      let xe = ltr ? Infinity : -Infinity;
      O.forEach(p => { xe = ltr ? Math.min(xe, p[0]) : Math.max(xe, p[0]); });
      const tolX = Math.max(0.3, 0.01 * res.st.H);
      let e = -1;
      O.forEach((p, i) => { if (Math.abs(p[0] - xe) <= tolX && (e < 0 || p[1] < O[e][1])) e = i; });
      if (e < 0) e = 0;
      // Einschnitte in die Innenformen (vor der Außenkontur, damit das Teil fest bleibt)
      const hooks = [];
      pc.holes.forEach((hl, hi) => {
        const others = pc.holes.filter((_, j) => j !== hi);
        let np = nearestPair(hl, O, pref);
        if (np && others.length && others.some(o => crossesPoly(np.p, np.q, o))) np = nearestPair(hl, O, null);
        if (!np) return;
        hooks.push({ k: np.k, t: np.t, q: np.q, p: np.p, hole: hl, hi: np.ia });
      });
      hooks.sort((a, b) => a.k - b.k || a.t - b.t);
      const m = O.length, seq = [];
      for (let s = 0; s < m; s++) {
        const i = (e + s) % m; seq.push({ p: O[i] });
        hooks.filter(hk => hk.k === i).forEach(hk => seq.push({ p: hk.q, hook: hk }));
      }
      seq.push({ p: O[e] });
      const tr = travel(cur, O[e]);
      tr.forEach((p, i) => put(p, i === tr.length - 1 ? 'enter' : 'travel'));   // letztes Stück = Einstieg
      pc.entry = O[e]; pc.order = idx + 1;
      for (let s = 1; s < seq.length; s++) {
        const it = seq[s];
        put(it.p, 'cut');
        if (it.hook) {
          const hk = it.hook, H2 = hk.hole, n2 = H2.length;
          put(hk.p, 'slit'); slits++;
          for (let q = 1; q <= n2; q++) put(H2[(hk.hi + q) % n2], 'hole');
          put(hk.p, 'hole'); put(hk.q, 'slit');
        }
      }
      cur = O[e];
    });
    if (P.length) travel(cur, [S.x, lane]).forEach(p => put(p, 'travel'));
    put([S.x, S.y], 'air');
    for (let i = 1; i < path.length; i++) if (path[i][2] !== 'air' && path[i][2] !== 'travel' && path[i][2] !== 'enter') cutLen += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    res.path = path; res.order = P; res.slits = slits; res.cutLen = cutLen;
    if (detours) warns.push(T('Kein freier Verbindungsweg gefunden — Weg über die Fahrspur schneidet evtl. durch Material. Abstände vergrößern.'));
  }
  function crossesPoly(a, b, P) {
    for (let i = 0, n = P.length; i < n; i++) {
      const c = P[i], d = P[(i + 1) % n];
      const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]), d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
    }
    return false;
  }

  // ======================================================================
  //  Fahrten als Daten (Maschinenkoordinaten) — Text macht schrift_gcode.js
  // ======================================================================
  function machineMoves() {
    const r = build(); if (!r || r.empty || !r.path) return null;
    const blk = r.block, bx = r.origin.x, by = r.origin.y;
    const f = r.feed, maxF = state.cfg.maxFeed || 0;
    const outF = App.outsideFeed ? App.outsideFeed() : f;
    // Strecke berührt das Blockinnere? (Liang-Barsky) — dann Schnittvorschub.
    const inBlock = (a, b) => {
      let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
      const clip = (p, q) => { if (Math.abs(p) < 1e-12) return q > 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
      const e = 1e-6;
      return clip(-dx, a[0] - blk.x0 - e) && clip(dx, blk.x1 - e - a[0]) && clip(-dy, a[1] - blk.y0 - e) && clip(dy, blk.y1 - e - a[1]) && t1 - t0 > 1e-9;
    };
    const moves = [];
    let len = 0, tmin = 0;
    r.path.forEach((p, i) => {
      const X = p[0] - bx, Y = p[1] - by;
      if (i === 0) { moves.push({ X, Y, k: 'start', F: outF }); return; }
      const q = r.path[i - 1], L = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (L < 1e-6) return;
      const cutting = p[2] !== 'air' && inBlock(q, p);
      const F = cutting ? (maxF > 0 ? Math.min(f, maxF) : f) : outF;
      moves.push({ X, Y, k: p[2], F, cut: cutting });
      len += L; tmin += L / Math.max(1, F);
    });
    const heat = App.heatForSpeed ? App.heatForSpeed(matId(), f) : null;
    return {
      moves, res: r,
      meta: {
        text: r.text, font: fontLabel(), H: r.st.H, w: r.st.w, bold: r.st.bold, kerf: r.k, feed: f, outFeed: outF,
        heat, wireS: heat != null && App.wireSFor ? App.wireSFor(heat) : null,
        block: { w: blk.w, h: blk.h, d: blk.d, x: blockX(), y: blockY() }, topFirst: topFirst(),
        pieces: r.order.length, slits: r.slits, cutLen: r.cutLen, minutes: tmin
      }
    };
  }
  // 3D-Szene (Simulation): Block um die Schrift, Draht gerade (XY = UV).
  function buildScene(mm) {
    mm = mm || machineMoves();
    const mw = state.cfg.machineWidth || 900;
    const ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    if (!mm) return { machineWidth: mw, ax, blocks: [{ seg: 0, x0: 0, x1: 1, y0: 0, y1: 1, x0t: 0, x1t: 1, y0t: 0, y1t: 1, z0: 0, z1: mw, cutZ0: 0, cutZ1: mw }], defaultSeg: 0, limits: App.machineLimits ? App.machineLimits() : {} };
    const b = mm.meta.block, d = Math.min(b.d, mw);
    const z0 = App.effBlockZ ? Math.max(0, Math.min(mw - d, +App.effBlockZ(d) || 0)) : (mw - d) / 2, z1 = z0 + d;
    const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
    return { machineWidth: mw, ax, blocks: [{ seg: 0, x0, x1, y0, y1, x0t: x0, x1t: x1, y0t: y0, y1t: y1, z0, z1, cutZ0: z0, cutZ1: z1 }], defaultSeg: 0, limits: App.machineLimits ? App.machineLimits() : {} };
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
    return { moves: mv, label: T('Schriften') };
  }

  // ======================================================================
  //  Ansicht (Canvas)
  // ======================================================================
  let canvas = null, ctx = null, view = null, bound = false;
  const W2S = (x, y) => [view.ox + x * view.sc, view.oy - y * view.sc];
  function col(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function fitCanvas() {
    canvas = document.getElementById('cSchrift'); if (!canvas) return false;
    const r = canvas.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return false;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  function fitView() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), res = lastRes;
    let b = res && res.block ? [res.block.x0, res.block.y0, res.block.x1, res.block.y1] : [0, -20, 200, 120];
    if (res && res.origin) { b[0] = Math.min(b[0], res.origin.x); b[1] = Math.min(b[1], res.origin.y); }
    const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
    // oben Platz für das Info-Feld, unten für die Knopfleiste
    const top = 110, bottom = 56, availH = Math.max(40, r.height - top - bottom);
    const sc = Math.min((r.width - 70) / bw, availH / bh);
    view = { sc, ox: (r.width - bw * sc) / 2 - b[0] * sc, oy: top + (availH + bh * sc) / 2 + b[1] * sc };
  }
  function pathOf(P) { ctx.moveTo(...W2S(P[0][0], P[0][1])); for (let i = 1; i < P.length; i++) ctx.lineTo(...W2S(P[i][0], P[i][1])); ctx.closePath(); }
  function draw() {
    if (!canvas || !ctx) return;
    const r = canvas.getBoundingClientRect(), w = r.width, hgt = r.height;
    const res = lastRes;
    if (!view) fitView();
    ctx.clearRect(0, 0, w, hgt);
    ctx.fillStyle = col('--panel2', '#1e242c'); ctx.fillRect(0, 0, w, hgt);
    // Raster
    const step = view.sc >= 4 ? 10 : view.sc >= 0.8 ? 50 : view.sc >= 0.2 ? 100 : 500;
    ctx.strokeStyle = col('--line', '#2a323c'); ctx.lineWidth = 1; ctx.beginPath();
    const wx0 = -view.ox / view.sc, wx1 = (w - view.ox) / view.sc, wy1 = view.oy / view.sc, wy0 = (view.oy - hgt) / view.sc;
    for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const [px] = W2S(x, 0); ctx.moveTo(px, 0); ctx.lineTo(px, hgt); }
    for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) { const [, py] = W2S(0, y); ctx.moveTo(0, py); ctx.lineTo(w, py); }
    ctx.stroke();
    const V = viewCfg();
    if (!res || res.empty) {
      ctx.fillStyle = '#8b98a8'; ctx.font = '13px Segoe UI, sans-serif';
      ctx.fillText(T('Kein Text — links in der Seitenleiste Text eingeben.'), 20, 30);
      updateInfo(res); return;
    }
    // Block
    const blk = res.block;
    { const [ax, ay] = W2S(blk.x0, blk.y1), [bx, by] = W2S(blk.x1, blk.y0);
      ctx.fillStyle = 'rgba(200,170,110,0.07)'; ctx.fillRect(ax, ay, bx - ax, by - ay);
      ctx.strokeStyle = '#a08a5a'; ctx.lineWidth = 1.5; ctx.strokeRect(ax, ay, bx - ax, by - ay);
      ctx.fillStyle = '#a08a5a'; ctx.font = '11px Segoe UI, sans-serif';
      ctx.fillText(T('Block') + ' ' + blk.w.toFixed(0) + ' × ' + blk.h.toFixed(0) + ' × ' + blk.d.toFixed(0) + ' mm', ax + 4, ay - 5); }
    // Fahrspur
    if (res.laneY != null && V.cut) { const [ax, ay] = W2S(blk.x0, res.laneY), [bx] = W2S(blk.x1, res.laneY); ctx.strokeStyle = 'rgba(255,180,84,0.25)'; ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); ctx.stroke(); ctx.setLineDash([]); }
    // Grundlinien
    ctx.strokeStyle = 'rgba(139,152,168,0.35)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1;
    res.lines.forEach(l => { if (!l.items.length) return; const [ax, ay] = W2S(l.x0 - 6, l.baseY), [bx] = W2S(l.x1 + 6, l.baseY); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); ctx.stroke(); });
    ctx.setLineDash([]);
    // Buchstaben (Kontur 0)
    ctx.beginPath();
    res.P0.forEach(pc => { pathOf(pc.outer); pc.holes.forEach(hl => pathOf(hl)); });
    if (V.fill) { ctx.fillStyle = 'rgba(74,163,255,0.22)'; ctx.fill('evenodd'); }
    ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.4; ctx.stroke();
    // Skelett (Linienschrift)
    if (V.skel && res.st.skel) {
      ctx.strokeStyle = 'rgba(255,210,127,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      res.lines.forEach(l => l.items.forEach(it => {
        (it.G.skelLines || []).forEach(P => { ctx.beginPath(); P.forEach((p, i) => { const q = W2S(p[0] + it.px, p[1] + it.bj * res.h); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.stroke(); });
      }));
      ctx.setLineDash([]);
    }
    // Schnittbahn
    if (V.cut && res.path) {
      const P = res.path;
      // Abbrand in wahrer Dicke: Band (Breite = Abbrand res.k) unter den Schnitt-
      // stücken (Kontur, Loch, Einschnitt) — Fahr-/Verbindungswege ausgenommen.
      if (App.kerfBand && App.kerfTrueOn && App.kerfTrueOn('schrift') && res.k > 0) {
        const runs = []; let run = null;
        for (let i = 1; i < P.length; i++) {
          const kd = P[i][2], on = kd === 'cut' || kd === 'hole' || kd === 'slit';
          if (!on) { run = null; continue; }
          if (!run) { run = [P[i - 1]]; runs.push(run); }
          run.push(P[i]);
        }
        const VB = { s: view.sc, X: x => view.ox + x * view.sc, Y: y => view.oy - y * view.sc };
        App.kerfBand(ctx, VB, runs, { view: 'schrift', k: res.k, color: '#ff5a3c' });
      }
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], kd = b[2];
        ctx.beginPath(); ctx.moveTo(...W2S(a[0], a[1])); ctx.lineTo(...W2S(b[0], b[1]));
        if (kd === 'travel' || kd === 'air' || kd === 'enter') { ctx.strokeStyle = kd === 'air' ? '#6b7888' : '#ffb454'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2; }
        else if (kd === 'slit') { ctx.strokeStyle = '#ff4fd8'; ctx.setLineDash([]); ctx.lineWidth = 2; }
        else { ctx.strokeStyle = '#ff5a3c'; ctx.setLineDash([]); ctx.lineWidth = 1.3; }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (V.num) res.order.forEach(pc => {
        if (!pc.entry) return; const [x, y] = W2S(pc.entry[0], pc.entry[1]);
        ctx.fillStyle = '#ffb454'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e6ebf1'; ctx.font = '10px Segoe UI, sans-serif'; ctx.fillText(String(pc.order), x + 5, y + 12);
      });
    }
    // Nullpunkt
    { const [ox, oy] = W2S(res.origin.x, res.origin.y); ctx.strokeStyle = col('--bad', '#ff6b6b'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy); ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke();
      ctx.fillStyle = col('--bad', '#ff6b6b'); ctx.font = '10px Segoe UI, sans-serif'; ctx.fillText('X0 Y0', ox + 6, oy + 13); }
    // Maße der Schrift
    { const ink = res.ink, [ax, ay] = W2S(ink[0], ink[1]), [bx, by] = W2S(ink[2], ink[3]);
      ctx.fillStyle = '#9fb0c4'; ctx.font = '11px Segoe UI, sans-serif';
      ctx.fillText((ink[2] - ink[0]).toFixed(1) + ' mm', (ax + bx) / 2 - 20, ay + 16);
      ctx.save(); ctx.translate(bx + 12, (ay + by) / 2 + 20); ctx.rotate(-Math.PI / 2); ctx.fillText((ink[3] - ink[1]).toFixed(1) + ' mm', 0, 0); ctx.restore(); }
    ctx.fillStyle = '#8b98a8'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText(T('Raster') + ' ' + step + ' mm · ' + T('blau = Buchstaben · rot = Schnittbahn (mit Abbrand) · violett = Einschnitt · orange = Verbindungsweg'), 8, hgt - 44);
    updateInfo(res);
  }
  function updateInfo(res) {
    const el = document.getElementById('schriftInfo'); if (!el) return;
    if (!res || res.empty) { el.innerHTML = T('Kein Text.'); return; }
    const ink = res.ink, mm = v => v.toFixed(1);
    let hh = '<b>' + T('Schrift') + ':</b> ' + esc(fontLabel()) + '<br>'
      + T('Schriftbild') + ': ' + mm(ink[2] - ink[0]) + ' × ' + mm(ink[3] - ink[1]) + ' mm · ' + T('Versalhöhe') + ' ' + mm(res.st.H) + ' mm'
      + (res.st.skel ? ' · ' + T('Strich') + ' ' + mm(res.st.w) + ' mm' : '') + '<br>'
      + T('Teile') + ': ' + res.order.length + ' · ' + T('Innenformen') + ': ' + res.P1.reduce((s, pc) => s + pc.holes.length, 0)
      + ' · ' + T('Einschnitte') + ': ' + res.slits + '<br>'
      + T('Abbrand') + ' ' + res.k.toFixed(2) + ' mm · ' + T('Vorschub') + ' ' + Math.round(res.feed) + ' mm/min · '
      + T('Schnittlänge') + ' ' + (res.cutLen / 1000).toFixed(2) + ' m (~' + (res.cutLen / Math.max(1, res.feed)).toFixed(1) + ' min)';
    if (res.warns.length) hh += '<div style="color:#ffb454;margin-top:4px">' + res.warns.map(w => '⚠ ' + esc(w)).join('<br>') + '</div>';
    el.innerHTML = hh;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function bindCanvas() {
    if (bound) return; canvas = document.getElementById('cSchrift'); if (!canvas) return;
    bound = true;
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); if (!view) return;
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      view.ox = mx - (mx - view.ox) * f; view.oy = my - (my - view.oy) * f; view.sc *= f; draw();
    }, { passive: false });
    let drag = null;
    canvas.addEventListener('mousedown', e => { if (e.button !== 0 && e.button !== 1 || !view) return; drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; canvas.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', e => { if (!drag) return; view.ox = drag.ox + e.clientX - drag.x; view.oy = drag.oy + e.clientY - drag.y; draw(); });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; canvas.style.cursor = ''; } });
    canvas.addEventListener('dblclick', () => { fitView(); draw(); });
    const tg = (id, key) => { const b = document.getElementById(id); if (!b) return; b.checked = !!viewCfg()[key]; b.onchange = () => { viewCfg()[key] = b.checked; draw(); }; };
    tg('scShowFill', 'fill'); tg('scShowCut', 'cut'); tg('scShowSkel', 'skel'); tg('scShowNum', 'num');
    // Abbrand in wahrer Dicke: eigene Einstellung der Ebene „Schriften" (App.KTRUE.schrift).
    { const kt = document.getElementById('scShowKerfTrue');
      if (kt && App.kerfTrueOn) { kt.checked = App.kerfTrueOn('schrift'); kt.onchange = () => App.kerfTrueSet('schrift', kt.checked); } }
    const fb = document.getElementById('scFit'); if (fb) fb.onclick = () => { fitView(); draw(); };
    const dx = document.getElementById('scDxf'); if (dx) { dx.onclick = () => exportDxf(); DEMO.btn(dx); }
    const cd = document.getElementById('scToCad'); if (cd) { if (!App.cadImportDxfText) cd.style.display = 'none'; else cd.onclick = () => toCad(); }
  }

  // ---------- Aktualisieren -------------------------------------------------
  let upTimer = null, genTimer = null;
  function upd(rebuildSide, delay) {
    if (rebuildSide) buildSidebar();
    if (upTimer) clearTimeout(upTimer);
    upTimer = setTimeout(() => {
      upTimer = null;
      if (state.activeTab === 'schrift') { build(); draw(); }
      if (state.cfg.gcodeSource === 'schrift') { if (genTimer) clearTimeout(genTimer); genTimer = setTimeout(() => { genTimer = null; App.render(); }, 120); }
    }, delay || 60);
  }
  function show() { bindCanvas(); if (!fitCanvas()) return; const had = !!lastRes; build(); if (!had || !view) fitView(); draw(); }
  function resize() { if (state.activeTab !== 'schrift') return; if (fitCanvas()) draw(); }
  function refresh() { if (state.activeTab !== 'schrift') return; build(); draw(); }

  // ======================================================================
  //  Schriftdateien / Systemschriften laden
  // ======================================================================
  async function loadFontBuffer(buf, wantPs) {
    let f;
    const n = SF.fontCount(buf);
    if (n > 1) {
      let pick = 0;
      for (let i = 0; i < n; i++) { try { const g = SF.parseFont(buf, i); if (wantPs && (g.name === wantPs || fontKeyOf(g) === wantPs)) { pick = i; break; } } catch (e) {} }
      f = SF.parseFont(buf, pick);
    } else f = SF.parseFont(buf, 0);
    const key = libAdd(f);
    selectFont('f:' + key);
    upd(true);
    App.toast && App.toast(T('Schrift geladen: ') + key);
    return key;
  }
  function loadFontFile() {
    const handler = file => file.arrayBuffer().then(b => loadFontBuffer(b)).catch(e => alert(T('Schriftdatei konnte nicht gelesen werden: ') + T(e.message)));
    const inp = document.getElementById('fileSchriftFont');
    if (inp && !inp._wired) { inp._wired = true; inp.onchange = e => { const f = e.target.files[0]; if (f) handler(f); e.target.value = ''; }; }
    if (App.loadFileVia) App.loadFileVia({ 'font/ttf': ['.ttf', '.otf', '.ttc'] }, handler, 'fileSchriftFont', 'ldFont');
    else if (inp) inp.click();
  }
  async function pickSystemFont() {
    if (!window.queryLocalFonts) { alert(T('Dieser Browser erlaubt keinen Zugriff auf die Systemschriften. Bitte „Schriftdatei laden…" verwenden (z. B. aus C:\\Windows\\Fonts).')); return; }
    let list;
    try { list = await window.queryLocalFonts(); }
    catch (e) { alert(T('Zugriff auf Systemschriften verweigert: ') + e.message); return; }
    if (!list || !list.length) { alert(T('Keine Systemschriften gefunden.')); return; }
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(92vw,560px);max-height:82vh;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;box-shadow:0 10px 40px rgba(0,0,0,.5)';
    box.innerHTML = '<div style="font-weight:600;margin-bottom:8px">' + T('Systemschrift wählen') + '</div>';
    const q = document.createElement('input'); q.type = 'text'; q.placeholder = T('Suchen …');
    q.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;border-radius:5px;border:1px solid var(--line);background:var(--panel2);color:var(--txt);margin-bottom:8px';
    const ul = document.createElement('div'); ul.style.cssText = 'overflow:auto;flex:1;min-height:200px;border:1px solid var(--line);border-radius:6px';
    const cl = document.createElement('button'); cl.textContent = T('Abbrechen'); cl.style.cssText = 'margin-top:8px;align-self:flex-end';
    box.appendChild(q); box.appendChild(ul); box.appendChild(cl); back.appendChild(box); document.body.appendChild(back);
    const close = () => back.remove();
    cl.onclick = close; back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    const render = () => {
      const s = q.value.trim().toLowerCase(); ul.textContent = '';
      list.filter(fd => !s || (fd.fullName || '').toLowerCase().includes(s)).slice(0, 400).forEach(fd => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:5px 9px;cursor:pointer;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:10px;align-items:baseline';
        row.innerHTML = '<span style="font-family:\'' + esc(fd.family) + '\';font-size:17px">' + esc(fd.fullName) + '</span><span class="hint" style="margin:0">' + esc(fd.style || '') + '</span>';
        row.onmouseenter = () => { row.style.background = 'var(--panel2)'; }; row.onmouseleave = () => { row.style.background = ''; };
        row.onclick = async () => {
          close();
          try { const blob = await fd.blob(); await loadFontBuffer(await blob.arrayBuffer(), fd.postscriptName || fd.fullName); }
          catch (e) { alert(T('Schrift konnte nicht geladen werden: ') + T(e.message)); }
        };
        ul.appendChild(row);
      });
    };
    q.oninput = render; render(); q.focus();
  }

  // ======================================================================
  //  Export: DXF / CAD
  // ======================================================================
  function dxfText(withCut) {
    const r = build(); if (!r || r.empty || !window.Dxf) return null;
    const toP = P => ({ closed: true, pts: P.map(p => ({ x: p[0], y: p[1] })) });
    const layers = [{ name: 'SCHRIFT', color: 5, polys: [] }];
    r.P0.forEach(pc => { layers[0].polys.push(toP(pc.outer)); pc.holes.forEach(hl => layers[0].polys.push(toP(hl))); });
    if (withCut && r.path) {
      layers.push({ name: 'SCHNITTBAHN', color: 1, polys: [{ closed: false, pts: r.path.map(p => ({ x: p[0], y: p[1] })) }] });
      const b = r.block;
      layers.push({ name: 'BLOCK', color: 2, polys: [{ closed: true, pts: [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }] }] });
    }
    return Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 3 });
  }
  function fileBase() { return ((C('scText') || 'schrift').split('\n')[0].replace(/[^\wäöüÄÖÜß\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)) || 'schrift'; }
  function exportDxf() {
    if (DEMO.blocked()) return;
    const t = dxfText(true); if (!t) { App.toast && App.toast(T('Nichts zu exportieren.')); return; }
    if (App.exportViaPicker) App.exportViaPicker(fileBase() + '.dxf', t, 'application/dxf', 'svDxf');
  }
  function toCad() {
    const t = dxfText(false); if (!t || !App.cadImportDxfText) return;
    App.cadImportDxfText(t, fileBase());
    if (App.switchView && document.getElementById('cadView')) App.switchView('cad');
  }

  // ======================================================================
  //  Seitenleiste
  // ======================================================================
  function schriftSidebar(side) {
    const TAB = 'schrift';
    const nr = (body, label, k, opt) => numRow(body, label, () => num(k, DEF[k]), v => { S(k, v); upd(opt && opt.side); }, Object.assign({ norender: true }, opt || {}));
    const sel = (body, label, k, opts, h, sideRebuild) => selectRow(body, label, opts, () => C(k), v => { S(k, v); upd(sideRebuild); }, h);
    const st = styleOf();

    // --- Text & Schriftart -----------------------------------------------
    const g1 = grp('Schriften: Text & Schriftart', true, TAB, { key: 'sc_text' });
    { const row = document.createElement('div'); row.className = 'row full';
      const l = document.createElement('label'); l.textContent = T('Text (Enter = neue Zeile)');
      const ta = document.createElement('textarea'); ta.rows = 3; ta.value = C('scText') || ''; ta.spellcheck = false;
      ta.style.cssText = 'font-size:15px;resize:vertical;min-height:54px';
      ta.oninput = () => { S('scText', ta.value); upd(false, 250); };   // beim Tippen erst nach kurzer Pause neu rechnen
      row.appendChild(l); row.appendChild(ta); g1.body.appendChild(row); }
    { const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = T('Schriftart');
      const s = document.createElement('select');
      const og = (label, items) => { if (!items.length) return; const o = document.createElement('optgroup'); o.label = T(label); items.forEach(([v, t]) => { const e = document.createElement('option'); e.value = v; e.textContent = t; o.appendChild(e); }); s.appendChild(o); };
      og('Eingebaut (Linienschrift)', SF.PRESETS.map(p => [p.id, T(p.name)]));
      og('Eigene Schriftarten', presets().map(p => ['u:' + p.id, p.name]));
      og('Schriftdateien / Systemschriften', libKeys().map(k => ['f:' + k, k]));
      s.value = C('scFont');
      if (s.value !== C('scFont')) { const e = document.createElement('option'); e.value = C('scFont'); e.textContent = fontLabel(); s.appendChild(e); s.value = C('scFont'); }
      s.onchange = () => { selectFont(s.value); upd(true); };
      row.appendChild(l); row.appendChild(s); g1.body.appendChild(row); }
    { const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0';
      const mk = (txt, title, fn) => { const b = document.createElement('button'); b.textContent = T(txt); b.title = T(title); b.onclick = fn; bar.appendChild(b); return b; };
      mk('🖋 Systemschrift…', 'Eine auf dem Rechner installierte Schrift wählen (Browser fragt einmal nach der Erlaubnis)', pickSystemFont);
      mk('📂 Schriftdatei…', 'TrueType-/OpenType-Datei (.ttf/.otf/.ttc) laden, z. B. aus C:\\Windows\\Fonts', loadFontFile);
      mk('💾 Als eigene Schriftart…', 'Die aktuellen Einstellungen (Stärke, Breite, Enden, Ecken, Serifen, Abstände …) unter einem Namen als eigene Schriftart speichern', () => {
        App.askText(T('Name der neuen Schriftart:'), fontLabel() + ' ' + T('eigen')).then(nm => {
          if (!nm || !nm.trim()) return;
          const id = 'p' + Date.now().toString(36);
          presets().push({ id, name: nm.trim(), p: currentParams() });
          S('scFont', 'u:' + id);
          if (App.saveSettings) try { App.saveSettings(); } catch (e) {}
          upd(true);
        });
      });
      const v = C('scFont');
      if (v.indexOf('u:') === 0 || v.indexOf('f:') === 0) mk('🗑 Entfernen', 'Gewählte eigene Schriftart bzw. Schriftdatei aus der Liste entfernen', () => {
        if (!confirm(T('Aus der Liste entfernen: ') + fontLabel() + '?')) return;
        if (v.indexOf('u:') === 0) { const a = presets(), i = a.findIndex(x => 'u:' + x.id === v); if (i >= 0) a.splice(i, 1); if (App.saveSettings) try { App.saveSettings(); } catch (e) {} }
        else libRemove(v.slice(2));
        selectFont('grotesk'); upd(true);
      });
      g1.body.appendChild(bar); }
    if (st.missingSrc) App.warn ? App.warn(g1.body, T('Schriftdatei fehlt: ') + st.missingSrc + ' — ' + T('bitte erneut laden.')) : hint(g1.body, 'Schriftdatei fehlt.');
    hint(g1.body, st.skel
      ? 'Linienschrift: jede Schriftart besteht aus Mittellinien — Höhe, Strichstärke, Breite, Enden, Ecken, Rundungen und Serifen sind frei einstellbar. Eigene Einstellungen lassen sich als Schriftart speichern.'
      : 'Schriftdatei: Umrisse der Schrift. Die Stärke lässt sich über „Stärke-Korrektur" fetter oder dünner machen. Die verwendeten Zeichen werden im Projekt mitgespeichert.');
    side.appendChild(g1.g);

    // --- Größe & Form ------------------------------------------------------
    const g2 = grp('Schriften: Größe & Form', true, TAB, { key: 'sc_form' });
    nr(g2.body, 'Schrifthöhe (Versalhöhe, mm)', 'scHeight', { step: 1, min: 2, hint: 'Höhe der Großbuchstaben (H, E …). Kleinbuchstaben mit Ober-/Unterlänge ragen entsprechend darüber bzw. darunter.' });
    if (st.skel) {
      nr(g2.body, 'Strichstärke (mm)', 'scWeight', { step: 0.5, min: 0.2, hint: T('Breite der Striche = Materialstärke der Buchstaben.') + ' ' + T('Aktuell') + ' ' + (num('scWeight', 12) / Math.max(1, num('scHeight', 100)) * 100).toFixed(0) + ' % ' + T('der Schrifthöhe.') });
    } else {
      nr(g2.body, 'Stärke-Korrektur (mm)', 'scBold', { step: 0.2, hint: 'Umriss nach außen (+, fetter) bzw. nach innen (−, dünner) versetzen. 0 = Original.' });
    }
    nr(g2.body, 'Breite (%)', 'scWidth', { step: 1, min: 30, max: 300, hint: '100 = normal, kleiner = schmal, größer = breit.' });
    nr(g2.body, 'Neigung (°)', 'scSlant', { step: 1, min: -40, max: 40, hint: 'Kursiv: positive Werte neigen nach rechts.' });
    if (st.skel) {
      nr(g2.body, 'x-Höhe (% der Versalhöhe)', 'scXh', { step: 1, min: 40, max: 95, hint: 'Höhe der Kleinbuchstaben ohne Oberlänge (a, e, n …).' });
      nr(g2.body, 'Eckigkeit der Bögen (%)', 'scSquare', { step: 5, min: 0, max: 100, hint: '0 = kreisrunde Bögen (O, C, S …), 100 = fast rechteckig (Block-/Technik-Stil).' });
      sel(g2.body, 'Strichenden', 'scCaps', [['flat', 'gerade (flach)'], ['round', 'abgerundet']]);
      sel(g2.body, 'Ecken', 'scJoin', [['miter', 'spitz'], ['round', 'abgerundet']]);
      boolRow(g2.body, 'Serifen (Slab)', () => !!C('scSerif'), v => { S('scSerif', v); upd(true); }, 'Balken-Serifen an den senkrechten Strichenden auf Grundlinie, x-Höhe und Versalhöhe.');
      if (C('scSerif')) {
        nr(g2.body, 'Serifenlänge je Seite (mm)', 'scSerifLen', { step: 0.5, min: 0 });
        nr(g2.body, 'Serifendicke (mm)', 'scSerifThk', { step: 0.5, min: 0.2 });
      }
    }
    side.appendChild(g2.g);

    // --- Abstände ------------------------------------------------------------
    const g3 = grp('Schriften: Abstände & Zeilen', false, TAB, { key: 'sc_space' });
    if (C('scConn') !== 'overlap') {
      sel(g3.body, 'Buchstabenabstand nach', 'scSpaceMode', [['metric', 'Zeichenbreite (wie Schrift)'], ['optical', 'Kontur (gleicher Mindestabstand)']],
        'Kontur: jeder Buchstabe rückt so nah an den vorigen, bis der kleinste waagerechte Abstand dem Wert „Konturabstand" entspricht — gleichmäßige Lücken, wichtig für den Schnitt (Abbrand).', true);
      if (C('scSpaceMode') === 'optical') nr(g3.body, 'Konturabstand (mm)', 'scGap', { step: 0.5 });
      else nr(g3.body, 'Zeichenabstand zusätzlich (mm)', 'scTrack', { step: 0.5, hint: 'Positiv = weiter, negativ = enger.' });
    }
    nr(g3.body, 'Wortabstand (%)', 'scWord', { step: 5, min: 0 });
    nr(g3.body, 'Zeilenabstand (% der Schrifthöhe)', 'scLine', { step: 5, min: 50 });
    sel(g3.body, 'Ausrichtung', 'scAlign', [['left', 'links'], ['center', 'mittig'], ['right', 'rechts']]);
    side.appendChild(g3.g);

    // --- Verbindung ----------------------------------------------------------
    const g4 = grp('Schriften: Verbindung der Buchstaben', true, TAB, { key: 'sc_conn' });
    sel(g4.body, 'Verbindung', 'scConn', [['none', 'keine (einzeln schneiden)'], ['overlap', 'Buchstaben überlappen'], ['bar', 'Grundleiste (Sockel)'], ['bridge', 'Stege zwischen den Buchstaben']],
      'Verbundene Buchstaben ergeben ein Stück (ein Wort/eine Zeile) — stabil, leicht aufzustellen, in einem Zug geschnitten.', true);
    const cm = C('scConn');
    if (cm === 'overlap') nr(g4.body, 'Überlappung (mm)', 'scOverlap', { step: 0.5, min: 0, hint: 'Um so viel greifen benachbarte Buchstaben an ihrer engsten Stelle ineinander.' });
    if (cm === 'bar') {
      nr(g4.body, 'Leistenhöhe (mm)', 'scBarH', { step: 0.5, min: 0.5 });
      nr(g4.body, 'Absenkung unter Grundlinie (mm)', 'scBarDrop', { step: 0.5, hint: '0 = Leiste liegt bündig in den Buchstabenfüßen, = Leistenhöhe → Buchstaben stehen auf der Leiste.' });
      nr(g4.body, 'Überstand links/rechts (mm)', 'scBarOver', { step: 1 });
      nr(g4.body, 'Eckenradius (mm)', 'scBarR', { step: 0.5, min: 0 });
    }
    if (cm === 'bridge') {
      nr(g4.body, 'Steghöhe über Grundlinie (mm)', 'scBridgeY', { step: 0.5, hint: 'Mitte des Stegs. Muss alle Buchstaben treffen (Hinweis erscheint sonst).' });
      nr(g4.body, 'Stegdicke (mm)', 'scBridgeT', { step: 0.5, min: 0.5 });
    }
    boolRow(g4.body, 'Punkte anbinden (i, j, ä, ö, ü …)', () => !!C('scDotLink'), v => { S('scDotLink', v); upd(true); },
      'Kleine Teile (i-Punkte, Umlaut-Punkte, Satzzeichen) mit einem Steg an den nächsten Buchstaben hängen, damit nichts einzeln herausfällt.');
    if (C('scDotLink')) nr(g4.body, 'Stegbreite Punkte (mm)', 'scDotLinkW', { step: 0.5, min: 0.5 });
    side.appendChild(g4.g);

    // --- Innenformen ---------------------------------------------------------
    const g5 = grp('Schriften: Innenformen (O, A, B, e …)', false, TAB, { key: 'sc_holes' });
    sel(g5.body, 'Innenformen', 'scHoles', [['slit', 'Einschnitt (Buchstabe bleibt ganz)'], ['gap', 'Lücke (Schablonen-Stil)'], ['fill', 'füllen (nicht schneiden)']],
      'Der Draht kann nicht springen: Einschnitt = feiner Schlitz (Abbrandbreite) an der dünnsten Stelle hinein und wieder heraus; Lücke = offener Spalt, Innenform wird Teil der Außenkontur; füllen = Innenform bleibt Schaum.', true);
    if (C('scHoles') !== 'fill') sel(g5.body, 'Lage von Einschnitt/Lücke', 'scHoleDir', [['auto', 'dünnste Stelle'], ['down', 'unten'], ['up', 'oben'], ['left', 'links'], ['right', 'rechts']]);
    if (C('scHoles') === 'gap') nr(g5.body, 'Lückenbreite (mm)', 'scHoleGap', { step: 0.5, min: 0.3, hint: 'Muss größer als der Abbrand sein.' });
    side.appendChild(g5.g);

    // --- Block & Schnitt -----------------------------------------------------
    const g6 = grp('Schriften: Block & Schnitt', false, TAB, { key: 'sc_block' });
    if (App.matOptions) {
      // Gleiche Zuordnung (und Bedeutung) wie in der Projektübersicht → „Werkstoff DXF-Formen / 3D-Modell / Schriften".
      const mo = [['', '— kein Werkstoff —']].concat(App.matOptions());
      selectRow(g6.body, 'Werkstoff', mo, () => (C('scMatId') != null ? C('scMatId') : (state.material.id || '')), v => { S('scMatId', v); upd(true); },
        'Werkstoff der Schriften (Abbrand, Heizung, Vorschub automatisch) — dieselbe Zuordnung wie in der Projektübersicht.');
    }
    sel(g6.body, 'Abbrand', 'scKerfMode', [['mat', 'aus Werkstoff-Kalibrierung'], ['manual', 'manuell'], ['off', 'aus (0)']], null, true);
    if (C('scKerfMode') === 'manual') nr(g6.body, 'Abbrand (Schnittspalt, mm)', 'scKerf', { step: 0.05, min: 0 });
    else hint(g6.body, T('Abbrand aktuell: ') + kerf().toFixed(2) + ' mm');
    hint(g6.body, 'Blocklage (Abstand X/Y vom Nullpunkt, Lage zwischen den Portalen), Vorschub und Schnittfolge (Oberseite/Unterseite zuerst) stellt der Reiter „G-Code" ein.');
    nr(g6.body, 'Blockdicke = Buchstabentiefe (mm)', 'scDepth', { step: 5, min: 1, hint: 'Ausdehnung entlang des Drahts (Materialstärke der fertigen Buchstaben).' });
    nr(g6.body, 'Rand links/rechts (mm)', 'scMarginX', { step: 1, min: 0 });
    nr(g6.body, 'Rand unten/oben (mm)', 'scMarginY', { step: 1, min: 0 });
    nr(g6.body, 'Blockbreite fest (mm, 0 = auto)', 'scBlockW', { step: 5, min: 0 });
    nr(g6.body, 'Blockhöhe fest (mm, 0 = auto)', 'scBlockH', { step: 5, min: 0 });
    nr(g6.body, 'Fahrspur unter der Schrift (mm)', 'scLane', { step: 0.5, min: 0.5, hint: 'Abstand der waagerechten Fahrspur unter den Buchstaben (nur Abfall), über die der Draht zwischen den Teilen wechselt, wenn der direkte Weg nicht frei ist.' });
    { const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
      if (document.getElementById('gcodeView')) { const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('⚙ G-Code'); b.title = T('Zum Reiter „G-Code" wechseln, Quelle „Schriften"'); b.onclick = () => { const t = document.getElementById('scToGcode'); if (t) t.click(); }; bar.appendChild(b); }
      const d = document.createElement('button'); d.textContent = T('DXF exportieren…'); d.title = T('Buchstaben-Konturen, Schnittbahn und Block als DXF'); d.onclick = exportDxf; bar.appendChild(DEMO.btn(d));
      if (App.cadImportDxfText) { const c = document.createElement('button'); c.textContent = T('In CAD übernehmen'); c.title = T('Buchstaben-Konturen in den Reiter „CAD-Bearbeitung" laden (ersetzt dessen Inhalt nach Rückfrage)'); c.onclick = toCad; bar.appendChild(c); }
      g6.body.appendChild(bar); }
    side.appendChild(g6.g);
  }

  // Neues Projekt / Projekt laden: alle Projektwerte des Reiters auf Anfang
  // (eigene Schriftarten = Einstellungen bleiben). Danach füllt C() die Vorgaben.
  function reset() {
    Object.keys(DEF).forEach(k => { if (MACHINE.indexOf(k) < 0) delete state.cfg[k]; });
    lastKey = ''; lastRes = null; view = null;
    setTimeout(() => { if (state.activeTab === 'schrift') show(); }, 0);
  }

  Object.assign(App, { schriftSidebar, buildSchriftScene: () => buildScene() });
  window.Schrift = {
    show, resize, refresh, build, draw, machineMoves, buildScene, previewMoves, exportDxf, reset,
    hasText: () => !!String(C('scText') || '').trim(),
    label: () => T('Schriften') + ' · „' + String(C('scText') || '').split('\n')[0].slice(0, 24) + '"',
    fileBase,
    _test: { styleOf, layout, contours, pieces, glyphFor, fontByKey, libKeys, selectFont, loadFontBuffer, kerf, feed, C, S }
  };
})();
