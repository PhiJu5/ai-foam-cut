/* foilpolar.js — Profilpolaren ohne den Reiter „Aerodynamik“: Rechner-Wahl
 * NeuralFoil/XFOIL (Endpunkt /__xfoil__), Polaren-Ansicht openFoilView,
 * Diagramme drawChart/chartRange samt Großansicht. Gehört zum Kern; aero.js und
 * foildb.js bauen darauf auf. Was nur die Aerodynamik kennt (geladene Zusatz-
 * profile, importierte XFOIL-Polaren), trägt aero.js in FoilPolar.hooks ein. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const DEF = { aeroCalc: 'nf', aeroXfCores: 0, aeroNcrit: 9 };
  const C = k => (state.cfg[k] !== undefined ? state.cfg[k] : DEF[k]);
  const S = (k, v) => { state.cfg[k] = v; };
  const num = k => { const v = +C(k); return isNaN(v) ? +DEF[k] || 0 : v; };
  const H = { allProfiles: () => [], loadExtraFoils: () => {}, extraFoils: [], extraSummary: () => '', xfGroupFor: () => null };

  const reName = Re => Re >= 1e6 ? (Math.round(Re / 1e5) / 10) + 'M' : Math.round(Re / 1000) + 'k';

  function foilHash(prof) {
    if (!Array.isArray(prof) || prof.length < 5) return null;
    let h = 0;
    for (let i = 0; i < prof.length; i++)
      h = (h * 31 + Math.round(prof[i].x * 8191) * 7 + Math.round(prof[i].y * 8191)) % 2147483647;
    return 'p' + prof.length + '_' + h;
  }

  const nfModels = new Map();     // Profil-Hash → NeuralFoil-Modell (Kulfan-Fit)

  function cssVar(n, fb) {
    try { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || fb; }
    catch (e) { return fb; }
  }
  const PART_COLORS = ['#4da3ff', '#ffb64d', '#7bd88f', '#ff6b81', '#c792ea', '#4dd0e1', '#f0e060'];

  const chartHide = new Set();     // 'diagrammId|Kurvenname' → ausgeblendet
  let ovRefresh = null;            // Live-Update-Haken der offenen Großansicht

  // ---------- Echtes XFOIL (xfoil.exe über den lokalen Server) -------------
  // Endpunkt /__xfoil__ (xfoilrun.py in launcher.py/dev_server, Node-Fassung in
  // electron/server.js): Liste von Läufen {pts, name, Re, type, ncrit, a0, a1, da}
  // hin, je Lauf die Polarpunkte zurück. Der Server rechnet die Läufe parallel
  // auf cfg.aeroXfCores Kernen (0 = alle) — deshalb gehen alle Profile und
  // Re-Stufen einer Analyse in EINEN Aufruf. Die Analyse-Kette ist synchron →
  // synchrone Anfrage; die Polaren-Ansicht holt asynchron.
  let xfAvail = null;                 // null = noch nicht gefragt, '' = fehlt, sonst exe-Pfad
  let xfCpus = 0;                     // Kerne des Rechners (vom Server gemeldet)
  const xfoilReady = () => !!xfAvail;
  function xfoilProbe(cb) {
    if (!/^https?:$/.test(location.protocol) || !window.fetch) { xfAvail = ''; return; }
    fetch('/__xfoil__', { cache: 'no-store' }).then(r => r.json())
      .then(j => { xfAvail = j && j.ok && j.exe ? String(j.exe) : ''; xfCpus = j && +j.cpus || 0; })
      .catch(() => { xfAvail = ''; }).then(() => { if (cb) cb(); xfWait.splice(0).forEach(f => { try { f(); } catch (e) {} }); });
  }
  const xfWait = [];                  // andere Reiter: nach der XFOIL-Suche neu aufbauen
  const xfoilWhenKnown = f => { if (xfAvail !== null) f(); else xfWait.push(f); };
  // Rechner-Wahl: calcUi = Einstellung wie gewählt, calcSel = was tatsächlich
  // rechnen kann (XFOIL fehlt → NeuralFoil)
  const calcUi = c => c === 'xfoil' ? 'xfoil' : 'nf';
  function calcSel(c) {
    c = calcUi(c === undefined ? C('aeroCalc') : c);
    return c === 'xfoil' && xfoilReady() ? 'xfoil' : 'nf';
  }
  // XFOIL steht IMMER zur Wahl; ist es nicht erreichbar, sagt xfoilWhy() warum
  // (dann rechnet NeuralFoil, bis XFOIL da ist)
  function xfoilWhy() {
    if (xfoilReady()) return '';
    if (!/^https?:$/.test(location.protocol))
      return T('XFOIL nicht verfügbar: Die App ist direkt als HTML-Datei geöffnet. XFOIL braucht den lokalen Server — die App über die exe bzw. launcher.py (Electron: das Programm) starten.');
    if (xfAvail === null) return T('XFOIL wird gesucht …');
    return T('XFOIL nicht verfügbar: xfoil.exe nicht gefunden — in den Ordner „XFOIL“ neben der App legen (oder der Starter ist älter als die XFOIL-Anbindung: neu starten/neu bauen).');
  }
  const xfLabel = () => xfoilReady() ? 'XFOIL' : T('XFOIL (nicht verfügbar)');

  const calcOpts = () => [['nf', 'NeuralFoil'], ['xfoil', xfLabel()]];
  // jobs: [{prof, name, Re, type, ncrit, a0, a1, da}]
  function xfoilBody(jobs) {
    return JSON.stringify({ cores: Math.max(0, Math.round(num('aeroXfCores') || 0)),
      jobs: jobs.map(j => {
        const o = { name: j.name || (j.prof && j.prof.name) || 'Profil', pts: j.prof.map(q => [q.x, q.y]),
          Re: j.Re, type: j.type || 1, ncrit: j.ncrit, a0: j.a0, a1: j.a1, da: j.da };
        if (j.dump) { o.dump = true; o.alphas = j.alphas; }   // Umströmung: DUMP je Winkel
        if (j.visc === false) o.visc = false;
        if (j.points) o.points = j.points;                   // Einzelpunkte (Profiloptimierung)
        if (j.iter > 0) o.iter = j.iter;
        return o;
      }) });
  }
  // XFOIL-Ergebnis → Polaren-Objekt wie foil2d/NeuralFoil {Re, type, pts, clmax}
  function xfoilPolarOf(r) {
    if (!r || !Array.isArray(r.pts) || r.pts.length < 3) return null;
    let clmax = -Infinity, alphaMax = NaN;
    const pts = r.pts.map(q => {
      if (q.cl > clmax) { clmax = q.cl; alphaMax = q.alpha; }
      return { alpha: q.alpha, Re: r.type === 2 && q.cl > 0 ? r.Re / Math.sqrt(q.cl) : r.Re,
        cl: q.cl, cd: q.cd, cm: q.cm, xtrU: q.xtrU, xtrL: q.xtrL };
    });
    return { Re: r.Re, type: r.type, pts, clmax, alphaMax };
  }
  function xfoilSync(jobs) {
    try {
      const x = new XMLHttpRequest();
      x.open('POST', '/__xfoil__', false);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(xfoilBody(jobs));
      const j = JSON.parse(x.responseText);
      return j && j.ok ? j.results : null;
    } catch (e) { return null; }
  }
  async function xfoilAsync(jobs) {
    try {
      const r = await fetch('/__xfoil__', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: xfoilBody(jobs) });
      const j = await r.json();
      return j && j.ok ? j.results : null;
    } catch (e) { return null; }
  }

  // ---------- Diagramm mit frei wählbaren Achsen ---------------------------
  // Jede Diagramm-Familie liefert dafür ihre Rohzeilen (groups: je Kurve
  // name/color/dash/rows) und die verfügbaren Größen (vars: k/lab/f). Die
  // gewählte X/Y-Größe bleibt je Familie in cfg[key] = [x, y].
  function freeDef(id, key, vars, groups, defX, defY) {
    const st = Array.isArray(C(key)) ? C(key) : [];
    const d = { id, title: T('Achsen frei wählen'), free: { key, vars, groups,
      x: vars.some(v => v.k === st[0]) ? st[0] : defX, y: vars.some(v => v.k === st[1]) ? st[1] : defY } };
    buildFree(d); return d;
  }
  function buildFree(d) {
    const F = d.free, vx = F.vars.find(v => v.k === F.x) || F.vars[0], vy = F.vars.find(v => v.k === F.y) || F.vars[1] || F.vars[0];
    F.x = vx.k; F.y = vy.k;
    d.xlab = vx.lab; d.ylab = vy.lab;
    d.title = T('Frei') + ': ' + vy.lab + ' ' + T('über') + ' ' + vx.lab;
    d.series = F.groups.map(g => ({ name: g.name, color: g.color, dash: g.dash, mark: g.mark,
      pts: g.rows.map(r => [vx.f(r), vy.f(r)]).filter(p => isFinite(p[0]) && isFinite(p[1])) }));
    d.series.forEach(s0 => { if (s0.name && chartHide.has(d.id + '|' + s0.name)) s0.hidden = true; });
    return d;
  }
  // X-/Y-Auswahllisten für ein freies Diagramm; onChange nach Neuaufbau
  function axisPicker(d, onChange, small) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:' + (small ? '11px' : '12.5px');
    const mk = (lbl, ax) => {
      const l = document.createElement('span'); l.textContent = lbl; l.style.opacity = '.7';
      const s0 = document.createElement('select');
      s0.style.cssText = 'padding:' + (small ? '2px 6px' : '3px 8px') + ';border-radius:6px;border:1px solid rgba(128,128,128,.45);'
        + 'background:var(--field,#0c0f13);color:var(--txt,#e6e6e6);cursor:pointer;font-size:inherit';
      d.free.vars.forEach(v => { const o = document.createElement('option'); o.value = v.k; o.textContent = v.lab; s0.appendChild(o); });
      s0.value = d.free[ax];
      s0.onchange = () => { d.free[ax] = s0.value; S(d.free.key, [d.free.x, d.free.y]); buildFree(d); onChange(d); };
      row.appendChild(l); row.appendChild(s0);
    };
    mk('X:', 'x'); mk('Y:', 'y');
    return row;
  }

  // Einfaches XY-Liniendiagramm auf einem Canvas: series = [{name,color,pts:[[x,y]],dash}]
  // series = [{name,color,pts:[[x,y]…],dash}]. opts: xr/yr = fester Bereich
  // (Zoom), grid = Gitter mit Achsenwerten (Vollbild). Rückgabe: Abbildung
  // Pixel<->Daten für Zoom/Fadenkreuz der Großansicht.
  function chartRange(series) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    series.forEach(s => !s.hidden && s.pts.concat(s.pts2 || []).forEach(p => {
      if (!isFinite(p[0]) || !isFinite(p[1])) return;
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }));
    if (!isFinite(x0) || !isFinite(y0)) return null;
    if (x1 - x0 < 1e-9) { x0 -= 1; x1 += 1; }
    if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
    y0 = Math.min(y0, 0); y1 = Math.max(y1, 0);
    return { x0, x1, y0, y1 };
  }
  function niceStep(span, n) {                     // 1-2-5-Raster
    const raw = span / Math.max(2, n), p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  function drawChart(canvas, title, xlab, ylab, series, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 320, H = canvas.clientHeight || 220;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const txt = cssVar('--txt', '#ccc');
    g.clearRect(0, 0, W, H);
    const auto = chartRange(series); if (!auto) return null;
    const x0 = opts.xr ? opts.xr[0] : auto.x0, x1 = opts.xr ? opts.xr[1] : auto.x1;
    const y0 = opts.yr ? opts.yr[0] : auto.y0, y1 = opts.yr ? opts.yr[1] : auto.y1;
    const mL = opts.grid ? 58 : 44, mR = opts.grid ? 14 : 8, mT = opts.grid ? 26 : 20, mB = opts.grid ? 34 : 26;
    const X = x => mL + (x - x0) / (x1 - x0) * (W - mL - mR);
    const Y = y => H - mB - (y - y0) / (y1 - y0) * (H - mT - mB);
    // Gitter (Vollbild) bzw. nur Rahmen + Nulllinien
    g.strokeStyle = txt; g.globalAlpha = 0.35; g.lineWidth = 1;
    g.strokeRect(mL, mT, W - mL - mR, H - mT - mB);
    g.font = '10px system-ui'; g.fillStyle = txt;
    if (opts.grid) {
      const sx = niceStep(x1 - x0, (W - mL - mR) / 70), sy = niceStep(y1 - y0, (H - mT - mB) / 45);
      g.globalAlpha = 0.13;
      for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) { g.beginPath(); g.moveTo(X(x), mT); g.lineTo(X(x), H - mB); g.stroke(); }
      for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) { g.beginPath(); g.moveTo(mL, Y(y)); g.lineTo(W - mR, Y(y)); g.stroke(); }
      g.globalAlpha = 0.75;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) g.fillText(fmt(x), X(x), H - mB + 4);
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) g.fillText(fmt(y), mL - 5, Y(y));
    }
    g.globalAlpha = 0.25;
    if (y0 < 0 && y1 > 0) { g.beginPath(); g.moveTo(mL, Y(0)); g.lineTo(W - mR, Y(0)); g.stroke(); }
    if (x0 < 0 && x1 > 0) { g.beginPath(); g.moveTo(X(0), mT); g.lineTo(X(0), H - mB); g.stroke(); }
    g.globalAlpha = 1;
    g.fillStyle = txt; g.font = '11px system-ui';
    g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(title, 4, 3);
    g.textAlign = 'center'; g.fillText(xlab, mL + (W - mL - mR) / 2, H - 14);
    g.save(); g.translate(10, mT + (H - mT - mB) / 2); g.rotate(-Math.PI / 2);
    g.textBaseline = 'middle'; g.fillText(ylab, 0, 0); g.restore();
    if (!opts.grid) {                              // kleine Ansicht: nur Eckwerte
      g.textAlign = 'center'; g.textBaseline = 'top'; g.globalAlpha = 0.7; g.font = '10px system-ui';
      [x0, x1].forEach(x => g.fillText(fmt(x), X(x), H - mB + 3));
      g.textAlign = 'right'; g.textBaseline = 'middle';
      [y0, y1].forEach(y => g.fillText(fmt(y), mL - 3, Y(y)));
      g.globalAlpha = 1;
    }
    // Kurven (auf den Zeichenbereich beschnitten - wichtig beim Zoomen)
    g.save(); g.beginPath(); g.rect(mL, mT, W - mL - mR, H - mT - mB); g.clip();
    series.forEach(s => {
      if (s.hidden) return;
      g.strokeStyle = s.color; g.lineWidth = 1.6;
      if (s.band && s.pts2) {                        // Flaeche zwischen zwei Kurven
        const up = s.pts.filter(p => isFinite(p[0]) && isFinite(p[1]));
        const dn = s.pts2.filter(p => isFinite(p[0]) && isFinite(p[1]));
        if (up.length > 1 && dn.length > 1) {
          g.fillStyle = s.color; g.globalAlpha = s.alpha || 0.14;
          g.beginPath();
          up.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])));
          for (let i = dn.length - 1; i >= 0; i--) g.lineTo(X(dn[i][0]), Y(dn[i][1]));
          g.closePath(); g.fill(); g.globalAlpha = 1;
        }
        return;
      }
      if (s.mark) {                                  // Einzelpunkte (Trimmpunkt): Ring + Punkt
        s.pts.forEach(p => {
          if (!isFinite(p[0]) || !isFinite(p[1])) return;
          const px = X(p[0]), py = Y(p[1]);
          g.fillStyle = s.color; g.beginPath(); g.arc(px, py, 3.2, 0, 2 * Math.PI); g.fill();
          g.lineWidth = 1.4; g.beginPath(); g.arc(px, py, 6.5, 0, 2 * Math.PI); g.stroke();
        });
        return;
      }
      g.setLineDash(s.dash === 'dot' ? [2, 3] : s.dash ? [5, 4] : []);
      g.beginPath();
      let started = false;
      s.pts.forEach(p => {
        if (!isFinite(p[0]) || !isFinite(p[1])) return;
        started ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])); started = true;
      });
      g.stroke(); g.setLineDash([]);
    });
    g.restore();
    // Legende (mehrzeilig; Einträge sind in der Großansicht klickbar =
    // Kurve ein-/ausschalten — ausgeblendete werden gedimmt gezeichnet)
    const legend = [];
    let lx = mL + 6, ly = mT + 8;
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '10px system-ui';
    series.forEach((s, si) => {
      if (!s.name) return;
      const wTx = 26 + g.measureText(s.name).width + 8;
      if (lx + wTx > W - mR && lx > mL + 6) { lx = mL + 6; ly += 13; }
      g.globalAlpha = s.hidden ? 0.3 : 1;
      g.strokeStyle = s.color; g.setLineDash(s.dash === 'dot' ? [2, 3] : s.dash ? [5, 4] : []);
      if (s.band) {
        g.fillStyle = s.color; g.globalAlpha = (s.alpha || 0.14) * 3;
        g.fillRect(lx, ly - 4, 16, 8); g.globalAlpha = s.hidden ? 0.3 : 1;
        g.strokeRect(lx + 0.5, ly - 3.5, 15, 7);
      } else if (s.mark) {
        g.fillStyle = s.color; g.beginPath(); g.arc(lx + 8, ly, 2.6, 0, 2 * Math.PI); g.fill();
        g.lineWidth = 1.2; g.beginPath(); g.arc(lx + 8, ly, 5, 0, 2 * Math.PI); g.stroke();
      } else { g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 16, ly); g.stroke(); }
      g.setLineDash([]);
      g.fillStyle = txt; g.fillText(s.name, lx + 20, ly);
      g.globalAlpha = 1;
      legend.push({ x0: lx - 3, y0: ly - 7, x1: lx + wTx - 8, y1: ly + 7, i: si });
      lx += wTx;
    });
    return { W, H, mL, mR, mT, mB, x0, x1, y0, y1, legend };
  }
  function fmt(v) {
    const a = Math.abs(v);
    return a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
  }

  // Klick auf ein kleines Diagramm: Vollbild-Overlay über dem Reiter mit
  // Gitter + Achsenwerten, Zoom (Mausrad um den Zeiger), Verschieben (Ziehen),
  // Doppelklick = alles, Fadenkreuz mit Werten am Mauszeiger. Mit ◀ ▶ (auch
  // Pfeiltasten) blättert man durch den ganzen Diagramm-Katalog.
  function openChart(specs, idx) {
    // foilHost nur, solange die Polaren-Ansicht dort wirklich noch offen UND
    // sichtbar ist — sonst (Ansicht in einem anderen, gerade verdeckten Reiter
    // wie „Profildatenbank“ offen gelassen, oder ohne ✕ verschwunden) landete
    // die Großansicht in einem unsichtbaren Knoten und „Vergrößern“ tat nichts.
    const fo = document.getElementById('aeroFoilOv');
    const foVisible = fo && foilHost && foilHost.contains(fo) && fo.getClientRects().length > 0;
    const view = (foVisible ? foilHost : null) || document.getElementById('aeroView'); if (!view) return;
    const old = document.getElementById('aeroChartOv'); if (old) old.remove();
    let specsCur = specs;
    let ci = Math.max(0, Math.min(idx || 0, specsCur.length - 1));
    const spec = () => specsCur[ci];
    const ov = document.createElement('div'); ov.id = 'aeroChartOv';
    ov.style.cssText = 'position:absolute;inset:0;z-index:30;background:var(--bg2,rgba(8,10,14,.97));display:flex;flex-direction:column';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 10px;font-size:13px';
    const mkNav = (lbl, d) => { const b = document.createElement('button'); b.textContent = lbl;
      b.title = T('Diagramm wechseln (auch Pfeiltasten)'); b.onclick = () => nav(d); return b; };
    const bPrev = mkNav('◀', -1), bNext = mkNav('▶', 1);
    // Auswahlliste statt starrem Titel: Diagramm direkt wählbar (zusätzlich
    // zu ◀ ▶ / Pfeiltasten).
    const ttl = document.createElement('select');
    ttl.title = T('Diagramm wählen');
    ttl.style.cssText = 'font-weight:600;max-width:46ch;padding:4px 10px;border-radius:8px;'
      + 'border:1px solid rgba(128,128,128,.45);background:var(--field,#0c0f13);color:var(--txt,#e6e6e6);cursor:pointer';
    const fillTtl = () => {
      ttl.innerHTML = '';
      specsCur.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = s.title; ttl.appendChild(o); });
    };
    fillTtl();
    ttl.onchange = () => setCi(+ttl.value);
    // Kurven-Menü: einzelne Kurven (z. B. Re-Stufen) per Häkchen ein/aus
    const bCur = document.createElement('button'); bCur.textContent = T('Kurven') + ' ▾';
    bCur.title = T('Einzelne Kurven ein-/ausblenden (auch per Klick auf die Legende)');
    const menu = document.createElement('div');
    menu.style.cssText = 'position:absolute;top:36px;left:0;z-index:5;display:none;max-height:70%;overflow:auto;'
      + 'background:var(--ovl,rgba(18,22,28,.98));border:1px solid rgba(128,128,128,.45);border-radius:8px;'
      + 'padding:8px 12px;font-size:12.5px;box-shadow:0 8px 28px rgba(0,0,0,.55)';
    const toggleSeries = (s, show) => {
      const ser = spec().series;
      if (!show && ser.filter(x => !x.hidden).length <= 1 && !s.hidden) return false;  // letzte bleibt an
      s.hidden = !show;
      const key = spec().id + '|' + s.name;
      if (s.hidden) chartHide.add(key); else chartHide.delete(key);
      auto = chartRange(ser);
      if (auto) rng = Object.assign({}, auto);
      redraw();
      return true;
    };
    const buildMenu = () => {
      menu.innerHTML = '';
      spec().series.forEach(s => {
        if (!s.name) return;
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;white-space:nowrap';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !s.hidden;
        cb.onchange = () => { if (!toggleSeries(s, cb.checked)) cb.checked = true; };
        const sw = document.createElement('span');
        sw.style.cssText = 'display:inline-block;width:20px;height:0;border-top:2.5px '
          + (s.dash === 'dot' ? 'dotted ' : s.dash ? 'dashed ' : 'solid ') + (s.color || '#888');
        const tx = document.createElement('span'); tx.textContent = s.name;
        row.appendChild(cb); row.appendChild(sw); row.appendChild(tx);
        menu.appendChild(row);
      });
    };
    bCur.onclick = () => {
      if (menu.style.display === 'none') { buildMenu(); menu.style.left = bCur.offsetLeft + 'px'; menu.style.display = 'block'; }
      else menu.style.display = 'none';
    };
    const pos = document.createElement('span'); pos.className = 'hint';
    const hnt = document.createElement('span'); hnt.className = 'hint'; hnt.style.flex = '1';
    hnt.textContent = T('Ziehen = Achse strecken/stauchen (waagerecht X, senkrecht Y) · Shift- oder Rechts-Ziehen = verschieben · Rad = Zoom · Doppelklick = alles · Legende/„Kurven" = ein/aus');
    const btn = document.createElement('button'); btn.textContent = '✕ ' + T('Schließen');
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); ovRefresh = null; };
    btn.onclick = close;
    const axHost = document.createElement('span');
    const syncAx = () => { axHost.innerHTML = ''; const d = spec(); if (d && d.free) axHost.appendChild(axisPicker(d, () => {
      fillTtl(); auto = chartRange(d.series); rng = Object.assign({}, auto || {}); cur = null; syncHead(); redraw(); })); };
    bar.appendChild(bPrev); bar.appendChild(bNext); bar.appendChild(ttl); bar.appendChild(axHost); bar.appendChild(bCur); bar.appendChild(pos);
    bar.appendChild(hnt); bar.appendChild(btn);
    const host = document.createElement('div'); host.style.cssText = 'flex:1;position:relative';
    const c = document.createElement('canvas'); c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    host.appendChild(c); ov.appendChild(bar); ov.appendChild(menu); ov.appendChild(host); view.appendChild(ov);
    const onKey = e => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') nav(-1);
      else if (e.key === 'ArrowRight') nav(1);
    };
    document.addEventListener('keydown', onKey);
    let auto = chartRange(spec().series);
    let rng = Object.assign({}, auto || {}), map = null, cur = null;
    const setCi = i => {
      ci = ((i % specsCur.length) + specsCur.length) % specsCur.length;
      auto = chartRange(spec().series);
      rng = Object.assign({}, auto || {}); cur = null;
      menu.style.display = 'none';
      syncHead(); redraw();
    };
    const nav = d => setCi(ci + d);
    const syncHead = () => { ttl.value = ci; pos.textContent = (ci + 1) + '/' + specsCur.length; syncAx(); };
    syncHead();
    if (!auto) return;
    const pxX = mx => rng.x0 + (mx - map.mL) / (map.W - map.mL - map.mR) * (rng.x1 - rng.x0);
    const pxY = my => rng.y0 + (map.H - map.mB - my) / (map.H - map.mT - map.mB) * (rng.y1 - rng.y0);
    const redraw = () => {
      if (!auto) { const g = c.getContext('2d'); g && g.clearRect(0, 0, c.width, c.height); map = null; return; }
      map = drawChart(c, '', spec().xlab, spec().ylab, spec().series, { grid: true, xr: [rng.x0, rng.x1], yr: [rng.y0, rng.y1] });
      if (!map || !cur) return;
      // Fadenkreuz + Werte am Mauszeiger
      if (cur.mx < map.mL || cur.mx > map.W - map.mR || cur.my < map.mT || cur.my > map.H - map.mB) return;
      const g = c.getContext('2d');
      const txt = cssVar('--txt', '#ccc');
      g.strokeStyle = txt; g.globalAlpha = 0.4; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(cur.mx, map.mT); g.lineTo(cur.mx, map.H - map.mB); g.stroke();
      g.beginPath(); g.moveTo(map.mL, cur.my); g.lineTo(map.W - map.mR, cur.my); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
      const lbl = fmt(pxX(cur.mx)) + ' / ' + fmt(pxY(cur.my));
      g.font = '12px system-ui';
      const w = g.measureText(lbl).width + 10;
      const bx = Math.min(cur.mx + 12, map.W - map.mR - w), by = Math.max(cur.my - 24, map.mT + 2);
      g.fillStyle = 'rgba(20,24,30,.9)'; g.fillRect(bx, by, w, 18);
      g.strokeStyle = txt; g.globalAlpha = 0.35; g.strokeRect(bx, by, w, 18); g.globalAlpha = 1;
      g.fillStyle = txt; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(lbl, bx + 5, by + 9);
    };
    // Live-Update: nach jeder neuen Analyse zieht renderResults() die offene
    // Großansicht mit den frischen Daten nach — Zoom bleibt erhalten, wenn es
    // dasselbe Diagramm noch gibt.
    ovRefresh = newSpecs => {
      const id = spec() && spec().id;
      specsCur = newSpecs;
      const ni = specsCur.findIndex(d => d.id === id);
      const same = ni >= 0;
      ci = same ? ni : Math.max(0, Math.min(ci, specsCur.length - 1));
      fillTtl();
      auto = chartRange(spec().series);
      if (!same || !rng || !isFinite(rng.x0)) rng = Object.assign({}, auto || {});
      menu.style.display = 'none';
      syncHead(); redraw();
    };
    c.onwheel = e => {
      e.preventDefault(); if (!map) return;
      const r = c.getBoundingClientRect();
      const fx = pxX(e.clientX - r.left), fy = pxY(e.clientY - r.top);
      const f = e.deltaY < 0 ? 0.8 : 1.25;
      rng = { x0: fx + (rng.x0 - fx) * f, x1: fx + (rng.x1 - fx) * f,
              y0: fy + (rng.y0 - fy) * f, y1: fy + (rng.y1 - fy) * f };
      redraw();
    };
    let drag = null, clickMoved = false;
    c.oncontextmenu = e => e.preventDefault();       // Rechts-Ziehen = verschieben
    c.onmousedown = e => {
      const r = c.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, r: Object.assign({}, rng), moved: false,
        pan: e.shiftKey || e.button === 2,
        fx: map ? pxX(e.clientX - r.left) : 0, fy: map ? pxY(e.clientY - r.top) : 0 };
    };
    c.onmousemove = e => {
      const r = c.getBoundingClientRect();
      cur = { mx: e.clientX - r.left, my: e.clientY - r.top };
      if (drag && map) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
        if (drag.pan) {
          // Shift-/Rechts-Ziehen: verschieben
          const sx = (drag.r.x1 - drag.r.x0) / (map.W - map.mL - map.mR);
          const sy = (drag.r.y1 - drag.r.y0) / (map.H - map.mT - map.mB);
          const dx = (e.clientX - drag.x) * sx, dy = (e.clientY - drag.y) * sy;
          rng = { x0: drag.r.x0 - dx, x1: drag.r.x1 - dx, y0: drag.r.y0 + dy, y1: drag.r.y1 + dy };
        } else {
          // Ziehen streckt/staucht die Achsen um den Startpunkt:
          // nach rechts = X strecken, nach oben = Y strecken
          const fx = Math.exp((e.clientX - drag.x) / 180);
          const fy = Math.exp(-(e.clientY - drag.y) / 180);
          rng = { x0: drag.fx + (drag.r.x0 - drag.fx) / fx, x1: drag.fx + (drag.r.x1 - drag.fx) / fx,
                  y0: drag.fy + (drag.r.y0 - drag.fy) / fy, y1: drag.fy + (drag.r.y1 - drag.fy) / fy };
        }
      }
      redraw();
    };
    c.onmouseup = () => { clickMoved = !!(drag && drag.moved); drag = null; };
    // Klick auf einen Legendeneintrag: Kurve ein-/ausschalten (die letzte
    // sichtbare bleibt an), Achsen an die sichtbaren Kurven anpassen.
    c.onclick = e => {
      if (clickMoved || !map || !map.legend) return;
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const hit = map.legend.find(b => mx >= b.x0 && mx <= b.x1 && my >= b.y0 && my <= b.y1);
      if (!hit) return;
      const s = spec().series[hit.i];
      toggleSeries(s, !!s.hidden);
    };
    c.onmouseleave = () => { drag = null; cur = null; redraw(); };
    c.ondblclick = () => { rng = Object.assign({}, auto); redraw(); };
    // erst zeichnen, wenn das Overlay Layout-Maße hat
    let tries = 0;
    const first = () => { if (!c.getBoundingClientRect().width && ++tries < 20) { setTimeout(first, 40); return; } redraw(); };
    first();
  }

  // Eigenes Fenster wie die Profil-Umströmung: Profile der Tragflächen über
  // eine Re-Schar rechnen und die üblichen Diagramme zeigen (cl(α), cd(α),
  // Polare, Gleitzahl, cm, Umschlag) — Typ 1 = feste Re, Typ 2 = Re·√cl
  // konstant (Fahrt aus dem Kräftegleichgewicht bei fester Masse).
  const foilFull = new Map();
  const foilReStr = () => (C('aeroFoilRe') && String(C('aeroFoilRe')).trim()) || '50k 100k 200k 400k';
  function parseReList(str) {
    const out = [];
    // „50 k" (Leerzeichen vor k/M) zuerst zusammenziehen, sonst trennt split es
    String(str || '').replace(/(\d)\s+([kKmM])(?![a-zA-Z])/g, '$1$2').split(/[,;\s]+/).forEach(t => {
      const v = parseRe(t);
      if (v >= 1e4 && v <= 5e7) out.push(v);
    });
    return [...new Set(out)].sort((a, b) => a - b);
  }
  function foilModelFor(P, calc) {
    if (calc === 'nf' && window.NeuralFoil && NeuralFoil.ready()) {
      let m = nfModels.get(P.key); if (m === undefined) { m = NeuralFoil.build(P.prof); nfModels.set(P.key, m); }
      if (m) return { m, src: 'nf' };
    }
    return null;
  }
  function foilPolarFull(P, Re, type, ncrit, calc, a0, a1, da) {
    const ck = [calc, P.key, Re, type, ncrit, a0, a1, da].join('@');
    if (foilFull.has(ck)) return foilFull.get(ck);
    if (calc === 'xfoil' && xfoilReady()) {      // echtes XFOIL rechnet die ganze Polare (auch Typ 2) selbst
      const r = xfoilSync([{ prof: P.prof, name: P.name, Re, type, ncrit, a0, a1, da }]);
      const X = r && r[0] ? xfoilPolarOf(r[0]) : null;
      if (X) { const out = Object.assign(X, { src: 'xfoil' }); foilFull.set(ck, out); return out; }
    }
    const M = foilModelFor(P, calc === 'xfoil' ? 'nf' : calc); if (!M) { foilFull.set(ck, null); return null; }
    const pts = []; let clmax = -Infinity, drop = 0, fails = 0;
    for (let a = a0; a <= a1 + 1e-9; a += da) {
      let ReA = Re, r = null;
      for (let it = 0; it < (type === 2 ? 5 : 1); it++) {
        try { r = M.m.run(a, ReA, { ncrit }); } catch (e) { r = null; }
        if (!r || !isFinite(r.cl) || (r.conf !== undefined && r.conf < 0.6)) { r = null; break; }
        if (type !== 2) break;
        if (r.cl < 0.05) { r = 'skip'; break; }           // Typ 2 unterhalb cl ≈ 0: keine Fahrt definiert
        const ReN = Re / Math.sqrt(r.cl);
        if (Math.abs(ReN - ReA) < 0.004 * ReA) break;
        ReA = ReN;
      }
      if (r === 'skip') continue;
      if (!r) { if (a > 2 && clmax > 0.3 && ++fails >= 3) break; continue; }
      fails = 0;
      pts.push({ alpha: +a.toFixed(4), Re: ReA, cl: r.cl, cd: r.cd, cm: r.cm, xtrU: r.xtrU, xtrL: r.xtrL });
      if (r.cl > clmax) { clmax = r.cl; drop = 0; }
      else if (a > 2 && r.cl < clmax - 0.02 && ++drop >= 4) break;
    }
    const out = pts.length > 2 ? { Re, type, pts, clmax, src: M.src } : null;
    foilFull.set(ck, out);
    return out;
  }
  // opts (optional, z. B. Reiter „Profildatenbank“): { host: Element, profs: [{key, prof, name}] }
  // — dann liegt die Ansicht über diesem Element und rechnet genau diese Profile.
  let foilHost = null;      // Host der offenen Polaren-Ansicht (auch für die Großansicht)
  function openFoilView(opts) {
    const ext = !!(opts && opts.host);
    const view = ext ? opts.host : document.getElementById('aeroView'); if (!view) return;
    if (!window.NeuralFoil && !xfoilReady()) { if (App.toast) App.toast(T('Kein Polaren-Rechner verfügbar (NeuralFoil/XFOIL).')); return; }
    const profs = ext ? opts.profs.map(p => ({ key: foilHash(p.prof), prof: p.prof, name: p.name, wing: p.wing || '' })).filter(p => p.key) : H.allProfiles();
    if (!profs.length) { if (ext) return; H.loadExtraFoils(n => { if (n) { S('aeroFoilProf', '0'); openFoilView(); } }); return; }
    foilHost = view;
    // extern: opts.rows = Indizes der vorgewählten Profile (erstes = Hauptreihe,
    // weitere = je eine Zusatzreihe); ohne Angabe nur das erste Profil.
    const extRows = ext && Array.isArray(opts.rows) && opts.rows.length ? opts.rows.filter(i => profs[i]) : (ext ? [0] : null);
    if (ext) S('aeroFoilProf', String(extRows[0] || 0));
    ['aeroFoilOv', 'aeroFlowOv', 'aeroChartOv'].forEach(id => { const o = document.getElementById(id); if (o) o.remove(); });
    const st = { pi: C('aeroFoilProf') === 'all' ? 'all' : String(Math.max(0, Math.min(profs.length - 1, +C('aeroFoilProf') || 0))),
      type: +C('aeroFoilType') === 2 ? 2 : 1 };
    const ov = document.createElement('div'); ov.id = 'aeroFoilOv';
    ov.style.cssText = 'position:absolute;inset:0;z-index:29;background:var(--bg2,#080a0e);display:flex;flex-direction:column;color:var(--txt,#e6e6e6)';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 10px;font-size:13px';
    const selCss = 'padding:4px 8px;border-radius:8px;border:1px solid rgba(128,128,128,.45);background:var(--field,#0c0f13);color:var(--txt,#e6e6e6)';
    const mkSel = (opts, val, on) => { const s = document.createElement('select'); s.style.cssText = selCss;
      opts.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; s.appendChild(o); });
      s.value = val; s.onchange = () => on(s.value); return s; };
    const lbl = t => { const e = document.createElement('span'); e.textContent = t; e.style.opacity = '.75'; return e; };
    const pOpts = profs.map((p, i) => [String(i), p.name + (p.wing ? '  (' + p.wing + ')' : '')]);
    if (profs.length > 1) pOpts.push(['all', T('alle Profile')]);
    const sProf = mkSel(pOpts, st.pi, v => { st.pi = v; S('aeroFoilProf', v); compute(); });
    const bLd = document.createElement('button'); bLd.textContent = T('Profil laden…');
    bLd.title = T('Weitere Profile (.dat/.bez) aus Dateien laden — nur für diese Sitzung');
    bLd.onclick = () => H.loadExtraFoils(n => { if (n) { S('aeroFoilProf', String(H.allProfiles().length - 1)); openFoilView(); } });
    const bDrop = document.createElement('button'); bDrop.textContent = '✕'; bDrop.title = T('Geladene Profile verwerfen');
    bDrop.style.display = H.extraFoils.length ? '' : 'none';
    bDrop.onclick = () => { H.extraFoils.length = 0; S('aeroFoilProf', '0');
      const el = document.getElementById('aeroExtraInfo'); if (el) el.textContent = H.extraSummary();
      if (H.allProfiles().length) openFoilView(); else close(); };
    const reIn = document.createElement('input'); reIn.type = 'text'; reIn.value = foilReStr();
    reIn.style.cssText = selCss + ';width:200px'; reIn.title = T('Liste, durch Komma oder Leerzeichen getrennt; k = Tausend, M = Million (z. B. 50k 100k 200k 400k)');
    reIn.onchange = () => { S('aeroFoilRe', reIn.value); compute(); };
    const sType = mkSel([['1', T('Typ 1 — feste Re')], ['2', T('Typ 2 — Re·√cl = konst.')]], String(st.type),
      v => { st.type = +v; S('aeroFoilType', st.type); compute(); });
    const ncIn = document.createElement('input'); ncIn.type = 'number'; ncIn.step = 1; ncIn.min = 3; ncIn.max = 13;
    ncIn.value = num('aeroNcrit') > 0 ? num('aeroNcrit') : 9; ncIn.style.cssText = selCss + ';width:56px'; ncIn.title = 'Ncrit';
    ncIn.onchange = () => { S('aeroNcrit', Math.max(3, Math.min(13, +ncIn.value || 9))); compute(); };
    const bar2 = [];
    if (window.NeuralFoil || xfoilReady()) bar2.push(mkSel(calcOpts(), calcUi(C('aeroCalc')),
      v => { S('aeroCalc', v); compute(); }));
    const bRun = document.createElement('button'); bRun.textContent = T('▶ Rechnen'); bRun.className = 'primary'; bRun.style.fontWeight = '700';
    bRun.onclick = () => { foilFull.clear(); compute(); };
    const bCsv = document.createElement('button'); bCsv.textContent = 'CSV'; bCsv.title = T('Polaren als CSV speichern');
    const bX = document.createElement('button'); bX.textContent = '✕'; bX.title = T('Schließen (Esc)'); bX.style.marginLeft = 'auto';
    const bAdd = document.createElement('button'); bAdd.textContent = '+'; bAdd.title = T('Weitere Reihe: anderes Profil / andere Re-Zahlen / Typ / Ncrit / Rechner zum Vergleich dazulegen');
    // Vergleich: jede Kurve zusätzlich mit der ANDEREN Methode (gestrichelt, gleiche Farbe)
    const cmpL = document.createElement('label'); cmpL.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer';
    cmpL.title = T('Jede Kurve zusätzlich mit der anderen Methode rechnen (NeuralFoil ↔ XFOIL) — gestrichelt in derselben Farbe, Kennwerte beider in der Tabelle');
    { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = C('aeroFoilCmp') === true;
      cb.onchange = () => { S('aeroFoilCmp', cb.checked); compute(); };
      cmpL.appendChild(cb); cmpL.appendChild(document.createTextNode(T('Vergleich NeuralFoil ↔ XFOIL'))); }
    [lbl(T('Profil')), sProf, bLd, bDrop, lbl('Re'), reIn, sType, lbl('Ncrit'), ncIn, ...bar2, cmpL, bRun, bCsv, bAdd, bX].forEach(e => bar.appendChild(e));
    // Zusatzreihen: jede Reihe ist ein eigener Satz Profil/Re/Typ/Ncrit/Rechner —
    // alle Reihen landen gemeinsam in den Diagrammen (Vergleich verschiedener
    // Profile bei verschiedenen Re-Zahlen). „+“ legt eine Reihe an, „✕“ entfernt sie.
    const rowsBox = document.createElement('div'); rowsBox.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:0 10px 4px';
    const extra = [];
    function addRow() {
      const ex = { pi: st.pi === 'all' ? '0' : st.pi, re: reIn.value, type: st.type, ncrit: +ncIn.value || 9, calc: calcUi(C('aeroCalc')) };
      const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px';
      const sP = mkSel(pOpts, ex.pi, v => { ex.pi = v; compute(); });
      const rI = document.createElement('input'); rI.type = 'text'; rI.value = ex.re; rI.style.cssText = selCss + ';width:200px'; rI.title = reIn.title;
      rI.onchange = () => { ex.re = rI.value; compute(); };
      const sT = mkSel([['1', T('Typ 1 — feste Re')], ['2', T('Typ 2 — Re·√cl = konst.')]], String(ex.type), v => { ex.type = +v; compute(); });
      const nI = document.createElement('input'); nI.type = 'number'; nI.step = 1; nI.min = 3; nI.max = 13; nI.value = ex.ncrit; nI.style.cssText = selCss + ';width:56px'; nI.title = 'Ncrit';
      nI.onchange = () => { ex.ncrit = Math.max(3, Math.min(13, +nI.value || 9)); compute(); };
      const parts = [lbl(T('Profil')), sP, lbl('Re'), rI, sT, lbl('Ncrit'), nI];
      if (window.NeuralFoil || xfoilReady()) parts.push(mkSel(calcOpts(), ex.calc, v => { ex.calc = v; compute(); }));
      const bDel = document.createElement('button'); bDel.textContent = '✕'; bDel.title = T('Diese Reihe entfernen');
      bDel.onclick = () => { const i = extra.indexOf(ex); if (i >= 0) extra.splice(i, 1); row.remove(); compute(); };
      parts.push(bDel);
      parts.forEach(e => row.appendChild(e));
      ex.el = row; extra.push(ex); rowsBox.appendChild(row);
    }
    bAdd.onclick = () => { addRow(); compute(); };
    if (extRows) extRows.slice(1).forEach(i => { addRow(); extra[extra.length - 1].pi = String(i); extra[extra.length - 1].el.querySelector('select').value = String(i); });
    const info = document.createElement('div'); info.style.cssText = 'padding:0 12px 4px;font-size:12.5px;opacity:.9';
    const host = document.createElement('div');
    host.style.cssText = 'flex:1;overflow:auto;padding:4px 10px 10px';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px';
    const tbl = document.createElement('div'); tbl.style.cssText = 'margin-top:12px;font-size:12.5px;overflow-x:auto';
    host.appendChild(grid); host.appendChild(tbl);
    ov.appendChild(bar); ov.appendChild(rowsBox); ov.appendChild(info); ov.appendChild(host); view.appendChild(ov);
    const onKey = e => {
      if (!document.getElementById('aeroFoilOv')) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape' && !document.getElementById('aeroChartOv')) close();
    };
    const close = () => { ov.remove(); foilHost = null; document.removeEventListener('keydown', onKey); window.removeEventListener('resize', drawAll); };
    if (ext) { bLd.style.display = 'none'; bDrop.style.display = 'none'; }
    bX.onclick = close;
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', drawAll);
    let runId = 0, res = [], defs = [], slots = [];
    const clr = i => PART_COLORS[i % PART_COLORS.length];
    const gz = p => (isFinite(p.cd) && p.cd > 0) ? p.cl / p.cd : NaN;
    async function compute() {
      const id = ++runId;
      // Hauptreihe (Leiste oben, persistiert) + Zusatzreihen
      const rows = [{ pi: st.pi, re: reIn.value, type: st.type, ncrit: num('aeroNcrit') > 0 ? num('aeroNcrit') : 9, calc: calcUi(C('aeroCalc')) }].concat(extra);
      const a0 = C('aeroFoilA0') != null ? num('aeroFoilA0') : -6, a1 = C('aeroFoilA1') != null ? num('aeroFoilA1') : 16;
      const da = num('aeroFoilDa') > 0 ? num('aeroFoilDa') : 0.5;
      const jobs = [];
      rows.forEach(rw => {
        const reL = parseReList(rw.re); if (!reL.length) return;
        const sel = rw.pi === 'all' ? profs : [profs[Math.min(+rw.pi, profs.length - 1)]];
        sel.forEach(P => reL.forEach(Re => jobs.push({ P, Re, type: rw.type, ncrit: rw.ncrit, calc: rw.calc })));
      });
      if (!jobs.length) { info.textContent = T('Keine gültige Re-Zahl (10 000 … 50 000 000).'); return; }
      // Vergleich: zu jedem Lauf ein Zwilling mit der anderen Methode (gleiche Farbe ci)
      const cmpOn = C('aeroFoilCmp') === true;
      { const base = jobs.splice(0);
        base.forEach((jb, k) => { jb.ci = k; jobs.push(jb);
          if (cmpOn) jobs.push(Object.assign({}, jb, { calc: jb.calc === 'xfoil' ? 'nf' : 'xfoil', cmp: true })); }); }
      // XFOIL-Läufe ALLER Reihen vorab asynchron in einem Aufruf (parallel auf den eingestellten Kernen)
      if (xfoilReady()) {
        const A0 = Math.min(a0, a1), A1 = Math.max(a0, a1), seen = new Set(), xl = [];
        jobs.filter(jb => jb.calc === 'xfoil').forEach(jb => {
          const ck = ['xfoil', jb.P.key, jb.Re, jb.type, jb.ncrit, A0, A1, da].join('@');
          if (foilFull.has(ck) || seen.has(ck)) return;
          seen.add(ck); xl.push({ ck, prof: jb.P.prof, name: jb.P.name, Re: jb.Re, type: jb.type, ncrit: jb.ncrit, a0: A0, a1: A1, da });
        });
        if (xl.length) {
          const nc = Math.round(num('aeroXfCores') || 0);
          info.textContent = T('XFOIL rechnet') + ' ' + xl.length + ' ' + T('Polare(n)') + ' · '
            + (nc > 0 ? nc + ' ' + T('Kerne') : T('alle Kerne')) + ' …';
          const r = await xfoilAsync(xl);
          if (id !== runId || !document.getElementById('aeroFoilOv')) return;
          xl.forEach((x, i) => { const X = r && r[i] ? xfoilPolarOf(r[i]) : null;
            if (X) foilFull.set(x.ck, Object.assign(X, { src: 'xfoil' })); });
        }
      }
      const out = [];
      for (let j = 0; j < jobs.length; j++) {
        info.textContent = T('Rechne') + ' ' + jobs[j].P.name + ' · Re ' + reName(jobs[j].Re) + ' (' + (j + 1) + '/' + jobs.length + ') …';
        await new Promise(r => setTimeout(r, 0));
        if (id !== runId || !document.getElementById('aeroFoilOv')) return;
        const jb = jobs[j];
        const pol = foilPolarFull(jb.P, jb.Re, jb.type, jb.ncrit, jb.calc, Math.min(a0, a1), Math.max(a0, a1), da);
        out.push({ P: jb.P, Re: jb.Re, type: jb.type, ncrit: jb.ncrit, pol, ci: jb.ci, cmp: !!jb.cmp, calc: jb.calc });
      }
      res = out;
      const ok = res.filter(r => r.pol);
      const src = cmpOn ? T('Vergleich NeuralFoil ↔ XFOIL (gestrichelt = Vergleichsmethode)') + (xfoilReady() ? '' : ' — ' + xfoilWhy())
        : ok.length && ok.every(r => r.pol.src === 'xfoil') ? 'XFOIL' : ok.length && ok.every(r => r.pol.src === 'nf') ? 'NeuralFoil' : T('gemischt');
      const types = new Set(res.map(r => r.type)), ncs = new Set(res.map(r => r.ncrit));
      info.textContent = (types.size > 1 ? T('Typ 1 und Typ 2 gemischt (Re-Angabe bei Typ 2 = Re bei cl = 1)') : types.has(2) ? T('Typ-2-Polaren (Re·√cl = konst., Re-Angabe = Re bei cl = 1)') : T('Typ-1-Polaren (feste Re-Zahl)'))
        + ' · Ncrit ' + [...ncs].join('/') + ' · ' + src + (ok.length < res.length ? ' · ' + T('nicht berechenbar:') + ' ' + res.filter(r => !r.pol).map(r => r.P.name + ' Re ' + reName(r.Re)).join(', ') : '');
      build();
    }
    function build() {
      const ok = res.filter(r => r.pol);
      const multi = new Set(res.map(r => r.P.key)).size > 1;
      const multiN = new Set(res.map(r => r.ncrit)).size > 1;
      const anyCmp = res.some(r => r.cmp);
      const srcName = r => r.pol && r.pol.src === 'xfoil' ? 'XFOIL' : 'NeuralFoil';
      const nm = r => (multi ? r.P.name + ' · ' : '') + 'Re ' + reName(r.Re) + (r.type === 2 ? '·√cl' : '') + (multiN ? ' N' + r.ncrit : '')
        + (anyCmp ? ' · ' + srcName(r) : '');
      const col = (r, i) => clr(r.ci != null ? r.ci : i);
      const ser = (fn, o) => ok.map((r, i) => Object.assign({ name: nm(r), color: col(r, i), dash: r.cmp || undefined,
        pts: r.pol.pts.map(fn).filter(p => isFinite(p[0]) && isFinite(p[1])) }, o || {}));
      defs = [];
      defs.push({ id: 'fa_cl', title: T('Auftrieb über Alpha'), xlab: 'α (°)', ylab: 'cl', series: ser(p => [p.alpha, p.cl]) });
      { const s = ser(p => [p.cd, p.cl]);
        // importierte XFOIL-Polaren gleichen Namens als gepunktete Vergleichskurven
        ok.forEach((r, i) => { const xg = H.xfGroupFor(r.P.name); if (!xg) return;
          xg.forEach(p => { if (Math.abs(p.Re - r.Re) < r.Re * 0.02) s.push({ name: 'XFOIL ' + (multi ? r.P.name + ' ' : '') + reName(p.Re), dash: 'dot', color: clr(i), pts: p.cl.map((c, j) => [p.cd[j], c]) }); }); });
        defs.push({ id: 'fa_polar', title: T('Polare cl über cd'), xlab: 'cd', ylab: 'cl', series: s }); }
      defs.push({ id: 'fa_gz', title: T('Gleitzahl über Alpha'), xlab: 'α (°)', ylab: 'cl/cd', series: ser(p => [p.alpha, gz(p)]) });
      defs.push({ id: 'fa_gzcl', title: T('Gleitzahl über cl'), xlab: 'cl', ylab: 'cl/cd', series: ser(p => [p.cl, gz(p)]) });
      defs.push({ id: 'fa_cd', title: T('Widerstand über Alpha'), xlab: 'α (°)', ylab: 'cd', series: ser(p => [p.alpha, p.cd]) });
      defs.push({ id: 'fa_cdcl', title: T('Widerstand über cl'), xlab: 'cl', ylab: 'cd', series: ser(p => [p.cl, p.cd]) });
      defs.push({ id: 'fa_cm', title: T('Moment über Alpha'), xlab: 'α (°)', ylab: 'cm', series: ser(p => [p.alpha, p.cm]) });
      const szOf = p => (p.cl > 0 && p.cd > 0) ? Math.pow(p.cl, 1.5) / p.cd : NaN;
      defs.push({ id: 'fa_sz', title: T('Steigzahl über Alpha'), xlab: 'α (°)', ylab: 'cl¹·⁵/cd', series: ser(p => [p.alpha, szOf(p)]) });
      defs.push({ id: 'fa_szcl', title: T('Steigzahl über cl'), xlab: 'cl', ylab: 'cl¹·⁵/cd', series: ser(p => [p.cl, szOf(p)]) });
      // Umschlag: x_tr/c waagerecht, Alpha senkrecht (wie in XFLR5)
      if (ok.some(r => r.pol.pts.some(p => isFinite(p.xtrU))))
        defs.push({ id: 'fa_xtr', title: T('Umschlag: Alpha über x_tr/c (voll = oben, gestrichelt = unten)'), xlab: 'x_tr/c', ylab: 'α (°)',
          series: ser(p => [p.xtrU, p.alpha]).concat(ser(p => [p.xtrL, p.alpha], { dash: true }).map(s => Object.assign(s, { name: s.name + ' ' + T('unten') }))) });
      if (ok.some(r => r.type === 2)) defs.push({ id: 'fa_re', title: T('Re-Zahl über cl (Typ 2)'), xlab: 'cl', ylab: 'Re', series: ser(p => [p.cl, p.Re]) });
      {
        const fv = [
          { k: 'alpha', lab: 'α (°)', f: p => p.alpha }, { k: 'cl', lab: 'cl', f: p => p.cl }, { k: 'cd', lab: 'cd', f: p => p.cd },
          { k: 'cm', lab: 'cm', f: p => p.cm }, { k: 'gz', lab: 'cl/cd', f: p => gz(p) }, { k: 'sz', lab: 'cl¹·⁵/cd', f: szOf },
          { k: 'xtrU', lab: 'x_tr/c ' + T('oben'), f: p => p.xtrU }, { k: 'xtrL', lab: 'x_tr/c ' + T('unten'), f: p => p.xtrL },
          { k: 'Re', lab: 'Re', f: p => p.Re }];
        defs.push(freeDef('fa_free', 'aeroFoilFreeXY', fv, ok.map((r, i) => ({ name: nm(r), color: col(r, i), dash: r.cmp || undefined, rows: r.pol.pts })), 'cl', 'gz'));
      }
      defs = defs.filter(d => d.series.some(s0 => s0.pts.length > 1));
      defs.forEach(d => d.series.forEach(s0 => { if (s0.name && chartHide.has(d.id + '|' + s0.name)) s0.hidden = true; }));
      grid.innerHTML = ''; slots = [];
      defs.forEach((d, i) => {
        const box = document.createElement('div');
        box.style.cssText = 'border:1px solid rgba(128,128,128,.3);border-radius:8px;background:rgba(128,128,128,.06);height:240px;position:relative;cursor:zoom-in';
        const c = document.createElement('canvas'); c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
        c.title = T('Klick = Großansicht (Zoom, Kurven schalten)');
        c.onclick = () => openChart(defs, i);
        box.appendChild(c); grid.appendChild(box); slots.push({ c, d });
        if (d.free) {
          const ax = axisPicker(d, () => drawAll(), true);
          ax.style.cssText += ';position:absolute;top:4px;right:6px;z-index:2;background:var(--ovl,rgba(8,10,14,.85));border-radius:6px;padding:2px 4px';
          ax.onclick = e => e.stopPropagation();
          box.appendChild(ax);
        }
      });
      // Kennwerte je Kurve
      const f = (v, n) => (v != null && isFinite(v)) ? (+v).toFixed(n) : '—';
      const rows = ok.map(r => {
        const pts = r.pol.pts;
        let best = null, cdm = null, mx = null;
        pts.forEach(p => { const g = gz(p); if (isFinite(g) && (!best || g > gz(best))) best = p;
          if (isFinite(p.cd) && (!cdm || p.cd < cdm.cd)) cdm = p; if (!mx || p.cl > mx.cl) mx = p; });
        let az = NaN; for (let i = 1; i < pts.length; i++) if (pts[i - 1].cl <= 0 && pts[i].cl > 0) { const t = -pts[i - 1].cl / (pts[i].cl - pts[i - 1].cl); az = pts[i - 1].alpha + t * (pts[i].alpha - pts[i - 1].alpha); break; }
        const p0 = pts.find(p => p.alpha >= 0) || pts[0];
        const td = v => '<td style="padding:2px 8px;text-align:right">' + v + '</td>';
        return '<tr><td style="padding:2px 8px">' + nm(r) + '</td>' + td(f(mx && mx.cl, 3)) + td(f(mx && mx.alpha, 1)) + td(f(az, 2))
          + td(f(cdm && cdm.cd, 4)) + td(f(cdm && cdm.cl, 2)) + td(f(best && gz(best), 1)) + td(f(best && best.alpha, 1)) + td(f(best && best.cl, 2))
          + td(f(p0 && p0.cm, 3)) + '</tr>';
      });
      const th = t => '<th style="padding:2px 8px;text-align:right;border-bottom:1px solid rgba(128,128,128,.4)">' + t + '</th>';
      tbl.innerHTML = rows.length ? '<table style="border-collapse:collapse"><thead><tr>' + th(T('Kurve')).replace('right', 'left') + th('cl max') + th('α(cl max)') + th('α₀ (cl = 0)') + th('cd min') + th('cl(cd min)') + th('(cl/cd) max') + th('α') + th('cl') + th('cm (α ≈ 0)') + '</tr></thead><tbody>'
        + rows.join('') + '</tbody></table>' : '';
      drawAll();
    }
    function drawAll() { slots.forEach(s0 => { if (s0.c.clientWidth) drawChart(s0.c, s0.d.title, s0.d.xlab, s0.d.ylab, s0.d.series); }); }
    bCsv.onclick = async () => {
      if (App.demoSaveBlocked && App.demoSaveBlocked('svAero')) return;
      const ok = res.filter(r => r.pol); if (!ok.length) return;
      const lines = ['profil;Re_ref;typ;alpha;Re;cl;cd;cm;cl_cd;xtr_oben;xtr_unten'];
      ok.forEach(r => r.pol.pts.forEach(p => lines.push([r.P.name, r.Re, r.type, p.alpha, Math.round(p.Re), p.cl.toFixed(4), isFinite(p.cd) ? p.cd.toFixed(5) : '', isFinite(p.cm) ? p.cm.toFixed(4) : '',
        isFinite(gz(p)) ? gz(p).toFixed(2) : '', isFinite(p.xtrU) ? p.xtrU.toFixed(3) : '', isFinite(p.xtrL) ? p.xtrL.toFixed(3) : ''].join(';'))));
      const text = '\ufeff' + lines.join('\r\n'), name = 'Profilpolaren.csv';
      try {
        if (window.showSaveFilePicker) {
          const opts = Object.assign({ suggestedName: name, types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }] },
            App.pickerOpts ? App.pickerOpts('svAero', '.csv') : {});
          const fh = await window.showSaveFilePicker(opts);
          if (App.markDirUsed) App.markDirUsed('svAero', '.csv');
          const w = await fh.createWritable(); await w.write(text); await w.close();
          if (App.toast) App.toast(T('Gespeichert: ') + fh.name);
          return;
        }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    compute();
  }

  xfoilProbe(() => { if (xfAvail && App.buildSidebar) { try { App.buildSidebar(); } catch (e) {} } });
  // Andere Reiter (Profiloptimierung, KFm, Vergleichsfenster): nur geschützt aufrufen (App.aeroXfoil && …).
  App.aeroXfoil = { ready: xfoilReady, whenKnown: xfoilWhenKnown, run: xfoilAsync, runSync: xfoilSync,
    polarOf: xfoilPolarOf, cpus: () => xfCpus, opts: calcOpts, sel: calcSel, why: xfoilWhy, label: xfLabel };
  window.FoilPolar = { hooks: H, reName, foilHash, nfModels, cssVar, PART_COLORS, chartHide, ovRefresh: d => { if (ovRefresh) ovRefresh(d); },
    xfoilReady, xfoilWhenKnown, calcUi, calcSel, xfoilWhy, xfLabel, calcOpts, xfoilPolarOf, xfoilSync, xfoilAsync,
    cpus: () => xfCpus, exe: () => xfAvail, freeDef, buildFree, axisPicker, chartRange, drawChart, fmt, openChart, openFoilView,
    foilReStr, niceStep, parseReList, foilModelFor, foilPolarFull };
})();
