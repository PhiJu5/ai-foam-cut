/* pc2.js — Import von Planform-Creator-2-Dateien (.pc2, JSON).
 *
 * Planform Creator 2 (jxjo) beschreibt eine HALBE Tragfläche über eine glatte,
 * meist elliptische Tiefenverteilung (Bézier) plus eine Bezugs-/Scharnierlinie.
 * Für den Heißdraht-Schnitt muss diese glatte Fläche in TRAPEZE (Segmente mit
 * linearer Zuspitzung) zerlegt werden — Anzahl und Lage frei wählbar.
 *
 * Geometrie:
 *   chord_distribution (Bézier): normierte Tiefe cn(xn), xn=Spannweitenanteil 0..1
 *     Kontrollpunkte P0=(0,1), P1=(p1x,p1y), P2=(1,p2y), P3=(1,p3y).
 *   chord_reference: Lage der Bezugslinie in % der Tiefe (von der Nase), linear
 *     von p0y (Wurzel) bis p1y (Spitze). ~ Scharnierlinie.
 *   sweep_angle: Neigung der geraden Bezugslinie [°].
 *   -> LE(xn) = ref_x(xn) − cr(xn)·c(xn),  TE(xn) = ref_x(xn) + (1−cr(xn))·c(xn)
 *      mit ref_x(xn) = tan(sweep)·(xn·halfspan),  c(xn) = chord_root·cn(xn).
 *
 * Die Profile (.dat) sind wie bei XFLR5 NICHT enthalten (nur Namen) -> Platzhalter.
 */
(function (global) {
  'use strict';

  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  function placeholder(name) {
    const p = (window.Airfoil ? Airfoil.naca4('0012', 120) : []);
    p.name = (name || 'Profil') + ' ' + T('(Platzhalter – .dat laden)');
    return p;
  }
  function cleanName(s) { return String(s || 'Profil').replace(/\.(dat|cor|txt)\s*$/i, '').trim() || 'Profil'; }

  // Text -> Planform-Modell mit ausgewerteten Funktionen.
  function parse(text) {
    let d;
    try { d = (typeof text === 'string') ? JSON.parse(text) : text; }
    catch (e) { throw new Error(T('PC2-Datei ist kein gültiges JSON.')); }
    if (!d || d.halfspan == null || d.chord_root == null || !d.chord_distribution)
      throw new Error(T('Keine Planform-Creator-Daten erkannt.'));

    const half = +d.halfspan, croot = +d.chord_root, sweep = +(d.sweep_angle || 0);
    const cd = d.chord_distribution;
    const style = String(cd.chord_style || 'Bezier');
    const isTrapez = /trapez/i.test(style);
    if (!isTrapez && !/bezier/i.test(style))
      throw new Error(T('Tiefenverteilung nicht unterstützt (chord_style=') + style + ').');
    // Stützstellen der Tiefe: bei Trapezflächen stehen sie direkt in den
    // Sektionen (defines_cn), dazwischen wird linear interpoliert.
    const cnPts = (d.wingSections || [])
      .filter(w => w.xn != null && w.cn != null && w.defines_cn !== false)
      .map(w => ({ x: +w.xn, y: +w.cn }))
      .sort((a, b) => a.x - b.x);
    let cn;
    if (isTrapez) {
      if (!cnPts.length || cnPts[0].x > 1e-9) cnPts.unshift({ x: 0, y: 1 });
      if (cnPts[cnPts.length - 1].x < 1 - 1e-9)
        cnPts.push({ x: 1, y: cnPts[cnPts.length - 1].y });
      cn = (xn) => {
        const x = Math.max(0, Math.min(1, xn));
        for (let i = 1; i < cnPts.length; i++) {
          if (x <= cnPts[i].x + 1e-12) {
            const a = cnPts[i - 1], b = cnPts[i];
            const u = (b.x - a.x) > 1e-12 ? (x - a.x) / (b.x - a.x) : 0;
            return a.y + (b.y - a.y) * u;
          }
        }
        return cnPts[cnPts.length - 1].y;
      };
    } else {
      // Bézier-Kontrollpunkte (x,y): P0 fest (0,1); P2/P3 x fest = 1.
      const P = [[0, 1], [+cd.p1x, +cd.p1y], [1, +cd.p2y], [1, +cd.p3y]];
      const bez = (t, a) => {
        const mt = 1 - t;
        return mt*mt*mt*P[0][a] + 3*mt*mt*t*P[1][a] + 3*mt*t*t*P[2][a] + t*t*t*P[3][a];
      };
      const tOfXn = (xn) => {           // x(t) monoton -> Bisektion
        let lo = 0, hi = 1;
        for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (bez(m, 0) < xn) lo = m; else hi = m; }
        return (lo + hi) / 2;
      };
      cn = (xn) => bez(tOfXn(Math.max(0, Math.min(1, xn))), 1);
    }
    const xnOfCn = (target) => {      // cn(xn) monoton fallend -> Bisektion
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (cn(m) > target) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    // Bezugslinie: ältere Dateien schreiben p0y/p1y, die Vorlagen des Programms
    // px/py als Wertepaare. Beides lesen.
    const cref = d.chord_reference || {};
    let cr0 = 0.75, cr1 = 0.75;
    if (cref.p0y != null) { cr0 = +cref.p0y; cr1 = (cref.p1y != null ? +cref.p1y : cr0); }
    else if (Array.isArray(cref.py) && cref.py.length) {
      cr0 = +cref.py[0]; cr1 = +cref.py[cref.py.length - 1];
    }
    const cr = (xn) => cr0 + (cr1 - cr0) * xn;
    const tanS = Math.tan(sweep * Math.PI / 180);

    const chord = (xn) => croot * cn(xn);
    const refx = (xn) => tanS * (xn * half);
    const le = (xn) => refx(xn) - cr(xn) * chord(xn);
    const te = (xn) => refx(xn) + (1 - cr(xn)) * chord(xn);
    const le0 = le(0);
    const leOffset = (xn) => le(xn) - le0;

    // Klappengruppe eines Feldes: PC2 vermerkt sie an der INNEREN Sektion; das
    // Feld von dort nach außen gehört dazu. 0 = keine Klappe.
    const grpPts = (d.wingSections || [])
      .filter(w => w.xn != null)
      .map(w => ({ x: +w.xn, g: (w.flap_group != null ? +w.flap_group : 1) }))
      .sort((a, b) => a.x - b.x);
    const flapGroupAt = (xnInner) => {
      let g = grpPts.length ? grpPts[0].g : 1;
      for (const q of grpPts) { if (q.x <= xnInner + 1e-9) g = q.g; else break; }
      return g;
    };

    // Sektionen: xn direkt, oder cn -> xn invertieren. Nur Profilzuweisungen.
    const sections = (d.wingSections || []).map(s => {
      const xn = (s.xn != null) ? +s.xn : (s.cn != null ? xnOfCn(+s.cn) : null);
      return { xn, airfoil: s.airfoil ? cleanName(s.airfoil) : null,
               hinge_cn: s.hinge_cn, flap_group: s.flap_group };
    }).filter(s => s.xn != null).sort((a, b) => a.xn - b.xn);

    // Scharnierlinie wie in PC2 (Flaps._get_hinge_points / hinge_polyline): Polylinie in ABSOLUTEN
    // Grundriss-Koordinaten durch die Sektionen mit hinge_cn (Punkt = Nase + hinge_cn·Sehne), gerade
    // dazwischen, nach außen bis zur Spitze verlängert, vor dem ersten Punkt konstant. Bei elliptischer
    // Fläche ist der Anteil an der Sehne deshalb NICHT linear. hinge_equal_ref_line: Bezugslinie
    // (Sehnenanteil cr, gerade mit sweep_angle). Weniger als 2 Punkte: PC2 setzt Wurzel/Spitze auf 0,75.
    const hingeTied = !!(d.flaps && d.flaps.hinge_equal_ref_line);
    let hDef = sections.filter(s => s.hinge_cn != null).map(s => ({ x: s.xn, h: le(s.xn) + (+s.hinge_cn) * chord(s.xn) }));
    if (hDef.length < 2) hDef = [{ x: 0, h: le(0) + 0.75 * chord(0) }, { x: 1, h: le(1) + 0.75 * chord(1) }];
    if (hDef[hDef.length - 1].x < 1 - 1e-9) {
      const p = hDef[hDef.length - 2], q = hDef[hDef.length - 1];
      hDef.push({ x: 1, h: q.h + (q.h - p.h) / ((q.x - p.x) || 1e-9) * (1 - q.x) });
    }
    const hingeX = (xn) => {
      if (hingeTied) return refx(xn);
      if (xn <= hDef[0].x) return hDef[0].h;
      for (let i = 1; i < hDef.length; i++) {
        if (xn <= hDef[i].x + 1e-12) {
          const a = hDef[i - 1], b = hDef[i];
          return a.h + (b.h - a.h) * ((b.x - a.x) > 1e-12 ? (xn - a.x) / (b.x - a.x) : 0);
        }
      }
      return hDef[hDef.length - 1].h;
    };
    const hingeCn = (xn) => { const c = chord(xn); return c > 1e-9 ? Math.max(0, Math.min(1, (hingeX(xn) - le(xn)) / c)) : 1; };
    // Knicke der Scharnierlinie (innere Definitionspunkte) -> dort beginnt eine neue gerade Scharnierstrecke.
    const hingeKinks = hingeTied ? [] : hDef.slice(1, -1).map(p => p.x);
    const hingeFromTE = (xn) => (1 - hingeCn(xn)) * 100;   // Klappentiefe in % von hinten

    // Profil an Position xn wie in PC2 (WingSections.do_strak): Sektion mit eigenem Profil -> dieses;
    // sonst Mischung („Strak") der Nachbarn mit Profil, Mischanteil nach Tiefe (cn) — bei gleicher Tiefe
    // nach Lage xn —, auf 1 % gerundet. Gleiches Profil links/rechts -> keine Mischung.
    const airfoilSpec = (xn) => {
      const own = sections.find(s => s.airfoil && Math.abs(s.xn - xn) < 1e-6);
      if (own) return { name: own.airfoil };
      let L = null, R = null;
      for (const s of sections) { if (!s.airfoil) continue; if (s.xn <= xn) L = s; else if (!R) R = s; }
      if (!L && !R) return { name: null };
      if (!L || !R) return { name: (L || R).airfoil };
      if (L.airfoil === R.airfoil) return { name: L.airfoil };
      const cl = cn(L.xn), cr_ = cn(R.xn);
      let t = Math.abs(cr_ - cl) > 1e-12 ? (cn(xn) - cl) / (cr_ - cl) : (xn - L.xn) / ((R.xn - L.xn) || 1);
      t = Math.round(Math.max(0, Math.min(1, t)) * 100) / 100;
      if (t <= 0) return { name: L.airfoil };
      if (t >= 1) return { name: R.airfoil };
      return { name: null, a: L.airfoil, b: R.airfoil, t };
    };
    // Profil an Position xn: nächste Sektion (mit Profil).
    const airfoilAt = (xn) => {
      let best = null, bd = Infinity;
      for (const s of sections) {
        if (!s.airfoil) continue;
        const dd = Math.abs(s.xn - xn);
        if (dd < bd) { bd = dd; best = s.airfoil; }
      }
      return best;
    };

    return {
      raw: d, name: d.wing_name || 'Planform', description: d.description || '',
      halfspan: half, chordRoot: croot, sweepAngle: sweep,
      cn, chord, xnOfCn, cr, le, te, refx, leOffset, hingeFromTE, hingeCn, hingeX, hingeKinks, hingeTied,
      flapGroupAt, airfoilAt, airfoilSpec, isTrapez, style,
      sections,
      chordTip: chord(1),
      // Vorschlag für Stationsgrenzen: Sektions-xn (inkl. 0 und 1), dedupliziert.
      sectionStations() {
        const xs = new Set([0, 1]);
        sections.forEach(s => xs.add(+s.xn.toFixed(6)));
        return Array.from(xs).sort((a, b) => a - b);
      }
    };
  }

  // Gleichverteilte Stationsgrenzen (N Trapeze -> N+1 Grenzen), Modus:
  //   'uniform'  gleichmäßig in der Spannweite
  //   'cosine'   zur Spitze hin verdichtet (gut für elliptische Flächen)
  function stations(n, mode) {
    n = Math.max(1, Math.round(n || 1));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      out.push(mode === 'cosine' ? (1 - Math.cos(u * Math.PI / 2)) : u);
    }
    out[0] = 0; out[n] = 1;
    return out;
  }

  // Maximale/mittlere Abweichung (mm) der Trapez-Näherung von der echten Tiefe,
  // gemessen an vielen Zwischenstellen je Segment (nur zur Anzeige).
  function chordError(model, st) {
    let maxE = 0, sumE = 0, cnt = 0;
    for (let k = 1; k < st.length; k++) {
      const x0 = st[k - 1], x1 = st[k], c0 = model.chord(x0), c1 = model.chord(x1);
      for (let j = 1; j < 20; j++) {
        const u = j / 20, xn = x0 + (x1 - x0) * u;
        const approx = c0 + (c1 - c0) * u, real = model.chord(xn);
        const e = Math.abs(approx - real); if (e > maxE) maxE = e; sumE += e; cnt++;
      }
    }
    return { max: maxE, mean: cnt ? sumE / cnt : 0 };
  }

  // Mischprofil wie PC2-Strak: beide Profile gleich abtasten, punktweise mischen (Anteil t von a nach b).
  function strak(pa, pb, t, name) {
    const N = Math.max(120, pa.length, pb.length);
    let out;
    if (window.App && App.lerpProfile) out = App.lerpProfile(pa, pb, t, N).map(p => ({ x: p.x, y: p.y }));
    else {
      const ra = Airfoil.resample(pa, N), rb = Airfoil.resample(pb, N);
      out = ra.map((p, i) => ({ x: p.x + (rb[i].x - p.x) * t, y: p.y + (rb[i].y - p.y) * t }));
    }
    out.name = name || 'Strak';
    return out;
  }
  function strakName(sp) { return sp.a + ' / ' + sp.b + ' ' + Math.round(sp.t * 100) + '%'; }

  // Modell + Stationsgrenzen -> App-Wing-Konfiguration (Trapez-Rippenkette).
  function toWingConfig(model, opts) {
    opts = opts || {};
    const mkSeg = opts.mkSeg || (o => Object.assign({}, o));
    const foils = opts.foils || {};
    const normName = (window.XFLR5 && XFLR5.normName) || (s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    let st = (opts.stations && opts.stations.length >= 2) ? opts.stations.slice() : model.sectionStations();
    st = Array.from(new Set(st.map(v => Math.max(0, Math.min(1, +v))))).sort((a, b) => a - b);
    if (st[0] > 0) st.unshift(0);
    if (st[st.length - 1] < 1) st.push(1);
    if (st.length < 2) throw new Error(T('Mindestens ein Trapez nötig.'));

    const missing = [];
    const resolveProfile = (foil) => {
      if (!foil) return placeholder('Profil');
      const hit = foils[normName(foil)];
      if (hit) { const c = hit.map(p => ({ x: p.x, y: p.y })); c.name = foil; return c; }
      if (missing.indexOf(foil) < 0) missing.push(foil);
      return placeholder(foil);
    };

    // Strak (Mischprofil zweier Nachbarn) — beide .dat nötig, sonst Platzhalter mit Strak-Namen.
    const specProfile = (sp) => {
      if (!sp || !sp.b) return resolveProfile(sp && sp.name);
      const ha = foils[normName(sp.a)], hb = foils[normName(sp.b)];
      [[sp.a, ha], [sp.b, hb]].forEach(([n, h]) => { if (!h && missing.indexOf(n) < 0) missing.push(n); });
      if (ha && hb) return strak(ha, hb, sp.t, strakName(sp));
      return placeholder(strakName(sp));
    };
    const holder = (sp) => ({ foilName: (sp && sp.name) || '', foilStrak: (sp && sp.b) ? { a: sp.a, b: sp.b, t: sp.t } : null });
    const rootSpec = model.airfoilSpec ? model.airfoilSpec(st[0]) : { name: model.airfoilAt(st[0]) };
    const cfg = {
      root: Object.assign({ profile: specProfile(rootSpec), chord: +model.chord(st[0]).toFixed(2) }, holder(rootSpec)),
      segments: [],
      meta: { name: model.name, halfspan: model.halfspan, nTrapez: st.length - 1, stations: st },
      missingFoils: missing
    };
    for (let k = 1; k < st.length; k++) {
      const xi = st[k - 1], xo = st[k];
      const spanMM = (xo - xi) * model.halfspan;
      if (spanMM < 1e-3) continue;
      const spec = model.airfoilSpec ? model.airfoilSpec(xo) : { name: model.airfoilAt(xo) };
      // Klappengruppe des Feldes. Gruppe 0 = keine Klappe -> Scharniertiefe 0,
      // damit der Export sie nicht als Ruder schreibt. Ein Gruppenwechsel setzt
      // eine neue Scharnierlinien-Gruppe (hingeGroupStart) -- so bleiben die
      // Klappen beim Export nach FLZ/PC2 beieinander.
      const grp = model.flapGroupAt ? model.flapGroupAt(xi) : 1;
      const prevGrp = k > 1 && model.flapGroupAt ? model.flapGroupAt(st[k - 2]) : null;
      const noFlap = grp === 0;
      cfg.segments.push(mkSeg(Object.assign({
        profile: specProfile(spec),
        chord: +model.chord(xo).toFixed(2),
        span: +spanMM.toFixed(2),
        sweep: +(model.leOffset(xo) - model.leOffset(xi)).toFixed(2),
        washout: 0, dihMode: 'mm', dih: 0, dihRoot: 0,
        hingeSide: 'top',
        hingePct: noFlap ? 0 : +model.hingeFromTE(xi).toFixed(1),
        hingePctTip: noFlap ? 0 : +model.hingeFromTE(xo).toFixed(1),
        hingeGroupStart: k > 1 && prevGrp !== null && grp !== prevGrp
      }, holder(spec))));
    }
    if (!cfg.segments.length) throw new Error(T('Keine Trapeze erzeugt.'));
    return cfg;
  }

  // ---------- .pc2 schreiben -----------------------------------------------
  // Erzeugt eine Trapez-Planform (chord_style "Trapezoid") aus einer fertigen
  // Rippenkette. spec:
  //   { name, description, halfspan, chordRoot, sweepDeg, cr0, cr1,
  //     sections:[{xn,cn,hingeCn,flapGroup,airfoil}], panels:{wy,wx} }
  // Zahlen werden gerundet ausgegeben, damit die Datei lesbar bleibt.
  function build(spec) {
    const r = (v, n) => +(+v).toFixed(n == null ? 6 : n);
    const secs = spec.sections.map(s => {
      const o = { xn: r(s.xn), cn: r(s.cn), defines_cn: true };
      // Gruppe 0 = kein Ruder; dann auch keine Scharnierlinie schreiben.
      if (s.flapGroup !== 0 && s.hingeCn != null) o.hinge_cn = r(s.hingeCn);
      o.flap_group = Math.max(0, Math.round(s.flapGroup || 0));
      if (s.airfoil) o.airfoil = s.airfoil;
      return o;
    });
    return {
      pc2_version: 2,
      wing_name: spec.name || 'Wing',
      description: spec.description || '',
      fuselage_width: 0.0,
      airfoil_nick_prefix: '',
      airfoil_nick_base: 100,
      halfspan: r(spec.halfspan, 4),
      chord_root: r(spec.chordRoot, 4),
      sweep_angle: r(spec.sweepDeg),
      chord_distribution: { chord_style: 'Trapezoid' },
      // Beide Schreibweisen: p0y/p1y lesen die neueren Fassungen (und PC3),
      // px/py die mitgelieferten Vorlagen des Programms.
      chord_reference: { p0y: r(spec.cr0), p1y: r(spec.cr1),
        px: [0.0, 1.0], py: [r(spec.cr0), r(spec.cr1)] },
      reference_line: {},
      wingSections: secs,
      flaps: { hinge_equal_ref_line: false },
      panels: {
        wy_panels: Math.max(1, Math.round((spec.panels && spec.panels.wy) || 15)),
        wy_distribution: 'uniform',
        wx_panels: Math.max(1, Math.round((spec.panels && spec.panels.wx) || 4)),
        wx_distribution: 'uniform',
        width_min: 0.02,
        cn_diff_max: 0.02
      },
      airfoils: { export_dir: 'airfoils', use_nick_name: false,
        adapt_te_gap: false, te_gap_mm: 0.5 },
      dxf: { export_dir: '.', export_airfoils: true }
    };
  }

  // Bezugslinie an eine vorhandene Nasenleiste anpassen. PC2 beschreibt die
  // Fl\u00e4che \u00fcber EINE gerade Bezugslinie (Pfeilwinkel) und deren Lage in der
  // Sehne (cr, linear von Wurzel zur Spitze):
  //   LE(xn) - LE(0) = tan(s)\u00b7xn\u00b7b - cr(xn)\u00b7c(xn) + cr0\u00b7c(0)
  // Das sind drei Unbekannte (tan s, cr0, cr1) f\u00fcr beliebig viele Rippen --
  // eine allgemeine Knickfl\u00e4che l\u00e4sst sich also nicht immer exakt abbilden.
  // Deshalb Ausgleichsrechnung (kleinste Quadrate) plus Angabe des gr\u00f6\u00dften
  // Restfehlers, damit der Aufrufer ehrlich warnen kann.
  function fitReference(pts, halfspan) {
    const c0 = pts[0].chord;
    const A = [[0,0,0],[0,0,0],[0,0,0]], rhs = [0, 0, 0];
    pts.forEach(q => {
      const b = [q.xn * halfspan, c0 - q.chord * (1 - q.xn), -q.chord * q.xn];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) A[i][j] += b[i] * b[j];
        rhs[i] += b[i] * q.le;
      }
    });
    // 3x3 mit Gauss (Teilpivotisierung); bei Entartung: gerade LE annehmen.
    const M = A.map((row, i) => row.concat([rhs[i]]));
    for (let i = 0; i < 3; i++) {
      let piv = i;
      for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      if (Math.abs(M[piv][i]) < 1e-12) return fallbackRef(pts, halfspan);
      const t = M[i]; M[i] = M[piv]; M[piv] = t;
      for (let k = i + 1; k < 3; k++) {
        const f = M[k][i] / M[i][i];
        for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j];
      }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
      let v = M[i][3];
      for (let j = i + 1; j < 3; j++) v -= M[i][j] * x[j];
      x[i] = v / M[i][i];
    }
    let [tanS, cr0, cr1] = x;
    if (!isFinite(tanS) || !isFinite(cr0) || !isFinite(cr1)) return fallbackRef(pts, halfspan);
    // cr au\u00dferhalb der Sehne ist zwar rechnerisch m\u00f6glich, in PC2 aber unsinnig.
    cr0 = Math.max(0, Math.min(1, cr0));
    cr1 = Math.max(0, Math.min(1, cr1));
    return withError({ tanS, cr0, cr1 }, pts, halfspan);
  }
  function fallbackRef(pts, halfspan) {
    const last = pts[pts.length - 1];
    const tanS = halfspan > 0 ? (last.le + last.chord * 0 ) / halfspan : 0;
    return withError({ tanS: tanS, cr0: 0, cr1: 0 }, pts, halfspan);
  }
  function withError(sol, pts, halfspan) {
    const c0 = pts[0].chord;
    let max = 0;
    pts.forEach(q => {
      const cr = sol.cr0 + (sol.cr1 - sol.cr0) * q.xn;
      const le = sol.tanS * q.xn * halfspan - cr * q.chord + sol.cr0 * c0;
      max = Math.max(max, Math.abs(le - q.le));
    });
    sol.maxErr = max;
    sol.sweepDeg = Math.atan(sol.tanS) * 180 / Math.PI;
    return sol;
  }

  // ---------- Glatte Fläche über der Trapezkette (Tragflächendesign, Formenbau) ----------
  /* Bildet die PC2-Kurve auf die tatsächliche Trapezkette ab. bounds[k] = { z, le, c } an den
   * Trapezgrenzen st[k] (z = Spannweite ab Wurzel, le = Nasen-x, c = Sehne im App-Rahmen). Zwischen
   * zwei Grenzen = lineare Verbindung + Abweichung der PC2-Kurve von ihrer eigenen Geraden (Nase)
   * bzw. Tiefenverhältnis — an den Grenzen exakt die Trapezecken, spätere Änderungen wirken weiter.
   * at(z) -> { xn, le, c, hinge } (hinge = Scharnier-x mit dem PC2-Sehnenanteil). */
  function overlay(model, st, bounds) {
    if (!model || !st || !bounds || st.length !== bounds.length || st.length < 2) return null;
    const segs = [];
    for (let k = 0; k < st.length - 1; k++) {
      const a = bounds[k], b = bounds[k + 1];
      segs.push({ a, b, x0: +st[k], x1: +st[k + 1], le0: model.le(st[k]), le1: model.le(st[k + 1]), c0: model.chord(st[k]), c1: model.chord(st[k + 1]) });
    }
    const zOfXn = (xn) => {
      let k = 0; while (k < segs.length - 1 && xn > segs[k].x1) k++;
      const s = segs[k], t = (s.x1 - s.x0) > 1e-12 ? (xn - s.x0) / (s.x1 - s.x0) : 0;
      return s.a.z + (s.b.z - s.a.z) * t;
    };
    const at = (z) => {
      let k = 0; while (k < segs.length - 1 && z > segs[k].b.z) k++;
      const s = segs[k], dz = s.b.z - s.a.z, t = dz > 1e-9 ? Math.max(0, Math.min(1, (z - s.a.z) / dz)) : 0;
      const xn = s.x0 + (s.x1 - s.x0) * t;
      const Lm = s.le0 + (s.le1 - s.le0) * t, Cm = s.c0 + (s.c1 - s.c0) * t;
      const le = s.a.le + (s.b.le - s.a.le) * t + (model.le(xn) - Lm);
      const c = (s.a.c + (s.b.c - s.a.c) * t) * (Cm > 1e-9 ? model.chord(xn) / Cm : 1);
      return { xn, le, c, hinge: le + model.hingeCn(xn) * c, seg: k };
    };
    return { at, zOfXn };
  }
  // Scharnierlage (Seite oben, % von hinten) + Gruppenwechsel je Segment aus der PC2-Scharnierlinie.
  function hingeToSegments(model, st, segments) {
    if (!model || !st || !segments || segments.length !== st.length - 1) return false;
    segments.forEach((sg, k) => {
      const xi = st[k], xo = st[k + 1];
      const grp = model.flapGroupAt(xi), noFlap = grp === 0;
      const prevGrp = k > 0 ? model.flapGroupAt(st[k - 1]) : null;
      sg.hingeSide = 'top';
      sg.hingePct = noFlap ? 0 : +model.hingeFromTE(xi).toFixed(1);
      sg.hingePctTip = noFlap ? 0 : +model.hingeFromTE(xo).toFixed(1);
      sg.hingeGroupStart = k > 0 && prevGrp !== null && grp !== prevGrp;
    });
    return true;
  }

  global.PC2 = { parse, stations, chordError, toWingConfig, build, fitReference, strak, strakName, overlay, hingeToSegments };
})(window);
