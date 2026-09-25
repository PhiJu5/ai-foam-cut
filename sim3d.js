/* sim3d.js — 3D-Simulation des Heißdrahtschnitts (Tab „G-Code").
 *
 * Zeigt beide Türme, den gespannten Heißdraht und den Styroporblock in der
 * Mitte und fährt den erzeugten G-Code ab. Simuliert wird der TATSÄCHLICHE
 * Programmtext (inkl. Vorschüben), nicht die Geometrie — was hier läuft, geht
 * so auch an die Maschine.
 *
 * Maschinenkoordinaten:  X = horizontal (Sehne), Y = vertikal (oben),
 *                        Z = Spannweite, 0 = linker Turm, W = rechter Turm.
 * Eigener Mini-Renderer: Orbit-Kamera + Perspektive auf 2D-Canvas.
 */
(function () {
  'use strict';

  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  const RAPID_FEED = 3000;          // Annahme für G0 (mm/min)

  // ---------- Kamera / Projektion ---------------------------------------
  // yaw > 0: Blick so, dass +Z (rechter Turm) auch rechts im Bild liegt,
  // −Z (linker Turm) links — Draufsicht-Konvention „in Flugrichtung".
  // Aktive Kamera (wird vor jedem Viewport auf mainCam bzw. monCam gesetzt).
  let cam = { yaw: 0.85, pitch: 0.30, zoom: 1.3, px: 0, py: 0 };
  const mainCam = cam;                    // G-Code-Tab (freie Wiedergabe)
  const CAM0 = Object.assign({}, cam);
  // Draufsicht: senkrecht von oben (pitch = 90°). yaw = -90° bildet die Sehne (X)
  // auf die Bild-Senkrechte ab, kleines X (Profilnase / LE) landet oben, die
  // Spannweite (Z) liegt waagerecht — obere Bildkante = Flugrichtung.
  // (Azimut um 180° gedreht: yaw = +90° statt -90° -> Draufsicht andersherum.)
  const CAM_TOP = { yaw: Math.PI / 2, pitch: Math.PI / 2, zoom: 1.3, px: 0, py: 0 };
  // Seitenansicht: Blick längs der Spannweite (Z) auf die XY-Ebene — das
  // Profil (Sehne X waagerecht, Höhe Y senkrecht) erscheint unverzerrt.
  const CAM_SIDE = { yaw: 0, pitch: 0, zoom: 1.3, px: 0, py: 0 };
  // Vorderansicht: Blick längs der Sehne (X). Spannweite (Z) waagerecht,
  // Höhe (Y) senkrecht — die Stirnfläche der Türme frontal.
  const CAM_FRONT = { yaw: Math.PI / 2, pitch: 0, zoom: 1.3, px: 0, py: 0 };

  const ZOOM_MIN = 0.05, ZOOM_MAX = 400;
  // Ansicht zurücksetzen (Standard-Schrägansicht, Zoom/Verschiebung neutral).
  function resetCam(camObj) { Object.assign(camObj, CAM0); }

  let canvas = null, ctx = null, W = 0, H = 0;
  let center = { x: 0, y: 0, z: 0 }, radius = 400;   // Szenen-Bounding-Sphere
  // Zweiter Viewport im Reiter „Schneiden": eigenständiger Datensatz (das im
  // Reiter gewählte Programm) — folgt der Ausführung ODER läuft als Vorschau-
  // Simulation vor dem Schnitt. Unabhängig vom G-Code-Tab (S).
  let monCanvas = null, monCam = null, monMounted = false;
  let monEndCb = () => {};
  let monPauseCb = () => {};
  const MON = {
    moves: [], cum: [], total: 0, scene: null, bx: null, floor: 0,
    center: { x: 0, y: 0, z: 0 }, radius: 400, ready: false,
    t: 0, playing: false, pos: null   // pos {i,u} = zuletzt ausgeführte Bewegung
  };

  /* Welt -> Kamera: erst um die Hochachse (yaw), dann kippen (pitch).
     Rückgabe {x,y,d} mit d = Tiefe vor der Kamera. */
  function toCam(p) {
    const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const x1 = dx * cy + dz * sy, z1 = -dx * sy + dz * cy;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const y2 = dy * cp - z1 * sp, z2 = dy * sp + z1 * cp;
    return { x: x1, y: y2, d: z2 + radius * 2.8 };
  }
  /* Orthografisch (Parallelprojektion): kein Fluchtpunkt, parallele Kanten
     bleiben parallel. Türme, Block und Draht sind dadurch maßstäblich
     vergleichbar — Strecken gleicher Länge sind im Bild gleich lang,
     unabhängig von der Tiefe. `d` dient nur noch der Tiefensortierung. */
  function scr(p) {
    const c = toCam(p);
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    return { x: W / 2 + cam.px + s * c.x, y: H / 2 + cam.py - s * c.y, d: c.d };
  }
  // Strecke an der Kamera-Ebene abschneiden (sonst „springen" Linien hinter der Kamera)
  const NEAR = 1;
  function line3(a, b) {
    let A = scr(a), B = scr(b);
    if (A.d < NEAR && B.d < NEAR) return null;
    if (A.d < NEAR || B.d < NEAR) {
      const t = (NEAR - A.d) / (B.d - A.d);
      const M = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      if (A.d < NEAR) A = scr(M); else B = scr(M);
    }
    return [A, B];
  }
  function seg(a, b) { const s = line3(a, b); if (!s) return; ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); }
  function strokeSeg(a, b, col, wd, dash) {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = wd || 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); seg(a, b); ctx.stroke(); ctx.restore();
  }

  // ---------- G-Code lesen ----------------------------------------------
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function parseGcode(text, ax, defaultSeg) {
    const rex = l => new RegExp(esc(l) + '(-?\\d*\\.?\\d+)', 'i');
    const rX = rex(ax.x), rY = rex(ax.y), rU = rex(ax.u), rV = rex(ax.v), rF = rex('F');
    const moves = [];
    const cur = { lx: 0, ly: 0, rx: 0, ry: 0 };
    let mode = 0, feed = 200, segIdx = defaultSeg || 0, started = false;
    // G93 (Inverse Time): F ist dann NICHT mm/min, sondern der Kehrwert der
    // Blockdauer (T = 1/F). Die tatsaechliche Portalgeschwindigkeit ergibt sich
    // erst aus der Streckenlaenge: v = dMax / T = dMax * F.
    let invTime = false;

    text.split(/\r?\n/).forEach((raw, idx) => {
      const cm = raw.match(/SEGMENT\s+(\d+)/i);
      if (cm && raw.trim().charAt(0) === ';') segIdx = parseInt(cm[1], 10) - 1;
      const line = raw.split(';')[0].trim();
      if (!line) return;
      if (/\bG93\b/.test(line)) invTime = true;
      if (/\bG94\b/.test(line)) invTime = false;
      // Aufheizphase (G4 P<s>): stehende Pause — Draht bleibt auf der Stelle,
      // damit die Simulation die Aufheizzeit sichtbar mit abfährt.
      const gd = line.match(/\bG4\b/i);
      if (gd) {
        const pm = line.match(/P(-?\d*\.?\d+)/i);
        const sec = pm ? parseFloat(pm[1]) : 0;
        if (started && sec > 0) {
          const here = { lx: cur.lx, ly: cur.ly, rx: cur.rx, ry: cur.ry };
          moves.push({ from: here, to: here, rapid: false, dwell: true, seg: segIdx, line: idx, dur: sec });
        }
        return;
      }
      // Programmpause M0: die zuletzt abgeschlossene Bewegung als „danach pausieren"
      // markieren, damit die Simulation dort automatisch anhält (wie die Maschine).
      if (/\bM0\b/i.test(line)) { if (moves.length) moves[moves.length - 1].pauseAfter = true; return; }
      const g = line.match(/\bG([0-3])\b/i);
      if (g) mode = parseInt(g[1], 10);
      if (mode > 1) return;                       // G2/G3 kommen hier nicht vor
      const mx = rX.exec(line), my = rY.exec(line), mu = rU.exec(line), mv = rV.exec(line);
      if (!mx && !my && !mu && !mv) return;
      const mf = rF.exec(line); if (mf) feed = parseFloat(mf[1]) || feed;
      const from = { lx: cur.lx, ly: cur.ly, rx: cur.rx, ry: cur.ry };
      if (mx) cur.lx = parseFloat(mx[1]);
      if (my) cur.ly = parseFloat(my[1]);
      if (mu) cur.rx = parseFloat(mu[1]);
      if (mv) cur.ry = parseFloat(mv[1]);
      const to = { lx: cur.lx, ly: cur.ly, rx: cur.rx, ry: cur.ry };
      if (!started) { started = true; return; }   // erste Position = Startpunkt
      const dL = Math.hypot(to.lx - from.lx, to.ly - from.ly);
      const dR = Math.hypot(to.rx - from.rx, to.ry - from.ry);
      const dMax = Math.max(dL, dR);
      // Wirksame Geschwindigkeit des schnelleren (aeusseren) Portals in mm/min —
      // in G94 direkt F, in G93 aus der vorgegebenen Blockdauer zurueckgerechnet.
      const F = mode === 0 ? RAPID_FEED : (invTime ? dMax * feed : feed);
      moves.push({
        from, to, rapid: mode === 0, seg: segIdx, line: idx,
        feed: mode === 0 ? 0 : F,                  // wirksamer Vorschub (0 = Eilgang)
        dur: dMax / (F || 1) * 60                  // Sekunden
      });
    });
    return moves;
  }

  // ---------- Zustand ----------------------------------------------------
  const S = {
    moves: [], cum: [], total: 0, scene: null,
    t: 0, playing: false, speed: 25, idx: 0,
    show: { towers: true, paths: true, surface: true, profile: false, block: true, dim: true },
    // Farben aus den App-Einstellungen (via setColors überschreibbar). Gelten für
    // beide Simulationen (G-Code-Reiter und Reiter „Schneiden").
    colors: { towerL: '#4aa3ff', towerR: '#ffb454', wire: '#ff5a3c', origin: '#ff3b3b', profile: '#57d38c' },
    raf: null, last: 0, ready: false, loaded: false
  };
  // Farben setzen und (falls schon aktiv) neu zeichnen — von der App aufgerufen,
  // wenn im Einstellungen-Dialog Turm-/Draht-/Nullpunktfarbe geändert wird.
  function setColors(c) {
    if (!c) return;
    ['towerL', 'towerR', 'wire', 'origin', 'profile'].forEach(k => { if (c[k]) S.colors[k] = c[k]; });
    try { if (S.ready) redrawAll(); } catch (e) {}
  }
  // Legendenzeilen (HTML-Overlay) nur zeigen, wenn das Element auch gezeichnet
  // wird: data-show="a|b" = sichtbar, wenn einer der Schalter an ist.
  function syncLegend() {
    try {
      document.querySelectorAll('#simLegend [data-show]').forEach(el => {
        el.style.display = el.dataset.show.split('|').some(k => S.show[k]) ? '' : 'none';
      });
    } catch (e) {}
  }
  // Beide Viewports (Haupt + Monitor) neu zeichnen. Die Animationsschleife
  // aktualisiert ohnehin laufend; dieser Aufruf sorgt für sofortige Wirkung,
  // wenn gerade nicht abgespielt wird.
  function redrawAll() {
    try { if (document.getElementById('gcodeView')) draw(); } catch (e) {}
    try { if (monMounted) drawMonitor(); } catch (e) {}
  }

  function buildTimeline() {
    S.cum = []; let t = 0; S.pauseTimes = [];
    for (const m of S.moves) { t += m.dur; S.cum.push(t); if (m.pauseAfter) S.pauseTimes.push(t); }
    S.total = t;
  }
  function moveAt(t) {                          // -> {i, u} Index + Anteil im Move
    if (!S.moves.length) return { i: 0, u: 0 };
    let lo = 0, hi = S.cum.length - 1;
    while (lo < hi) { const md = (lo + hi) >> 1; if (S.cum[md] < t) lo = md + 1; else hi = md; }
    const t0 = lo ? S.cum[lo - 1] : 0;
    const d = S.moves[lo].dur || 1e-9;
    return { i: lo, u: Math.max(0, Math.min(1, (t - t0) / d)) };
  }
  function lerpMove(m, u) {
    return {
      lx: m.from.lx + (m.to.lx - m.from.lx) * u, ly: m.from.ly + (m.to.ly - m.from.ly) * u,
      rx: m.from.rx + (m.to.rx - m.from.rx) * u, ry: m.from.ry + (m.to.ry - m.from.ry) * u
    };
  }

  // Punkt auf dem Draht: t = 0 linker Turm, 1 rechter Turm
  function wirePt(p, tz) {
    const mw = S.scene.machineWidth;
    return { x: p.lx + (p.rx - p.lx) * tz, y: p.ly + (p.ry - p.ly) * tz, z: tz * mw };
  }

  // ---------- Szene rahmen ----------------------------------------------
  /* Bounding-Box + Kamera-Zentrum/Radius für ein beliebiges Move-/Szenenpaar. */
  function computeFrame(moves, scene) {
    const mw = scene ? scene.machineWidth : 900;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const m of moves) { add(m.to.lx, m.to.ly); add(m.to.rx, m.to.ry); }
    (scene ? scene.blocks : []).forEach(b => {
      add(b.x0, b.y0); add(b.x1, b.y1);
      if (b.x0t != null) { add(b.x0t, b.y0t); add(b.x1t, b.y1t); }
    });
    if (x0 > x1) { x0 = -50; x1 = 250; y0 = -50; y1 = 100; }
    const bx = { x0: x0 - 40, x1: x1 + 40, y0: y0 - 40, y1: y1 + 40 };
    return {
      bx, floor: bx.y0,
      center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: mw / 2 },
      radius: Math.max(mw, x1 - x0, y1 - y0) * 0.62
    };
  }
  function frameScene() {
    const fr = computeFrame(S.moves, S.scene);
    S.bx = fr.bx; S.floor = fr.floor; center = fr.center; radius = fr.radius;
  }

  /* Zeichenfunktionen lesen aus S (moves/scene/bx/floor) und den Modulglobalen
     center/radius. Für den Monitor-Viewport wird dieser Kontext kurzzeitig auf
     den MON-Datensatz umgeschaltet und danach wiederhergestellt (synchron,
     daher kollisionsfrei). */
  function withDataset(ds, fn) {
    const sv = { moves: S.moves, cum: S.cum, total: S.total, scene: S.scene,
                 bx: S.bx, floor: S.floor, ready: S.ready, warn: S.warn, center, radius };
    S.moves = ds.moves; S.cum = ds.cum; S.total = ds.total; S.scene = ds.scene;
    S.bx = ds.bx; S.floor = ds.floor; S.ready = ds.ready; S.warn = ds.warn;
    center = ds.center; radius = ds.radius;
    try { fn(); }
    finally {
      S.moves = sv.moves; S.cum = sv.cum; S.total = sv.total; S.scene = sv.scene;
      S.bx = sv.bx; S.floor = sv.floor; S.ready = sv.ready; S.warn = sv.warn;
      center = sv.center; radius = sv.radius;
    }
  }

  /* Fahrweg-Prüfung für die Simulation: negative Koordinaten sind immer
     unzulässig (Portal unter Maschinennullpunkt), Obergrenze nur bei Limit>0.
     Rückgabe: Warntext oder null. */
  function computeWarn(moves, scene) {
    if (!scene || !moves || !moves.length) return null;
    const lim = scene.limits || {}, ax = scene.ax;
    const wNeg = lim.warnNeg !== false, wTr = lim.warnTravel !== false, wF = lim.warnFeed !== false;
    const H = wTr ? (+lim.h || 0) : 0, V = wTr ? (+lim.v || 0) : 0, Fmax = wF ? (+lim.f || 0) : 0;
    const chans = [['lx', ax.x, H], ['rx', ax.u, H], ['ly', ax.y, V], ['ry', ax.v, V]];
    let neg = null, over = null;
    const consider = pt => {
      for (const [k, name, limit] of chans) {
        const val = pt[k];
        if (wNeg && val < -0.001 && (!neg || val < neg.val)) neg = { name, val };
        if (limit > 0 && val > limit + 0.001 && (!over || (val - limit) > (over.val - over.limit))) over = { name, val, limit };
      }
    };
    for (const m of moves) consider(m.to);
    consider(moves[0].from);
    const advice = v => (window.App && App.limitAdvice) ? App.limitAdvice(v) : [];
    if (neg) return { msg: `${T('Portal fährt ins Negative: ')}${neg.name} = ${neg.val.toFixed(1)}${T(' mm (< 0, Maschinennullpunkt)')}`,
                      tips: advice({ kind: 'neg', axis: neg.name, val: neg.val, limit: 0 }) };
    if (over) return { msg: `${T('Fahrweg überschritten: ')}${over.name} = ${over.val.toFixed(1)}${T(' mm (max ')}${over.limit} mm)`,
                       tips: advice({ kind: 'max', axis: over.name, val: over.val, limit: over.limit }) };
    if (Fmax > 0) {
      let fMax = 0;
      for (const m of moves) if (!m.rapid && m.feed > fMax) fMax = m.feed;
      if (fMax > Fmax + 0.001) return { msg: `${T('Vorschub überschritten: F = ')}${fMax.toFixed(0)}${T(' mm/min (max ')}${Fmax} mm/min)`,
                                        tips: advice({ kind: 'feed', axis: 'F', val: fMax, limit: Fmax }) };
    }
    return null;
  }

  /* Rote Warnleiste oben im Viewport: Meldung + Lösungsvorschläge darunter. */
  function drawWarn(w) {
    const msg = typeof w === 'string' ? w : w.msg, tips = (typeof w === 'string' ? [] : (w.tips || []));
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    // links verankert; rechts bleibt Platz für die Legende (HTML-Overlay über dem Canvas)
    let legW = 180;
    try {
      const lg = canvas.parentElement && canvas.parentElement.querySelector('.simlegend');
      if (lg && lg.offsetParent) legW = lg.getBoundingClientRect().width + 10;
    } catch (e) { /* ohne Legende: Standardbreite */ }
    const avail = Math.max(220, W - 16 - legW), maxW = avail - 24;
    const wrap = (text, font, indent) => {
      ctx.font = font; const out = []; let cur = '';
      for (const wd of text.split(' ')) {
        const test = cur ? cur + ' ' + wd : wd;
        if (ctx.measureText(test).width > maxW && cur) { out.push(cur); cur = indent + wd; } else cur = test;
      }
      if (cur) out.push(cur);
      return out;
    };
    const FH = 'bold 12px Segoe UI', FT = '11px Segoe UI';
    const headLines = wrap('⚠ ' + msg, FH, '   ');
    const tipLines = [].concat(...tips.map(t => wrap('→ ' + t, FT, '   ')));
    let tw = 0;
    ctx.font = FH; for (const ln of headLines) tw = Math.max(tw, ctx.measureText(ln).width);
    ctx.font = FT; for (const ln of tipLines) tw = Math.max(tw, ctx.measureText(ln).width);
    const lhH = 16, lh = 15, bw = Math.min(avail, tw + 24), bx = 8, by = 8;
    const bh = 10 + headLines.length * lhH + (tipLines.length ? tipLines.length * lh + 4 : 0);
    ctx.fillStyle = 'rgba(150,24,24,.94)'; ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx, by, bw, bh);
    let y = by + 5;
    ctx.fillStyle = '#ffe2e2'; ctx.font = FH;
    for (const ln of headLines) { ctx.fillText(ln, bx + 12, y + lhH / 2); y += lhH; }
    y += 4;
    ctx.fillStyle = '#ffd0d0'; ctx.font = FT;
    for (const ln of tipLines) { ctx.fillText(ln, bx + 12, y + lh / 2); y += lh; }
    ctx.restore();
  }

  // ---------- Zeichnen ---------------------------------------------------
  function fit(cv) {
    if (cv) canvas = cv;
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawFloor() {
    const mw = S.scene.machineWidth, y = S.floor;
    const step = 50 * Math.max(1, Math.round(mw / 900));
    ctx.save(); ctx.strokeStyle = 'rgba(90,110,135,.20)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(S.bx.x0 / step) * step; x <= S.bx.x1; x += step)
      seg({ x, y, z: 0 }, { x, y, z: mw });
    for (let z = 0; z <= mw + 0.5; z += step)
      seg({ x: S.bx.x0, y, z }, { x: S.bx.x1, y, z });
    ctx.stroke(); ctx.restore();
  }

  /* Maschinennullpunkt (X=0, Y=0): rote Nulllinie längs der Spannweite (Z) auf
     Höhe der Blockunterkante, hinten am Block. Zusätzlich je Turmebene ein rotes
     Fadenkreuz + „0". */
  function drawOrigin() {
    const ORIGIN_COL = S.colors.origin;
    const mw = S.scene.machineWidth;
    ctx.save();
    // durchgehende rote Nulllinie zwischen beiden Turmebenen
    strokeSeg({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: mw }, ORIGIN_COL, 2);
    [0, mw].forEach(z => {
      const O = { x: 0, y: 0, z };
      const s = scr(O);
      if (s.d <= NEAR) return;
      ctx.strokeStyle = ORIGIN_COL; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(s.x - 9, s.y); ctx.lineTo(s.x + 9, s.y);
      ctx.moveTo(s.x, s.y - 9); ctx.lineTo(s.x, s.y + 9); ctx.stroke();
      ctx.fillStyle = ORIGIN_COL; ctx.beginPath(); ctx.arc(s.x, s.y, 2.6, 0, 6.3); ctx.fill();
      ctx.font = '11px Segoe UI'; ctx.textAlign = 'left';
      ctx.fillText(T('Null'), s.x + 11, s.y - 6);
      ctx.restore(); ctx.save();
    });
    ctx.restore();
  }

  /* 3D-Bemaßung: eine Maßlinie zwischen zwei Weltpunkten mit Pfeilen + Label.
     `nx,ny` = Bild-Versatzrichtung (Einheitsvektor) für die Maßlinie. */
  function dim3(a, b, label, opt) {
    opt = opt || {};
    const col = opt.color || '#c9d4e0', off = opt.off == null ? 22 : opt.off;
    const A = scr(a), B = scr(b);
    if (A.d < NEAR || B.d < NEAR) return;
    let nx = opt.nx, ny = opt.ny;
    if (nx == null) { const dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy) || 1; nx = -dy / l; ny = dx / l; }
    const A2 = { x: A.x + nx * off, y: A.y + ny * off }, B2 = { x: B.x + nx * off, y: B.y + ny * off };
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y); ctx.lineTo(A2.x, A2.y);
    ctx.moveTo(B.x, B.y); ctx.lineTo(B2.x, B2.y);
    ctx.moveTo(A2.x, A2.y); ctx.lineTo(B2.x, B2.y); ctx.stroke();
    const arr = (from, to) => {
      const dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, s = 6;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - ux * s - uy * s * .5, to.y - uy * s + ux * s * .5);
      ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - ux * s + uy * s * .5, to.y - uy * s - ux * s * .5);
      ctx.stroke();
    };
    arr(B2, A2); arr(A2, B2);
    const mx = (A2.x + B2.x) / 2, my = (A2.y + B2.y) / 2;
    ctx.font = '10px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(15,18,22,.85)'; ctx.fillRect(mx - tw / 2 - 3, my - 7, tw + 6, 13);
    ctx.fillStyle = col; ctx.fillText(label, mx, my);
    ctx.restore();
  }

  /* Abstand Bezugsportal → Block in Spannweitenrichtung, je für den hinteren
     (Endleistenseite) und den vorderen (Nasenseite) Blockpunkt an der Wurzelebene.
     Bezugsportal = Portal auf der Wurzelseite: links (z=0), wenn der Block zur
     Randebene nach +z läuft, sonst rechts (z=machineWidth). Bei Werkstück-Drehung
     liegen die beiden Ecken unterschiedlich weit vom Portal entfernt. */
  function drawPortalDims(b, rear, front) {
    if (b.z0 == null || b.z1 == null) return;
    const mm = v => Math.round(v) + ' mm';
    const left = b.z1 >= b.z0, zRef = left ? 0 : S.scene.machineWidth;
    const name = T(left ? 'Portal links' : 'Portal rechts');
    [[rear, '→Block hinten '], [front, '→Block vorne ']].forEach(([p, lab]) => {
      const d = Math.abs(p.z - zRef);
      if (d > 0.5) dim3({ x: p.x, y: p.y, z: zRef }, p, name + T(lab) + mm(d), { color: '#38d6e8', off: 26, nx: 0, ny: 1 });
    });
  }

  /* Bemaßung des aktiven Blocks: Länge (X/Sehne), Höhe (Y), Spannweite (Z),
     der Abstand des Blocks vom Maschinennullpunkt (X=0) und vom Bezugsportal. */
  function drawDims(b) {
    const mm = v => Math.round(v) + ' mm';
    // Gedrehter Block (Pfeilung): Maße an den gedrehten Ecken. Die roten
    // Nullpunkt-Abstände entfallen (bei gedrehtem Block nicht eindeutig).
    if (b.rot && b.rot.corners && b.rot.corners.length === 8) {
      const c = b.rot.corners, len = (a, d) => Math.hypot(d.x - a.x, d.z - a.z);
      dim3(c[0], c[1], 'Block-L ' + mm(len(c[0], c[1])), { color: '#8fa0b4', off: 26, nx: 0, ny: 1 });
      dim3(c[1], c[3], 'H ' + mm(Math.abs(c[3].y - c[1].y)), { color: '#8fa0b4', off: 22 });
      dim3(c[0], c[4], 'Spannw. ' + mm(len(c[0], c[4])), { color: '#57d38c', off: 26, nx: 0, ny: 1 });
      dim3(c[0], c[6], (T('Drehung') + ' ' + (Math.round(b.rot.angleDeg * 10) / 10) + '°'), { color: '#ffb454', off: 46, nx: 0, ny: 1 });
      // Ecke 0 = hinten/Wurzel/unten, Ecke 1 = vorne/Wurzel/unten (Reihenfolge wie drawBlock).
      drawPortalDims(b, c[0], c[1]);
      return;
    }
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1);
    const yb = Math.min(b.y0, b.y1), yt = Math.max(b.y0, b.y1);
    // Rückkante = kleines X, Nase = großes X (Nullpunkt hinter dem Block). Bei der
    // Schnittrichtung „von vorne" (b.noseNear) umgekehrt: Nase am Nullpunkt.
    const nn = !!b.noseNear;
    if (nn) drawPortalDims(b, { x: x1, y: yb, z: b.z0 }, { x: x0, y: yb, z: b.z0 });
    else drawPortalDims(b, { x: x0, y: yb, z: b.z0 }, { x: x1, y: yb, z: b.z0 });
    // Blocklänge in X (Sehne) an der Wurzelebene, unterhalb des Blocks.
    dim3({ x: x0, y: yb, z: b.z0 }, { x: x1, y: yb, z: b.z0 }, 'Block-L ' + mm(x1 - x0), { color: '#8fa0b4', off: 26, nx: 0, ny: 1 });
    // Blockhöhe (Y).
    dim3({ x: x1, y: yb, z: b.z0 }, { x: x1, y: yt, z: b.z0 }, 'H ' + mm(yt - yb), { color: '#8fa0b4', off: 22 });
    // Spannweite (Z) zwischen Wurzel- und Randebene.
    dim3({ x: x0, y: yb, z: b.z0 }, { x: x0, y: yb, z: b.z1 }, 'Spannw. ' + mm(Math.abs(b.z1 - b.z0)), { color: '#57d38c', off: 26, nx: 0, ny: 1 });
    // Abstand Maschinennullpunkt (X=0) -> hinterer Blockschnitt (kleinstes X), rot.
    // Beim Kern der Blockschnitt hinten, bei der Negativschale der hintere
    // konstante Schalenrand. Innen = Wurzelebene (z0), Außen = Randebene (z1);
    // beim Trapezblock liegen beide bei unterschiedlichem X.
    // Im Negativdesign misst die hintere Blockkante keinen echten Schnitt (nur den
    // Überstand) — dort werden diese roten Maße unterdrückt (b.noBlockCut).
    const x0t = Math.min(b.x0t != null ? b.x0t : b.x0, b.x1t != null ? b.x1t : b.x1);
    if (!b.noBlockCut) {
      if (x0 > 0.5) dim3({ x: 0, y: 0, z: b.z0 }, { x: x0, y: 0, z: b.z0 }, T(nn ? 'Null→Blockschnitt vorne innen X ' : 'Null→Blockschnitt hinten innen X ') + mm(x0), { color: '#ff3b3b', off: 44, nx: 0, ny: 1 });
      if (x0t > 0.5) dim3({ x: 0, y: 0, z: b.z1 }, { x: x0t, y: 0, z: b.z1 }, T(nn ? 'Null→Blockschnitt vorne außen X ' : 'Null→Blockschnitt hinten außen X ') + mm(x0t), { color: '#ff8a3c', off: 44, nx: 0, ny: 1 });
    }
    // Negativschale mit konstantem Schalenrand: Abstand Null → hinterer
    // Referenz-Vertikalschnitt (EL), innen (z0) und außen (z1). Lila, deutlich
    // weiter versetzt als die Blockkanten-Maße.
    const e = b.edge;
    if (e) {
      const SE = '#c78bff';
      if (e.rearIn  > 0.5) dim3({ x: 0, y: 0, z: b.z0 }, { x: e.rearIn,  y: 0, z: b.z0 }, T('Null→Schalenrand hinten innen X ') + mm(e.rearIn),  { color: SE, off: 66, nx: 0, ny: 1 });
      if (e.rearOut > 0.5) dim3({ x: 0, y: 0, z: b.z1 }, { x: e.rearOut, y: 0, z: b.z1 }, T('Null→Schalenrand hinten außen X ') + mm(e.rearOut), { color: SE, off: 66, nx: 0, ny: 1 });
    }
    // Höhe des Blocks über dem Nullpunkt (Y=0 -> Blockunterkante), rot.
    if (yb > 0.5) dim3({ x: x0, y: 0, z: b.z0 }, { x: x0, y: yb, z: b.z0 }, T('Null→Block Y ') + mm(yb), { color: '#ff3b3b', off: 40 });
  }

  /* Hilfsebenen im Block (z. B. Schnitthöhen bei „Block horizontal"): gestrichelte
     waagrechte Ebene über die Blocklänge und -breite auf Höhe y, dazu ein Maß
     ab Y0 (Maschinennullpunkt) mit Beschriftung. */
  function drawGuides(b) {
    if (!b.guides || !b.guides.length) return;
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1);
    const z0 = b.z0 != null ? b.z0 : 0, z1 = b.z1 != null ? b.z1 : S.scene.machineWidth;
    for (const g of b.guides) {
      const col = g.color || '#ffb454', y = g.y;
      const P = (x, z) => ({ x, y, z });
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      seg(P(x0, z0), P(x1, z0)); seg(P(x0, z1), P(x1, z1));
      seg(P(x0, z0), P(x0, z1)); seg(P(x1, z0), P(x1, z1));
      ctx.stroke();
      ctx.restore();
      if (g.label) dim3({ x: x1, y: 0, z: z1 }, { x: x1, y, z: z1 }, g.label, { color: col, off: 22 });
    }
  }

  function drawTower(zPlane, pos, label, col) {
    const { x0, x1, y1 } = S.bx, y = S.floor;
    const P = (x, yy) => ({ x, y: yy, z: zPlane });
    ctx.save();
    ctx.strokeStyle = 'rgba(150,168,190,.55)'; ctx.lineWidth = 1.6;
    ctx.beginPath();                                   // Rahmen der Turmebene
    seg(P(x0, y), P(x1, y)); seg(P(x0, y1), P(x1, y1));
    seg(P(x0, y), P(x0, y1)); seg(P(x1, y), P(x1, y1));
    ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 3;          // fahrende Säule (X)
    ctx.beginPath(); seg(P(pos.x, y), P(pos.x, y1)); ctx.stroke();
    ctx.lineWidth = 2.4;                               // Ausleger (Y)
    ctx.beginPath(); seg(P(x0, pos.y), P(pos.x, pos.y)); ctx.stroke();
    const s = scr(P(pos.x, pos.y));                    // Drahtaufnahme
    if (s.d > NEAR) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, 4.5, 0, 6.3); ctx.fill();
    }
    const t = scr(P((x0 + x1) / 2, y1));
    if (t.d > NEAR) {
      ctx.fillStyle = 'rgba(160,178,200,.85)'; ctx.font = '11px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(label, t.x, t.y - 8);
    }
    ctx.restore();
  }

  function drawBlock(b) {
    // Trapez-Block: Wurzelebene (z0) und Außenebene (z1) können unterschiedliche
    // X-/Y-Ausdehnung haben (Sehne + Nasen-/Endleisten-Verlängerung je Ende).
    // Fällt auf Quader zurück, wenn keine Außenwerte vorliegen (Altprojekte).
    const x0t = b.x0t != null ? b.x0t : b.x0, x1t = b.x1t != null ? b.x1t : b.x1;
    const y0t = b.y0t != null ? b.y0t : b.y0, y1t = b.y1t != null ? b.y1t : b.y1;
    // Werkstück-Drehung (Pfeilung): liegen 8 vorgedrehte Ecken vor, den Block als
    // gedrehten Körper zeichnen (Reihenfolge identisch zur Trapez-Variante unten).
    let V;
    if (b.rot && b.rot.corners && b.rot.corners.length === 8) {
      V = b.rot.corners;
    } else {
      const planes = [
        [b.z0, b.x0, b.x1, b.y0, b.y1],
        [b.z1, x0t, x1t, y0t, y1t]
      ];
      V = [];
      for (const [z, x0, x1, y0, y1] of planes) for (const y of [y0, y1]) for (const x of [x0, x1]) V.push({ x, y, z });
    }
    // Index: z-Ebene*4 + y*2 + x
    const E = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
    ctx.save();
    // Stirnflächen leicht füllen, damit der Block Körper bekommt
    [[0,1,3,2],[4,5,7,6]].forEach(f => {
      const pts = f.map(i => scr(V[i]));
      if (pts.some(p => p.d < NEAR)) return;
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath(); ctx.fillStyle = 'rgba(225,238,255,.055)'; ctx.fill();
    });
    ctx.strokeStyle = 'rgba(150,170,195,.75)'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); E.forEach(([a, c]) => seg(V[a], V[c])); ctx.stroke();
    ctx.restore();
  }

  /* Bereits geschnittene Fläche: das Band, das der Draht zwischen Wurzel- und
     Randebene überstrichen hat. Quads nach Tiefe sortiert (Maleralgorithmus). */
  function drawSurface(upto, u, b) {
    const t0 = b.cutZ0 / S.scene.machineWidth, t1 = b.cutZ1 / S.scene.machineWidth;
    const quads = [];
    for (let i = 0; i <= upto && i < S.moves.length; i++) {
      const m = S.moves[i];
      if (m.rapid || m.seg !== b.seg) continue;
      const a = m.from, c = i === upto ? lerpMove(m, u) : m.to;
      const p = [wirePt(a, t0), wirePt(c, t0), wirePt(c, t1), wirePt(a, t1)].map(scr);
      if (p.some(q => q.d < NEAR)) continue;
      quads.push({ p, d: (p[0].d + p[1].d + p[2].d + p[3].d) / 4 });
    }
    quads.sort((A, B) => B.d - A.d);
    ctx.save();
    ctx.fillStyle = 'rgba(74,163,255,.20)'; ctx.strokeStyle = 'rgba(74,163,255,.30)'; ctx.lineWidth = .6;
    for (const q of quads) {
      ctx.beginPath();
      q.p.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // Schnittkanten in Wurzel- und Randebene betonen
    ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.6;
    [t0, t1].forEach(tz => {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= upto && i < S.moves.length; i++) {
        const m = S.moves[i];
        if (m.seg !== b.seg) { pen = false; continue; }
        const A = scr(wirePt(m.from, tz)), C = scr(wirePt(i === upto ? lerpMove(m, u) : m.to, tz));
        if (A.d < NEAR || C.d < NEAR) { pen = false; continue; }
        if (m.rapid) { pen = false; continue; }
        if (!pen) { ctx.moveTo(A.x, A.y); pen = true; }
        ctx.lineTo(C.x, C.y);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  /* Fertiges Flächenprofil: der komplette (gesamte Programm-)Schnittzug an
     Wurzel- und Randebene jedes Segments. Zeigt die Zielkontur der Fläche im
     Block dauerhaft an — unabhängig vom Wiedergabestand (anders als
     drawSurface, das nur das bis zur aktuellen Position Überstrichene füllt). */
  function drawProfile() {
    const mw = S.scene.machineWidth;
    ctx.save();
    ctx.strokeStyle = S.colors.profile; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    for (const b of (S.scene.blocks || [])) {
      const cz0 = b.cutZ0 != null ? b.cutZ0 : (b.z0 != null ? b.z0 : 0);
      const cz1 = b.cutZ1 != null ? b.cutZ1 : (b.z1 != null ? b.z1 : mw);
      [cz0 / mw, cz1 / mw].forEach(tz => {
        ctx.beginPath();
        let pen = false;
        for (const m of S.moves) {
          if (m.seg !== b.seg || m.rapid) { pen = false; continue; }
          const A = scr(wirePt(m.from, tz)), C = scr(wirePt(m.to, tz));
          if (A.d < NEAR || C.d < NEAR) { pen = false; continue; }
          if (!pen) { ctx.moveTo(A.x, A.y); pen = true; }
          ctx.lineTo(C.x, C.y);
        }
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  /* Vollständiger Schneideweg beider Türme: die komplette Bahn, die jeder Turm
     in seiner Ebene abfährt (linker Turm bei z=0, rechter bei z=machineWidth).
     Schnittzüge in der Turmfarbe, Eilgänge (G0) blass gestrichelt. */
  function drawTowerPaths() {
    const mw = S.scene.machineWidth;
    const specs = [
      { get: m => [m.from.lx, m.from.ly, m.to.lx, m.to.ly], z: 0,  col: S.colors.towerL },
      { get: m => [m.from.rx, m.from.ry, m.to.rx, m.to.ry], z: mw, col: S.colors.towerR }
    ];
    for (const s of specs) {
      for (const m of S.moves) {
        const g = s.get(m);
        strokeSeg({ x: g[0], y: g[1], z: s.z }, { x: g[2], y: g[3], z: s.z },
          m.rapid ? 'rgba(130,150,175,.30)' : s.col, m.rapid ? 1 : 1.5, m.rapid ? [4, 4] : null);
      }
    }
  }

  function drawWire(p) {
    const A = { x: p.lx, y: p.ly, z: 0 }, B = { x: p.rx, y: p.ry, z: S.scene.machineWidth };
    const s = line3(A, B); if (!s) return;
    ctx.save();
    ctx.globalAlpha = 0.28; ctx.strokeStyle = S.colors.wire; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = S.colors.wire; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
    ctx.restore();
  }

  function hud(p, m, info) {
    const ax = S.scene.ax;
    const mm = v => v.toFixed(1);
    const fmt = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    const x = 10, y = H - 92;                 // unten links, stört die Legende nicht
    ctx.save();
    ctx.font = '11px Consolas,monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(15,18,22,.82)';
    ctx.fillRect(x, y, 232, 82);
    ctx.strokeStyle = 'rgba(42,50,60,1)'; ctx.strokeRect(x, y, 232, 82);
    ctx.fillStyle = '#ffb454';
    ctx.fillText(`${ax.x}${mm(p.lx).padStart(8)}   ${ax.y}${mm(p.ly).padStart(8)}`, x + 10, y + 20);
    ctx.fillText(`${ax.u}${mm(p.rx).padStart(8)}   ${ax.v}${mm(p.ry).padStart(8)}`, x + 10, y + 36);
    ctx.fillStyle = '#8b98a8';
    ctx.fillText(`${T(info.tag)} ${fmt(info.t)} / ${fmt(info.tot)}   ${T('Zeile ')}${m ? m.line + 1 : 0}`, x + 10, y + 54);
    ctx.fillText(`Segment ${m ? m.seg + 1 : 1}${m && m.rapid ? T('   G0 Eilgang') : ''}`, x + 10, y + 70);
    ctx.restore();
  }

  /* Zeichnet die Szene an Position `at` ({i,u}) in den aktuell gesetzten
     Viewport (canvas/ctx/W/H/cam). `info` = HUD-Zeit/Tag. */
  // ---------- Achsen-Gizmo (oben links; rechts liegt die Legende) ---------
  // Zeigt die Orientierung der Maschinenachsen (X = Sehne, Y = Höhe, Z = Spann-
  // weite/Turmabstand). Klick auf ein Achsenende stellt die Ansicht senkrecht
  // auf diese Achse. Die Trefferflächen liegen je Kamera (zwei Viewports).
  const GIZ_AXES = [
    { v: [1, 0, 0], t: 'X', col: '#ff5a5a', cam: CAM_FRONT },
    { v: [0, 1, 0], t: 'Y', col: '#5ad06a', cam: CAM_TOP },
    { v: [0, 0, 1], t: 'Z', col: '#5a9cff', cam: CAM_SIDE }
  ];
  function rotDir(v) {   // Richtung Welt -> Kamera (nur Drehung, wie toCam)
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
    return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
  }
  function drawGizmo() {
    const L = 30, cx = 58, cy = 58;
    ctx.save();
    if (window.ViewCube) {   // Ansichtswürfel (viewcube.js) ersetzt das Achsen-Gizmo; nur Zoomfaktor anzeigen
      ctx.fillStyle = '#8b98a8'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText((cam.zoom >= 10 ? cam.zoom.toFixed(0) : cam.zoom.toFixed(1)) + '×', 10, 16);
      ctx.restore(); cam.giz = null; return;
    }
    ctx.fillStyle = 'rgba(15,18,22,.55)'; ctx.beginPath(); ctx.arc(cx, cy, L + 16, 0, 6.3); ctx.fill();
    ctx.strokeStyle = 'rgba(42,50,60,1)'; ctx.lineWidth = 1; ctx.stroke();
    const items = GIZ_AXES.map(a => { const r = rotDir(a.v); return { a, x: cx + r[0] * L, y: cy - r[1] * L, d: r[2] }; });
    // negative Halbachsen nur angedeutet
    ctx.strokeStyle = 'rgba(150,160,175,.35)'; ctx.setLineDash([2, 3]);
    items.forEach(q => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(2 * cx - q.x, 2 * cy - q.y); ctx.stroke(); });
    ctx.setLineDash([]);
    items.sort((p, q) => p.d - q.d);   // hintere zuerst
    const hits = [];
    ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const q of items) {
      ctx.globalAlpha = 0.55 + 0.45 * Math.max(0, Math.min(1, (q.d + 1) / 2));
      ctx.strokeStyle = q.a.col; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.fillStyle = q.a.col; ctx.beginPath(); ctx.arc(q.x, q.y, 8, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#10141a'; ctx.fillText(q.a.t, q.x, q.y + 0.5);
      hits.push({ x: q.x, y: q.y, r: 9, cam: q.a.cam });
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#8b98a8'; ctx.font = '10px Segoe UI';
    ctx.fillText((cam.zoom >= 10 ? cam.zoom.toFixed(0) : cam.zoom.toFixed(1)) + '×', cx, cy + L + 26);
    ctx.restore();
    cam.giz = hits;
  }
  function gizmoHit(camObj, x, y) {
    const h = camObj.giz; if (!h) return null;
    for (let k = h.length - 1; k >= 0; k--) if (Math.hypot(x - h[k].x, y - h[k].y) <= h[k].r) return h[k].cam;
    return null;
  }

  function drawSceneAt(at, info) {
    ctx.clearRect(0, 0, W, H);
    drawGizmo();
    if (!S.ready) {
      ctx.fillStyle = '#8b98a8'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(T('Noch kein G-Code.'), W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }
    const m = S.moves[at.i];
    const p = m ? lerpMove(m, at.u) : { lx: 0, ly: 0, rx: 0, ry: 0 };
    const blk = S.scene.blocks[m ? m.seg : 0] || S.scene.blocks[0];

    drawFloor();
    drawOrigin();
    if (S.show.block && blk) drawBlock(blk);
    if (S.show.block && blk) drawGuides(blk);
    if (S.show.surface && blk) drawSurface(at.i, at.u, blk);
    if (S.show.profile) drawProfile();
    if (S.show.paths) drawTowerPaths();
    if (S.show.towers) {
      // Aus Bedienersicht (vor der Maschine stehend): XY-Portal links, UZ rechts.
      drawTower(0, { x: p.lx, y: p.ly }, T('Portal links · ') + S.scene.ax.x + S.scene.ax.y, S.colors.towerL);
      drawTower(S.scene.machineWidth, { x: p.rx, y: p.ry }, T('Portal rechts · ') + S.scene.ax.u + S.scene.ax.v, S.colors.towerR);
    }
    drawWire(p);
    if (S.show.dim && blk) drawDims(blk);
    hud(p, m, info);
    if (S.warn) drawWarn(S.warn);
  }

  // Haupt-Viewport (G-Code-Tab): Position aus der Wiedergabezeit S.t.
  function draw() {
    canvas = document.getElementById('cSim'); cam = mainCam; fit();
    const at = moveAt(S.t);
    drawSceneAt(at, { t: S.t, tot: S.total, tag: 't' });
  }

  // Monitor-Viewport (Reiter „Schneiden"): eigener Datensatz (MON). Position
  // entweder aus der Vorschau-Wiedergabe (MON.t) oder aus der Ausführung (MON.pos).
  function drawMonitor() {
    if (!monMounted || !monCanvas) return;
    canvas = monCanvas; cam = monCam; fit();
    withDataset(MON, () => {
      let at, info;
      // Vorschau läuft ODER steht an einer Auto-Pause (M0) / am Ende: Position
      // aus der Wiedergabezeit MON.t — sonst springt die Ansicht auf Null zurück.
      if (MON.playing || (MON.t > 0 && !MON.pos)) {
        at = moveAt(MON.t);
        info = { t: MON.t, tot: MON.total, tag: MON.playing ? '▶ Sim' : '⏸ Sim' };
      } else {
        at = MON.pos || { i: 0, u: 0 };
        const tExec = MON.cum.length && MON.pos ? (MON.cum[at.i] || 0) : 0;
        info = { t: tExec, tot: MON.total, tag: '▶' };
      }
      drawSceneAt(at, info);
    });
  }

  // ---------- Animationsschleife ----------------------------------------
  function tick(now) {
    S.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - S.last) / 1000 || 0); S.last = now;
    if (S.playing) {
      const prevS = S.t;
      S.t += dt * S.speed;
      // Auto-Pause an M0-Stellen: an der ersten Pausenzeit im Intervall anhalten
      // (Draht bleibt dort stehen; erneutes „Start" setzt die Fahrt fort).
      let ptS = null;
      if (S.pauseTimes) for (const q of S.pauseTimes) { if (q > prevS + 1e-9 && q <= S.t) { ptS = q; break; } }
      if (ptS != null) { S.t = ptS; setPlaying(false); }
      else if (S.t >= S.total) { S.t = S.total; setPlaying(false); }
      syncBar();
    }
    if (MON.playing) {
      const prev = MON.t;
      MON.t += dt * S.speed;
      // Auto-Pause an M0-Stellen: erste Pausenzeit im Intervall (prev, MON.t].
      let pt = null;
      if (MON.pauseTimes) for (const q of MON.pauseTimes) { if (q > prev + 1e-9 && q <= MON.t) { pt = q; break; } }
      if (pt != null) { MON.t = pt; MON.playing = false; monPauseCb(); }
      else if (MON.t >= MON.total) { MON.t = MON.total; MON.playing = false; monEndCb(); }
    }
    // Nur den jeweils sichtbaren Viewport zeichnen.
    if (document.getElementById('gcodeView').classList.contains('active')) draw();
    const mv = document.getElementById('cutView');   // 3D-Monitor liegt jetzt im Reiter „Schneiden"
    if (monMounted && mv && mv.classList.contains('active')) drawMonitor();
  }

  // ---------- Bedienelemente --------------------------------------------
  const $ = s => document.querySelector(s);
  function setPlaying(on) {
    S.playing = on && S.ready && S.total > 0;
    if (S.playing && S.t >= S.total) S.t = 0;
    $('#simPlay').textContent = S.playing ? T('⏸ Pause') : T('▶ Start');
  }
  let curGln = null;
  // Aktuelle G-Code-Zeile in der zeilenweisen Ansicht (#gcodeText) hervorheben
  // und zentriert mitscrollen. lineIdx = 0-basierte Quellzeile der Bewegung.
  function highlightGline(lineIdx) {
    const el = $('#gcodeText');
    if (!el || !el.children || !el.children.length) { curGln = null; return; }
    const ln = el.children[lineIdx];
    if (ln === curGln) return;
    if (curGln) curGln.classList.remove('cur');
    curGln = ln || null;
    if (ln) {
      ln.classList.add('cur');
      el.scrollTop = Math.max(0, ln.offsetTop - el.clientHeight / 2 + ln.offsetHeight / 2);
    }
  }
  function syncBar() {
    const f = S.total ? S.t / S.total : 0;
    const sl = $('#simSeek'); if (document.activeElement !== sl) sl.value = String(Math.round(f * 1000));
    const at = moveAt(S.t), m = S.moves[at.i];
    if (m) highlightGline(m.line);
  }

  // Orbit/Pan/Zoom für einen bestimmten Canvas + dessen Kamera. Beide Viewports
  // (Haupt + Monitor) nutzen dies mit ihrer eigenen Kamera.
  function setupInput(cv, camObj) {
    let drag = null;
    cv.addEventListener('mousedown', e => {
      // Klick auf eine Achse des Gizmos: Ansicht senkrecht auf diese Achse.
      if (e.button === 0 && !e.shiftKey) {
        const r = cv.getBoundingClientRect(), g = gizmoHit(camObj, e.clientX - r.left, e.clientY - r.top);
        if (g) { Object.assign(camObj, g, { zoom: camObj.zoom, px: 0, py: 0 }); return; }
      }
      drag = { x: e.clientX, y: e.clientY, yaw: camObj.yaw, pitch: camObj.pitch,
               px: camObj.px, py: camObj.py, pan: e.shiftKey || e.button === 1 };
      cv.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.pan) { camObj.px = drag.px + dx; camObj.py = drag.py + dy; }
      else {
        camObj.yaw = drag.yaw + dx * 0.008 * (Math.cos(drag.pitch) < 0 ? -1 : 1);
        camObj.pitch = drag.pitch + dy * 0.006;   // keine Kipp-Begrenzung
      }
    });
    window.addEventListener('mouseup', () => { drag = null; cv.style.cursor = 'grab'; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      // Zoom am Mauszeiger: der Punkt unter dem Cursor bleibt stehen (großer
      // Bereich bis 400x, damit auch Details wie der Draht am Block sichtbar werden).
      const z0 = camObj.zoom, z1 = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z0 * Math.exp(-e.deltaY * 0.0015)));
      const k = z1 / z0, r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      camObj.px = mx - (mx - camObj.px) * k; camObj.py = my - (my - camObj.py) * k;
      camObj.zoom = z1;
    }, { passive: false });
    cv.addEventListener('dblclick', () => { resetCam(camObj); });
    cv.style.cursor = 'grab';
  }

  // ---------- Öffentliche API -------------------------------------------
  function init(opts) {
    canvas = document.getElementById(opts.canvasId || 'cSim');
    cam = mainCam; fit(); setupInput(canvas, mainCam);
    if (window.ViewCube) ViewCube.attach({ canvas: () => canvas && canvas.id === (opts.canvasId || 'cSim') ? canvas : document.getElementById(opts.canvasId || 'cSim'), get: () => mainCam, set: (y, p) => { mainCam.yaw = y; mainCam.pitch = p; }, redraw: () => draw(), rot: ViewCube.ROT_STD, k: [0.008, 0.006] });

    $('#simPlay').onclick = () => setPlaying(!S.playing);
    $('#simStop').onclick = () => { setPlaying(false); S.t = 0; syncBar(); };
    $('#simTop').onclick = () => { Object.assign(mainCam, CAM_TOP); frameScene(); };
    $('#simSide').onclick = () => { Object.assign(mainCam, CAM_SIDE); frameScene(); };
    $('#simFront').onclick = () => { Object.assign(mainCam, CAM_FRONT); frameScene(); };
    $('#simView0').onclick = () => { resetCam(mainCam); frameScene(); };
    $('#simSpeed').onchange = e => S.speed = parseFloat(e.target.value);
    $('#simSeek').oninput = e => {
      S.t = S.total * (parseInt(e.target.value, 10) / 1000);
      syncBar();
    };
    [['simTowers', 'towers'], ['simPaths', 'paths'], ['simSurface', 'surface'], ['simProfile', 'profile'], ['simBlock', 'block'], ['simDim', 'dim']].forEach(([id, key]) => {
      const el = document.getElementById(id);
      el.checked = S.show[key];
      el.onchange = () => { S.show[key] = el.checked; syncLegend(); };
    });
    syncLegend();
    S.speed = parseFloat($('#simSpeed').value) || 25;
    S.last = performance.now();
    S.raf = requestAnimationFrame(tick);
  }

  /* Neuen G-Code + Szene übernehmen. scene:
     { machineWidth, ax:{x,y,u,v}, defaultSeg,
       blocks:[{seg,x0,x1,y0,y1,z0,z1,cutZ0,cutZ1}] } */
  function load(text, scene) {
    S.scene = scene;
    S.moves = parseGcode(text || '', scene.ax, scene.defaultSeg || 0);
    buildTimeline();
    S.ready = S.moves.length > 0;
    S.warn = computeWarn(S.moves, scene);
    S.t = 0; setPlaying(false);
    frameScene();
    // Kamera nur beim allerersten Laden auf die Standardansicht setzen. Danach
    // bleibt die gewählte Ansicht (Draufsicht, frei gedreht, …) erhalten, auch
    // beim Neuaufbau durch Umschalten zwischen linker/rechter Tragfläche.
    if (!S.loaded) { Object.assign(mainCam, CAM0); S.loaded = true; }
    $('#simInfo').textContent = S.ready
      ? `${S.moves.length}${T(' Bewegungen · Laufzeit ')}${(S.total / 60).toFixed(1)} min`
      : T('kein Programm');
    syncBar();
  }

  /* Bewegungsliste direkt übernehmen (ohne G-Code-Text) — Bahnvorschau in
     Ausgaben ohne G-Code-Erzeugung (pathpreview.js). list = [{from:{lx,ly,rx,ry},
     to, rapid, feed}]; Dauer und Zeilenindex werden hier ergänzt. */
  function loadMoves(list, scene) {
    S.scene = scene;
    S.moves = (list || []).map((m, i) => {
      const dMax = Math.max(Math.hypot(m.to.lx - m.from.lx, m.to.ly - m.from.ly),
                            Math.hypot(m.to.rx - m.from.rx, m.to.ry - m.from.ry));
      const F = m.rapid ? RAPID_FEED : (m.feed || 1);
      return { from: m.from, to: m.to, rapid: !!m.rapid, seg: scene.defaultSeg || 0, line: i,
               feed: m.rapid ? 0 : F, dur: dMax / F * 60 };
    });
    buildTimeline();
    S.ready = S.moves.length > 0;
    S.warn = computeWarn(S.moves, scene);
    S.t = 0; setPlaying(false);
    frameScene();
    if (!S.loaded) { Object.assign(mainCam, CAM0); S.loaded = true; }
    $('#simInfo').textContent = S.ready
      ? `${S.moves.length}${T(' Bewegungen · Laufzeit ')}${(S.total / 60).toFixed(1)} min`
      : T('kein Programm');
    syncBar();
  }

  /* Zweiten Viewport im Reiter „Schneiden" anlegen (folgt der Ausführung bzw.
     spielt die Vorschau-Simulation ab). */
  function mountMonitor(canvasId) {
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    monCanvas = cv;
    monCam = Object.assign({}, CAM0);
    setupInput(monCanvas, monCam);
    if (window.ViewCube && !cv._vc) { cv._vc = true; ViewCube.attach({ canvas: () => monCanvas, get: () => monCam, set: (y, p) => { monCam.yaw = y; monCam.pitch = p; }, redraw: () => drawMonitor(), rot: ViewCube.ROT_STD, k: [0.008, 0.006] }); }
    monMounted = true;
    const bind = (id, C) => { const b = document.getElementById(id); if (b) b.onclick = () => Object.assign(monCam, C); };
    bind('simMTop', CAM_TOP); bind('simMSide', CAM_SIDE); bind('simMFront', CAM_FRONT); bind('simMView0', CAM0);
  }

  /* Programm des Reiters „Schneiden" in den Monitor laden (das im Reiter
     ausgewählte G-Code-Programm — Tragfläche ODER Blockzurichten). */
  function loadMonitor(text, scene) {
    MON.scene = scene || { machineWidth: 900, ax: { x: 'X', y: 'Y', u: 'Z', v: 'A' }, blocks: [], defaultSeg: 0 };
    MON.moves = parseGcode(text || '', MON.scene.ax, MON.scene.defaultSeg || 0);
    MON.cum = []; let t = 0; MON.pauseTimes = [];
    for (let k = 0; k < MON.moves.length; k++) { t += MON.moves[k].dur; MON.cum.push(t); if (MON.moves[k].pauseAfter) MON.pauseTimes.push(t); }
    MON.total = t;
    MON.ready = MON.moves.length > 0;
    MON.warn = computeWarn(MON.moves, MON.scene);
    const fr = computeFrame(MON.moves, MON.scene);
    MON.bx = fr.bx; MON.floor = fr.floor; MON.center = fr.center; MON.radius = fr.radius;
    MON.t = 0; MON.playing = false; MON.pos = null;
    Object.assign(monCam, CAM0);
    return MON.ready;
  }
  /* Vorschau-Simulation im Monitor starten/pausieren. -> aktueller Spielzustand.
     Geschwindigkeit = Faktor aus dem Dropdown (S.speed). */
  function playMonitor(on) {
    const want = on == null ? !MON.playing : !!on;
    MON.playing = want && MON.ready && MON.total > 0;
    if (MON.playing) { if (MON.t >= MON.total) MON.t = 0; MON.pos = null; }
    return MON.playing;
  }

  function stopMonitor() { MON.playing = false; MON.t = 0; MON.pos = null; }
  function monitorReady() { return MON.ready; }
  function setMonitorEnd(fn) { monEndCb = fn || (() => {}); }
  function setMonitorPause(fn) { monPauseCb = fn || (() => {}); }

  // Simulator (Haupt-Viewport) an den Beginn einer angeklickten G-Code-Zeile
  // setzen. lineIdx = 0-basierte Quellzeile (= Kindindex in #gcodeText).
  // Bevorzugt die exakte Zeile; sonst die letzte Bewegung davor (Kommentar-/
  // Leerzeilen ohne eigene Bewegung landen bei der vorherigen Fahrt).
  function seekToLine(lineIdx) {
    if (!S.moves.length) return;
    let exact = -1, le = -1;
    for (let k = 0; k < S.moves.length; k++) {
      const l = S.moves[k].line;
      if (l === lineIdx && exact < 0) exact = k;
      if (l <= lineIdx) le = k;
    }
    const idx = exact >= 0 ? exact : le;
    if (idx < 0) return;
    setPlaying(false);
    // Startzeit der Bewegung idx (Ende der vorherigen) + winziger Versatz, damit
    // moveAt() genau diese Bewegung/Zeile trifft.
    S.t = Math.min(S.total, (idx > 0 ? S.cum[idx - 1] : 0) + 1e-6);
    syncBar();
    draw();
  }

  /* Warnungen neu bewerten (Schalter im Menü „Maschinengrenzen & Warnungen"
     umgelegt): Grenzen frisch aus der App holen, beide Szenen neu prüfen. */
  function refreshWarn() {
    const lim = (window.App && App.machineLimits) ? App.machineLimits() : null;
    if (S.scene) { if (lim) S.scene.limits = lim; S.warn = computeWarn(S.moves, S.scene); }
    if (MON.scene) { if (lim) MON.scene.limits = lim; MON.warn = computeWarn(MON.moves, MON.scene); }
    redrawAll();
  }
  window.Sim3D = { init, load, loadMoves, resize: fit, play: () => setPlaying(true), setColors,
                   mountMonitor, loadMonitor, playMonitor, stopMonitor, monitorReady,
                   setMonitorEnd, setMonitorPause, seekToLine, refreshWarn };
})();
