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
    // Scharnierlinie: PC2 legt sie je Sektion als hinge_cn (Anteil der Sehne ab
    // Nasenleiste) fest. Nur wenn die Datei sie an die Bezugslinie koppelt
    // (hinge_equal_ref_line), gilt stattdessen cr.
    const hingeTied = !!(d.flaps && d.flaps.hinge_equal_ref_line);
    const hPts = (d.wingSections || [])
      .filter(w => w.xn != null && w.hinge_cn != null)
      .map(w => ({ x: +w.xn, y: +w.hinge_cn }))
      .sort((a, b) => a.x - b.x);
    const hingeCn = (xn) => {
      if (hingeTied || !hPts.length) return cr(xn);
      const x = Math.max(0, Math.min(1, xn));
      if (x <= hPts[0].x) return hPts[0].y;
      for (let i = 1; i < hPts.length; i++) {
        if (x <= hPts[i].x + 1e-12) {
          const a = hPts[i - 1], b = hPts[i];
          const u = (b.x - a.x) > 1e-12 ? (x - a.x) / (b.x - a.x) : 0;
          return a.y + (b.y - a.y) * u;
        }
      }
      return hPts[hPts.length - 1].y;
    };
    const hingeFromTE = (xn) => (1 - hingeCn(xn)) * 100;   // Klappentiefe in % von hinten

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
      cn, chord, xnOfCn, cr, le, te, refx, leOffset, hingeFromTE, hingeCn,
      flapGroupAt, airfoilAt, isTrapez, style,
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

    const rootFoil = model.airfoilAt(st[0]);
    const cfg = {
      root: { profile: resolveProfile(rootFoil), chord: +model.chord(st[0]).toFixed(2), foilName: rootFoil || '' },
      segments: [],
      meta: { name: model.name, halfspan: model.halfspan, nTrapez: st.length - 1, stations: st },
      missingFoils: missing
    };
    for (let k = 1; k < st.length; k++) {
      const xi = st[k - 1], xo = st[k];
      const spanMM = (xo - xi) * model.halfspan;
      if (spanMM < 1e-3) continue;
      const foil = model.airfoilAt(xo);
      // Klappengruppe des Feldes. Gruppe 0 = keine Klappe -> Scharniertiefe 0,
      // damit der Export sie nicht als Ruder schreibt. Ein Gruppenwechsel setzt
      // eine neue Scharnierlinien-Gruppe (hingeGroupStart) -- so bleiben die
      // Klappen beim Export nach FLZ/PC2 beieinander.
      const grp = model.flapGroupAt ? model.flapGroupAt(xi) : 1;
      const prevGrp = k > 1 && model.flapGroupAt ? model.flapGroupAt(st[k - 2]) : null;
      const noFlap = grp === 0;
      cfg.segments.push(mkSeg({
        profile: resolveProfile(foil), foilName: foil || '',
        chord: +model.chord(xo).toFixed(2),
        span: +spanMM.toFixed(2),
        sweep: +(model.leOffset(xo) - model.leOffset(xi)).toFixed(2),
        washout: 0, dihMode: 'mm', dih: 0, dihRoot: 0,
        hingeSide: 'top',
        hingePct: noFlap ? 0 : +model.hingeFromTE(xi).toFixed(1),
        hingePctTip: noFlap ? 0 : +model.hingeFromTE(xo).toFixed(1),
        hingeGroupStart: k > 1 && prevGrp !== null && grp !== prevGrp
      }));
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

  global.PC2 = { parse, stations, chordError, toWingConfig, build, fitReference };
})(window);
