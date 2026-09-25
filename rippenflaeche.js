/* rippenflaeche.js — Reiter „Rippenfläche": komplette Rippenbauweise aus dem
 * Tragflächendesign ableiten (Rippen, Holmgurte, Holmstege, Rippenkämme,
 * Helling, Beplankung inkl. Abwicklung, geodätische Bauweise).
 *
 * Abgrenzung zum Reiter „Rippendesigner" (ribs.js): der zeigt einzelne Rippen
 * und exportiert sie als STL. Hier geht es um die GANZE Fläche als Bausatz —
 * alle Teile, die man zum Aufbau einer Rippenfläche braucht, fertig geschachtelt
 * als DXF (Laser/Fräse) und als Übergabe an den CAD-Reiter.
 *
 * Koordinaten: Rippenteile liegen im Rippensystem (x = Sehne ab Nasenleiste,
 * y = Höhe, mm). Flächenteile (Gurte, Stege, Kämme, Beplankung, Helling) liegen
 * abgewickelt in ihrem eigenen System (x = Spannweite/Abwicklungslänge ab
 * Wurzel, y = Breite/Höhe). Alle Teile werden zum Schluss auf einer Platte
 * geschachtelt (rfParts → rfLayout).
 *
 * Abwählbare Funktion (features.json: „rippenflaeche"): andere Module rufen
 * Namen von hier nur geschützt auf (App.rfSidebar && …).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const state = App.state;
  const DEMO = App.demoFeature ? App.demoFeature('rippenflaeche',
    'Demo-Version: Der Export der Rippenfläche (DXF) ist in dieser Ausgabe nicht enthalten.') : { on: false, btn: () => {}, msg: '' };

  // ==================================================================
  //  1. Polygon-Werkzeuge
  // ==================================================================
  // Greiner-Hormann-Boolean. Gebraucht für Gurtnuten (Rippe minus Rechteck),
  // Helling-Nasen (Rippe plus Rechteck) und Kammschlitze. Die Konturen sind
  // hier immer einfache, nicht selbstschneidende Polygone.
  const GEPS = 1e-9;
  function polyArea2(p) { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += a.x * b.y - b.x * a.y; } return s / 2; }
  function inPoly(pt, poly) {
    let inside = false;
    for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y)) {
        const x = a.x + (pt.y - a.y) / ((b.y - a.y) || 1e-300) * (b.x - a.x);
        if (x > pt.x) inside = !inside;
      }
    }
    return inside;
  }
  function mkList(poly) {
    let first = null, prev = null;
    poly.forEach(p => {
      const v = { x: p.x, y: p.y, next: null, prev: null, nb: null, isect: false, entry: false, visited: false, alpha: 0 };
      if (!first) first = v; else { prev.next = v; v.prev = prev; }
      prev = v;
    });
    if (!first) return null;
    prev.next = first; first.prev = prev;
    return first;
  }
  function insertBetween(v, a, b) {
    let p = a;
    while (p.next !== b && p.next.alpha < v.alpha) p = p.next;
    v.next = p.next; v.prev = p; p.next.prev = v; p.next = v;
  }
  function segX(a, b, c, d) {
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-14) return null;
    const ta = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
    const tb = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    if (ta <= GEPS || ta >= 1 - GEPS || tb <= GEPS || tb >= 1 - GEPS) return null;
    return { x: a.x + ta * rx, y: a.y + ta * ry, ta, tb };
  }
  function dedupe(r) {
    const o = [];
    r.forEach(p => { const l = o[o.length - 1]; if (!l || Math.hypot(p.x - l.x, p.y - l.y) > 1e-7) o.push(p); });
    while (o.length > 1 && Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y) < 1e-7) o.pop();
    return o;
  }
  const FLIP = { and: [false, false], or: [true, true], diff: [true, false] };
  function polyBool(A, B, op) {
    if (!A || A.length < 3) return [];
    if (!B || B.length < 3) return op === 'and' ? [] : [A.slice()];
    const sa = mkList(A), ca = mkList(B);
    if (!sa || !ca) return [A.slice()];
    let cnt = 0, s = sa;
    do {
      if (!s.isect) {
        let sn = s.next; while (sn.isect) sn = sn.next;
        let c = ca;
        do {
          if (!c.isect) {
            let cn = c.next; while (cn.isect) cn = cn.next;
            const r = segX(s, sn, c, cn);
            if (r) {
              cnt++;
              const v1 = { x: r.x, y: r.y, isect: true, alpha: r.ta, entry: false, visited: false };
              const v2 = { x: r.x, y: r.y, isect: true, alpha: r.tb, entry: false, visited: false };
              v1.nb = v2; v2.nb = v1;
              insertBetween(v1, s, sn); insertBetween(v2, c, cn);
            }
          }
          c = c.next;
        } while (c !== ca);
      }
      s = s.next;
    } while (s !== sa);
    if (!cnt) {
      // Keine echten Kreuzungen: entweder liegt eines der Polygone ganz im
      // anderen — oder sie berühren sich nur entartet (Eckpunkt genau auf einer
      // Kante). Der zweite Fall ist an gemischter Lage der Punkte erkennbar und
      // wird an boolSafe zurückgegeben, das das Werkzeug leicht verrückt.
      const inA = B.filter(p => inPoly(p, A)).length;
      const inB = A.filter(p => inPoly(p, B)).length;
      const bInA = inA === B.length, aInB = inB === A.length;
      if (!bInA && !aInB && (inA || inB)) return [];      // entartet -> neu rechnen
      if (op === 'and') return aInB ? [A.slice()] : (bInA ? [B.slice()] : []);
      if (op === 'or') return aInB ? [B.slice()] : (bInA ? [A.slice()] : [A.slice(), B.slice()]);
      return bInA ? [A.slice(), B.slice().reverse()] : (aInB ? [] : [A.slice()]);
    }
    const flip = FLIP[op] || FLIP.and;
    let st = inPoly({ x: sa.x, y: sa.y }, B) !== flip[0];
    s = sa; do { if (s.isect) { s.entry = !st; st = !st; } s = s.next; } while (s !== sa);
    let ct = inPoly({ x: ca.x, y: ca.y }, A) !== flip[1];
    let c2 = ca; do { if (c2.isect) { c2.entry = !ct; ct = !ct; } c2 = c2.next; } while (c2 !== ca);
    const out = [];
    for (let loop = 0; loop < 500; loop++) {
      let start = null;
      s = sa; do { if (s.isect && !s.visited) { start = s; break; } s = s.next; } while (s !== sa);
      if (!start) break;
      const ring = [];
      let cur = start, guard = 0, bad = false;
      do {
        cur.visited = true; if (cur.nb) cur.nb.visited = true;
        const fwd = cur.entry;
        do {
          cur = fwd ? cur.next : cur.prev;
          ring.push({ x: cur.x, y: cur.y });
          if (++guard > 100000) { bad = true; break; }
        } while (!cur.isect);
        if (bad) break;
        cur.visited = true;
        cur = cur.nb; cur.visited = true;
      } while (cur !== start && !(cur.nb && cur.nb === start));
      if (!bad && ring.length >= 3) out.push(dedupe(ring));
    }
    return out.filter(r => r.length >= 3 && Math.abs(polyArea2(r)) > 1e-7);
  }
  // Boolean mit Rückfall: schlägt sie fehl (entartete Lage — Kante genau auf
  // Kante), wird das Werkzeug minimal verrückt und erneut gerechnet. Ohne
  // Erfolg bleibt die Ausgangskontur erhalten (lieber keine Nut als Müll).
  function boolSafe(A, B, op) {
    for (let k = 0; k < 4; k++) {
      const off = k ? { x: (k % 2 ? 1 : -1) * 1.7e-4 * k, y: (k > 1 ? 1 : -1) * 1.1e-4 * k } : null;
      const BB = off ? B.map(p => ({ x: p.x + off.x, y: p.y + off.y })) : B;
      const r = polyBool(A, BB, op);
      if (r && r.length) return r;
      if (op === 'and') return [];
    }
    return (op === 'diff' || op === 'or') ? [A.slice()] : [];
  }
  // Mehrere Werkzeuge nacheinander abziehen/hinzufügen. Ergebnis kann in
  // mehrere Ringe zerfallen (z. B. Rippe durch einen breiten Ausschnitt geteilt).
  function boolMany(rings, tool, op) {
    const out = [];
    rings.forEach(r => boolSafe(r, tool, op).forEach(x => out.push(x)));
    return out.length ? out : rings;
  }
  // Rechteck (auch gedreht) als Polygon: Mitte (cx,cy), Breite w, Höhe h, Winkel°.
  function rectPoly(cx, cy, w, h, deg) {
    const a = (deg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
      .map(q => ({ x: cx + q[0] * c - q[1] * s, y: cy + q[0] * s + q[1] * c }));
  }
  function bboxOf(list) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    (list || []).forEach(pl => (pl.pts || pl).forEach(p => {
      if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
    }));
    if (!isFinite(minx)) return { minx: 0, miny: 0, maxx: 0, maxy: 0, w: 0, h: 0 };
    return { minx, miny, maxx, maxy, w: maxx - minx, h: maxy - miny };
  }
  function polyLen(pts, closed) {
    let L = 0, n = pts.length;
    for (let i = 0; i < n - (closed ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % n]; L += Math.hypot(b.x - a.x, b.y - a.y); }
    return L;
  }
  // Ellipse als Polygon (Leichterungslöcher).
  function ellipsePoly(cx, cy, rx, ry, n) {
    const o = []; n = n || 48;
    // Halber Schrittversatz: so liegt KEIN Eckpunkt exakt auf der waagrechten
    // oder senkrechten Mittellinie. Genau dort sitzen sonst die Kanten, gegen
    // die verschnitten wird (z. B. die senkrechte Schnittfläche der Nasen-
    // leiste) — ein Eckpunkt darauf liefert entartete Schnittpunkte.
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n * 2 * Math.PI;
      o.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
    }
    return o;
  }
  // Ecken eines Polygons verrunden (Leichterungslöcher: scharfe Ecken reißen im
  // Holz ein und sind mit dem Fräser ohnehin nicht herstellbar).
  function roundPoly(poly, rad) {
    if (!(rad > 0) || !poly || poly.length < 3) return poly;
    const n = poly.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
      const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
      const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
      if (l1 < 1e-9 || l2 < 1e-9) { out.push(p); continue; }
      const u1 = { x: v1.x / l1, y: v1.y / l1 }, u2 = { x: v2.x / l2, y: v2.y / l2 };
      const cosA = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
      const ang = Math.acos(cosA);
      if (ang > 2.9 || ang < 0.08) { out.push(p); continue; }   // fast gerade / entartet
      const tan = Math.min(rad / Math.tan(ang / 2), l1 * 0.45, l2 * 0.45);
      const r = tan * Math.tan(ang / 2);
      const p1 = { x: p.x + u1.x * tan, y: p.y + u1.y * tan };
      const p2 = { x: p.x + u2.x * tan, y: p.y + u2.y * tan };
      // Bogenmitte auf der Winkelhalbierenden
      let bx = u1.x + u2.x, by = u1.y + u2.y;
      const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
      const d = r / Math.sin(ang / 2);
      const c = { x: p.x + bx * d, y: p.y + by * d };
      const a1 = Math.atan2(p1.y - c.y, p1.x - c.x), a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(2, Math.ceil(Math.abs(da) / 0.35));
      for (let k = 0; k <= steps; k++) {
        const t = a1 + da * k / steps;
        out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
      }
    }
    return out;
  }
  // Beplankungsabzug (senkrechter Versatz nach innen). Nutzt den Rechenweg des
  // Rippendesigners, sonst den der Holmausschnitte.
  function insetProfile(pts, top, bot, sharp) {
    if (!(top > 0) && !(bot > 0)) return null;
    if (App.ribInset) { try { const r = App.ribInset(pts, top, bot, sharp); if (r && r.length > 2) return r; } catch (e) { /* Rückfall */ } }
    if (App.sparCoreFromSheet) { try { const r = App.sparCoreFromSheet(pts, { top, bot }); if (r && r.length > 2) return r; } catch (e) { /* Rückfall */ } }
    return null;
  }
  // Ober-/Unterseite eines Profils an der Stelle x (y oben/unten).
  function surfAt(pts, x) {
    if (App.surfaceAtX) { const s = App.surfaceAtX(pts, x); if (s) return s; }
    let top = -Infinity, bot = Infinity, hit = false;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a.x - x) * (b.x - x) <= 0 && Math.abs(b.x - a.x) > 1e-12) {
        const y = a.y + (x - a.x) / (b.x - a.x) * (b.y - a.y);
        if (y > top) top = y; if (y < bot) bot = y; hit = true;
      }
    }
    return hit ? { top, bot } : null;
  }

  // ==================================================================
  //  2. Einstellungen
  // ==================================================================
  // Bauteilgruppe: Werkstoff + Materialstärke. Rippen werden Gruppen
  // zugeordnet (z. B. „Hauptrippen 3 mm Pappel", „Nasenrippen 1,5 mm Balsa").
  // Die Stärke der Gruppe bestimmt Schlitzbreiten (Rippenkamm, Helling),
  // die Schachtelung (je Platte ein Werkstoff/eine Stärke) und die Beschriftung.
  function rfGroupDefault(name, t) {
    return { name: name || 'Gruppe', matId: null, t: t != null ? t : 3, color: null };
  }
  function rfSparDefault(pos) {
    return {
      name: '', posMode: 'pct', pos: pos != null ? pos : 30,
      segFrom: 0, segTo: 99,
      capMode: 'both',          // 'both' | 'top' | 'bot' | 'none'
      capW: 8, capT: 3,         // Gurtbreite (Sehnenrichtung) / Gurtdicke (Höhe)
      capTaper: true,           // Gurtbreite zur Spitze hin verjüngen
      capWTip: 6, capMat: null,
      web: 'flat',              // 'none' | 'flat' | 'comb' | 'hole'
      webT: 3, webMat: null,    // Stegdicke (Material) / Werkstoff
      webBetween: true,         // Stegblätter zwischen den Rippen statt durchgehend
      webSide: 'both',          // aufgeleimt vorn / hinten / beidseitig am Holm
      webFull: true,            // Steg über die volle Höhe zwischen den Gurten
      webH: 0,                  // sonst feste Steghöhe (mm)
      combDepth: 0, combTop: false,     // Rippenkamm: Schlitztiefe (0 = halbe Höhe), Schlitz von oben
      combSlit: false, combSlitY: 10,   // Sollbruch-Perforation: an/aus, Höhe über der Unterkante
      combSlitLen: 8, combSlitGap: 4, combSlitW: 0.8,
      combGap: 0,                       // Zugabe der Rippennut in Sehnenrichtung (je Seite)
      holeW: 8, holeH: 0,       // 'hole': reiner Durchbruch in der Rippe (Vierkantholm)
      holeShape: 'rect',        // 'rect' = Kastenholm/Vierkant, 'round' = Rundholm/Rohr
      notchFit: 0.1,            // Übermaß der Nut je Seite (mm)
      webHoles: false           // Leichterungslöcher im Steg
    };
  }
  function rfCfg() {
    const c = state.cfg;
    if (!c.rf) c.rf = {};
    const r = c.rf;
    const def = (k, v) => { if (r[k] == null) r[k] = v; };
    def('mode', 'perSeg'); def('perSeg', 6); def('spacing', 80); def('atJoints', true);
    if (!Array.isArray(r.manualZ)) r.manualZ = null;
    def('points', 160); def('teThk', 0);
    def('kerf', 0);
    // --- Rippengruppen (Werkstoff + Stärke) ---
    if (!Array.isArray(r.groups) || !r.groups.length) r.groups = [rfGroupDefault('Hauptrippen', 3)];
    r.groups.forEach(g => { const d = rfGroupDefault(); Object.keys(d).forEach(k => { if (g[k] === undefined) g[k] = d[k]; }); });
    if (!r.groupPer) r.groupPer = {};           // Rippenindex -> Gruppenindex
    def('groupAuto', 'none');                    // 'none' | 'type' | 'seg'
    def('typeDefault', 'full'); if (!r.typePer) r.typePer = {};
    if (!r.exPer) r.exPer = {};   // Ausnahmen je Rippe: {sheet,spar,jig,le,te,flap} = weglassen
    def('flatten', false);        // Rippen zum Schneiden auf die Sehne drehen (Schränkung raus)
    def('typeEvery', 0);          // 0/1 = aus; sonst: jede n-te Rippe abweichend
    def('typeAlt', 'dbox');       // Art der abweichenden Rippen
    def('typeAltInv', false);     // umgekehrt: jede n-te bekommt die STANDARD-Art
    def('dboxTo', 30); def('teFrom', 70);
    def('skewMode', 'none'); def('skewAngle', 0); def('skewScope', 'all'); def('skewSpar', 0);
    def('flapSplit', false); def('flapGap', 1); def('flapMode', 'wing'); def('flapFrom', 75);
    def('flapNose', 'v');        // Ruder-Nase: 'straight' | 'v' | 'round' (Hohlkehle)
    def('flapHinge', 'top');     // Scharnierlage: 'top' | 'mid' | 'bot'
    def('flapDefl', 45);         // größter Ausschlag (bestimmt den Keilwinkel)
    if (!r.flapSpar) r.flapSpar = {};
    const fs = r.flapSpar;
    if (fs.on == null) fs.on = true;       // Hilfsholm in der Fläche vor der Scharnierlinie
    if (fs.w == null) fs.w = 6;            // Breite in Sehnenrichtung
    if (fs.t == null) fs.t = 3;            // Materialstärke (Steg hochkant)
    if (fs.mat === undefined) fs.mat = null;
    if (fs.caps == null) fs.caps = false;  // (alt) Hilfsgurte oben/unten
    if (!fs.mode) fs.mode = 'caps';
    if (!fs.xMode) fs.xMode = 'auto'; if (fs.dTop == null) fs.dTop = 1; if (fs.dBot == null) fs.dBot = 1;        // 'caps' = Gurte in Nuten wie beim Hauptholm, 'strip' = aufgeleimte Leiste
    if (fs.capW == null) fs.capW = 6; if (fs.capT == null) fs.capT = 2;
    if (!r.flapRSpar) r.flapRSpar = {};
    const fr = r.flapRSpar;
    if (fr.on == null) fr.on = true;       // Nasenholm im Ruder
    if (fr.w == null) fr.w = 6;
    if (fr.t == null) fr.t = 3;
    if (fr.mat === undefined) fr.mat = null;
    if (!fr.mode) fr.mode = 'caps';
    if (!fr.xMode) fr.xMode = 'auto'; if (fr.dTop == null) fr.dTop = 1; if (fr.dBot == null) fr.dBot = 1;
    if (fr.capT == null) fr.capT = 2;
    def('sparSrc', 'own');
    if (!Array.isArray(r.sparsOwn)) r.sparsOwn = [rfSparDefault(30)];
    r.sparsOwn.forEach(sp => { const d = rfSparDefault(); Object.keys(d).forEach(k => { if (sp[k] == null) sp[k] = d[k]; }); });
    def('sheetSrc', 'wing'); def('sheetTop', 1.5); def('sheetBot', 1.5); def('sheetMat', null);
    if (!r.zones) r.zones = {};
    const z = r.zones;
    if (z.dbox == null) z.dbox = true; if (z.flap == null) z.flap = false; if (z.dboxTo == null) z.dboxTo = 30;
    if (z.full == null) z.full = false;
    if (z.te == null) z.te = false; if (z.teFrom == null) z.teFrom = 70;
    // Form der Beplankungskante im Grundriss (Oldtimer-Formen).
    ['dboxEdge', 'teEdge'].forEach(k => {
      if (!z[k]) z[k] = {};
      const e = z[k];
      if (!e.shape) e.shape = 'straight';   // straight | scallop | tongue | zigzag
      if (e.tip === undefined) e.tip = null; // % Sehne am Rand (null = wie an der Wurzel)
      if (e.depth == null) e.depth = 6;      // Bogen-/Zungentiefe (% Sehne)
      if (e.width == null || e.width > 30) e.width = 8;   // Zungenbreite (mm) — üblich 1,5–3 × Rippenstärke
      if (!e.rootMode) e.rootMode = 'round'; // Wurzelübergang: 'round' (Kehle) | 'tri' (Dreieck)
      if (e.rootLen == null) e.rootLen = 0;  // Wurzelbeplankung: Länge ab Wurzel (mm)
      if (e.rootTo == null) e.rootTo = 100;  // ... bis % Sehne an der Wurzel
    });
    if (z.teBoth == null) z.teBoth = false;
    if (!r.capStrip) r.capStrip = {};
    { const c = r.capStrip; if (c.on == null) c.on = false; if (c.w == null) c.w = 4; if (c.t == null) c.t = 1;
      if (c.bot == null) c.bot = true; if (c.mat === undefined) c.mat = null; }
    def('devOn', true); def('devPanelMax', 0); def('devMark', true);
    if (!r.jig) r.jig = {};
    const j = r.jig;
    if (j.on == null) j.on = false;
    if (!j.mode) j.mode = 'tab';       // 'tab' = Rippennase in Helling-Schlitz, 'cradle' = Auflagebock
    if (j.h == null) j.h = 40;         // Höhe der Helling über der Bauplatte
    if (j.tabW == null) j.tabW = 20; if (j.tabH == null) j.tabH = 12;
    if (j.railH == null) j.railH = 60; if (j.railT == null) j.railT = 5;
    if (j.mat == null) j.mat = null;
    if (j.ref == null) j.ref = 'te';   // Bezugslinie: 'te' Endleiste, 'chord' Sehne, 'le' Nasenleiste
    if (j.fit == null) j.fit = 0.1;
    if (j.tabPos == null) j.tabPos = 60;   // % Sehne, wo die Nase sitzt
    if (j.tab2 == null) j.tab2 = true;     // zweite Nase (Verdrehsicherung)
    if (j.tabPos2 == null) j.tabPos2 = 20;
    if (j.margin == null) j.margin = 10;   // Rand um die Rippe beim Negativ-Brett
    if (!j.cradleSide) j.cradleSide = 'bot';   // Auflagebock unter der Rippe / Negativbett darüber
    if (j.tabBreak == null) j.tabBreak = true;  // Fuß nur seitlich anbinden (Trennschlitz)
    if (j.tabBridge == null) j.tabBridge = 3;   // Breite der Anbindung je Seite (mm)
    if (j.tabSlit == null) j.tabSlit = 0.8;     // Breite des Trennschlitzes (mm)
    if (!r.geo) r.geo = {};
    const g = r.geo;
    if (g.on == null) g.on = false;
    if (g.angle == null) g.angle = 45;
    if (g.width == null) g.width = 8;
    if (g.from == null) g.from = 30; if (g.to == null) g.to = 95;
    if (g.both == null) g.both = true;
    // 'cross'  = echter Kreuzverband: zwei Scharen ±Winkel, an jeder Kreuzung
    //            halb/halb verzahnt — die Diagonalen SIND die Rippen.
    // 'zigzag' = Warren-Fachwerk: Diagonalen Ende an Ende, Dreiecke, keine Kreuzung.
    // 'extra'  = zusätzliche Diagonalrippen zwischen den normalen Rippen
    //            (Oldtimer-Praxis: Verdrehsteifigkeit im hinteren Feld).
    if (g.mode == null) g.mode = 'cross';
    if (g.spaceMode == null) g.spaceMode = 'auto';   // 'auto' | 'perBay' | 'spacing'
    if (g.spacing == null) g.spacing = 120;
    if (g.replace == null) g.replace = true;         // normale Rippen im Bereich weglassen
    if (g.node == null) g.node = false;              // kurzes senkrechtes Rippenstück am Knoten
    if (g.keepTo == null) g.keepTo = null;           // normale Rippen bis % Sehne behalten (null = bis g.from)
    if (g.inFlap == null) g.inFlap = false;          // Diagonalen nur im Ruder (ab Scharnier + Spalt)
    if (g.holes == null) g.holes = true;             // Leichterung der geodätischen Rippen
    if (!g.holeStyle) g.holeStyle = 'offset';
    if (g.holeWeb == null) g.holeWeb = 4;            // Randsteg (mm)
    if (g.holeMin == null) g.holeMin = 6;
    if (g.notch == null) g.notch = true;     // Kreuzungen halb/halb ausklinken
    if (g.t == null) g.t = 2; if (g.mat === undefined) g.mat = null;
    // --- Steckung (Flächenverbinder) ---
    if (!r.joiner) r.joiner = {};
    const jo = r.joiner;
    if (jo.on == null) jo.on = false;
    if (!jo.shape) jo.shape = 'round';     // 'round' = Rundstahl/Rohr, 'rect' = Flachstahl/Kasten
    if (jo.w == null) jo.w = 10;           // Durchmesser bzw. Breite (mm)
    if (jo.h == null) jo.h = 10;           // Höhe (nur 'rect')
    if (!jo.posMode) jo.posMode = 'pct';
    if (jo.pos == null) jo.pos = 30;       // Lage ab Nasenleiste
    if (!jo.yMode) jo.yMode = 'mid';       // 'mid' = Skelettlinie, 'mm' = fester Abstand zur Sehne
    if (jo.y == null) jo.y = 0;
    if (jo.fit == null) jo.fit = 0.2;      // Passung ringsum (mm)
    if (!jo.scope) jo.scope = 'count';     // 'count' = die ersten n Rippen, 'group' = eine Rippengruppe
    if (jo.count == null) jo.count = 3;
    if (jo.group == null) jo.group = 0;
    if (!jo.side) jo.side = 'root';        // 'root' | 'tip' | 'both'
    if (jo.angle == null) jo.angle = 0;    // Neigung der Steckung (V-Form), Grad
    def('gap', 8); def('cols', 0); def('labelH', 4); def('label', true); def('plateSplit', true);
    def('plateW', 0); def('plateH', 0);   // Maß der Materialplatte (0 = unbegrenzt)
    if (!r.holes) r.holes = {};
    const h = r.holes;
    if (h.on == null) h.on = false;
    if (h.margin == null) h.margin = 6; if (h.min == null) h.min = 14;
    if (h.max == null) h.max = 60; if (h.round == null) h.round = true;
    if (!h.style) h.style = 'ellipse';      // 'ellipse' | 'offset' | 'truss'
    if (h.webW == null) h.webW = 5;         // Stegbreite im Fachwerk
    if (h.angle == null) h.angle = 45;      // Neigung der Fachwerkstreben
    if (h.fillet == null) h.fillet = 2;     // Eckenverrundung der Löcher (mm)
    if (!r.show) r.show = {};
    const s = r.show;
    ['ribs', 'caps', 'webs', 'flap', 'jig', 'sheet', 'geo', 'le', 'te'].forEach(k => { if (s[k] == null) s[k] = (k === 'ribs' || k === 'caps' || k === 'webs' || k === 'flap'); });
    def('leOn', false); def('leW', 8); def('leH', 8); def('leMat', null);
    def('leShape', 'strip');     // 'strip' = Vierkant, 'round' = Rundstab, 'tri' = Dreikant
    def('leD', 8);               // Durchmesser des Rundstabs (mm)
    def('leCut', true);          // Rippen vorn für die Nasenleiste abschneiden
    def('leTriW', 8); def('leTriH', 8);   // Dreikantleiste: Kathete waagerecht/senkrecht
    def('leFit', 0.1);           // Passung der Einlassung je Seite (mm)
    def('teOn', false); def('teW', 20); def('teH', 3); def('teMat', null);
    def('teCut', true);          // Rippen hinten für das Endleistenbrett abschneiden
    return r;
  }

  // ==================================================================
  //  2b. Eigene Werkstoffdatenbank (Holz & Platten für den Rippenbau)
  // ==================================================================
  // Die globale Werkstoff-Datenbank der App ist auf SCHAUM ausgelegt (Abbrand,
  // Vorschub, Drahttemperatur) — für eine Rippenfläche braucht es Holzarten mit
  // ihren üblichen LIEFERSTÄRKEN. Diese Liste gehört deshalb dem Modul, liegt im
  // Projekt (state.cfg.rf.woods) und ist frei erweiter-/änderbar. Die
  // Startwerte sind handelsübliche Modellbau-Werkstoffe; „Liste zurücksetzen"
  // stellt sie wieder her.
  const WOOD_SEED = [
    { id: 'balsa_l', name: 'Balsa leicht', kind: 'Balsa', density: 100, thick: [0.6, 0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] },
    { id: 'balsa_m', name: 'Balsa mittel', kind: 'Balsa', density: 130, thick: [0.6, 0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] },
    { id: 'balsa_h', name: 'Balsa hart', kind: 'Balsa', density: 180, thick: [1, 1.5, 2, 3, 4, 5, 6, 8, 10] },
    { id: 'ply_pop', name: 'Pappel-Sperrholz', kind: 'Sperrholz', density: 450, thick: [0.4, 0.6, 0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8] },
    { id: 'ply_bir', name: 'Birke-Sperrholz (Flugzeugsperrholz)', kind: 'Sperrholz', density: 680, thick: [0.4, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6] },
    { id: 'ply_buc', name: 'Buche-Sperrholz', kind: 'Sperrholz', density: 750, thick: [1, 1.5, 2, 3, 4, 5, 6] },
    { id: 'kiefer', name: 'Kiefer (Leisten/Vollholz)', kind: 'Vollholz', density: 500, thick: [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15] },
    { id: 'abachi', name: 'Abachi', kind: 'Vollholz', density: 380, thick: [0.6, 0.8, 1, 1.5, 2, 3, 4] },
    { id: 'depron', name: 'Depron / XPS-Platte', kind: 'Schaum', density: 35, thick: [1, 2, 3, 4, 5, 6] },
    { id: 'gfk', name: 'GFK-Platte', kind: 'Faserverbund', density: 1900, thick: [0.5, 0.8, 1, 1.5, 2, 3] },
    { id: 'cfk', name: 'CFK-Platte', kind: 'Faserverbund', density: 1500, thick: [0.3, 0.5, 0.8, 1, 1.5, 2, 3] }
  ];
  function woodDb() {
    const rc = rfCfg();
    if (!Array.isArray(rc.woods) || !rc.woods.length) rc.woods = WOOD_SEED.map(w => Object.assign({}, w, { thick: w.thick.slice() }));
    rc.woods.forEach(w => { if (!Array.isArray(w.thick)) w.thick = []; if (w.density == null) w.density = 0; });
    return rc.woods;
  }
  function woodOf(id) { return id ? woodDb().find(w => w.id === id) || null : null; }
  function woodOptions() { return [['', T('— offen —')]].concat(woodDb().map(w => [w.id, w.name + (w.kind ? ' · ' + w.kind : '')])); }
  function woodAddId(name) {
    const base = (name || 'holz').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 12) || 'holz';
    let id = base, k = 2; while (woodDb().some(w => w.id === id)) id = base + '_' + (k++);
    return id;
  }
  function thickListOf(id) { const w = woodOf(id); return w && w.thick.length ? w.thick.slice().sort((a, b) => a - b) : []; }
  // Nächstliegende Lieferstärke eines Werkstoffs (für „Stärke übernehmen").
  function snapThick(id, t) {
    const l = thickListOf(id); if (!l.length) return t;
    return l.reduce((b, v) => Math.abs(v - t) < Math.abs(b - t) ? v : b, l[0]);
  }

  // Anzeigename eines Werkstoffs (leer = „—").
  function matName(id) {
    if (!id) return '';
    const w = woodOf(id); if (w) return w.name;
    if (App.matField) { const n = App.matField(id, 'name', ''); if (n) return n; }
    return String(id);
  }
  // Rohdichte (kg/m³) eines Werkstoffs — für die Massenangabe in der Stückliste.
  function matDensity(id) {
    const w = woodOf(id); if (w) return w.density || 0;
    if (App.matField) { const d = App.matField(id, 'density', 0); if (d) return +d || 0; }
    return 0;
  }
  // Gruppe einer Rippe (Index in rc.groups, immer gültig).
  function groupOf(idx, info) {
    const rc = rfCfg(), n = rc.groups.length;
    let gi = rc.groupPer[idx];
    if (gi == null && rc.groupAuto === 'type' && info) {
      const order = ['full', 'dbox', 'te', 'nose'];
      gi = Math.min(n - 1, Math.max(0, order.indexOf(info.type)));
    } else if (gi == null && rc.groupAuto === 'seg' && info) gi = Math.min(n - 1, info.seg | 0);
    if (gi == null) gi = 0;
    return Math.max(0, Math.min(n - 1, gi | 0));
  }
  function groupObj(idx, info) { return rfCfg().groups[groupOf(idx, info)]; }
  // Materialstärke einer Rippe (mm) — bestimmt Schlitzbreiten und Platten.
  function ribThick(idx, info) { const g = groupObj(idx, info); return Math.max(0.2, g.t || 3); }

  // ==================================================================
  //  3. Tragflächen-Geometrie: Stationen, Schnitte, Grundriss
  // ==================================================================
  function hasWing() { return !!(App.wing && App.wing.cuts && App.wing.cuts.length && App.wing.stations && App.wing.stations.length > 1); }
  function segStarts() {
    const z0 = []; let acc = 0;
    (state.segments || []).forEach(s => { z0.push(acc); acc += (s.span || 0); });
    return { z0, total: acc };
  }
  function locateZ(z) {
    const { z0 } = segStarts(), segs = state.segments;
    for (let i = 0; i < segs.length; i++) {
      const a = z0[i], sp = segs[i].span || 0;
      if (z <= a + sp + 1e-6) return { seg: i, t: sp ? Math.max(0, Math.min(1, (z - a) / sp)) : 0 };
    }
    const li = Math.max(0, segs.length - 1); return { seg: li, t: 1 };
  }
  // Profil-Endleistendicke und Punktzahl wie im Rippendesigner anwenden.
  function processOutline(pts) {
    const rc = rfCfg();
    const N = Math.max(20, Math.round(rc.points || 160));
    let rs = window.Airfoil ? Airfoil.resample(pts, N) : pts;
    if (rc.teThk > 0 && App.thickenTE) { const t = App.thickenTE(rs, rc.teThk); t.name = rs.name; rs = t; }
    return rs;
  }
  // Querschnitt an beliebiger Spannweitenposition z (mm ab Wurzel), in den
  // LOKALEN Paneel-Koordinaten des zugehörigen Schnitts — wie ribOutline().
  const secCache = new Map();
  function sectionAt(z) {
    const key = Math.round(z * 1000) / 1000;
    if (secCache.has(key)) return secCache.get(key);
    const st = locateZ(z);
    const cut = App.wing.cuts[Math.min(st.seg, App.wing.cuts.length - 1)];
    const r = cut.root.pts, tp = cut.tip.pts, N = Math.min(r.length, tp.length);
    let pts = [];
    for (let i = 0; i < N; i++) pts.push({ x: r[i].x + (tp[i].x - r[i].x) * st.t, y: r[i].y + (tp[i].y - r[i].y) * st.t });
    const chord = cut.root.chord + (cut.tip.chord - cut.root.chord) * st.t;
    pts = processOutline(pts);
    const xs = pts.map(p => p.x);
    const leX = Math.min.apply(null, xs), teX = Math.max.apply(null, xs);
    const res = { pts, chord, leX, teX, seg: st.seg, t: st.t, z };
    secCache.set(key, res);
    return res;
  }
  function clearCache() { secCache.clear(); edgeRibZ = null; }
  // Grundriss (absolute Lage): Nasen-/Endleiste je Station.
  function leTeArr() {
    return App.wing.stations.map(s => {
      const xs = s.pts.map(p => p.x);
      return { z: s.z, le: Math.min.apply(null, xs), te: Math.max.apply(null, xs) };
    });
  }
  function leTeAt(z, arr) {
    arr = arr || leTeArr();
    if (z <= arr[0].z) return { z, le: arr[0].le, te: arr[0].te };
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      if (z <= b.z + 1e-6) { const t = (z - a.z) / ((b.z - a.z) || 1); return { z, le: a.le + (b.le - a.le) * t, te: a.te + (b.te - a.te) * t }; }
    }
    const l = arr[arr.length - 1]; return { z, le: l.le, te: l.te };
  }
  // Scharnierlinie (% Sehne ab Endleiste) an z — aus den Segmentwerten des
  // Tragflächendesigns (seg.hingePct / hingePctTip) oder fest eingestellt.
  function hingePctAt(z) {
    const rc = rfCfg();
    if (rc.flapMode === 'fixed') return 100 - Math.max(0, Math.min(100, rc.flapFrom));
    const st = locateZ(z), seg = (state.segments || [])[st.seg];
    if (!seg) return 25;
    const a = seg.hingePct || 0, b = seg.hingePctTip != null ? seg.hingePctTip : a;
    return a + (b - a) * st.t;
  }
  // Sehnenanteil (0…1) der Scharnierlinie an z, oder null ohne Ruder.
  function hingeFracAt(z) {
    if (!rfCfg().flapSplit) return null;
    const p = Math.max(0, Math.min(100, hingePctAt(z)));
    return p > 0 ? 1 - p / 100 : null;
  }
  // Absolutes x der Scharnierlinie an z (Grundriss). 0 = kein Ruder.
  function hingeXAt(z, arr) {
    const lt = leTeAt(z, arr), ch = lt.te - lt.le;
    const p = Math.max(0, Math.min(100, hingePctAt(z)));
    return p > 0 ? lt.te - ch * p / 100 : null;
  }

  // ==================================================================
  //  4. Rippenstationen, Rippenarten, Schrägstellung
  // ==================================================================
  const RIB_TYPES = [
    ['full', 'Vollrippe (ganze Sehne)'],
    ['dbox', 'D-Box-Rippe (nur vorn bis zum Holm)'],
    ['te', 'Endleistenrippe (nur hinterer Teil)'],
    ['both', 'Vorn + hinten (Mitte offen)'],
    ['skip', 'Keine Rippe']
  ];
  function ribTypeLabel(t) { const e = RIB_TYPES.find(x => x[0] === t); return e ? T(e[1]) : t; }
  // Verteilung der Rippen über die Spannweite (wie im Rippendesigner, aber mit
  // eigener Einstellung) + Art, Gruppe und Schrägstellung je Rippe.
  function rfStations() {
    const rc = rfCfg();
    if (!hasWing()) return { list: [], total: 0 };
    const { z0, total } = segStarts();
    let zs = [];
    if (rc.mode === 'manual') zs = (rc.manualZ || []).slice();
    else if (rc.mode === 'spacing') {
      const sp = Math.max(5, rc.spacing || 80);
      for (let z = 0; z <= total + 1e-6; z += sp) zs.push(z);
      if (!zs.length || zs[zs.length - 1] < total - 1e-6) zs.push(total);
    } else {
      const n = Math.max(2, Math.round(rc.perSeg || 6));
      (state.segments || []).forEach((s, i) => { const sp = s.span || 0; for (let k = 0; k < n; k++) zs.push(z0[i] + sp * k / (n - 1)); });
    }
    if (rc.atJoints && rc.mode !== 'manual') { zs.push(0); z0.forEach((z, i) => { if (i > 0) zs.push(z); }); zs.push(total); }
    zs = zs.filter(z => z >= -1e-6 && z <= total + 1e-6).sort((a, b) => a - b);
    const out = [];
    zs.forEach(z => { if (!out.length || Math.abs(z - out[out.length - 1].z) > 1.0) out.push(Object.assign({ z }, locateZ(z))); });
    const arr = leTeArr();
    out.forEach((st, i) => {
      st.idx = i;
      st.type = rc.typePer[i] || autoType(i);
      st.skew = skewAt(st.z, arr);
      st.group = groupOf(i, st);
      st.t_mat = ribThick(i, st);
      st.hinge = hingeXAt(st.z, arr);
      st.isRoot = i === 0; st.isTip = i === out.length - 1;
    });
    return { list: out, total };
  }
  // Rippenart aus dem Muster: jede n-te Rippe kann eine andere Art bekommen
  // (z. B. Vollrippe — Nasenrippe — Vollrippe — Nasenrippe). Eine von Hand
  // gesetzte Art hat immer Vorrang.
  function autoType(i) {
    const rc = rfCfg(), n = Math.round(rc.typeEvery || 0);
    if (n < 2) return rc.typeDefault || 'full';
    const hit = (i % n) === 0;
    const main = rc.typeDefault || 'full', alt = rc.typeAlt || 'dbox';
    return rc.typeAltInv ? (hit ? alt : main) : (hit ? main : alt);
  }
  // Steigung einer Bezugslinie im Grundriss (dx je dz) an der Stelle z.
  function lineSlope(z, kind, arr) {
    const d = Math.max(1, (segStarts().total || 100) * 0.01);
    const za = Math.max(0, z - d), zb = Math.min(segStarts().total, z + d);
    const xAt = zz => {
      if (kind === 'le') return leTeAt(zz, arr).le;
      if (kind === 'te') return leTeAt(zz, arr).te;
      if (kind === 'hinge') { const h = hingeXAt(zz, arr); return h != null ? h : leTeAt(zz, arr).te; }
      return sparXAt(rfCfg().skewSpar | 0, zz, arr);       // 'spar'
    };
    const xa = xAt(za), xb = xAt(zb);
    if (xa == null || xb == null || zb - za < 1e-6) return 0;
    return (xb - xa) / (zb - za);
  }
  // Schrägstellung einer Rippe in Grad. 0 = senkrecht zur Spannweitenachse.
  // Positiv = die Rippe „kippt" zur Spitze hin nach hinten.
  function skewAt(z, arr) {
    const rc = rfCfg();
    if (rc.skewMode === 'none') return 0;
    if (rc.skewMode === 'angle') return Math.max(-70, Math.min(70, rc.skewAngle || 0));
    const sl = lineSlope(z, rc.skewMode, arr);            // dx/dz der Bezugslinie
    // Rippe senkrecht zur Bezugslinie: Richtung (dx=1, dz=-sl) -> tanβ = -sl.
    return Math.atan(-sl) * 180 / Math.PI;
  }
  // Querschnitt entlang einer SCHRÄGEN Schnittebene durch die Fläche.
  // beta = Winkel (Grad) gegen die Senkrechte zur Spannweitenachse, refX =
  // absolute Sehnenlage des Drehpunkts bei z0. Ergebnis im Rippensystem:
  // x = wahre Länge in der Rippenebene ab Drehpunkt, y = Höhe.
  // Liefert zusätzlich die Angaben, mit denen sich der Schnitt später wieder im
  // Raum platzieren lässt (3D-Ansicht): Drehpunkt, Anker-Höhe, Winkel.
  function obliqueOutline(z0, beta, refFrac) {
    const arr = leTeArr(), total = segStarts().total;
    const base = sectionAt(z0), baseLT = leTeAt(z0, arr);
    const refX = baseLT.le + (refFrac != null ? refFrac : 0.25) * (baseLT.te - baseLT.le);
    const anchorY = sec => { const s = surfAt(sec.pts, sec.leX + 0.25 * (sec.teX - sec.leX)); return s ? (s.top + s.bot) / 2 : 0; };
    if (!beta) {
      const y0 = anchorY(base), dx = refX - baseLT.le;
      return { pts: base.pts.map(p => ({ x: p.x - base.leX - dx, y: p.y - y0 })), chord: base.chord, beta: 0, refX, z: z0, anchorY: y0 };
    }
    const tb = Math.tan(beta * Math.PI / 180), cb = Math.cos(beta * Math.PI / 180);
    const N = base.pts.length, out = [];
    for (let i = 0; i < N; i++) {
      let z = z0, d = 0, y = 0;
      for (let it = 0; it < 4; it++) {
        const zc = Math.max(0, Math.min(total, z));
        const sec = sectionAt(zc), lt = leTeAt(zc, arr);
        const p = sec.pts[Math.min(i, sec.pts.length - 1)];
        const xAbs = p.x - sec.leX + lt.le;
        d = xAbs - refX; y = p.y - anchorY(sec);
        const zn = z0 + d * tb;
        if (Math.abs(zn - z) < 0.05) { z = zn; break; }
        z = zn;
      }
      out.push({ x: d / cb, y });
    }
    // Sehnenlänge der schrägen Rippe (Nase…Endleiste in der Rippenebene).
    const xs = out.map(p => p.x);
    return { pts: out, chord: Math.max.apply(null, xs) - Math.min.apply(null, xs), beta, refX, z: z0, anchorY: anchorY(base) };
  }
  // Waagerechter Schnitt eines Polygons bei y = yc (keepLower = alles darunter).
  function clipX90(poly, yc, keepLower) {
    if (!poly || poly.length < 3) return null;
    const inside = p => keepLower ? p.y <= yc + 1e-9 : p.y >= yc - 1e-9;
    const isec = (a, b) => { const t = (yc - a.y) / ((b.y - a.y) || 1e-9); return { x: a.x + t * (b.x - a.x), y: yc }; };
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], ai = inside(a), bi = inside(b);
      if (ai) { out.push(a); if (!bi) out.push(isec(a, b)); }
      else if (bi) out.push(isec(a, b));
    }
    return out.length >= 3 ? out : null;
  }
  // Senkrechter Schnitt eines Polygons bei x = xc (Sutherland-Hodgman).
  function clipX(poly, xc, keepFront) {
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

  // ==================================================================
  //  5. Holme: Lage, Gurte, Stege
  // ==================================================================
  // Wirksame Holmliste: entweder die im Tragflächendesigner definierten
  // Holmausschnitte (dann nur Lage/Breite übernommen) oder eigene Holme.
  function sparList() {
    const rc = rfCfg();
    if (rc.sparSrc === 'wing' && state.spars && state.spars.length) {
      return state.spars.map((sp, j) => {
        const d = rfSparDefault();
        const w = (sp.rootW != null ? sp.rootW : (sp.w != null ? sp.w : 8));
        return Object.assign(d, {
          name: T('Holm') + ' ' + (j + 1), posMode: sp.posMode === 'mm' ? 'mm' : 'pct',
          pos: sp.pos != null ? sp.pos : 30,
          segFrom: sp.segFrom | 0, segTo: sp.segTo | 0,
          capW: w, capWTip: w, capT: d.capT, fromWing: true
        });
      });
    }
    return rc.sparsOwn;
  }
  function sparApplies(sp, segIdx) {
    const a = Math.min(sp.segFrom | 0, sp.segTo | 0), b = Math.max(sp.segFrom | 0, sp.segTo | 0);
    return segIdx >= a && segIdx <= Math.min(b, (state.segments || []).length - 1);
  }
  // Absolute Sehnenlage (Grundriss-x) eines Holms an z.
  function sparXAt(j, z, arr) {
    const list = sparList(), sp = list[Math.max(0, Math.min(list.length - 1, j | 0))];
    if (!sp) return null;
    const lt = leTeAt(z, arr), ch = lt.te - lt.le;
    return lt.le + (sp.posMode === 'mm' ? (sp.pos || 0) : (sp.pos || 0) / 100 * ch);
  }
  // Lage eines Holms IM Rippensystem einer Rippe (x ab Rippen-Nase).
  function sparOnRib(sp, rib) {
    const ch = rib.chord;
    const xFromLE = sp.posMode === 'mm' ? (sp.pos || 0) : (sp.pos || 0) / 100 * ch;
    return rib.leX + xFromLE / Math.max(0.2, Math.cos((rib.beta || 0) * Math.PI / 180));
  }
  // Gurtbreite eines Holms an der Spannweitenposition z (Verjüngung).
  function capWAt(sp, z, total) {
    if (!sp.capTaper) return Math.max(0.5, sp.capW || 8);
    const f = total ? Math.max(0, Math.min(1, z / total)) : 0;
    return Math.max(0.5, (sp.capW || 8) + ((sp.capWTip != null ? sp.capWTip : sp.capW) - (sp.capW || 8)) * f);
  }

  // ==================================================================
  //  6. Beplankung: Dicke, Zonen, Abzug an der Rippe
  // ==================================================================
  function sheetAt(st) {
    const rc = rfCfg();
    if (rc.sheetSrc === 'global') return { top: rc.sheetTop || 0, bot: rc.sheetBot || 0 };
    if (!App.sheetFor || !state.segments[st.seg]) return { top: 0, bot: 0 };
    const sf = App.sheetFor(state.segments[st.seg]);
    return { top: sf.root.top + (sf.tip.top - sf.root.top) * st.t, bot: sf.root.bot + (sf.tip.bot - sf.root.bot) * st.t };
  }
  // Beplankungskante (Sehnenanteil 0…1) an der Spannweitenstelle z.
  //   which = 'dbox' (Hinterkante der Nasenbeplankung) | 'te' (Vorderkante der
  //   Endleistenbeplankung).
  // Formen wie an Oldtimer-Seglern:
  //   straight — gerade, optional linear von Wurzel zu Rand verlaufend
  //   scallop  — Girlanden: an den Rippen am weitesten, dazwischen Bögen zurück
  //   tongue   — Zungen: schmale Ausläufer entlang jeder Rippe
  //   zigzag   — gezackt, Spitzen an den Rippen
  // Dazu optional eine Wurzelbeplankung, die über rootLen mm zur Wurzel hin
  // weich bis rootTo % aufläuft.
  let edgeRibZ = null;
  function edgeF(which, z) {
    const zz = rfCfg().zones;
    const e = which === 'dbox' ? zz.dboxEdge : zz.teEdge;
    const base0 = (which === 'dbox' ? zz.dboxTo : zz.teFrom) || (which === 'dbox' ? 30 : 70);
    const total = segStarts().total || 1;
    const u = Math.max(0, Math.min(1, z / total));
    let f = (base0 + ((e && e.tip != null ? e.tip : base0) - base0) * u) / 100;
    const sgn = which === 'dbox' ? 1 : -1;       // + = zur beplankten Seite hin
    if (e && e.shape !== 'straight') {
      const zs = edgeRibZ || (edgeRibZ = rfStations().list.map(q => q.z));
      if (zs.length > 1) {
        let i = 0; while (i < zs.length - 2 && z > zs[i + 1]) i++;
        const za = zs[i], zb = zs[i + 1];
        const L = Math.max(1e-6, zb - za), t = Math.max(0, Math.min(1, (z - za) / L));
        const d = Math.max(0, e.depth || 0) / 100;
        if (e.shape === 'scallop') f -= sgn * d * Math.sin(Math.PI * t);
        else if (e.shape === 'zigzag') f -= sgn * d * (1 - Math.abs(2 * t - 1));
        else if (e.shape === 'tongue') {
          // Zunge: gerade Flanken über die halbe Breite, runde Spitze, weiche
          // Kehle in die Kante — so wie sie aus Sperrholz geschnitten wird.
          const hw = Math.max(0.5, (e.width || 8) / 2), fillet = hw;
          const dist = Math.min(z - za, zb - z);
          if (dist < hw) f += sgn * d;
          else if (dist < hw + fillet) f += sgn * d * (0.5 + 0.5 * Math.cos(Math.PI * (dist - hw) / fillet));
        }
      }
    }
    if (e && e.rootLen > 0 && z < e.rootLen) {
      // Wurzelbeplankung: Kehle (weich) oder Dreieck (gerade Schräge).
      const k = e.rootMode === 'tri' ? 1 - z / e.rootLen : 0.5 + 0.5 * Math.cos(Math.PI * z / e.rootLen);
      const tgt = which === 'dbox' ? Math.max(f, (e.rootTo || 100) / 100) : Math.min(f, 1 - (e.rootTo || 100) / 100);
      f = f + (tgt - f) * k;
    }
    return Math.max(0.005, Math.min(0.999, f));
  }
  // Ist die Stelle (Sehnenanteil f, Oberseite?) beplankt?
  function sheeted(f, top, hf, zp) {
    const z = rfCfg().zones;
    if (z.full) return true;
    if (zp != null) {
      if (z.flap && hf != null && rfCfg().flapSplit && f >= hf) return true;
      if (z.dbox && f <= edgeF('dbox', zp)) return true;
      if (z.te && f >= edgeF('te', zp) && (z.teBoth || top)) return true;
      return false;
    }
    // Ruder ganz beplankt (oben und unten, ab der Scharnierlinie).
    if (z.flap && hf != null && rfCfg().flapSplit && f >= hf) return true;
    if (z.dbox && f <= (z.dboxTo || 30) / 100) return true;
    if (z.te && f >= (z.teFrom || 70) / 100 && (z.teBoth || top)) return true;
    return false;
  }
  function anySheet() { const z = rfCfg().zones; return !!(z.full || z.dbox || z.te || (z.flap && rfCfg().flapSplit)); }
  // Rippenkontur unter der Beplankung: nur in den beplankten Zonen nach innen
  // versetzt. Dort, wo die Beplankung endet, bleibt eine senkrechte Stufe —
  // genau so sieht die Rippe im Bausatz aus.
  // hf = Sehnenanteil der Scharnierlinie (für „Ruder ganz beplanken"), sonst null.
  function zonedInset(pts, sh, chord, leX, hf, zp) {
    if ((!(sh.top > 0) && !(sh.bot > 0)) || !anySheet()) return null;
    const z = rfCfg().zones;
    let off = null;
    if (window.HotWire && HotWire.offsetPathTB) { try { off = HotWire.offsetPathTB(pts, sh.top || 0, sh.bot || 0); } catch (e) { off = null; } }
    if (!off || off.length !== pts.length) {
      if (z.full) return insetProfile(pts, sh.top, sh.bot, false);
      return null;
    }
    const n = pts.length;
    let iLE = 0; for (let i = 1; i < n; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    const isS = (p, top) => sheeted(chord ? (p.x - leX) / chord : 0, top, hf, zp);
    const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    const out = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, top = i <= iLE;
      const a = isS(pts[i], top), b = isS(pts[j], (j <= iLE));
      out.push(a ? off[i] : pts[i]);
      if (a === b) continue;
      // Ende der Beplankung: die Stufe steht SENKRECHT auf der Kontur. Dazu
      // wird die Übergangsstelle auf der Kante gesucht und dort der Punkt der
      // Außen- UND der Innenkontur eingefügt — beide liegen beim selben
      // Kantenparameter, die Verbindung ist damit die Flächennormale.
      let lo = 0, hi = 1;
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2;
        if (isS(lerp(pts[i], pts[j], m), top) === a) lo = m; else hi = m;
      }
      const u = (lo + hi) / 2;
      const A = lerp(pts[i], pts[j], u), B = lerp(off[i], off[j], u);
      if (a) { out.push(B); out.push(A); } else { out.push(A); out.push(B); }
    }
    return App.deloopPoly ? (App.deloopPoly(out) || out) : out;
  }

  // ==================================================================
  //  7. Eine Rippe bauen: Zuschnitt, Gurtnuten, Kammschlitze, Helling-
  //     nasen, Leichterungslöcher
  // ==================================================================
  // Ergebnis: { pieces: [ {rings:[…], holes:[…], tag} ], chord, leX, … }
  function buildRib(st) {
    const rc = rfCfg(), total = segStarts().total;
    if (st.type === 'skip') return null;
    // Bei „Schräg nur an den Rudern" bleibt der Hauptteil senkrecht.
    const mainBeta = rc.skewScope === 'flap' ? 0 : st.skew;
    const ex = rc.exPer[st.idx] || {};      // Ausnahmen dieser Rippe
    const o = obliqueOutline(st.z, mainBeta, 0.25);
    const xs0 = o.pts.map(p => p.x);
    const leX = Math.min.apply(null, xs0);
    let pts = o.pts.map(p => ({ x: p.x - leX, y: p.y }));
    // Zum Schneiden die Schränkung herausdrehen: die Sehne (Nase→Endleiste)
    // liegt dann waagerecht. Für die Helling ist das falsch — dort muss die
    // Rippe ihre Schränkung behalten, deshalb schaltbar.
    if (rc.flatten) {
      let iLE = 0, iTE = 0;
      for (let i = 1; i < pts.length; i++) { if (pts[i].x < pts[iLE].x) iLE = i; if (pts[i].x > pts[iTE].x) iTE = i; }
      const dx = pts[iTE].x - pts[iLE].x, dy = pts[iTE].y - pts[iLE].y;
      const a = -Math.atan2(dy, dx), ca = Math.cos(a), sa = Math.sin(a);
      const ox = pts[iLE].x, oy = pts[iLE].y;
      pts = pts.map(p => { const X = p.x - ox, Y = p.y - oy; return { x: X * ca - Y * sa, y: X * sa + Y * ca }; });
      const mn = Math.min.apply(null, pts.map(p => p.x));
      pts = pts.map(p => ({ x: p.x - mn, y: p.y }));
    }
    const chord = Math.max.apply(null, pts.map(p => p.x));
    const sh = ex.sheet ? { top: 0, bot: 0 } : sheetAt(st);
    const core = zonedInset(pts, sh, chord, 0, hingeFracAt(st.z), st.z);
    let base = core && core.length > 2 ? core : pts;
    const prof = pts;                      // Außenkontur (für Oberflächenlagen)
    // --- Nasenleiste: Rippe vorn freistellen -------------------------
    // Leiste (Vierkant): die Rippe wird senkrecht abgeschnitten, davor sitzt die
    // Leiste. Rundstab: die Rippe wird bis zur Stabachse abgeschnitten und
    // bekommt eine halbrunde Einlassung — der Stab liegt zur Hälfte in der Rippe.
    let leCutX = 0, leRound = null;
    if (rc.leOn && rc.leCut && !ex.le) {
      if (rc.leShape === 'round') {
        const r = Math.max(0.5, (rc.leD || 8) / 2) + Math.max(0, rc.leFit || 0);
        const su = surfAt(base, Math.min(r, chord * 0.4));
        const cy = su ? (su.top + su.bot) / 2 : 0;
        const cut = clipX(base, r, false);
        if (cut) {
          const ring = boolSafe(cut, ellipsePoly(r, cy, r, r, 56), 'diff');
          base = (ring && ring.length ? ring[0] : cut);
          leCutX = r; leRound = { x: r, y: cy, r };
        }
      } else {
        // Vierkant- UND Dreikantleiste stoßen mit einer senkrechten Klebefläche
        // an die Rippe: bei der Dreikantleiste ist das die Kathete.
        const xc = Math.max(0.5, rc.leShape === 'tri' ? (rc.leTriW || rc.leW || 8) : (rc.leW || 8));
        const cut = clipX(base, xc, false);
        if (cut) { base = cut; leCutX = xc; }
      }
    }
    // --- Endleistenbrett: Rippe hinten kappen ------------------------
    if (rc.teOn && rc.teCut && !ex.te) {
      const cut = clipX(base, Math.max(0.5, chord - (rc.teW || 20)), true);
      if (cut) base = cut;
    }
    // --- Zuschnitt nach Rippenart ------------------------------------
    const xD = chord * Math.max(0, Math.min(100, rc.dboxTo)) / 100;
    const xT = chord * Math.max(0, Math.min(100, rc.teFrom)) / 100;
    const pieces = [];
    const add = (ring, tag, beta) => { if (ring && ring.length > 2) pieces.push({ rings: [ring], holes: [], tag: tag || '', beta: beta != null ? beta : mainBeta }); };
    if (st.type === 'dbox') add(clipX(base, xD, true), 'D');
    else if (st.type === 'te') add(clipX(base, xT, false), 'E');
    else if (st.type === 'both') { add(clipX(base, xD, true), 'D'); add(clipX(base, xT, false), 'E'); }
    else add(base, '');
    // --- Geodätische Bauweise: die Diagonalen SIND dort die Rippen ---
    // Im Diagonalbereich entfällt die normale Rippe; stehen bleibt nur der
    // vordere Teil (D-Box). Wurzel- und Randrippe bleiben immer vollständig —
    // sie sind Anschluss- und Abschlussrippe, die Diagonalen enden an ihnen.
    if (rc.geo.on && rc.geo.replace && rc.geo.mode !== 'extra' && !st.isRoot && !st.isTip && !(rc.geo.inFlap && rc.flapSplit)) {
      const xg = chord * geoKeepTo() / 100;
      const keep = [];
      pieces.forEach(pc => {
        const r = clipX(pc.rings[0], xg, true);
        if (r && r.length > 2) { pc.rings = [r]; pc.holes = []; keep.push(pc); }
      });
      pieces.length = 0; keep.forEach(pc => pieces.push(pc));
      if (!pieces.length) return null;
    }
    // --- Ruder abtrennen (Scharnierlinie) ----------------------------
    if (rc.flapSplit && st.hinge != null && !ex.flap) {
      const lt = leTeAt(st.z), hx = (st.hinge - lt.le) / Math.max(0.2, Math.cos(mainBeta * Math.PI / 180));
      const gap = Math.max(0, rc.flapGap || 0) / 2;
      // Scharnierpunkt und örtliche Profildicke an der Trennstelle.
      const hs = surfAt(base, hx) || { top: 0, bot: 0 };
      const hT = Math.max(0.5, hs.top - hs.bot);
      const hy = rc.flapHinge === 'top' ? hs.top : rc.flapHinge === 'bot' ? hs.bot : (hs.top + hs.bot) / 2;
      const fsp = rc.flapSpar, frp = rc.flapRSpar;
      // Die Ruderlinie (Spalt, V-Anschliff, Hohlkehle) wird IMMER an der Rippe
      // ausgeformt. Die Hilfsholme stören sie nicht: sie sitzen entweder als
      // Gurte (Nuten oben/unten wie beim Hauptholm) oder als aufgeleimte Leiste
      // (nur gestrichelt eingezeichnet) knapp vor bzw. hinter der Formgebung.
      const src = pieces.slice(); pieces.length = 0;
      const round = rc.flapNose === 'round';
      const rNose = rc.flapHinge === 'mid' ? hT / 2 : hT;
      const aDef = Math.max(5, Math.min(80, rc.flapDefl || 45)) * Math.PI / 180;
      const vDepth = rc.flapNose === 'v' ? (rc.flapHinge === 'mid' ? hT / 2 : hT) * Math.tan(aDef) : 0;
      src.forEach(pc => {
        let a = clipX(pc.rings[0], hx - gap, true);
        let b = clipX(pc.rings[0], hx + gap, false);
        if (b && rc.flapNose !== 'straight') b = flapNoseShape(b, round ? hx : hx + gap, hy, hT, false, base);
        if (a && round) a = flapNoseShape(a, hx, hy, hT, true, base);
        if (a) pieces.push({ rings: [a], holes: [], marks: [], tag: pc.tag, beta: pc.beta });
        if (b) pieces.push({ rings: [b], holes: [], marks: [], tag: (pc.tag || '') + 'R', beta: pc.beta, flap: true });
      });
      // Kante des Ruderspalts an der Ober-/Unterseite (Bezug für die Hilfsholme).
      // Fläche: bei gerade/V die Schnittkante, bei der Hohlkehle der Schnitt des
      // Gegenkreises mit der Oberfläche. Ruder: je nach Nasenform.
      const edgeX = (flapSide, ys) => {
        if (round) {
          const R = flapSide ? rNose : rNose + 2 * gap, dy = ys - hy;
          return Math.abs(dy) < R ? hx - Math.sqrt(R * R - dy * dy) : (flapSide ? hx + gap : hx - gap);
        }
        if (!flapSide) return hx - gap;
        if (rc.flapNose !== 'v') return hx + gap;
        const topSurf = ys >= hy - 1e-6;
        if (rc.flapHinge === 'mid') return hx + gap + vDepth;
        if (rc.flapHinge === 'top') return topSurf ? hx + gap : hx + gap + vDepth;
        return topSurf ? hx + gap + vDepth : hx + gap;
      };
      // Gurte parallel zur Oberfläche, oben und unten getrennt platziert.
      const auxSpar = (cfg, flapSide) => {
        if (!cfg.on) return;
        const w = Math.max(0.5, cfg.w), cT = Math.max(0.2, cfg.capT || 2), fit = 0.1;
        const dist = which => cfg.xMode === 'mm' ? Math.max(0, which === 'top' ? cfg.dTop : cfg.dBot) : 1;
        const place = which => {
          const ys = which === 'top' ? hs.top : hs.bot;
          const e = edgeX(flapSide, ys), d = dist(which);
          const c = flapSide ? e + d + w / 2 : e - d - w / 2;
          const xa = c - w / 2 - fit, xb = c + w / 2 + fit;
          const sa = surfAt(base, xa), sb = surfAt(base, xb);
          return sa && sb ? { c, xa, xb, sa, sb } : null;
        };
        const T0 = place('top'), B0 = place('bot');
        pieces.forEach(pc => {
          if (!!pc.flap !== flapSide) return;
          const bb = bboxOf(pc.rings);
          const inP = q => q && q.c > bb.minx && q.c < bb.maxx;
          if (cfg.mode === 'strip') {
            if (inP(T0) && inP(B0)) pc.marks.push([{ x: B0.xa, y: B0.sa.bot }, { x: T0.xa, y: T0.sa.top }, { x: T0.xb, y: T0.sb.top },
              { x: B0.xb, y: B0.sb.bot }, { x: B0.xa, y: B0.sa.bot }]);
            return;
          }
          if (inP(T0)) {
            const sl = (T0.sb.top - T0.sa.top) / (T0.xb - T0.xa), dT = cT * Math.sqrt(1 + sl * sl);
            pc.rings = boolMany(pc.rings, [{ x: T0.xa, y: T0.sa.top - dT }, { x: T0.xb, y: T0.sb.top - dT },
              { x: T0.xb, y: T0.sb.top + 50 }, { x: T0.xa, y: T0.sa.top + 50 }], 'diff');
          }
          if (inP(B0)) {
            const sl = (B0.sb.bot - B0.sa.bot) / (B0.xb - B0.xa), dB = cT * Math.sqrt(1 + sl * sl);
            pc.rings = boolMany(pc.rings, [{ x: B0.xa, y: B0.sa.bot - 50 }, { x: B0.xb, y: B0.sb.bot - 50 },
              { x: B0.xb, y: B0.sb.bot + dB }, { x: B0.xa, y: B0.sa.bot + dB }], 'diff');
          }
        });
      };
      auxSpar(fsp, false);
      auxSpar(frp, true);
      // Geodäten nur im Ruder: dort ersetzen die Diagonalen die Ruderrippen.
      if (rc.geo.on && rc.geo.inFlap && rc.geo.replace && rc.geo.mode !== 'extra' && !st.isRoot && !st.isTip)
        for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].flap) pieces.splice(i, 1);
      // „Schräg nur an den Rudern": das Ruderstück wird aus einem eigenen,
      // schrägen Schnitt gewonnen (senkrecht zur Scharnierlinie).
      if (rc.skewScope === 'flap' && st.skew) {
        const o2 = obliqueOutline(st.z, st.skew, 0.75);
        const le2 = Math.min.apply(null, o2.pts.map(p => p.x));
        let p2 = o2.pts.map(p => ({ x: p.x - le2, y: p.y }));
        const ch2 = Math.max.apply(null, p2.map(p => p.x));
        const c2 = zonedInset(p2, sh, ch2, 0, hingeFracAt(st.z), st.z);
        const b2 = c2 && c2.length > 2 ? c2 : p2;
        const hx2 = (st.hinge - leTeAt(st.z).le) / Math.max(0.2, Math.cos(st.skew * Math.PI / 180));
        const rr = clipX(b2, hx2 + gap, false);
        for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].flap) pieces.splice(i, 1);
        if (rr) pieces.push({ rings: [rr], holes: [], tag: 'R', beta: st.skew, flap: true });
      }
    }
    // --- Holme: Gurtnuten, Kammschlitze, Durchbrüche -----------------
    const spars = [];
    sparList().forEach((sp, j) => {
      if (ex.spar || !sparApplies(sp, st.seg)) return;
      const x = sparOnRib(sp, { chord, leX: 0, beta: mainBeta });
      const s = surfAt(prof, x); if (!s) return;
      const sc = surfAt(base, x) || s;
      const fit = Math.max(0, sp.notchFit || 0);
      const w = capWAt(sp, st.z, total) + 2 * fit;
      const cT = Math.max(0.2, sp.capT || 3);
      const info = { sp, j, x, top: s.top, bot: s.bot, ctop: sc.top, cbot: sc.bot, w, cT };
      spars.push(info);
      const tools = [];
      if (sp.capMode === 'both' || sp.capMode === 'top') tools.push(rectPoly(x, s.top - cT / 2 + 50, w, 100 + cT, 0));
      if (sp.capMode === 'both' || sp.capMode === 'bot') tools.push(rectPoly(x, s.bot + cT / 2 - 50, w, 100 + cT, 0));
      if (sp.web === 'comb') {
        // Rippenkamm: senkrechter Schlitz in der Rippe, in den der Kamm greift.
        const h = Math.abs(sc.top - sc.bot);
        const d = sp.combDepth > 0 ? sp.combDepth : h / 2;
        const wS = Math.max(0.2, (sp.webT || 3) + 2 * fit + 2 * Math.max(0, sp.combGap || 0));
        const yc = sp.combTop ? sc.top + 50 - d : sc.bot - 50 + d;
        tools.push(rectPoly(x, yc, wS, 100, 0));
      }
      if (sp.web === 'hole') {
        const yc = (sc.top + sc.bot) / 2;
        if (sp.holeShape === 'round') {
          // Rundholm/Rohr: kreisrunde Aufnahme auf der Skelettlinie.
          const r = Math.max(0.3, (sp.holeW || 8) / 2 + fit);
          pieces.forEach(pc => pc.holes.push(ellipsePoly(x, yc, r, r, 48)));
        } else {
          const hh = sp.holeH > 0 ? sp.holeH : Math.abs(sc.top - sc.bot) * 0.5;
          pieces.forEach(pc => pc.holes.push(rectPoly(x, yc, Math.max(0.5, sp.holeW || 8) + 2 * fit, hh, 0)));
        }
      }
      tools.forEach(tool => pieces.forEach(pc => { pc.rings = boolMany(pc.rings, tool, 'diff'); }));
    });
    // --- Leichterungslöcher ------------------------------------------
    // BEWUSST vor der Helling: die Stützfüße sind Bauhilfe und werden später
    // abgetrennt — sie dürfen die Aufteilung der Rippenfelder nicht verändern.
    if (rc.holes.on && !ex.holes) pieces.forEach(pc => lightenHoles(pc, spars, chord)
      .forEach(h => pc.holes.push(rc.holes.fillet > 0 ? roundPoly(h, rc.holes.fillet) : h)));

    // --- Geodäten kreuzen die stehengebliebenen Rippen ----------------
    // Halb/halb verzahnt: die Rippe wird von OBEN geschlitzt, die Diagonale von
    // unten (in geoParts). Nur so leitet die Verbindung ein Moment weiter.
    if (rc.geo.on && rc.geo.mode !== 'extra') {
      const cr = geoRibCrossings(rfStations().list).byRib[st.idx];
      if (cr && cr.length) {
        const lt = leTeAt(st.z);
        const cb = Math.max(0.2, Math.cos(mainBeta * Math.PI / 180));
        cr.forEach(c => {
          const x = (c.xabs - lt.le) / cb;
          const su = surfAt(base, x); if (!su) return;
          const h = Math.abs(su.top - su.bot);
          const w = Math.max(0.2, (rc.geo.t || 2) + 0.1);
          pieces.forEach(pc => {
            const b = bboxOf(pc.rings);
            if (x <= b.minx + 0.5 || x >= b.maxx - 0.5) return;
            pc.rings = boolMany(pc.rings, rectPoly(x, su.top + 50 - h / 2, w, 100, 0), 'diff');
          });
        });
      }
    }
    // --- Steckung (Flächenverbinder) ---------------------------------
    // Die Steckung durchdringt die ersten Rippen ab der Wurzel (bzw. eine ganze
    // Rippengruppe). Die Ausnehmung wandert mit der V-Form: bei geneigter
    // Steckung verschiebt sie sich je Rippe in der Höhe.
    if (rc.joiner.on && !ex.joiner && joinerAppliesTo(st)) {
      const jo = rc.joiner;
      const x = jo.posMode === 'mm' ? (jo.pos || 0) : chord * Math.max(0, Math.min(100, jo.pos)) / 100;
      const su = surfAt(base, x);
      if (su) {
        const dz = jo.side === 'tip' ? (segStarts().total - st.z) : st.z;
        const yc = (jo.yMode === 'mm' ? (jo.y || 0) : (su.top + su.bot) / 2)
          + dz * Math.tan(Math.max(-30, Math.min(30, jo.angle || 0)) * Math.PI / 180);
        const f = Math.max(0, jo.fit || 0);
        const tool = jo.shape === 'round'
          ? ellipsePoly(x, yc, Math.max(0.5, jo.w / 2) + f, Math.max(0.5, jo.w / 2) + f, 56)
          : rectPoly(x, yc, Math.max(0.5, jo.w) + 2 * f, Math.max(0.5, jo.h) + 2 * f, 0);
        pieces.forEach(pc => {
          const b = bboxOf(pc.rings);
          if (x > b.minx && x < b.maxx) pc.holes.push(tool);
        });
      }
    }
    // --- Helling: Nasen an der Rippenunterseite ----------------------
    const jig = rc.jig;
    if (jig.on && jig.mode === 'tab' && !ex.jig) {
      const yRef = jigRefY(prof, chord, jig.ref);
      const mk = posPct => {
        const x = chord * Math.max(0, Math.min(100, posPct)) / 100;
        const s = surfAt(prof, x); if (!s) return;
        // Nur an dem Teilstueck, das diese Stelle ueberhaupt enthaelt — sonst
        // entstuende bei D-Box-/Endleisten-/Ruderrippen ein loses Rechteck
        // neben dem Teil.
        const inPiece = pc => { const b = bboxOf(pc.rings); return x > b.minx + 0.5 && x < b.maxx - 0.5; };
        // Die Nase muss IMMER in der Rippe stecken: Oberkante liegt ein Stück
        // ÜBER der Rippenunterseite (Überlappung), Unterkante auf der gemein-
        // samen Bezugsebene der Helling. Sonst hinge sie vorn — wo die Unter-
        // seite höher liegt als die Bezugslinie — frei in der Luft.
        const over = Math.max(1, Math.min(4, (s.top - s.bot) * 0.15));
        const yTop = s.bot + over;
        const yBot = yRef - Math.max(2, jig.tabH || 12);
        if (yBot > yTop - 0.5) return;            // Bezugsebene liegt zu hoch
        const tw = Math.max(2, jig.tabW || 20);
        const tool = rectPoly(x, (yTop + yBot) / 2, tw, yTop - yBot, 0);
        // Trennschlitz: der Fuß hängt nur an zwei schmalen Stegen links und
        // rechts; dazwischen läuft die RIPPENKONTUR weiter. Nach dem Bau bricht
        // der Fuß dort sauber ab und die Rippe bleibt in ihrer Sollkontur.
        const br = Math.max(0, jig.tabBridge != null ? jig.tabBridge : 3);
        const sw = Math.max(0.2, jig.tabSlit || 0.8);
        let slit = null;
        if (jig.tabBreak && tw - 2 * br > 1) slit = contourSlit(base, x - tw / 2 + br, x + tw / 2 - br, sw);
        pieces.forEach(pc => {
          if (!inPiece(pc)) return;
          const before = pc.rings.length;
          const after = boolMany(pc.rings, tool, 'or');
          // Verschmilzt die Nase nicht mit dem Teil (mehr Ringe als vorher),
          // bleibt sie weg statt als loses Rechteck herumzuliegen.
          if (after.length <= before) {
            pc.rings = after;
            if (slit) pc.holes.push(slit);
          }
        });
      };
      mk(jig.tabPos);
      if (jig.tab2) mk(jig.tabPos2);
    }
    return { pieces, chord, leX: 0, prof, base, spars, st, sh, beta: mainBeta,
             place: { z0: st.z, beta: mainBeta, refX: o.refX, leX, anchorY: o.anchorY || 0 } };
  }
  // Schmales Band (Trennschlitz) entlang der UNTERSEITE einer Kontur, von x1
  // bis x2. Wird als Loch in das Teil gelegt: der angesetzte Fuß hängt dann nur
  // noch an den beiden Enden, die Rippenkontur läuft dazwischen durch.
  function contourSlit(poly, x1, x2, w) {
    const a = Math.min(x1, x2), b = Math.max(x1, x2);
    const n = Math.max(6, Math.round((b - a) / 1.5));
    const line = [];
    for (let i = 0; i <= n; i++) {
      const x = a + (b - a) * i / n;
      const su = surfAt(poly, x);
      if (su) line.push({ x, y: su.bot });
    }
    if (line.length < 2) return null;
    const up = line.map(p => ({ x: p.x, y: p.y + w / 2 }));
    const dn = line.slice().reverse().map(p => ({ x: p.x, y: p.y - w / 2 }));
    return up.concat(dn);
  }
  // Ruder-Nase formen. wing=false: das RUDER bekommt den V-Anschliff bzw. die
  // konvexe Hohlkehlennase. wing=true: die Flächenseite bekommt die konkave
  // Gegenform (nur bei der Hohlkehle nötig).
  //   V-Anschliff: der Scheitel liegt auf der Scharnierachse, der Keil öffnet
  //   sich zur Seite, auf die ausgeschlagen wird — der Keilwinkel ist der
  //   größte mögliche Ausschlag.
  //   Hohlkehle: Halbkreis um den Scharnierpunkt; bei oben liegendem Scharnier
  //   r = Profildicke, sonst r = halbe Profildicke.
  function flapNoseShape(ring, xh, hy, t, wing, prof) {
    const rc = rfCfg();
    if (rc.flapNose === 'round') {
      const r = (rc.flapHinge === 'mid' ? t / 2 : t) ;
      const gap = Math.max(0, rc.flapGap || 0);
      if (wing) {
        const res = boolSafe(ring, ellipsePoly(xh, hy, r + gap, r + gap, 64), 'diff');
        return res && res.length ? res[0] : ring;
      }
      let disc = ellipsePoly(xh, hy, r, r, 64);
      // Nur der Teil der Scheibe, der im Profil liegt — sonst stünde die Nase
      // bei obenliegendem Scharnier (r = Profildicke) über die Kontur hinaus.
      if (prof && prof.length > 2) {
        const cl = boolSafe(disc, prof, 'and');
        if (cl && cl.length) disc = cl.reduce((m, c) => Math.abs(polyArea2(c)) > Math.abs(polyArea2(m)) ? c : m, cl[0]);
      }
      const add = boolSafe(ring, disc, 'or');
      // Nur der Teil, der im Profil liegt — die Scheibe darf nicht überstehen.
      return add && add.length === 1 ? add[0] : ring;
    }
    // V-Anschliff: Dreieck vor der Keilfläche abziehen.
    const a = Math.max(5, Math.min(80, rc.flapDefl || 45)) * Math.PI / 180;
    const bb = bboxOf([ring]);
    const big = Math.max(50, (bb.maxy - bb.miny) * 4);
    let wedge;
    if (rc.flapHinge === 'top') {
      const d = t * Math.tan(a);
      wedge = [{ x: xh, y: hy }, { x: xh + d, y: hy - t }, { x: xh - big, y: hy - t }, { x: xh - big, y: hy }];
    } else if (rc.flapHinge === 'bot') {
      const d = t * Math.tan(a);
      wedge = [{ x: xh, y: hy }, { x: xh + d, y: hy + t }, { x: xh - big, y: hy + t }, { x: xh - big, y: hy }];
    } else {
      const d = (t / 2) * Math.tan(a);
      wedge = [{ x: xh, y: hy }, { x: xh + d, y: hy + t }, { x: xh - big, y: hy + t },
               { x: xh - big, y: hy - t }, { x: xh + d, y: hy - t }];
    }
    const res = boolSafe(ring, wedge, 'diff');
    return res && res.length ? res[0] : ring;
  }
  // Bekommt diese Rippe eine Steckungs-Ausnehmung?
  function joinerAppliesTo(st) {
    const jo = rfCfg().joiner;
    if (jo.scope === 'group') return st.group === (jo.group | 0);
    const n = Math.max(1, Math.round(jo.count || 1));
    const total = rfStations().list.length;
    if (jo.side === 'tip') return st.idx >= total - n;
    if (jo.side === 'both') return st.idx < n || st.idx >= total - n;
    return st.idx < n;
  }
  // Bezugshöhe der Helling in Rippenkoordinaten.
  function jigRefY(prof, chord, ref) {
    const ys = prof.map(p => p.y);
    const minY = Math.min.apply(null, ys);
    if (ref === 'le') { const s = surfAt(prof, 0.02 * chord); return s ? s.bot : minY; }
    if (ref === 'chord') return 0;
    const s = surfAt(prof, chord * 0.98);             // 'te'
    return s ? (s.top + s.bot) / 2 : minY;
  }
  // Leichterungslöcher in den Feldern zwischen Nase, Holmen und Endleiste.
  // Ringe eines Feldes: Kontur um `d` nach innen versetzt (Randsteg).
  function insetRing(r, d) {
    if (!(d > 0) || !r || r.length < 3) return r;
    let o = offsetRing(r, -d);
    if (App.deloopPoly) { const q = App.deloopPoly(o); if (q && q.length > 2) o = q; }
    return o && o.length > 2 ? o : null;
  }
  // Fachwerk-Streben eines Feldes: abwechselnd +/- geneigte Balken.
  function trussBars(bb, H) {
    const ang = Math.max(15, Math.min(80, H.angle || 45));
    const wv = Math.max(1, H.webW || 5);
    const pitch = Math.max(H.min + wv, bb.h / Math.tan(ang * Math.PI / 180));
    const bars = [];
    const L = (bb.w + bb.h) * 2;
    let k = 0;
    for (let x = bb.minx; x <= bb.maxx + pitch * 0.5; x += pitch / 2, k++)
      bars.push(rectPoly(x, bb.miny + bb.h / 2, wv, L, (k % 2 ? 90 - ang : 90 + ang)));
    return bars;
  }
  // Leichterung der Rippenfelder. Drei Bauarten:
  //   'ellipse' — klassische runde/ovale Löcher (Standard)
  //   'offset'  — EIN Loch je Feld, das der Rippenkontur folgt (Randsteg außen)
  //   'truss'   — Fachwerk: dasselbe Feld, durch Diagonalstreben unterteilt
  function lightenHoles(pc, spars, chord) {
    const rc = rfCfg(), H = rc.holes, out = [];
    const ring = pc.rings[0]; if (!ring || ring.length < 3) return out;
    const bx = bboxOf([ring]);
    // Feldgrenzen: Nase, Holme (mit ihrer Gurtbreite), Endleiste.
    const fields = [];
    let prev = bx.minx;
    spars.filter(s => s.x > bx.minx && s.x < bx.maxx).sort((a, b) => a.x - b.x)
      .forEach(s => { fields.push([prev, s.x - s.w / 2]); prev = s.x + s.w / 2; });
    fields.push([prev, bx.maxx]);
    const style = H.style || 'ellipse';
    if (style === 'ellipse') {
      fields.forEach(([a, b]) => {
        const w = b - a - 2 * H.margin;
        if (w < H.min) return;
        const n = Math.max(1, Math.round(w / Math.max(H.min, H.max)));
        const cw = w / n;
        for (let k = 0; k < n; k++) {
          const cx = a + H.margin + cw * (k + 0.5);
          const su = surfAt(ring, cx); if (!su) continue;
          const hh = (su.top - su.bot) - 2 * H.margin;
          if (hh < H.min * 0.5) continue;
          const rx = Math.min(cw / 2 - 1, H.max / 2), ry = Math.min(hh / 2, H.max / 2);
          if (rx < 2 || ry < 2) continue;
          out.push(ellipsePoly(cx, (su.top + su.bot) / 2, rx, H.round ? Math.min(rx, ry) : ry, 40));
        }
      });
      return out;
    }
    const inner = insetRing(ring, Math.max(0.5, H.margin));
    if (!inner) return out;
    fields.forEach(([a, b]) => {
      if (b - a < 2 * H.margin + H.min) return;
      let reg = clipX(inner, a + H.margin, false);
      reg = reg ? clipX(reg, b - H.margin, true) : null;
      if (!reg) return;
      const rb = bboxOf([reg]);
      if (rb.w < H.min || rb.h < Math.max(3, H.min * 0.35)) return;
      if (style === 'offset') { out.push(reg); return; }
      let regs = [reg];
      trussBars(rb, H).forEach(bar => {
        const nxt = [];
        regs.forEach(r => polyBool(r, bar, 'diff').forEach(x => nxt.push(x)));
        regs = nxt.length ? nxt : regs;
      });
      // Beim Fachwerk sind die einzelnen Felder naturgemäß klein — hier zählt
      // die kleinste Kantenlänge, nicht die Fläche (sonst fällt bei flachen
      // Rippen das ganze Fachwerk durch das Raster).
      const lim = Math.max(3, (H.min || 14) * 0.25);
      regs.forEach(r => {
        const b2 = bboxOf([r]);
        if (Math.min(b2.w, b2.h) >= lim && Math.abs(polyArea2(r)) > lim * lim) out.push(r);
      });
    });
    return out;
  }

  // ==================================================================
  //  8. Abwicklung: Spannweiten-Abtastung und Bogenlängen
  // ==================================================================
  // Dichte Abtastung für geformte Beplankungskanten (Girlanden, Zungen).
  function sheetSamples(stations) {
    const zz = rfCfg().zones, total = segStarts().total;
    const shaped = ['dboxEdge', 'teEdge'].some(k => zz[k] && (zz[k].shape !== 'straight' || zz[k].rootLen > 0));
    if (!shaped) return spanSamples(stations.map(q => q.z));
    const extra = [];
    const n = Math.max(200, stations.length * 24);
    for (let i = 0; i <= n; i++) extra.push(total * i / n);
    return spanSamples(stations.map(q => q.z).concat(extra));
  }
  // Stützstellen über die Spannweite: Rippenlagen, Segmentstöße und ein
  // feines Raster dazwischen (glatte Ränder der abgewickelten Teile).
  function spanSamples(extra) {
    const { z0, total } = segStarts();
    const set = [0, total];
    z0.forEach(z => set.push(z));
    (extra || []).forEach(z => set.push(z));
    const step = Math.max(10, total / 120);
    for (let z = 0; z <= total; z += step) set.push(z);
    return set.filter(z => z >= -1e-6 && z <= total + 1e-6).sort((a, b) => a - b)
      .filter((z, i, a) => i === 0 || z - a[i - 1] > 0.5);
  }
  // Höhenlage (V-Form/Ausrichtung) an z — für die wahre Länge der Abwicklung.
  function riseAt(z) {
    const sts = (App.wing && App.wing.stations) || [];
    if (!sts.length) return 0;
    if (sts[0].yRise == null) return 0;
    if (z <= sts[0].z) return sts[0].yRise || 0;
    for (let i = 0; i < sts.length - 1; i++) {
      const a = sts[i], b = sts[i + 1];
      if (z <= b.z + 1e-6) { const t = (z - a.z) / ((b.z - a.z) || 1); return (a.yRise || 0) + ((b.yRise || 0) - (a.yRise || 0)) * t; }
    }
    return sts[sts.length - 1].yRise || 0;
  }
  // Abgewickelte Länge entlang einer Linie x(z) über die Spannweite.
  function devLengths(zs, xOf) {
    const s = [0];
    for (let i = 1; i < zs.length; i++) {
      const dz = zs[i] - zs[i - 1];
      const dx = (xOf(zs[i]) || 0) - (xOf(zs[i - 1]) || 0);
      const dy = riseAt(zs[i]) - riseAt(zs[i - 1]);
      s.push(s[i - 1] + Math.hypot(dz, dx, dy));
    }
    return s;
  }
  // Bogenlänge entlang der Kontur von der Nase bis zur Sehnenstelle x
  // (top = Oberseite). Negativ = oben, positiv = unten (Abwicklung um die Nase).
  function arcLenTo(pts, xT, top) {
    let iLE = 0; for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    let L = 0;
    if (top) {
      for (let i = iLE; i > 0; i--) {
        const a = pts[i], b = pts[i - 1];
        if (b.x >= xT) { const t = (xT - a.x) / ((b.x - a.x) || 1e-9); return -(L + Math.hypot(b.x - a.x, b.y - a.y) * Math.max(0, Math.min(1, t))); }
        L += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return -L;
    }
    for (let i = iLE; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (b.x >= xT) { const t = (xT - a.x) / ((b.x - a.x) || 1e-9); return L + Math.hypot(b.x - a.x, b.y - a.y) * Math.max(0, Math.min(1, t)); }
      L += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return L;
  }
  // Kernkontur (Rippenoberfläche unter der Beplankung) an z — Basis für die
  // Abwicklung: die Beplankung wird über DIESE Kontur gebogen.
  function coreAt(z) {
    const st = Object.assign({ z }, locateZ(z));
    const sec = sectionAt(z);
    const pts = sec.pts.map(p => ({ x: p.x - sec.leX, y: p.y }));
    const chord = sec.teX - sec.leX;
    const sh = sheetAt(st);
    const hf = hingeFracAt(z);
    const c = zonedInset(pts, sh, chord, 0, hf, z);
    return { pts: c && c.length > 2 ? c : pts, outer: pts, chord, sh, z, seg: st.seg, t: st.t, hf };
  }

  // ==================================================================
  //  9. Flächenteile: Gurte, Stege, Kämme, Helling, Beplankung, Geodäten
  // ==================================================================
  // Ein „Band" aus zwei Randlinien über die Abwicklungslänge.
  function ribbon(s, lo, hi) {
    const top = [], bot = [];
    for (let i = 0; i < s.length; i++) { top.push({ x: s[i], y: hi[i] }); bot.push({ x: s[i], y: lo[i] }); }
    return top.concat(bot.reverse());
  }
  // --- Holmgurte (oben/unten) ---------------------------------------
  function capParts(stations) {
    const rc = rfCfg(), out = [], total = segStarts().total;
    sparList().forEach((sp, j) => {
      if (sp.capMode === 'none') return;
      const segs = state.segments || [];
      const a = Math.max(0, Math.min(sp.segFrom | 0, sp.segTo | 0)), b = Math.min(segs.length - 1, Math.max(sp.segFrom | 0, sp.segTo | 0));
      const { z0 } = segStarts();
      const zA = z0[a] || 0, zB = (z0[b] || 0) + (segs[b] ? segs[b].span || 0 : 0);
      const zs = spanSamples(stations.map(s => s.z)).filter(z => z >= zA - 1e-6 && z <= zB + 1e-6);
      if (zs.length < 2) return;
      const xOf = z => sparXAt(j, z);
      const s = devLengths(zs, xOf);
      const w = zs.map(z => capWAt(sp, z, total));
      const ring = ribbon(s, w.map(v => -v / 2), w.map(v => v / 2));
      const marks = [];
      stations.forEach(st => {
        if (st.z < zA - 1e-6 || st.z > zB + 1e-6) return;
        const si = interpAt(zs, s, st.z);
        marks.push([{ x: si, y: -w[0] / 2 }, { x: si, y: w[0] / 2 }]);
      });
      const which = sp.capMode === 'both' ? ['oben', 'unten'] : [sp.capMode === 'top' ? 'oben' : 'unten'];
      which.forEach(side => out.push({
        kind: 'cap', name: (sp.name || T('Holm') + ' ' + (j + 1)) + ' · ' + T('Gurt ') + T(side),
        rings: [ring.map(p => ({ x: p.x, y: p.y }))], holes: [], marks,
        mat: sp.capMat, t: sp.capT, layer: 'Holmgurt',
        note: T('Länge ') + s[s.length - 1].toFixed(0) + ' mm · ' + T('Dicke ') + (sp.capT || 0) + ' mm'
      }));
    });
    return out;
  }
  // Umkehrung von interpAt: zu einer Abwicklungslänge die Spannweitenposition.
  function interpZ(zs, s, si) {
    if (si <= s[0]) return zs[0];
    for (let i = 0; i < s.length - 1; i++) if (si <= s[i + 1] + 1e-6) { const t = (si - s[i]) / ((s[i + 1] - s[i]) || 1); return zs[i] + (zs[i + 1] - zs[i]) * t; }
    return zs[zs.length - 1];
  }
  function interpAt(zs, vals, z) {
    if (z <= zs[0]) return vals[0];
    for (let i = 0; i < zs.length - 1; i++) if (z <= zs[i + 1] + 1e-6) { const t = (z - zs[i]) / ((zs[i + 1] - zs[i]) || 1); return vals[i] + (vals[i + 1] - vals[i]) * t; }
    return vals[vals.length - 1];
  }
  // --- Holmstege und Rippenkämme ------------------------------------
  function webParts(stations) {
    const rc = rfCfg(), out = [];
    sparList().forEach((sp, j) => {
      if (sp.web !== 'flat' && sp.web !== 'comb' && sp.web !== 'jigcomb') return;
      const isComb = sp.web === 'comb' || sp.web === 'jigcomb';
      const segs = state.segments || [];
      const a = Math.max(0, Math.min(sp.segFrom | 0, sp.segTo | 0)), b = Math.min(segs.length - 1, Math.max(sp.segFrom | 0, sp.segTo | 0));
      const { z0 } = segStarts();
      const zA = z0[a] || 0, zB = (z0[b] || 0) + (segs[b] ? segs[b].span || 0 : 0);
      const zs = spanSamples(stations.map(s => s.z)).filter(z => z >= zA - 1e-6 && z <= zB + 1e-6);
      if (zs.length < 2) return;
      const s = devLengths(zs, z => sparXAt(j, z));
      const lo = [], hi = [];
      zs.forEach(z => {
        const c = coreAt(z);
        const x = sp.posMode === 'mm' ? (sp.pos || 0) : (sp.pos || 0) / 100 * c.chord;
        const su = surfAt(c.pts, x) || { top: 0, bot: 0 };
        const cT = Math.max(0, sp.capT || 0);
        let yT = su.top - (sp.capMode === 'both' || sp.capMode === 'top' ? cT : 0);
        let yB = su.bot + (sp.capMode === 'both' || sp.capMode === 'bot' ? cT : 0);
        if (isComb) { yT = su.top; yB = su.bot; }                   // Kamm geht über die volle Höhe
        if (!sp.webFull && sp.webH > 0 && sp.web === 'flat') { const m = (yT + yB) / 2; yT = m + sp.webH / 2; yB = m - sp.webH / 2; }
        // Bezug ist die Anker-Höhe des Querschnitts (25 % Sehne) — über die
        // Spannweite durchgehend, damit das abgewickelte Band die wahre Form
        // behält (Profilhöhe, Schränkung, V-Form stecken darin).
        hi.push(yT); lo.push(yB);
      });
      let rings = [ribbon(s, lo, hi)];
      const holes = [], marks = [];
      // Rippenkamm: Schlitze an jeder Rippenlage (Breite = Materialstärke der Rippe).
      if (isComb) {
        stations.forEach(st => {
          if (st.type === 'skip') return;
          if (st.z < zA - 1e-6 || st.z > zB + 1e-6) return;
          if (!sparApplies(sp, st.seg)) return;
          const si = interpAt(zs, s, st.z);
          const yT = interpAt(zs, hi, st.z), yB = interpAt(zs, lo, st.z);
          const d = sp.combDepth > 0 ? sp.combDepth : (yT - yB) / 2;
          const wS = Math.max(0.2, (st.t_mat || 3) + 2 * Math.max(0, sp.notchFit || 0));
          // Der Kamm wird von der GEGENSEITE der Rippennut geschlitzt.
          const yc = sp.combTop ? yB - 50 + d : yT + 50 - d;
          rings = boolMany(rings, rectPoly(si, yc, wS, 100, 0), 'diff');
        });
      } else {
        stations.forEach(st => {
          if (st.z < zA - 1e-6 || st.z > zB + 1e-6) return;
          const si = interpAt(zs, s, st.z);
          marks.push([{ x: si, y: interpAt(zs, lo, st.z) }, { x: si, y: interpAt(zs, hi, st.z) }]);
        });
      }
      // Sollbruch-Perforation: nach dem Bau lässt sich der überstehende Teil des
      // Kamms sauber abbrechen (Stege dazwischen halten ihn bis dahin).
      if (isComb && (sp.combSlit || sp.web === 'jigcomb')) {
        const sl = Math.max(1, sp.combSlitLen || 8), sg = Math.max(0.5, sp.combSlitGap || 4);
        const sw = Math.max(0.2, sp.combSlitW || 0.8), sy = Math.max(0, sp.combSlitY || 10);
        const total2 = s[s.length - 1];
        for (let x0 = sg; x0 + sl < total2; x0 += sl + sg) {
          const xm = x0 + sl / 2;
          const yb = interpAt(zs, lo, interpZ(zs, s, xm));
          const yt = interpAt(zs, hi, interpZ(zs, s, xm));
          if (yb + sy + sw / 2 < yt - 0.5) holes.push(rectPoly(xm, yb + sy, sl, sw, 0));
        }
      }
      if (sp.webHoles) {
        for (let i = 0; i < stations.length - 1; i++) {
          const z1 = stations[i].z, z2 = stations[i + 1].z;
          if (z1 < zA - 1e-6 || z2 > zB + 1e-6) continue;
          const sm = interpAt(zs, s, (z1 + z2) / 2), s1 = interpAt(zs, s, z1), s2 = interpAt(zs, s, z2);
          const yT = interpAt(zs, hi, (z1 + z2) / 2), yB = interpAt(zs, lo, (z1 + z2) / 2);
          const rx = (s2 - s1) / 2 - 6, ry = (yT - yB) / 2 - 5;
          if (rx > 3 && ry > 3) holes.push(ellipsePoly(sm, (yT + yB) / 2, rx, ry, 40));
        }
      }
      // Aufgeleimte Holmstege sind KEIN durchgehendes Band: sie sitzen als
      // einzelne Blättchen zwischen den Rippen (vorn und/oder hinten am Holm).
      // Deshalb je Rippenfeld ein eigenes Teil, um die Rippendicke verkürzt.
      if (sp.web === 'flat' && sp.webBetween) {
        const inRange = stations.filter(st => st.type !== 'skip' && st.z >= zA - 1e-6 && st.z <= zB + 1e-6)
          .sort((p1, p2) => p1.z - p2.z);
        const sides = sp.webSide === 'both' ? ['vorn', 'hinten'] : [sp.webSide === 'rear' ? 'hinten' : 'vorn'];
        const fit = Math.max(0, sp.notchFit || 0);
        let nBay = 0;
        for (let i = 0; i < inRange.length - 1; i++) {
          const s1 = interpAt(zs, s, inRange[i].z) + (inRange[i].t_mat || 3) / 2 + fit;
          const s2 = interpAt(zs, s, inRange[i + 1].z) - (inRange[i + 1].t_mat || 3) / 2 - fit;
          if (s2 - s1 < 2) continue;
          nBay++;
          const nSeg = Math.max(2, Math.round((s2 - s1) / 4));
          const ss = [], ll = [], hh = [];
          for (let k = 0; k <= nSeg; k++) {
            const si = s1 + (s2 - s1) * k / nSeg, z = interpZ(zs, s, si);
            ss.push(si - s1); ll.push(interpAt(zs, lo, z)); hh.push(interpAt(zs, hi, z));
          }
          sides.forEach(side => out.push({
            kind: 'web',
            name: (sp.name || T('Holm') + ' ' + (j + 1)) + ' · ' + T('Stegblatt ') + nBay + ' ' + T(side),
            rings: [ribbon(ss, ll, hh)], holes: [], marks: [],
            mat: sp.webMat, t: sp.webT, layer: 'Holmsteg',
            note: T('Feld ') + nBay + ' · ' + T('Länge ') + (s2 - s1).toFixed(1) + ' mm · ' + T('Dicke ') + (sp.webT || 0) + ' mm'
          }));
        }
        return;
      }
      out.push({
        kind: isComb ? 'comb' : 'web',
        name: (sp.name || T('Holm') + ' ' + (j + 1)) + ' · '
          + (sp.web === 'jigcomb' ? T('Rippenkamm (Bauhilfe)') : isComb ? T('Rippenkamm') : T('Holmsteg')),
        rings, holes, marks, mat: sp.webMat, t: sp.webT, layer: sp.web === 'comb' ? 'Rippenkamm' : 'Holmsteg',
        note: T('Länge ') + s[s.length - 1].toFixed(0) + ' mm · ' + T('Dicke ') + (sp.webT || 0) + ' mm'
      });
    });
    return out;
  }
  // --- Helling ------------------------------------------------------
  function jigParts(stations, ribs) {
    const rc = rfCfg(), j = rc.jig, out = [];
    if (!j.on) return out;
    const { total } = segStarts();
    if (j.mode === 'tab') {
      // Helling-Brett: gerade Oberkante, Schlitze an jeder Rippenlage.
      const zs = spanSamples(stations.map(s => s.z));
      const s = devLengths(zs, () => 0);
      const H = Math.max(10, j.railH || 60);
      const top = j.follow ? zs.map(z => riseAt(z)) : zs.map(() => 0);
      let rings = [ribbon(s, top.map(v => v - H), top)];
      stations.forEach((st, i) => {
        if (st.type === 'skip') return;
        const si = interpAt(zs, s, st.z), ty = interpAt(zs, top, st.z);
        const w = Math.max(0.2, (st.t_mat || 3) + 2 * (j.fit || 0));
        rings = boolMany(rings, rectPoly(si, ty + 50 - Math.max(2, j.tabH || 12), w, 100, 0), 'diff');
      });
      out.push({
        kind: 'jig', name: T('Helling — Schlitzbrett'), rings, holes: [], marks: [],
        mat: j.mat, t: j.railT, layer: 'Helling',
        note: T('Länge ') + s[s.length - 1].toFixed(0) + ' mm · ' + T('Dicke ') + (j.railT || 0) + ' mm'
      });
    } else if (j.mode === 'neg') {
      // Negativ der Rippe: ein Brett, aus dem die Rippenkontur ausgeschnitten ist.
      // Waagerecht an der Bezugslinie geteilt — die Rippe wird in die untere
      // Hälfte gelegt, die obere aufgesetzt. So sitzt sie ringsum in ihrer
      // Sollform und kann sich beim Bauen nicht verziehen.
      ribs.forEach(rb => {
        if (!rb) return;
        const ring = rb.pieces[0] && rb.pieces[0].rings[0]; if (!ring) return;
        const bx = bboxOf([ring]);
        const m = Math.max(4, j.margin || 10);
        const fit = Math.max(0, j.fit || 0);
        const neg = fit > 0 ? offsetRing(ring, fit) : ring;
        const yRef = jigRefY(rb.prof, rb.chord, j.ref);
        const board = [{ x: bx.minx - m, y: bx.miny - m }, { x: bx.maxx + m, y: bx.miny - m },
                       { x: bx.maxx + m, y: bx.maxy + m }, { x: bx.minx - m, y: bx.maxy + m }];
        let rings = boolSafe(board, neg, 'diff');
        if (!rings || !rings.length) return;
        [['unten', true], ['oben', false]].forEach(([side, lower]) => {
          const half = rings.map(r => clipX90(r, yRef, lower)).filter(Boolean);
          if (!half.length) return;
          out.push({
            kind: 'jig', name: T('Negativ-Helling R') + (rb.st.idx + 1) + ' ' + T(side),
            rings: [half[0]], holes: half.slice(1), marks: [],
            mat: j.mat, t: j.railT, layer: 'Helling',
            note: 'z = ' + rb.st.z.toFixed(0) + ' mm'
          });
        });
      });
    } else {
      // Auflageböcke: je Rippe ein Bock, dessen Oberkante die Rippenunterseite abbildet.
      ribs.forEach((rb, i) => {
        if (!rb) return;
        const prof = rb.prof, chord = rb.chord;
        const x1 = chord * 0.08, x2 = chord * 0.92;
        const up = j.cradleSide === 'top';
        const low = [];
        for (let x = x1; x <= x2; x += Math.max(1, chord / 80)) { const su = surfAt(prof, x); if (su) low.push({ x, y: up ? su.top : su.bot }); }
        if (low.length < 3) return;
        const yRef = jigRefY(prof, chord, j.ref);
        const H = Math.max(10, j.h || 40);
        const base = up ? yRef + H : yRef - H;
        const line = up ? low.slice().reverse() : low;
        const ring = up
          ? [{ x: x2, y: base }].concat(line).concat([{ x: x1, y: base }])
          : [{ x: x1, y: base }].concat(line).concat([{ x: x2, y: base }]);
        out.push({
          kind: 'jig', name: (up ? T('Negativbett R') : T('Helling — Bock R')) + (rb.st.idx + 1), rings: [ring], holes: [], marks: [],
          mat: j.mat, t: j.railT, layer: 'Helling',
          note: 'z = ' + rb.st.z.toFixed(0) + ' mm'
        });
      });
    }
    return out;
  }
  // --- Beplankung: Abwicklung ---------------------------------------
  // Eine Beplankungsbahn: je Station die Bogenlängen ihrer beiden Ränder,
  // gemessen ab der Nase auf der KERNKONTUR (die Beplankung liegt darauf auf).
  function sheetPanel(name, zs, fLo, fHi, layer) {
    const rc = rfCfg();
    const lo = [], hi = [], xs = [];
    zs.forEach(z => {
      const c = coreAt(z);
      const e = fLo(c), f = fHi(c);
      lo.push(e); hi.push(f); xs.push(c.chord);
    });
    const s = devLengths(zs, z => { const c = coreAt(z); return c.chord * 0.5; });
    const ring = ribbon(s, lo, hi);
    const marks = [];
    return {
      kind: 'sheet', name, rings: [ring], holes: [], marks,
      mat: rc.sheetMat, t: Math.max(rc.sheetTop, rc.sheetBot), layer: layer || 'Beplankung',
      note: T('Abwicklung · Länge ') + s[s.length - 1].toFixed(0) + ' mm',
      devZs: zs, devS: s
    };
  }
  function sheetParts(stations) {
    const rc = rfCfg(), z = rc.zones, out = [];
    if (!anySheet()) return out;
    const zs = sheetSamples(stations);
    const has = f => zs.some(zz => { const c = coreAt(zz); return (c.sh.top > 0 || c.sh.bot > 0); });
    if (!has()) return out;
    if (z.full) {
      out.push(sheetPanel(T('Beplankung oben (ganze Fläche)'), zs,
        c => arcLenTo(c.pts, c.chord * 0.999, true), c => 0));
      out.push(sheetPanel(T('Beplankung unten (ganze Fläche)'), zs,
        c => 0, c => arcLenTo(c.pts, c.chord * 0.999, false)));
    } else {
      if (z.dbox) out.push(sheetPanel(T('Beplankung D-Box (um die Nase)'), zs,
        c => arcLenTo(c.pts, c.chord * edgeF('dbox', c.z), true),
        c => arcLenTo(c.pts, c.chord * edgeF('dbox', c.z), false), 'Beplankung D-Box'));
      // Mit abgetrenntem Ruder wird jede Bahn, die über die Scharnierlinie läuft,
      // dort geteilt (Spalt): ein Stück für die Fläche, eines fürs Ruder.
      const fl = rc.flapSplit;
      const gapF = c => (Math.max(0, rc.flapGap || 0) / 2) / Math.max(1, c.chord);
      const cut = (c, f) => c.chord * Math.max(0, Math.min(0.999, f));
      const teF = (z.teFrom || 70) / 100;
      const panelTE = (topSide) => {
        const edge = c => arcLenTo(c.pts, c.chord * 0.999, topSide);
        const from = c => arcLenTo(c.pts, cut(c, edgeF('te', c.z)), topSide);
        const nm = topSide ? 'oben' : 'unten';
        if (!fl) {
          out.push(sheetPanel(T('Beplankung Endleiste ') + T(nm), zs, topSide ? edge : from, topSide ? from : edge, 'Beplankung Endleiste'));
          return;
        }
        const hW = c => arcLenTo(c.pts, cut(c, (c.hf != null ? c.hf : 1) - gapF(c)), topSide);
        const hR = c => arcLenTo(c.pts, cut(c, (c.hf != null ? c.hf : 1) + gapF(c)), topSide);
        const hfMid = coreAt(zs[Math.floor(zs.length / 2)]).hf;
        if (hfMid != null && hfMid > teF)
          out.push(sheetPanel(T('Beplankung Endleiste ') + T(nm) + ' — ' + T('Fläche'), zs,
            topSide ? hW : from, topSide ? from : hW, 'Beplankung Endleiste'));
        out.push(sheetPanel(T('Beplankung Ruder ') + T(nm), zs,
          topSide ? edge : (hfMid != null && hfMid > teF ? hR : from), topSide ? (hfMid != null && hfMid > teF ? hR : from) : edge, 'Beplankung Ruder'));
      };
      if (z.te) { panelTE(true); if (z.teBoth) panelTE(false); }
      // Ruder ganz beplankt (unabhängig von der Endleisten-Zone).
      if (z.flap && fl && !z.te) {
        const edgeT = c => arcLenTo(c.pts, c.chord * 0.999, true), edgeB = c => arcLenTo(c.pts, c.chord * 0.999, false);
        const hRT = c => arcLenTo(c.pts, cut(c, (c.hf != null ? c.hf : 1) + gapF(c)), true);
        const hRB = c => arcLenTo(c.pts, cut(c, (c.hf != null ? c.hf : 1) + gapF(c)), false);
        out.push(sheetPanel(T('Beplankung Ruder oben'), zs, edgeT, hRT, 'Beplankung Ruder'));
        out.push(sheetPanel(T('Beplankung Ruder unten'), zs, hRB, edgeB, 'Beplankung Ruder'));
      }
    }
    return out;
  }
  // --- Hilfsholm (Fläche) und Nasenholm (Ruder) ---------------------
  // Beide laufen entlang der Scharnierlinie und sind hochkant stehende Stege
  // über die volle Profilhöhe (abzüglich Beplankung). Ihre Stirnflächen sind
  // die Trennschnitte, deshalb sind die Rippenstücke genau um ihre Breite kürzer.
  function flapSparParts(stations) {
    const rc = rfCfg(), out = [];
    if (!rc.flapSplit) return out;
    const arr = leTeArr();
    const zs = spanSamples(stations.map(s => s.z)).filter(z => hingeXAt(z, arr) != null);
    if (zs.length < 2) return out;
    const s = devLengths(zs, z => hingeXAt(z, arr));
    const lo = [], hi = [];
    zs.forEach(z => {
      const c = coreAt(z), lt = leTeAt(z, arr);
      const x = hingeXAt(z, arr) - lt.le;
      const su = surfAt(c.pts, x) || { top: 0, bot: 0 };
      hi.push(su.top); lo.push(su.bot);
    });
    const L = s[s.length - 1];
    const mk = (cfg, name) => {
      if (!cfg.on) return;
      const w = Math.max(0.5, cfg.w);
      if (cfg.mode === 'strip') {
        out.push({ kind: 'web', name: name + ' — ' + T('Leiste'),
          rings: [ribbon(s, zs.map(() => -w / 2), zs.map(() => w / 2))], holes: [], marks: [],
          mat: cfg.mat, t: cfg.t, layer: 'Hilfsholm',
          note: T('aufgeleimt') + ' · ' + T('Länge ') + L.toFixed(0) + ' mm · ' + w + ' × ' + (cfg.t || 0) + ' mm' });
      } else {
        ['oben', 'unten'].forEach(side => out.push({ kind: 'cap', name: name + ' — ' + T('Gurt ') + T(side),
          rings: [ribbon(s, zs.map(() => -w / 2), zs.map(() => w / 2))], holes: [], marks: [],
          mat: cfg.mat, t: cfg.capT, layer: 'Hilfsholm',
          note: T('Länge ') + L.toFixed(0) + ' mm · ' + w + ' × ' + (cfg.capT || 0) + ' mm' }));
      }
    };
    mk(rc.flapSpar, T('Hilfsholm (Fläche)'));
    mk(rc.flapRSpar, T('Nasenholm (Ruder)'));
    return out;
  }
  // --- Rippenaufleimer (cap strips) --------------------------------
  // Leisten auf Ober- und Unterseite jeder Rippe, von der Beplankungskante bis
  // zur Endleiste (bzw. zur Endleistenbeplankung). Abgewickelt = gerade Leiste
  // in Bogenlänge der Rippenkontur.
  function capStripParts(stations, ribs) {
    const rc = rfCfg(), cs = rc.capStrip, out = [];
    if (!cs || !cs.on) return out;
    const zz = rc.zones;
    stations.forEach((st, i) => {
      const rb = ribs[i]; if (!rb || st.type === 'skip') return;
      const pts = rb.base, ch = rb.chord;
      [['oben', true], ['unten', false]].forEach(([side, top]) => {
        if (!top && !cs.bot) return;
        const fA = zz.full ? 1 : (zz.dbox && (top || true) ? edgeF('dbox', st.z) : 0);
        const fB = zz.te && (top || zz.teBoth) ? edgeF('te', st.z) : 0.999;
        if (fB <= fA + 0.01) return;
        const L = Math.abs(arcLenTo(pts, ch * fB, top) - arcLenTo(pts, ch * fA, top));
        if (L < 2) return;
        const w = Math.max(0.5, cs.w || 4);
        out.push({ kind: 'cap', name: 'R' + (st.idx + 1) + ' · ' + T('Aufleimer ') + T(side),
          rings: [[{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: w }, { x: 0, y: w }]], holes: [], marks: [],
          mat: cs.mat, t: cs.t, layer: 'Aufleimer',
          note: T('Länge ') + L.toFixed(1) + ' mm · ' + w + ' × ' + (cs.t || 0) + ' mm' });
      });
    });
    return out;
  }
  // --- Nasen- und Endleiste (Grundrissteile) ------------------------
  function edgeParts(stations) {
    const rc = rfCfg(), out = [];
    const zs = spanSamples(stations.map(s => s.z));
    if (rc.leOn) {
      const s = devLengths(zs, z => leTeAt(z).le);
      const L = s[s.length - 1];
      if (rc.leShape === 'tri') {
        // Dreikantleiste: nichts aus der Platte zu schneiden — als Balken in
        // Länge × Kathetenhöhe für Stückliste und Übersicht.
        const w = Math.max(1, rc.leTriW || 8), h = Math.max(1, rc.leTriH || 8);
        out.push({ kind: 'edge', name: T('Nasenleiste — Dreikantleiste ') + w + '×' + h + ' mm',
          rings: [[{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: h }, { x: 0, y: h }]], holes: [], marks: [],
          mat: rc.leMat, t: h, layer: 'Nasenleiste',
          note: T('Dreikantleiste ') + w + '×' + h + ' mm · ' + T('Länge ') + L.toFixed(0) + ' mm' });
      } else if (rc.leShape === 'round') {
        // Rundstab: nichts zu schneiden — als Balken in Länge × Durchmesser für
        // Stückliste und Übersicht (die Einlassung steckt in den Rippen).
        const d = Math.max(1, rc.leD || 8);
        out.push({ kind: 'edge', name: T('Nasenleiste — Rundstab Ø') + d + ' mm',
          rings: [[{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: d }, { x: 0, y: d }]], holes: [], marks: [],
          mat: rc.leMat, t: d, layer: 'Nasenleiste',
          note: T('Rundstab Ø') + d + ' mm · ' + T('Länge ') + L.toFixed(0) + ' mm' });
      } else {
        const lo = zs.map(() => 0), hi = zs.map(() => Math.max(1, rc.leW || 8));
        out.push({ kind: 'edge', name: T('Nasenleiste (Grundriss)'), rings: [ribbon(s, lo, hi)], holes: [], marks: [],
          mat: rc.leMat, t: rc.leH, layer: 'Nasenleiste',
          note: T('Länge ') + L.toFixed(0) + ' mm · ' + T('Dicke ') + (rc.leH || 0) + ' mm' });
      }
    }
    if (rc.teOn) {
      const s = devLengths(zs, z => leTeAt(z).te);
      const lo = zs.map(() => 0), hi = zs.map(() => Math.max(1, rc.teW || 20));
      out.push({ kind: 'edge', name: T('Endleistenbrett (Grundriss)'), rings: [ribbon(s, lo, hi)], holes: [], marks: [], mat: rc.teMat, t: rc.teH, layer: 'Endleiste', note: T('Länge ') + s[s.length - 1].toFixed(0) + ' mm' });
    }
    return out;
  }

  // ==================================================================
  // 10. Geodätische Bauweise
  // ==================================================================
  // Diagonale Rippen/Leisten unter ±Winkel. Geometrisch sind das schräge
  // Schnitte durch dieselbe Fläche — also genau die Maschinerie der schrägen
  // Rippen, nur auf einen Sehnenbereich begrenzt und optional als schmale
  // Leiste (Band entlang der Oberfläche) statt als volle Rippe.
  // Beginn des Diagonalbereichs (% Sehne) an z. Im Ruder-Modus: knapp hinter
  // der Ruder-Nase (Scharnierlinie + Spalt + Nasenholm).
  function geoFrom(z) {
    const rc = rfCfg(), g = rc.geo;
    if (!(g.inFlap && rc.flapSplit)) return g.from;
    const hf = hingeFracAt(z); if (hf == null) return g.from;
    const lt = leTeAt(z), ch = Math.max(1, lt.te - lt.le);
    const extra = (rc.flapGap || 0) / 2 + (rc.flapRSpar.on ? Math.max(0, rc.flapRSpar.w) + 1 : 1);
    return Math.min(99, hf * 100 + extra / ch * 100);
  }
  // Wert eines Diagonal-Endpunkts: g.from wird an der Stelle z aufgelöst.
  function geoVal(v, z) { const g = rfCfg().geo; return v === g.from ? geoFrom(z) : v; }
  // Sehnenbereich der Geodäten an z (absolute Grundriss-x).
  function geoRange(z, arr) {
    const g = rfCfg().geo, lt = leTeAt(z, arr), ch = lt.te - lt.le;
    return { xa: lt.le + ch * Math.max(0, Math.min(100, g.from)) / 100,
             xb: lt.le + ch * Math.max(0, Math.min(100, g.to)) / 100, ch, lt };
  }
  // Teilung der Diagonalen über die Spannweite. 'auto' rechnet sie aus Winkel
  // und Feldtiefe, sodass eine Diagonale genau von vorn nach hinten reicht.
  function geoPitch(stations) {
    const g = rfCfg().geo, { total } = segStarts();
    if (g.spaceMode === 'spacing') return Math.max(10, g.spacing || 120);
    if (g.spaceMode === 'perBay' && stations.length > 1) return Math.max(10, total / (stations.length - 1));
    const r = geoRange(total / 2);
    const depth = Math.max(5, r.xb - r.xa);
    return Math.max(10, depth / Math.tan(Math.max(5, Math.min(85, g.angle || 45)) * Math.PI / 180));
  }
  // Liste der Diagonalen: je Eintrag Anfang/Ende im Grundriss.
  //   cross  — zwei durchgehende Scharen, um die halbe Teilung versetzt
  //   zigzag — Ende an Ende, abwechselnd vorn/hinten anschlagend
  //   extra  — eine Diagonale je Rippenfeld (zwischen den normalen Rippen)
  function geoSpans(stations) {
    const g = rfCfg().geo, { total } = segStarts(), out = [];
    const pitch = geoPitch(stations);
    if (g.mode === 'zigzag') {
      let k = 0;
      for (let z = 0; z < total - 1; z += pitch, k++) {
        const z2 = Math.min(total, z + pitch);
        // gerade Nummer: vorn -> hinten, ungerade: hinten -> vorn
        out.push(k % 2 === 0 ? { za: z, fa: g.from, zb: z2, fb: g.to, k }
                             : { za: z, fa: g.to, zb: z2, fb: g.from, k });
      }
      return out;
    }
    if (g.mode === 'extra') {
      for (let i = 0; i < stations.length - 1; i++) {
        const za = stations[i].z, zb = stations[i + 1].z;
        out.push(g.both && i % 2 ? { za, fa: g.to, zb, fb: g.from, k: i }
                                 : { za, fa: g.from, zb, fb: g.to, k: i });
        if (g.both && !(i % 2) === false) { /* alternierend, kein Kreuz */ }
      }
      return out;
    }
    // Kreuzverband: beide Scharen durchlaufend über die ganze Spannweite
    let k = 0;
    for (let z = -total; z < total; z += pitch, k++) {
      out.push({ za: z, fa: g.from, zb: z + pitch, fb: g.to, k, dir: 1 });
      if (g.both) out.push({ za: z, fa: g.to, zb: z + pitch, fb: g.from, k, dir: -1 });
    }
    return out.filter(d => Math.max(d.za, d.zb) > 0 && Math.min(d.za, d.zb) < total);
  }
  // Bis wohin bleiben die normalen Rippen stehen (% Sehne)?
  function geoKeepTo() {
    const g = rfCfg().geo;
    return g.keepTo == null ? g.from : Math.max(0, Math.min(100, g.keepTo));
  }
  // Kreuzungen zwischen den Diagonalen und den NORMALEN Rippen. Sie treten auf,
  // sobald die Diagonalen weiter nach vorn laufen als die Rippen stehen bleiben
  // (Diagonalen auch in der D-Box). Beide werden dort halb/halb ausgeklinkt.
  function geoRibCrossings(stations) {
    const g = rfCfg().geo, byRib = {}, byDiag = {};
    if (!g.on || g.mode === 'extra' || (g.inFlap && rfCfg().flapSplit)) return { byRib, byDiag };
    const keep = geoKeepTo();
    if (!(keep > g.from + 0.5)) return { byRib, byDiag };
    const arr = leTeArr();
    geoSpans(stations).forEach((d, di) => {
      const za = d.za, zb = d.zb;
      stations.forEach(st => {
        if (st.type === 'skip') return;
        if (st.z < Math.min(za, zb) - 1e-6 || st.z > Math.max(za, zb) + 1e-6) return;
        const t = (st.z - za) / ((zb - za) || 1);
        const fr = d.fa + (d.fb - d.fa) * t;          // Sehnenanteil an dieser Stelle
        if (fr > keep + 1e-6 || fr < 0) return;        // Rippe steht dort nicht mehr
        const lt = leTeAt(st.z, arr);
        const xabs = lt.le + (lt.te - lt.le) * fr / 100;
        (byRib[st.idx] = byRib[st.idx] || []).push({ xabs, fr, diag: di });
        (byDiag[di] = byDiag[di] || []).push({ z: st.z, xabs, fr, rib: st.idx });
      });
    });
    return { byRib, byDiag };
  }
  // Band zwischen Kontur und nach innen versetzter Kontur  // Band zwischen Kontur und nach innen versetzter Kontur, begrenzt auf einen
  // x-Bereich und eine Seite (oben/unten).
  function contourBand(pts, x1, x2, width, top) {
    let iLE = 0; for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    let inner = null;
    if (window.HotWire && HotWire.offsetPathTB) { try { inner = HotWire.offsetPathTB(pts, width, width); } catch (e) { inner = null; } }
    if (!inner || inner.length !== pts.length) return null;
    const idx = [];
    if (top) { for (let i = iLE; i >= 0; i--) idx.push(i); } else { for (let i = iLE; i < pts.length; i++) idx.push(i); }
    const sel = idx.filter(i => pts[i].x >= Math.min(x1, x2) - 1e-6 && pts[i].x <= Math.max(x1, x2) + 1e-6);
    if (sel.length < 2) return null;
    const outer = sel.map(i => pts[i]);
    const back = sel.slice().reverse().map(i => inner[i]);
    return outer.concat(back);
  }
  function geoParts(stations) {
    const rc = rfCfg(), g = rc.geo, out = [];
    if (!g.on || !hasWing()) return out;
    const total = segStarts().total, arr = leTeArr();
    const items = [];
    geoSpans(stations).forEach((d, di) => {
      // Aus Anfangs-/Endpunkt im Grundriss den Schnittwinkel bestimmen: die
      // Diagonale ist ein SCHRÄGER Schnitt durch die Fläche, kein gestrecktes
      // Profil (deshalb dieselbe Maschinerie wie bei den schrägen Rippen).
      const z0 = (d.za + d.zb) / 2;
      const zc = Math.max(0, Math.min(total, z0));
      const r = geoRange(zc, arr);
      d = Object.assign({}, d, { fa: geoVal(d.fa, d.za), fb: geoVal(d.fb, d.zb) });
      // Einheitlich von vorn nach hinten orientieren: die Gegen-Schar hat dann
      // einen negativen Winkel (sonst läge er über 90° und fiele weg).
      if (d.fb < d.fa) d = Object.assign({}, d, { za: d.zb, zb: d.za, fa: d.fb, fb: d.fa });
      const xa = r.lt.le + r.ch * d.fa / 100, xb = r.lt.le + r.ch * d.fb / 100;
      const dx = xb - xa;
      if (Math.abs(dx) < 1e-6) return;
      const beta = Math.atan2(d.zb - d.za, dx) * 180 / Math.PI;
      if (Math.abs(beta) > 86) return;
      const refFrac = (d.fa + d.fb) / 200;
      const o = obliqueOutline(zc, beta, refFrac);
      const xs = o.pts.map(p => p.x);
      const leX = Math.min.apply(null, xs);
      const pts = o.pts.map(p => ({ x: p.x - leX, y: p.y }));
      const chord = Math.max.apply(null, pts.map(p => p.x));
      const lo = Math.min(d.fa, d.fb), hi = Math.max(d.fa, d.fb);
      items.push({ i0: di, z0: zc, beta, k: d.k, dir: beta >= 0 ? 1 : -1, pts, chord,
                   x1: chord * lo / 100, x2: chord * hi / 100, leX, refX: o.refX,
                   za: d.za, zb: d.zb, fa: d.fa, fb: d.fb,
                   place: { z0: zc, beta, refX: o.refX, leX, anchorY: o.anchorY || 0 } });
    });
    // Kreuzungen suchen (nur im Kreuzverband) — halb/halb ausklinken: die eine
    // Schar wird von oben, die andere von unten bis zur halben Höhe geschlitzt.
    const cross = [];
    if (g.mode === 'cross' && g.both && g.notch) {
      const xOfDiag = (it, z) => it.refX + (z - it.z0) / Math.tan(it.beta * Math.PI / 180);
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        if (A.dir === B.dir) continue;
        let prev = null, hit = null;
        for (let z = 0; z <= total; z += Math.max(1, total / 600)) {
          const dd = xOfDiag(A, z) - xOfDiag(B, z);
          if (prev != null && prev * dd <= 0) { hit = z; break; }
          prev = dd;
        }
        if (hit == null) continue;
        if (hit < Math.min(A.za, A.zb) - 1 || hit > Math.max(A.za, A.zb) + 1) continue;
        if (hit < Math.min(B.za, B.zb) - 1 || hit > Math.max(B.za, B.zb) + 1) continue;
        const la = (xOfDiag(A, hit) - A.refX) / Math.cos(A.beta * Math.PI / 180) - A.leX;
        const lb = (xOfDiag(B, hit) - B.refX) / Math.cos(B.beta * Math.PI / 180) - B.leX;
        if (la < A.x1 || la > A.x2 || lb < B.x1 || lb > B.x2) continue;
        cross.push({ a: i, b: j, la, lb });
      }
    }
    const ribCross = geoRibCrossings(stations).byDiag;
    items.forEach((it, i) => {
      const notches = cross.filter(c => c.a === i || c.b === i)
        .map(c => ({ x: c.a === i ? c.la : c.lb, up: c.a === i }));
      // Gegenschlitz dort, wo die Diagonale eine stehengebliebene Rippe kreuzt
      // (Rippe von oben, Diagonale von unten).
      (ribCross[it.i0] || []).forEach(c => {
        const xl = (c.xabs - it.refX) / Math.cos(it.beta * Math.PI / 180) - it.leX;
        if (xl > it.x1 && xl < it.x2) notches.push({ x: xl, up: false, rib: true });
      });
      const mkPart = (ring, side) => {
        if (!ring || ring.length < 3) return;
        let rings = [ring];
        notches.forEach(n => {
          const su = surfAt(ring, n.x); if (!su) return;
          const h = Math.abs(su.top - su.bot);
          const w = Math.max(0.2, g.t || 2) + 0.1;
          const yc = n.up ? su.top + 50 - h / 2 : su.bot - 50 + h / 2;
          rings = boolMany(rings, rectPoly(n.x, yc, w, 100, 0), 'diff');
        });
        // Leichterung der geodätischen Rippen: Felder zwischen den Kreuzungen
        // (wie beim Rautengitter der DLG-/F3K-Flächen) — die Kreuzungen wirken
        // dabei wie Holme, dort bleibt voller Steg stehen.
        let holes = [];
        if (g.mode === 'cross' && g.full && g.holes && rings.length === 1) {
          const keep = notches.map(n => ({ x: n.x, w: Math.max(0.2, g.t || 2) + 2 * Math.max(2, g.holeWeb || 4) }));
          const H = rfCfg().holes, save = { style: H.style, margin: H.margin, min: H.min };
          H.style = g.holeStyle || 'offset'; H.margin = Math.max(1, g.holeWeb || 4); H.min = Math.max(3, g.holeMin || 6);
          try { holes = lightenHoles({ rings }, keep, it.chord).map(h => roundPoly(h, Math.max(0, H.fillet || 0))); }
          finally { Object.assign(H, save); }
        }
        out.push({
          kind: 'geo',
          name: (g.mode === 'cross' ? T('Geodät. Rippe ') : T('Fachwerkrippe ')) + (out.length + 1)
            + (it.dir > 0 ? ' ↗' : ' ↘') + (side ? ' ' + T(side) : ''),
          rings, holes, marks: [], mat: g.mat, t: g.t, layer: g.mode === 'cross' ? 'Geodaeten' : 'Fachwerkrippen', place: it.place,
          note: 'z ' + it.za.toFixed(0) + '…' + it.zb.toFixed(0) + ' mm · ' + it.beta.toFixed(0) + '°'
        });
      };
      if (g.full) {
        const a2 = clipX(it.pts, it.x1, false), b2 = a2 ? clipX(a2, it.x2, true) : null;
        mkPart(b2, '');
      } else {
        mkPart(contourBand(it.pts, it.x1, it.x2, Math.max(1, g.width || 8), true), 'oben');
        mkPart(contourBand(it.pts, it.x1, it.x2, Math.max(1, g.width || 8), false), 'unten');
      }
    });
    return out;
  }

  // ==================================================================
  // 11. Alle Teile sammeln und schachteln
  // ==================================================================
  function rfParts() {
    clearCache();
    const rc = rfCfg();
    if (!hasWing()) return { parts: [], ribs: [], stations: [], total: 0 };
    const { list, total } = rfStations();
    const ribs = [], parts = [];
    list.forEach(st => {
      const rb = buildRib(st);
      ribs.push(rb);
      if (!rb || !rc.show.ribs) return;
      const g = rc.groups[st.group] || rc.groups[0];
      // Alle Stücke EINER Rippe (Hauptteil, Ruderteil, D-Box-/Endleistenstück)
      // bleiben ein Teil in ihrer echten Lage zueinander — so, wie der Schnitt
      // durch die Fläche an dieser Stelle aussieht, mit dem richtigen Spalt.
      const rings = [], holes = [], marks = [];
      rb.pieces.forEach(pc => { pc.rings.forEach(r => rings.push(r)); pc.holes.forEach(h => holes.push(h)); (pc.marks || []).forEach(m => marks.push(m)); });
      if (rings.length) parts.push({
        kind: 'rib', name: 'R' + (st.idx + 1), rings, holes, marks,
        place: rb.place,
        mat: g.matId, t: g.t, group: st.group, layer: 'Rippen',
        note: 'z = ' + st.z.toFixed(0) + ' mm · ' + T('Sehne ') + rb.chord.toFixed(0) + ' mm'
          + (st.skew ? ' · ' + st.skew.toFixed(1) + '°' : '')
          + (rb.pieces.length > 1 ? ' · ' + rb.pieces.length + ' ' + T('Stücke') : '') + ' · ' + (g.name || '')
      });
    });
    if (rc.show.caps) capParts(list).forEach(p => parts.push(p));
    if (rc.show.webs) webParts(list).forEach(p => parts.push(p));
    if (rc.show.flap) flapSparParts(list).forEach(p => parts.push(p));
    capStripParts(list, ribs).forEach(p => parts.push(p));
    if (rc.show.jig) jigParts(list, ribs).forEach(p => parts.push(p));
    if (rc.show.sheet) sheetParts(list).forEach(p => parts.push(p));
    if (rc.show.geo) geoParts(list).forEach(p => parts.push(p));
    if (rc.show.le || rc.show.te) edgeParts(list).forEach(p => parts.push(p));
    // Schnittfugen-Ausgleich (Laser): alle Konturen nach außen, Löcher nach innen.
    if (rc.kerf) parts.forEach(p => {
      const k = rc.kerf / 2;
      p.rings = p.rings.map(r => offsetRing(r, k));
      p.holes = p.holes.map(r => offsetRing(r, -k));
    });
    parts.forEach(p => { const b = bboxOf(p.rings.concat(p.holes)); p.bb = b; });
    return { parts, ribs, stations: list, total };
  }
  // Einfacher Polygon-Versatz (Eckpunkt-Normalen), für den Kerf-Ausgleich.
  function offsetRing(r, d) {
    if (!d || !r || r.length < 3) return r;
    // d > 0 = nach AUSSEN. Bei linkslaeufigem Ring (Flaeche > 0) zeigt die
    // Kantennormale (-dy, dx) nach INNEN, deshalb dort das Vorzeichen drehen.
    const s = polyArea2(r) > 0 ? -1 : 1, n = r.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = r[(i - 1 + n) % n], b = r[i], c = r[(i + 1) % n];
      const n1 = norm(a, b), n2 = norm(b, c);
      let nx = (n1.x + n2.x), ny = (n1.y + n2.y);
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const cosHalf = Math.max(0.35, (n1.x * nx + n1.y * ny));
      out.push({ x: b.x + s * d * nx / cosHalf, y: b.y + s * d * ny / cosHalf });
    }
    return out;
    function norm(a, b) { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: -dy / l, y: dx / l }; }
  }
  // Plattenschlüssel: gleiche Werkstoff/Stärke-Kombination = eine Platte.
  function plateKey(p) { return (p.mat || '-') + '@' + (p.t != null ? (+p.t).toFixed(2) : '-'); }
  function plateLabel(p) {
    const m = matName(p.mat);
    return (m ? m + ' · ' : '') + (p.t != null ? (+p.t).toFixed(1) + ' mm' : T('Stärke offen'));
  }
  // Teile auf „Platten" schachteln (Regal-Layout, Zeile für Zeile).
  // Teile schachteln. Ohne Plattenmaß läuft jede Werkstoff-/Stärkengruppe als
  // ein endloser Streifen; mit Plattenmaß wird auf echte Materialplatten
  // (z. B. Balsa 100 × 1000 mm) aufgeteilt — jede Platte ein eigener Block mit
  // Rahmen und Überschrift, sodass die Zahl der benötigten Platten ablesbar ist.
  function rfLayout(parts) {
    const rc = rfCfg(), gap = Math.max(2, rc.gap || 8);
    const lab = rc.label ? rc.labelH + 3 : 0;
    const PW = Math.max(0, rc.plateW || 0), PH = Math.max(0, rc.plateH || 0);
    const groups = new Map();
    parts.forEach(p => {
      const k = rc.plateSplit ? plateKey(p) : 'all';
      if (!groups.has(k)) groups.set(k, { key: k, label: rc.plateSplit ? plateLabel(p) : T('Alle Teile'), parts: [] });
      groups.get(k).parts.push(p);
    });
    const widest = Math.max(1, ...parts.map(p => p.bb.w));
    const autoW = rc.cols > 0 ? rc.cols * (widest + gap)
      : Math.max(600, Math.sqrt(parts.reduce((a, p) => a + (p.bb.w + gap) * (p.bb.h + gap), 1)) * 1.6);
    const rowW = PW > 0 ? PW : autoW;
    const plates = [];
    let yTop = 0;
    groups.forEach(g => {
      // Passt ein Teil nicht in die Plattenbreite, wird es um 90° gedreht
      // (lange Rippen liegen dann längs auf dem Brett).
      if (PW > 0) g.parts.forEach(p => { if (p.bb.w > PW - gap && p.bb.h <= PW - gap) rotatePart(p); });
      // Große Teile zuerst: füllt die Platten besser.
      const items = g.parts.slice().sort((a, b) => (b.bb.h - a.bb.h) || (b.bb.w - a.bb.w));
      let sheet = null, nr = 0, x = 0, rowH = 0, used = 0;
      const newSheet = () => {
        sheet = { key: g.key, label: g.label + (PW > 0 ? ' · ' + T('Platte ') + (++nr) : ''),
                  parts: [], w: rowW, plate: PW > 0 ? { w: PW, h: PH } : null, y0: yTop };
        plates.push(sheet); x = 0; rowH = 0; used = 0;
      };
      newSheet();
      items.forEach(p => {
        const need = p.bb.h + gap + lab;
        if (x > 0 && x + p.bb.w > rowW) { used += rowH + gap + lab; x = 0; rowH = 0; }
        if (PH > 0 && used + need > PH && (x > 0 || used > 0)) {
          // Platte voll: abschließen und die nächste anfangen.
          sheet.h = PH; sheet.y1 = sheet.y0 - PH; yTop = sheet.y1 - 3 * gap;
          newSheet();
        }
        p.ox = x - p.bb.minx;
        p.oy = (sheet.y0 - used - lab) - p.bb.maxy;
        x += p.bb.w + gap;
        rowH = Math.max(rowH, p.bb.h);
        sheet.parts.push(p);
      });
      const h = used + rowH + gap + lab;
      sheet.h = PH > 0 ? PH : h;
      sheet.y1 = sheet.y0 - sheet.h;
      sheet.fill = PH > 0 ? Math.min(100, Math.round(h / PH * 100)) : null;
      yTop = sheet.y1 - 3 * gap;
    });
    return plates.filter(pl => pl.parts.length);
  }
  // Ein Teil um 90° drehen (Schachtelung). Alle Konturen mitdrehen.
  function rotatePart(p) {
    const rot = r => r.map(q => ({ x: q.y, y: -q.x }));
    p.rings = p.rings.map(rot);
    p.holes = p.holes.map(rot);
    p.marks = (p.marks || []).map(rot);
    p.bb = bboxOf(p.rings.concat(p.holes));
    p.rot = true;
  }
  // Fertige Teile in Weltkoordinaten (nach der Schachtelung).
  function placedPolys(p) {
    const tr = q => ({ x: q.x + p.ox, y: q.y + p.oy });
    return {
      rings: p.rings.map(r => r.map(tr)),
      holes: p.holes.map(r => r.map(tr)),
      marks: (p.marks || []).map(m => m.map(tr)),
      label: { x: p.bb.minx + p.ox, y: p.bb.miny + p.oy - (rfCfg().labelH + 2) }
    };
  }

  // ==================================================================
  // 12. Darstellung
  // ==================================================================
  const COL = {
    rib: '#4aa3ff', cap: '#f5a35c', web: '#57d38c', comb: '#57d38c',
    jig: '#b58cf0', sheet: '#6fd6e0', geo: '#ffd27f', edge: '#d0d6de'
  };
  function partColor(p) { return COL[p.kind] || '#d0d6de'; }
  // --- Grundriss: Rippenlagen (mit Schrägstellung), Holme, Ruder, Geodäten ---
  function renderRfPlan() {
    const cv = document.getElementById('cRfPlan'); if (!cv) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    if (!hasWing()) return;
    const rc = rfCfg(), arr = leTeArr();
    const le = arr.map(s => ({ x: s.z, y: -s.le })), te = arr.map(s => ({ x: s.z, y: -s.te }));
    const outline = le.concat(te.slice().reverse());
    const V = App.makeView(w, h, App.bounds(outline), 40, App.nav.rfplan || (App.nav.rfplan = { z: 1, ox: 0, oy: 0 }));
    App.grid(ctx, w, h, V);
    App.poly(ctx, V, outline, true);
    ctx.fillStyle = App.hexA('#4aa3ff', 0.07); ctx.strokeStyle = App.PAL.profInner; ctx.lineWidth = 1.6;
    ctx.fill(); ctx.stroke();
    const total = segStarts().total;
    // Scharnierlinie (Ruder)
    const hs = [];
    spanSamples([]).forEach(z => { const x = hingeXAt(z, arr); if (x != null) hs.push({ x: z, y: -x }); });
    if (hs.length > 1) {
      ctx.strokeStyle = '#ffd27f'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
      App.poly(ctx, V, hs, false); ctx.stroke(); ctx.setLineDash([]);
    }
    // Ruder: Ruderfläche, Hilfsholm (vor) und Nasenholm (hinter der Scharnierlinie)
    if (rc.flapSplit) {
      const g2 = Math.max(0, rc.flapGap || 0) / 2;
      const zsH = spanSamples([]).filter(z => hingeXAt(z, arr) != null);
      const bandH = (o1, o2, fill, stroke) => {
        const f = [], r = [];
        zsH.forEach(z => { const h = hingeXAt(z, arr), lt = leTeAt(z, arr);
          const x1 = o1 === 'te' ? lt.te : h + o1, x2 = o2 === 'te' ? lt.te : h + o2;
          f.push({ x: z, y: -x1 }); r.push({ x: z, y: -x2 }); });
        if (f.length < 2) return;
        App.poly(ctx, V, f.concat(r.reverse()), true);
        ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
      };
      bandH(g2, 'te', App.hexA('#ffd27f', 0.10), App.hexA('#ffd27f', 0.5));
      if (rc.flapSpar.on) bandH(-g2 - Math.max(0, rc.flapSpar.w), -g2, App.hexA(COL.web, 0.35), COL.web);
      if (rc.flapRSpar.on) bandH(g2, g2 + Math.max(0, rc.flapRSpar.w), App.hexA(COL.web, 0.35), COL.web);
    }
    // Holme als Band in wahrer Gurtbreite
    sparList().forEach((sp, j) => {
      const segs = state.segments || [], { z0 } = segStarts();
      const a = Math.max(0, Math.min(sp.segFrom | 0, sp.segTo | 0)), b = Math.min(segs.length - 1, Math.max(sp.segFrom | 0, sp.segTo | 0));
      const zA = z0[a] || 0, zB = (z0[b] || 0) + (segs[b] ? segs[b].span || 0 : 0);
      const f = [], r = [];
      spanSamples([]).filter(z => z >= zA - 1e-6 && z <= zB + 1e-6).forEach(z => {
        const x = sparXAt(j, z, arr), wd = capWAt(sp, z, total);
        f.push({ x: z, y: -(x - wd / 2) }); r.push({ x: z, y: -(x + wd / 2) });
      });
      if (f.length < 2) return;
      App.poly(ctx, V, f.concat(r.reverse()), true);
      ctx.fillStyle = App.hexA(COL.cap, 0.18); ctx.strokeStyle = COL.cap; ctx.lineWidth = 1.2;
      ctx.fill(); ctx.stroke();
    });
    // Beplankungsgrenzen: wo die Beplankung endet — im Grundriss sichtbar, damit
    // sich die Bahnen und die Rippenstufen zuordnen lassen.
    if (anySheet() && rc.show.sheetLines !== false) {
      const zz = rc.zones;
      const band = (f1, f2, col, label) => {
        const a = [], b = [];
        const F = v => typeof v === 'function' ? v : () => v;
        const g1 = F(f1), g2 = F(f2);
        sheetSamples(rfStations().list).forEach(z => {
          const lt = leTeAt(z, arr), ch = lt.te - lt.le;
          a.push({ x: z, y: -(lt.le + ch * g1(z)) });
          b.push({ x: z, y: -(lt.le + ch * g2(z)) });
        });
        if (a.length < 2) return;
        App.poly(ctx, V, a.concat(b.slice().reverse()), true);
        ctx.fillStyle = App.hexA(col, 0.10); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1.1; ctx.setLineDash([7, 4]);
        // gestrichelt die Beplankungskante (nicht Nase/Endleiste)
        App.poly(ctx, V, (typeof f2 === 'function' || f2 < 1) ? b : a, false); ctx.stroke(); ctx.setLineDash([]);
        if (label) {
          const m = b[Math.floor(b.length / 2)];
          ctx.fillStyle = col; ctx.font = '10px system-ui';
          ctx.fillText(T(label), V.X(m.x) + 3, V.Y(m.y) - 3);
        }
      };
      if (zz.full) band(0, 1, COL.sheet, 'Vollbeplankung');
      else {
        if (zz.dbox) band(0, z => edgeF('dbox', z), COL.sheet, 'Beplankung D-Box');
        if (zz.te) band(z => edgeF('te', z), 1, COL.sheet, 'Beplankung Endleiste');
      }
    }
    // Rippenlagen (schräge Rippen als schräge Linien)
    const { list } = rfStations();
    ctx.font = '10px system-ui';
    list.forEach(st => {
      if (st.type === 'skip') return;
      const lt = leTeAt(st.z, arr);
      const beta = rc.skewScope === 'flap' ? 0 : st.skew;
      const tb = Math.tan(beta * Math.PI / 180);
      const refX = lt.le + 0.25 * (lt.te - lt.le);
      const xa = st.type === 'te' ? lt.le + (lt.te - lt.le) * rc.teFrom / 100 : lt.le;
      const xb = st.type === 'dbox' ? lt.le + (lt.te - lt.le) * rc.dboxTo / 100 : lt.te;
      const pa = { x: st.z + (xa - refX) * tb, y: -xa }, pb = { x: st.z + (xb - refX) * tb, y: -xb };
      const g = rc.groups[st.group] || rc.groups[0];
      ctx.strokeStyle = g && g.color ? g.color : App.PAL.profOuter;
      ctx.lineWidth = Math.max(1.2, Math.min(4, (st.t_mat || 3) * 0.5));
      ctx.beginPath(); ctx.moveTo(V.X(pa.x), V.Y(pa.y)); ctx.lineTo(V.X(pb.x), V.Y(pb.y)); ctx.stroke();
      ctx.fillStyle = '#e6ebf1';
      ctx.fillText('R' + (st.idx + 1), V.X(pa.x) - 6, V.Y(pa.y) - 4);
    });
    // Geodäten
    if (rc.geo.on && rc.show.geo) {
      ctx.strokeStyle = COL.geo; ctx.lineWidth = 1.4;
      geoSpans(list).forEach(d => {
        const ra = geoRange(Math.max(0, Math.min(total, d.za)), arr);
        const rb = geoRange(Math.max(0, Math.min(total, d.zb)), arr);
        const xa = ra.lt.le + ra.ch * geoVal(d.fa, d.za) / 100, xb = rb.lt.le + rb.ch * geoVal(d.fb, d.zb) / 100;
        ctx.beginPath();
        ctx.moveTo(V.X(d.za), V.Y(-xa));
        ctx.lineTo(V.X(d.zb), V.Y(-xb));
        ctx.stroke();
      });
    }
    ctx.fillStyle = '#8b98a8'; ctx.font = '11px system-ui';
    ctx.fillText(T('▲ Flugrichtung'), 12, 18);
  }
  // --- Teile-Ansicht (geschachtelt wie im DXF) ----------------------
  let lastLayout = null;
  function renderRf() {
    renderRfPlan();
    const cv = document.getElementById('cRf'); if (!cv) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    const info = document.getElementById('rfInfo');
    if (!hasWing()) { if (info) info.textContent = T('Keine Tragfläche.'); return; }
    if (sidebarNoWing) { sidebarNoWing = false; App.buildSidebar(); }
    const rc = rfCfg();
    let data;
    try { data = rfParts(); } catch (e) { if (info) info.textContent = T('Fehler beim Aufbau: ') + e.message; return; }
    const plates = rfLayout(data.parts);
    lastLayout = { data, plates };
    if (!data.parts.length) { if (info) info.textContent = T('Keine Teile gewählt — im Menü „Teile" Inhalte ankreuzen.'); return; }
    const all = [];
    data.parts.forEach(p => { const q = placedPolys(p); q.rings.concat(q.holes).forEach(r => all.push(r)); });
    const V = App.makeView(w, h, App.bounds([].concat.apply([], all)), 50, App.nav.rf || (App.nav.rf = { z: 1, ox: 0, oy: 0 }));
    App.grid(ctx, w, h, V);
    plates.forEach(pl => {
      if (pl.plate) {
        ctx.strokeStyle = '#3a4657'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
        App.poly(ctx, V, [{ x: 0, y: pl.y0 }, { x: pl.plate.w, y: pl.y0 },
          { x: pl.plate.w, y: pl.y0 - pl.plate.h }, { x: 0, y: pl.y0 - pl.plate.h }], true);
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = '#8b98a8'; ctx.font = 'bold 12px system-ui';
      ctx.fillText('▸ ' + pl.label + '  (' + pl.parts.length + ' ' + T('Teile')
        + (pl.fill != null ? ' · ' + pl.fill + '% ' + T('belegt') : '') + ')', 8, V.Y(pl.y0) - 2);
      pl.parts.forEach(p => {
        const q = placedPolys(p), c = partColor(p);
        ctx.lineWidth = 1.6; ctx.strokeStyle = c; ctx.fillStyle = App.hexA(c, 0.10);
        q.rings.forEach(r => { App.poly(ctx, V, r, true); ctx.fill(); ctx.stroke(); });
        ctx.lineWidth = 1.1;
        q.holes.forEach(r => { App.poly(ctx, V, r, true); ctx.fillStyle = '#0d1117'; ctx.fill(); ctx.stroke(); });
        ctx.setLineDash([3, 3]); ctx.lineWidth = 0.9; ctx.strokeStyle = App.hexA(c, 0.7);
        q.marks.forEach(m => { App.poly(ctx, V, m, false); ctx.stroke(); });
        ctx.setLineDash([]);
        if (rc.label) {
          ctx.fillStyle = '#e6ebf1'; ctx.font = '10px system-ui';
          ctx.fillText(p.name, V.X(q.label.x), V.Y(q.label.y));
        }
      });
    });
    if (info) {
      const byKind = {};
      data.parts.forEach(p => { byKind[p.kind] = (byKind[p.kind] || 0) + 1; });
      const names = { rib: 'Rippen', cap: 'Gurte', web: 'Stege', comb: 'Kämme', jig: 'Helling', sheet: 'Beplankung', geo: 'Geodäten', edge: 'Leisten' };
      let mSum = 0;
      data.parts.forEach(p => {
        const a = p.rings.reduce((x, r) => x + Math.abs(polyArea2(r)), 0) - p.holes.reduce((x, r) => x + Math.abs(polyArea2(r)), 0);
        const d = matDensity(p.mat);
        if (d && p.t) mSum += a * p.t * d * 1e-6;
      });
      info.innerHTML = '<b>' + data.parts.length + '</b> ' + T('Teile') + ' · '
        + Object.keys(byKind).map(k => byKind[k] + ' ' + T(names[k] || k)).join(' · ')
        + ' · ' + T('Spannweite ') + data.total.toFixed(0) + ' mm'
        + ' · ' + plates.length + ' ' + T('Platten')
        + (mSum ? ' · ' + T('Gerüst ') + mSum.toFixed(0) + ' g' : '')
        + '<div class="hint" style="margin-top:5px">' + T('Ziehen = verschieben · Rad = Zoom · Doppelklick = zurück. ')
        + T('Je Platte ein Werkstoff und eine Materialstärke — Überschrift links.') + '</div>';
    }
  }


  // ==================================================================
  // 12b. 3D-Ansicht des zusammengebauten Flügels
  // ==================================================================
  // Zeigt den Bausatz so, wie er zusammengesteckt aussieht: Rippen an ihrer
  // Spannweitenposition (mit Schrägstellung), Holmgurte und -stege entlang der
  // Holmlinie, Nasen-/Endleiste und die Steckung. Bewusst eine eigene, kleine
  // Malerei (Painter-Algorithmus) — kein WebGL nötig, läuft überall.
  const view3d = { rx: -0.95, ry: 0.75, zoom: 1, ox: 0, oy: 0, tris: null, center: [0, 0, 0], size: 1 };

  // --- Ohrenschneiden (Triangulierung eines einfachen Polygons) ------
  function earClip(poly) {
    const n = poly.length; if (n < 3) return [];
    const idx = []; for (let i = 0; i < n; i++) idx.push(i);
    let area = 0;
    for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
    if (area < 0) idx.reverse();
    const tri = [];
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const inTri = (p, a, b, c) => {
      const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
    let guard = 0;
    while (idx.length > 3 && guard++ < 6000) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i - 1 + idx.length) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        const a = poly[ia], b = poly[ib], c = poly[ic];
        if (cross(a, b, c) <= 0) continue;                 // keine konvexe Ecke
        let ok = true;
        for (let k = 0; k < idx.length; k++) {
          const j = idx[k];
          if (j === ia || j === ib || j === ic) continue;
          if (inTri(poly[j], a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        tri.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
      }
      if (!cut) break;
    }
    if (idx.length >= 3) for (let i = 1; i < idx.length - 1; i++) tri.push([idx[0], idx[i], idx[i + 1]]);
    return tri;
  }
  // Flaches Polygon zu einem Körper aufdicken. mapFn bildet (x, y, s) auf einen
  // 3D-Punkt ab, s = -1 / +1 für die beiden Seiten.
  function prism(poly, mapFn, out) {
    const n = poly.length; if (n < 3) return;
    const A = poly.map(p => mapFn(p.x, p.y, -1));
    const B = poly.map(p => mapFn(p.x, p.y, +1));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push([A[i], A[j], B[j]]); out.push([A[i], B[j], B[i]]);
    }
    earClip(poly).forEach(t => {
      out.push([A[t[0]], A[t[2]], A[t[1]]]);
      out.push([B[t[0]], B[t[1]], B[t[2]]]);
    });
  }
  // Körper aus einer Folge von Querschnitten (gleiche Punktzahl).
  function loft(sections, out, caps) {
    for (let k = 0; k < sections.length - 1; k++) {
      const a = sections[k], b = sections[k + 1], n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        out.push([a[i], a[j], b[j]]); out.push([a[i], b[j], b[i]]);
      }
    }
    if (caps !== false && sections.length) {
      const f = sections[0], l = sections[sections.length - 1];
      for (let i = 1; i < f.length - 1; i++) out.push([f[0], f[i + 1], f[i]]);
      for (let i = 1; i < l.length - 1; i++) out.push([l[0], l[i], l[i + 1]]);
    }
  }
  // Rechteck-Querschnitt (4 Punkte) an einer Stelle der Spannweite.
  function boxSection(x, y, w, h, z) {
    return [[x - w / 2, y - h / 2, z], [x + w / 2, y - h / 2, z],
            [x + w / 2, y + h / 2, z], [x - w / 2, y + h / 2, z]];
  }
  // Kreis-Querschnitt (Rundstab/Rohr) an einer Stelle der Spannweite.
  function ringSection(x, y, r, z, n) {
    const out = [];
    n = n || 24;
    for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * 2 * Math.PI; out.push([x + r * Math.cos(a), y + r * Math.sin(a), z]); }
    return out;
  }
  // Mehrere Querschnittsfolgen loften: null in der Liste trennt zwei Abschnitte
  // (z. B. dort, wo ein Ruder aufhört).
  function loftRuns(list, out) {
    let run = [];
    const flush = () => { if (run.length > 1) loft(run, out); run = []; };
    list.forEach(s => { if (!s) flush(); else run.push(s); });
    flush();
  }
  // --- Modell zusammenbauen -----------------------------------------
  function rf3dBuild() {
    const rc = rfCfg();
    const wasFlat = rc.flatten;
    rc.flatten = false;                 // für 3D immer in der echten Lage
    let data;
    try { data = rfParts(); } finally { rc.flatten = wasFlat; }
    const groups = [];
    const arr = leTeArr(), total = segStarts().total;
    // Rippen und Diagonalen: ihre Ebene steht schräg im Raum.
    const ribTris = [], geoTris = [];
    data.parts.forEach(p => {
      if (!p.place || (p.kind !== 'rib' && p.kind !== 'geo')) return;
      const pl = p.place, cb = Math.cos(pl.beta * Math.PI / 180), sb = Math.sin(pl.beta * Math.PI / 180);
      const t = Math.max(0.2, p.t || 2) / 2;
      const map = (X, Y, sgn) => {
        const raw = X + pl.leX;
        return [pl.refX + raw * cb - sgn * t * sb, Y + pl.anchorY, pl.z0 + raw * sb + sgn * t * cb];
      };
      const out = p.kind === 'geo' ? geoTris : ribTris;
      p.rings.forEach(r => prism(r, map, out));
    });
    if (ribTris.length) groups.push({ name: 'Rippen', tris: ribTris, col: [110, 165, 225] });
    if (geoTris.length) groups.push({ name: 'Geodäten', tris: geoTris, col: [235, 200, 120] });
    // Holmgurte und -stege entlang der Holmlinie.
    const capTris = [], webTris = [];
    sparList().forEach((sp, j) => {
      const segs = state.segments || [], { z0 } = segStarts();
      const a = Math.max(0, Math.min(sp.segFrom | 0, sp.segTo | 0));
      const b = Math.min(segs.length - 1, Math.max(sp.segFrom | 0, sp.segTo | 0));
      const zA = z0[a] || 0, zB = (z0[b] || 0) + (segs[b] ? segs[b].span || 0 : 0);
      const zs = spanSamples([]).filter(z => z >= zA - 1e-6 && z <= zB + 1e-6);
      if (zs.length < 2) return;
      const top = [], bot = [], web = [];
      zs.forEach(z => {
        const c = coreAt(z), lt = leTeAt(z, arr);
        const x = sparXAt(j, z, arr) - lt.le;
        const su = surfAt(c.pts, x); if (!su) return;
        const w = capWAt(sp, z, total), cT = Math.max(0.2, sp.capT || 3);
        const xa = sparXAt(j, z, arr);
        if (sp.capMode === 'both' || sp.capMode === 'top') top.push(boxSection(xa, su.top - cT / 2, w, cT, z));
        if (sp.capMode === 'both' || sp.capMode === 'bot') bot.push(boxSection(xa, su.bot + cT / 2, w, cT, z));
        if (sp.web === 'flat' || sp.web === 'comb' || sp.web === 'jigcomb') {
          const yT = su.top - (sp.capMode === 'both' || sp.capMode === 'top' ? cT : 0);
          const yB = su.bot + (sp.capMode === 'both' || sp.capMode === 'bot' ? cT : 0);
          if (yT > yB) web.push(boxSection(xa, (yT + yB) / 2, Math.max(0.2, sp.webT || 3), yT - yB, z));
        }
      });
      if (top.length > 1) loft(top, capTris);
      if (bot.length > 1) loft(bot, capTris);
      if (web.length > 1) loft(web, webTris);
    });
    if (capTris.length) groups.push({ name: 'Holmgurte', tris: capTris, col: [240, 165, 95] });
    if (webTris.length) groups.push({ name: 'Stege', tris: webTris, col: [95, 210, 145] });
    // Nasen- und Endleiste.
    const edgeTris = [];
    const zsAll = spanSamples([]);
    if (rc.leOn) {
      const sec = [];
      zsAll.forEach(z => {
        const c = coreAt(z), lt = leTeAt(z, arr);
        const su = surfAt(c.pts, Math.min(c.chord * 0.02 + (rc.leShape === 'round' ? rc.leD / 2 : rc.leW), c.chord * 0.4));
        const ym = su ? (su.top + su.bot) / 2 : 0;
        if (rc.leShape === 'round') {
          // Rundstab: runder Querschnitt, Achse dort, wo die Rippe endet.
          const r = Math.max(0.5, (rc.leD || 8) / 2);
          sec.push(ringSection(lt.le + r, ym, r, z, 24));
          return;
        }
        const w = rc.leShape === 'tri' ? rc.leTriW : rc.leW;
        const h = rc.leShape === 'tri' ? rc.leTriH : (su ? su.top - su.bot : 6);
        sec.push(boxSection(lt.le + w / 2, ym, w, h, z));
      });
      if (sec.length > 1) loft(sec, edgeTris);
    }
    if (rc.teOn) {
      const sec = [];
      zsAll.forEach(z => {
        const c = coreAt(z), lt = leTeAt(z, arr);
        const su = surfAt(c.pts, c.chord * 0.97);
        const ym = su ? (su.top + su.bot) / 2 : 0;
        sec.push(boxSection(lt.te - rc.teW / 2, ym, rc.teW, Math.max(1, rc.teH), z));
      });
      if (sec.length > 1) loft(sec, edgeTris);
    }
    if (edgeTris.length) groups.push({ name: 'Leisten', tris: edgeTris, col: [200, 205, 215] });
    // Steckung.
    if (rc.joiner.on) {
      const jo = rc.joiner, sec = [], zEnd = jo.side === 'tip' ? total : 0;
      const zMax = Math.max(1, rfStations().list.filter(joinerAppliesTo).reduce((m, st) => Math.max(m, Math.abs(st.z - zEnd)), 0));
      const n = 20;
      for (let k = 0; k <= 10; k++) {
        const z = zEnd + (jo.side === 'tip' ? -1 : 1) * zMax * k / 10;
        const c = coreAt(Math.max(0, Math.min(total, z))), lt = leTeAt(Math.max(0, Math.min(total, z)), arr);
        const x = lt.le + (jo.posMode === 'mm' ? jo.pos : c.chord * jo.pos / 100);
        const su = surfAt(c.pts, x - lt.le) || { top: 0, bot: 0 };
        const dz = jo.side === 'tip' ? (total - z) : z;
        const y = (jo.yMode === 'mm' ? jo.y : (su.top + su.bot) / 2) + dz * Math.tan((jo.angle || 0) * Math.PI / 180);
        if (jo.shape === 'round') {
          const ring = [];
          for (let i = 0; i < n; i++) { const a2 = (i + 0.5) / n * 2 * Math.PI; ring.push([x + jo.w / 2 * Math.cos(a2), y + jo.w / 2 * Math.sin(a2), z]); }
          sec.push(ring);
        } else sec.push(boxSection(x, y, jo.w, jo.h, z));
      }
      const jt = []; if (sec.length > 1) loft(sec, jt);
      if (jt.length) groups.push({ name: 'Steckung', tris: jt, col: [200, 120, 210] });
    }
    // --- Ruder-Hilfsholme (Gurte bzw. aufgeleimte Leisten) -----------
    // Lage genau wie an der Rippe: Bezug ist die Kante des Ruderspalts,
    // davor (Fläche) bzw. dahinter (Ruder) sitzt der Gurt in seiner Nut.
    if (rc.flapSplit) {
      const auxTris = [], gap = Math.max(0, rc.flapGap || 0);
      const aDef = Math.max(5, Math.min(80, rc.flapDefl || 45)) * Math.PI / 180;
      const auxSpar3d = (cfg, flapSide) => {
        if (!cfg.on) return;
        const w = Math.max(0.5, cfg.w), cT = Math.max(0.2, cfg.capT || 2);
        const secT = [], secB = [], secS = [];
        zsAll.forEach(z => {
          const hx0 = hingeXAt(z, arr);
          if (hx0 == null) { secT.push(null); secB.push(null); secS.push(null); return; }
          const c = coreAt(z), lt = leTeAt(z, arr), hx = hx0 - lt.le;
          const hs = surfAt(c.pts, hx);
          if (!hs) { secT.push(null); secB.push(null); secS.push(null); return; }
          const hT = Math.max(0.5, hs.top - hs.bot);
          const hy = rc.flapHinge === 'top' ? hs.top : rc.flapHinge === 'bot' ? hs.bot : (hs.top + hs.bot) / 2;
          const round = rc.flapNose === 'round', rNose = rc.flapHinge === 'mid' ? hT / 2 : hT;
          const vDepth = rc.flapNose === 'v' ? rNose * Math.tan(aDef) : 0;
          const edgeX = ys => {
            if (round) {
              const R = flapSide ? rNose : rNose + 2 * gap, dy = ys - hy;
              return Math.abs(dy) < R ? hx - Math.sqrt(R * R - dy * dy) : (flapSide ? hx + gap : hx - gap);
            }
            if (!flapSide) return hx - gap;
            if (rc.flapNose !== 'v') return hx + gap;
            const topSurf = ys >= hy - 1e-6;
            if (rc.flapHinge === 'mid') return hx + gap + vDepth;
            if (rc.flapHinge === 'top') return topSurf ? hx + gap : hx + gap + vDepth;
            return topSurf ? hx + gap + vDepth : hx + gap;
          };
          const place = which => {
            const ys = which === 'top' ? hs.top : hs.bot;
            const d = cfg.xMode === 'mm' ? Math.max(0, which === 'top' ? cfg.dTop : cfg.dBot) : 1;
            const e = edgeX(ys), cx = flapSide ? e + d + w / 2 : e - d - w / 2;
            const su = surfAt(c.pts, cx);
            return su && cx > 0 && cx < c.chord ? { cx, su } : null;
          };
          const T0 = place('top'), B0 = place('bot');
          if (cfg.mode === 'strip') {
            // Aufgeleimte Leiste über die ganze Profilhöhe.
            secT.push(null); secB.push(null);
            if (T0 && B0 && T0.su.top > B0.su.bot)
              secS.push(boxSection(lt.le + (T0.cx + B0.cx) / 2, (T0.su.top + B0.su.bot) / 2, w, T0.su.top - B0.su.bot, z));
            else secS.push(null);
            return;
          }
          secS.push(null);
          secT.push(T0 ? boxSection(lt.le + T0.cx, T0.su.top - cT / 2, w, cT, z) : null);
          secB.push(B0 ? boxSection(lt.le + B0.cx, B0.su.bot + cT / 2, w, cT, z) : null);
        });
        loftRuns(secT, auxTris); loftRuns(secB, auxTris); loftRuns(secS, auxTris);
      };
      auxSpar3d(rc.flapSpar, false);
      auxSpar3d(rc.flapRSpar, true);
      if (auxTris.length) groups.push({ name: 'Hilfsholme', tris: auxTris, col: [250, 210, 120] });
    }
    // --- Beplankung ---------------------------------------------------
    // Dünne Schale zwischen Außenhaut und Kernkontur, nur in den beplankten
    // Zonen. Die Punkte der Querschnitte liegen index-gleich, deshalb lassen
    // sich Außen- und Innenhaut Feld für Feld über die Spannweite vernähen.
    if (rc.show.sheet && anySheet()) {
      const shTris = [], secs = [];
      zsAll.forEach(z => {
        const st = Object.assign({ z }, locateZ(z));
        const sec = sectionAt(z), sh = sheetAt(st);
        if (!(sh.top > 0) && !(sh.bot > 0)) { secs.push(null); return; }
        const loc = sec.pts.map(p => ({ x: p.x - sec.leX, y: p.y }));
        let off = null;
        if (window.HotWire && HotWire.offsetPathTB) {
          try { off = HotWire.offsetPathTB(loc, sh.top || 0, sh.bot || 0); } catch (e) { off = null; }
        }
        if (!off || off.length !== loc.length) { secs.push(null); return; }
        const lt = leTeAt(z, arr), chord = sec.teX - sec.leX, hf = hingeFracAt(z);
        let iLE = 0; for (let i = 1; i < loc.length; i++) if (loc[i].x < loc[iLE].x) iLE = i;
        secs.push({
          z,
          out: loc.map(p => ({ x: p.x + lt.le, y: p.y })),
          inn: off.map(p => ({ x: p.x + lt.le, y: p.y })),
          on: loc.map((p, i) => sheeted(chord ? p.x / chord : 0, i <= iLE, hf, z))
        });
      });
      for (let k = 0; k + 1 < secs.length; k++) {
        const a = secs[k], b = secs[k + 1];
        if (!a || !b || a.out.length !== b.out.length) continue;
        const n = a.out.length;
        const P = (s2, side, i) => [s2[side][i].x, s2[side][i].y, s2.z];
        for (let i = 0; i < n - 1; i++) {
          const j = i + 1;
          if (!(a.on[i] && a.on[j] && b.on[i] && b.on[j])) continue;
          const A = P(a, 'out', i), B = P(a, 'out', j), C = P(b, 'out', j), D = P(b, 'out', i);
          const A2 = P(a, 'inn', i), B2 = P(a, 'inn', j), C2 = P(b, 'inn', j), D2 = P(b, 'inn', i);
          shTris.push([A, B, C], [A, C, D]);
          shTris.push([A2, C2, B2], [A2, D2, C2]);
          // Stirnflächen an den Zonengrenzen (Beplankungskante).
          if (i === 0 || !(a.on[i - 1] && b.on[i - 1])) shTris.push([A, D, A2], [D, D2, A2]);
          if (j === n - 1 || !(a.on[j + 1] && b.on[j + 1])) shTris.push([B, B2, C], [C, B2, C2]);
        }
      }
      if (shTris.length) groups.push({ name: 'Beplankung', tris: shTris, col: [111, 214, 224] });
    }
    return { groups, parts: data.parts.length, total };
  }
  function rf3dOpen() {
    if (!hasWing()) { App.toast && App.toast(T('Keine Tragfläche.')); return; }
    let m;
    try { m = rf3dBuild(); } catch (e) { App.toast && App.toast(T('3D-Ansicht fehlgeschlagen: ') + e.message); return; }
    if (!m.groups.length) { App.toast && App.toast(T('Keine Teile für die 3D-Ansicht.')); return; }
    view3d.model = m;
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    m.groups.forEach(g => g.tris.forEach(t => t.forEach(p => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } })));
    view3d.center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    view3d.size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
    view3d.rx = -0.95; view3d.ry = 0.75; view3d.zoom = 1; view3d.ox = 0; view3d.oy = 0;
    const md = document.getElementById('rf3dModal'); if (md) md.classList.add('open');
    requestAnimationFrame(rf3dRender);
  }
  function rf3dClose() { const m = document.getElementById('rf3dModal'); if (m) m.classList.remove('open'); }
  function rf3dRender() {
    const cv = document.getElementById('cRf3d'); if (!cv || !view3d.model) return;
    const { ctx, w, h } = App.fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0e12'; ctx.fillRect(0, 0, w, h);
    const c0 = view3d.center;
    const sr = Math.sin(view3d.rx), cr = Math.cos(view3d.rx);
    const sy = Math.sin(view3d.ry), cy = Math.cos(view3d.ry);
    const scale = (Math.min(w, h) / (view3d.size * 1.35)) * view3d.zoom;
    const rot = p => {
      const x = p[0] - c0[0], y = p[1] - c0[1], z = p[2] - c0[2];
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      return [x1, y * cr - z1 * sr, y * sr + z1 * cr];
    };
    const L = [0.42, 0.52, 0.74];
    const faces = [];
    view3d.model.groups.forEach(g => g.tris.forEach(t => {
      const A = rot(t[0]), B = rot(t[1]), C = rot(t[2]);
      const nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
      const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
      const nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      const nl = Math.hypot(nx, ny, nz) || 1;
      const lit = 0.28 + 0.72 * Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      faces.push({ A, B, C, lit, col: g.col, depth: (A[2] + B[2] + C[2]) / 3 });
    }));
    faces.sort((a, b) => a.depth - b.depth);
    const X = p => w / 2 + view3d.ox + p[0] * scale;
    const Y = p => h / 2 + view3d.oy - p[1] * scale;
    faces.forEach(f => {
      ctx.beginPath(); ctx.moveTo(X(f.A), Y(f.A)); ctx.lineTo(X(f.B), Y(f.B)); ctx.lineTo(X(f.C), Y(f.C)); ctx.closePath();
      ctx.fillStyle = 'rgb(' + Math.round(f.col[0] * f.lit) + ',' + Math.round(f.col[1] * f.lit) + ',' + Math.round(f.col[2] * f.lit) + ')';
      ctx.fill();
    });
    const info = document.getElementById('rf3dInfo');
    if (info) info.innerHTML = '<b>' + view3d.model.parts + '</b> ' + T('Teile') + ' · '
      + view3d.model.groups.map(g => T(g.name)).join(' · ')
      + '<div class="hint" style="margin-top:4px">' + T('Ziehen = drehen · Shift+Ziehen = schieben · Rad = Zoom')
      + '</div>';
  }
  function rf3dNav() {
    const cv = document.getElementById('cRf3d'); if (!cv) return;
    let drag = null;
    cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, sh: e.shiftKey }; cv.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', () => { drag = null; if (cv) cv.style.cursor = 'grab'; });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.sh || e.shiftKey) { view3d.ox += dx; view3d.oy += dy; }
      else { view3d.ry += dx * 0.008; view3d.rx += dy * 0.008; }
      rf3dRender();
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      view3d.zoom = Math.max(0.15, Math.min(12, view3d.zoom * Math.exp(-e.deltaY * 0.0015)));
      rf3dRender();
    }, { passive: false });
    cv.addEventListener('dblclick', () => { view3d.zoom = 1; view3d.ox = 0; view3d.oy = 0; rf3dRender(); });
  }

  // ==================================================================
  // 13. Ausgabe: DXF, CAD-Übergabe
  // ==================================================================
  function rfLayers() {
    const rc = rfCfg();
    const data = rfParts(), plates = rfLayout(data.parts);
    const map = new Map();
    const get = name => { if (!map.has(name)) map.set(name, { name, color: 7, polys: [], texts: [] }); return map.get(name); };
    const COLI = { Rippen: 5, Holmgurt: 30, Holmsteg: 3, Rippenkamm: 3, Hilfsholm: 3, Helling: 6, Beplankung: 4, 'Beplankung D-Box': 4, 'Beplankung Endleiste': 4, Geodaeten: 2, Nasenleiste: 7, Endleiste: 7, Markierung: 8, Beschriftung: 8 };
    plates.forEach(pl => {
      pl.parts.forEach(p => {
        const q = placedPolys(p);
        const ly = get(p.layer || 'Teile'); ly.color = COLI[p.layer] != null ? COLI[p.layer] : 7;
        q.rings.forEach(r => ly.polys.push({ pts: r, closed: true }));
        q.holes.forEach(r => ly.polys.push({ pts: r, closed: true }));
        if (q.marks.length) { const m = get('Markierung'); m.color = 8; q.marks.forEach(mk => m.polys.push({ pts: mk, closed: false })); }
        if (rc.label) {
          const tl = get('Beschriftung'); tl.color = 8;
          tl.texts.push({ x: p.bb.minx + p.ox + p.bb.w / 2, y: p.bb.miny + p.oy - (rc.labelH + 2), h: rc.labelH, text: p.name, rot: 0 });
        }
      });
      if (rc.label) {
        const tl = get('Beschriftung'); tl.color = 8;
        tl.texts.push({ x: 0, y: pl.y0 + 3, h: rc.labelH * 1.3, text: pl.label, rot: 0 });
      }
    });
    return { layers: Array.from(map.values()), data, plates };
  }
  async function rfExportDxf() {
    if (DEMO.on) { App.toast && App.toast(DEMO.msg); return; }
    if (!hasWing()) { App.toast && App.toast(T('Keine Tragfläche.')); return; }
    const { layers } = rfLayers();
    if (!layers.length) { App.toast && App.toast(T('Keine Teile gewählt.')); return; }
    const text = Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 4 });
    const wt = App.wingFileTag ? App.wingFileTag() : '';
    await App.exportViaPicker((wt || 'tragflaeche') + '_rippenflaeche.dxf', text, 'application/dxf', 'svDxf');
  }
  // Stückliste als CSV (Teil, Art, Werkstoff, Stärke, Maße).
  async function rfExportCsv() {
    if (DEMO.on) { App.toast && App.toast(DEMO.msg); return; }
    const data = rfParts();
    const rows = [['Teil', 'Art', 'Werkstoff', 'Staerke_mm', 'Breite_mm', 'Hoehe_mm', 'Flaeche_cm2', 'Masse_g', 'Hinweis'].join(';')];
    let mSum = 0;
    data.parts.forEach(p => {
      // Fläche = Außenringe minus Löcher; Masse = Fläche × Stärke × Rohdichte.
      const a = p.rings.reduce((x, r) => x + Math.abs(polyArea2(r)), 0) - p.holes.reduce((x, r) => x + Math.abs(polyArea2(r)), 0);
      const dens = matDensity(p.mat);
      const m = dens && p.t ? a * p.t * dens * 1e-6 : 0;   // mm³ × kg/m³ → g
      mSum += m;
      rows.push([p.name, p.kind, matName(p.mat) || '-', p.t != null ? (+p.t).toFixed(2) : '',
        p.bb.w.toFixed(1), p.bb.h.toFixed(1), (a / 100).toFixed(1), m ? m.toFixed(2) : '',
        (p.note || '').replace(/;/g, ',')].join(';'));
    });
    rows.push(['SUMME', '', '', '', '', '', '', mSum ? mSum.toFixed(1) : '', T('Gesamtmasse der Teile')].join(';'));
    const wt = App.wingFileTag ? App.wingFileTag() : '';
    await App.exportViaPicker((wt || 'tragflaeche') + '_stueckliste.csv', rows.join('\r\n') + '\r\n', 'text/csv', 'svCsv');
  }
  // --- Übergabe an den CAD-Reiter -----------------------------------
  // Dieselbe Geometrie wie im DXF, aber direkt als CAD-Layer — dort lässt sich
  // jedes Teil weiterbearbeiten (Bohrungen, Beschriftung, Verschieben) und
  // anschließend fräsen/lasern.
  function rfToCad() {
    if (!App.cadEnsureLayer || !App.cadAddEntity) { App.toast && App.toast(T('CAD-Bearbeitung nicht verfügbar.')); return; }
    if (!hasWing()) { (App.cadFlash || App.toast || (() => {}))(T('Keine Tragfläche.')); return; }
    const rc = rfCfg();
    const { data, plates } = rfLayers();
    if (!data.parts.length) { (App.cadFlash || App.toast)(T('Keine Teile gewählt.')); return; }
    if (App.cadClearAsk && !App.cadClearAsk()) return;
    if (App.cadPushUndo) App.cadPushUndo();
    const c = state.cad;
    c.layers = {}; c.order = []; c.texts = []; c.layerColors = {}; c.layerHidden = {}; c.lineStyles = {};
    const mk = (pts, closed) => { const a = pts.map(p => ({ x: p.x, y: p.y })); a.closed = !!closed; return a; };
    const HEX = { Rippen: '#4aa3ff', Holmgurt: '#f5a35c', Holmsteg: '#57d38c', Rippenkamm: '#57d38c', Helling: '#b58cf0', Beplankung: '#6fd6e0', 'Beplankung D-Box': '#6fd6e0', 'Beplankung Endleiste': '#6fd6e0', Geodaeten: '#ffd27f' };
    plates.forEach(pl => pl.parts.forEach(p => {
      const q = placedPolys(p), lay = p.layer || 'Teile';
      App.cadEnsureLayer(lay); if (HEX[lay]) c.layerColors[lay] = HEX[lay];
      q.rings.forEach(r => App.cadAddEntity(lay, mk(r, true)));
      q.holes.forEach(r => App.cadAddEntity(lay, mk(r, true)));
      if (q.marks.length) {
        App.cadEnsureLayer('Markierung'); c.lineStyles['Markierung'] = 'dashed';
        q.marks.forEach(m => App.cadAddEntity('Markierung', mk(m, false)));
      }
      if (rc.label) c.texts.push({ x: p.bb.minx + p.ox + p.bb.w / 2, y: p.bb.miny + p.oy - (rc.labelH + 2), h: rc.labelH, text: p.name, rot: 0, layer: 'Beschriftung' });
    }));
    if (rc.label) { App.cadEnsureLayer('Beschriftung'); plates.forEach(pl => c.texts.push({ x: 0, y: pl.y0 + 3, h: rc.labelH * 1.3, text: pl.label, rot: 0, layer: 'Beschriftung' })); }
    c.edit.active = c.order[0] || null; c.edit.sel = []; c.edit.draft = null;
    state.cad.view = null;
    if (App.nav && App.nav.cad) { App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; }
    App.buildSidebar(); if (App.renderCad) App.renderCad();
    (App.cadFlash || App.toast || (() => {}))(T('Rippenfläche geladen: ') + data.parts.length + ' ' + T('Teile.'));
  }

  // ==================================================================
  // 14. Seitenleiste
  // ==================================================================
  const RD = () => { clearCache(); renderRf(); };
  const RB = () => { clearCache(); App.buildSidebar(); renderRf(); };
  function matRow(body, label, get, set, hint) {
    const proj = (App.matOptions ? App.matOptions() : []).map(o => [o[0], o[1] + ' · ' + T('Projekt')]);
    App.selectRow(body, label, woodOptions().concat(proj), () => get() || '', v => { set(v || null); RB(); },
      hint || 'Werkstoff aus der Holz-Datenbank dieses Moduls (Menü „Werkstoffe (Holz & Platten)"). '
        + 'Darunter stehen zusätzlich die Werkstoffe des Projekts. Bestimmt Lieferstärken, '
        + 'Plattenaufteilung und Masse in der Stückliste.');
  }
  // Auswahl der Lieferstärken des gewählten Werkstoffs.
  function thickSel(body, label, matId, get, set) {
    const list = thickListOf(matId);
    if (!list.length) return false;
    const cur = +get();
    const opts = list.map(v => [String(v), v + ' mm']);
    if (!list.some(v => Math.abs(v - cur) < 1e-6)) opts.unshift([String(cur), cur + ' mm (' + T('frei') + ')']);
    App.selectRow(body, label, opts, () => String(+get()), v => { set(parseFloat(v)); RB(); },
      'Handelsübliche Lieferstärken des gewählten Werkstoffs.');
    return true;
  }
  // Werkstoff UND Materialstärke zusammen.
  function matThickRow(body, labelMat, labelT, getM, setM, getT, setT, hint) {
    matRow(body, labelMat, getM, setM, hint);
    const had = thickSel(body, labelT, getM(), getT, setT);
    App.numRow(body, had ? labelT + T(' — frei') : labelT, getT, v => { setT(Math.max(0.1, v)); RD(); }, { step: 0.5, min: 0.1, norender: true });
  }
  // Einstellungen einer Beplankungskante (Form im Grundriss).
  function edgeRows(body, e, label, base) {
    App.selectRow(body, 'Form ' + label, [
      ['straight', 'Gerade'],
      ['tongue', 'Zungen entlang der Rippen'],
      ['scallop', 'Girlanden (Bögen zwischen den Rippen)'],
      ['zigzag', 'Gezackt']
    ], () => e.shape, v => { e.shape = v; RB(); },
      'Oldtimer-Formen: „Zungen" laufen als schmale Ausläufer über die Rippen nach hinten '
      + '(mehr Klebefläche, kein harter Steifigkeitssprung). „Girlanden": an den Rippen am '
      + 'weitesten, dazwischen bogenförmig zurück. Die Rippen bekommen ihre Beplankungs-'
      + 'stufe jeweils genau dort, wo die Kante an ihnen liegt.');
    if (e.shape !== 'straight') {
      App.numRow(body, e.shape === 'tongue' ? 'Zungenlänge (% Sehne)' : 'Tiefe (% Sehne)',
        () => e.depth, v => { e.depth = Math.max(0, Math.min(60, v)); RD(); }, { step: 1, min: 0, max: 60, norender: true });
      if (e.shape === 'tongue')
        App.numRow(body, 'Zungenbreite (mm)', () => e.width, v => { e.width = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true,
          hint: 'Üblich 1,5–3 × Rippenstärke bzw. so breit wie der Rippenaufleimer.' });
    }
    App.numRow(body, 'Am Rand (% Sehne, leer = wie Wurzel)', () => e.tip != null ? e.tip : base,
      v => { e.tip = Math.max(0, Math.min(100, v)); RD(); }, { step: 1, min: 0, max: 100, norender: true,
      hint: 'Kante verläuft linear von der Wurzel zum Rand.' });
    App.numRow(body, 'Wurzelbeplankung über (mm)', () => e.rootLen, v => { e.rootLen = Math.max(0, v); RB(); }, { step: 10, min: 0, norender: true,
      hint: 'Zur Wurzel hin großflächig beplankt (Beschläge!) — die Kante läuft über diese Länge '
        + 'auf den unten eingestellten Wert auf. 0 = aus.' });
    if (e.rootLen > 0) {
      App.numRow(body, 'An der Wurzel bis (% Sehne)', () => e.rootTo, v => { e.rootTo = Math.max(0, Math.min(100, v)); RD(); }, { step: 5, min: 0, max: 100, norender: true });
      App.selectRow(body, 'Übergang', [['round', 'Kehle (weich)'], ['tri', 'Dreieck (gerade)']],
        () => e.rootMode, v => { e.rootMode = v; RD(); });
    }
  }
  function btn(body, text, fn, primary, demo) {
    const b = document.createElement('button');
    b.textContent = T(text); if (primary) b.className = 'primary';
    b.onclick = fn; if (demo) DEMO.btn(b);
    body.appendChild(b); return b;
  }
  // Die Seitenleiste wird beim Start gebaut — da steht die Tragfläche u. U.
  // noch nicht. Merken und beim ersten Zeichnen mit Tragfläche nachbauen.
  let sidebarNoWing = false;
  function rfSidebar(side) {
    const rc = rfCfg();
    if (!hasWing()) {
      sidebarNoWing = true;
      const g0 = App.grp('Rippenfläche', true, 'rf');
      App.hint(g0.body, 'Erst im Reiter „Tragflächendesigner" eine Tragfläche anlegen.');
      side.appendChild(g0.g); return;
    }
    sidebarNoWing = false;
    const { list, total } = rfStations();

    // --- Rippenverteilung ------------------------------------------
    const gv = App.grp('Rippenverteilung', true, 'rf', { key: 'rfDist' });
    App.selectRow(gv.body, 'Anordnung',
      [['perSeg', 'Anzahl je Segment'], ['spacing', 'Abstand (mm)'], ['manual', 'Positionen von Hand']],
      () => rc.mode, v => {
        const old = rc.mode; rc.mode = v;
        if (v === 'manual' && !rc.manualZ) { rc.mode = old; const st = rfStations(); rc.mode = 'manual'; rc.manualZ = st.list.map(s => +s.z.toFixed(1)); }
        RB();
      },
      'Wie die Rippen über die Spannweite verteilt werden. „Positionen von Hand" '
      + 'übernimmt die aktuelle Verteilung als Startwerte.');
    if (rc.mode === 'spacing')
      App.numRow(gv.body, 'Rippenabstand (mm)', () => rc.spacing, v => { rc.spacing = Math.max(5, v); RD(); }, { step: 5, min: 5, norender: true });
    else if (rc.mode === 'manual') {
      App.hint(gv.body, 'Spannweitenposition je Rippe — Millimeter ab der Wurzelrippe.');
      btn(gv.body, '↻ Aus gleichmäßiger Verteilung', () => {
        const old = rc.mode; rc.mode = 'perSeg'; const st = rfStations(); rc.mode = old;
        rc.manualZ = st.list.map(s => +s.z.toFixed(1)); RB();
      });
      (rc.manualZ || []).forEach((z, i) => {
        App.numRow(gv.body, 'R' + (i + 1) + ' · z (mm)', () => rc.manualZ[i],
          v => { rc.manualZ[i] = Math.max(0, Math.min(total, v)); RD(); }, { step: 5, min: 0, max: total, norender: true });
      });
      btn(gv.body, '+ Rippe hinzufügen', () => {
        const a = rc.manualZ || (rc.manualZ = []);
        a.push(Math.min(total, Math.round((a.length ? a[a.length - 1] : 0) + (total ? total / 10 : 50)))); RB();
      }, true);
      btn(gv.body, '− Letzte entfernen', () => { (rc.manualZ || []).pop(); RB(); });
    } else
      App.numRow(gv.body, 'Rippen je Segment', () => rc.perSeg, v => { rc.perSeg = Math.max(2, Math.round(v)); RD(); }, { int: true, min: 2, max: 60, norender: true });
    if (rc.mode !== 'manual')
      App.boolRow(gv.body, 'Rippen an Wurzel/Stößen/Rand', () => rc.atJoints, v => { rc.atJoints = v; RD(); },
        'Erzwingt zusätzlich eine Rippe an der Wurzel, an jedem Segmentstoß und am Rand.');
    App.hint(gv.body, T('Ergibt derzeit ') + list.length + T(' Rippen über ') + total.toFixed(0) + ' mm.');
    side.appendChild(gv.g);

    // --- Eigene Werkstoffdatenbank (Holz & Platten) -----------------
    const gw = App.grp('Werkstoffe (Holz & Platten)', false, 'rf', { key: 'rfWood' });
    App.hint(gw.body, 'Eigene Werkstoffliste NUR für die Rippenfläche: Holzarten und Platten '
      + 'mit ihren handelsüblichen Lieferstärken und der Rohdichte. Sie gehört zum Projekt und '
      + 'ist frei änderbar — die Startwerte sind übliche Modellbau-Werkstoffe. Die Rohdichte '
      + 'liefert die Massen in der Stückliste.');
    woodDb().forEach((w, i) => {
      const box = document.createElement('div');
      box.style.cssText = 'border:1px solid #2a3340;border-radius:6px;padding:6px;margin:6px 0';
      const hd = document.createElement('div'); hd.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
      const nm = document.createElement('input'); nm.type = 'text'; nm.value = w.name || ''; nm.style.flex = '1';
      nm.oninput = () => { w.name = nm.value; };
      hd.appendChild(nm);
      const del = document.createElement('button'); del.textContent = '✕'; del.title = T('Werkstoff entfernen');
      del.onclick = () => { woodDb().splice(i, 1); RB(); };
      hd.appendChild(del);
      box.appendChild(hd);
      const kr = document.createElement('div'); kr.className = 'row';
      const kl = document.createElement('label'); kl.textContent = T('Art');
      const ki = document.createElement('input'); ki.type = 'text'; ki.value = w.kind || ''; ki.style.width = '100%';
      ki.oninput = () => { w.kind = ki.value; };
      kr.appendChild(kl); kr.appendChild(ki); box.appendChild(kr);
      App.numRow(box, 'Rohdichte (kg/m³)', () => w.density, v => { w.density = Math.max(0, v); }, { step: 10, min: 0, norender: true });
      const tr = document.createElement('div'); tr.className = 'row';
      const tl = document.createElement('label'); tl.textContent = T('Lieferstärken (mm)');
      const ti = document.createElement('input'); ti.type = 'text'; ti.style.width = '100%';
      ti.value = (w.thick || []).join(', ');
      ti.title = T('Mit Komma getrennt, z. B. 1, 1.5, 2, 3');
      ti.onchange = () => {
        w.thick = ti.value.split(/[,;\s]+/).map(x => parseFloat(String(x).replace(',', '.')))
          .filter(v => v > 0).sort((a, b) => a - b);
        RB();
      };
      tr.appendChild(tl); tr.appendChild(ti); box.appendChild(tr);
      gw.body.appendChild(box);
    });
    btn(gw.body, '+ Werkstoff anlegen', () => {
      const nm = T('Neuer Werkstoff');
      woodDb().push({ id: woodAddId(nm), name: nm, kind: '', density: 400, thick: [1, 2, 3] });
      RB();
    }, true);
    btn(gw.body, '↻ Standardliste wiederherstellen', () => {
      if (!window.confirm(T('Die Werkstoffliste dieses Moduls auf die Startwerte zurücksetzen? Eigene Einträge gehen verloren.'))) return;
      rc.woods = null; woodDb(); RB();
    });
    side.appendChild(gw.g);

    // --- Rippengruppen: Werkstoff + Materialstärke ------------------
    const gg = App.grp('Rippengruppen (Werkstoff & Stärke)', true, 'rf', { key: 'rfGroups' });
    App.hint(gg.body, 'Rippen lassen sich zu Gruppen zusammenfassen — jede Gruppe hat einen '
      + 'eigenen Werkstoff und eine eigene Materialstärke. Die Stärke bestimmt die Breite der '
      + 'Schlitze in Rippenkamm und Helling und die Aufteilung auf die Platten.');
    rc.groups.forEach((g, i) => {
      const box = document.createElement('div');
      box.style.cssText = 'border:1px solid #2a3340;border-radius:6px;padding:6px;margin:6px 0';
      const hd = document.createElement('div'); hd.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
      const nm = document.createElement('input'); nm.type = 'text'; nm.value = g.name || ''; nm.style.flex = '1';
      nm.oninput = () => { g.name = nm.value; renderRf(); };
      hd.appendChild(nm);
      if (rc.groups.length > 1) {
        const del = document.createElement('button'); del.textContent = '✕'; del.title = T('Gruppe entfernen');
        del.onclick = () => {
          rc.groups.splice(i, 1);
          Object.keys(rc.groupPer).forEach(k => { const v = rc.groupPer[k]; if (v === i) delete rc.groupPer[k]; else if (v > i) rc.groupPer[k] = v - 1; });
          RB();
        };
        hd.appendChild(del);
      }
      box.appendChild(hd);
      matThickRow(box, 'Werkstoff', 'Materialstärke (mm)',
        () => g.matId, v => { g.matId = v; if (v) g.t = snapThick(v, g.t); },
        () => g.t, v => { g.t = Math.max(0.2, v); });
      // --- Welche Rippen gehören zu dieser Gruppe? ---
      if (rc.groupAuto === 'none') {
        const lab = document.createElement('div');
        lab.className = 'hint';
        lab.textContent = T('Rippen anklicken — angeklickte gehören zu dieser Gruppe:');
        box.appendChild(lab);
        const grid = document.createElement('div');
        grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin:4px 0';
        list.forEach((st, k) => {
          const b = document.createElement('button');
          b.textContent = 'R' + (k + 1);
          b.title = 'z = ' + st.z.toFixed(0) + ' mm';
          const mine = groupOf(k, st) === i;
          b.style.cssText = 'padding:3px 6px;min-width:34px;font-size:11px;'
            + (mine ? 'background:var(--grp-accent,#4aa3ff);color:#0d1117;font-weight:600' : 'opacity:.55');
          b.onclick = () => { rc.groupPer[k] = i; RB(); };
          grid.appendChild(b);
        });
        box.appendChild(grid);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
        const all = document.createElement('button'); all.textContent = T('Alle');
        all.onclick = () => { list.forEach((st, k) => { rc.groupPer[k] = i; }); RB(); };
        const ev = document.createElement('button'); ev.textContent = T('Jede 2.');
        ev.onclick = () => { list.forEach((st, k) => { if (k % 2 === (i % 2)) rc.groupPer[k] = i; }); RB(); };
        row.appendChild(all); row.appendChild(ev);
        if (i > 0) {
          const none = document.createElement('button'); none.textContent = T('Keine');
          none.onclick = () => { Object.keys(rc.groupPer).forEach(k => { if (rc.groupPer[k] === i) delete rc.groupPer[k]; }); RB(); };
          row.appendChild(none);
        }
        box.appendChild(row);
      }
      gg.body.appendChild(box);
    });
    btn(gg.body, '+ Gruppe anlegen', () => { rc.groups.push(rfGroupDefault('Gruppe ' + (rc.groups.length + 1), 3)); RB(); }, true);
    App.selectRow(gg.body, 'Zuordnung',
      [['none', 'Von Hand (unten je Rippe)'], ['type', 'Automatisch nach Rippenart'], ['seg', 'Automatisch nach Segment']],
      () => rc.groupAuto, v => { rc.groupAuto = v; RB(); },
      '„Nach Rippenart": Vollrippe→Gruppe 1, D-Box→2, Endleistenrippe→3 … '
      + '„Nach Segment": Segment 1→Gruppe 1 usw. Von Hand gesetzte Rippen haben immer Vorrang.');
    side.appendChild(gg.g);

    // --- Rippenarten -----------------------------------------------
    const gt = App.grp('Rippenarten', false, 'rf', { key: 'rfTypes' });
    App.selectRow(gt.body, 'Standard für alle Rippen', RIB_TYPES, () => rc.typeDefault, v => { rc.typeDefault = v; RB(); },
      '„D-Box-Rippe": nur der vordere Teil bis zur Grenze unten (Nasenrippe). '
      + '„Endleistenrippe": nur der hintere Teil (Hilfsrippe hinter dem Holm). '
      + '„Vorn + hinten": beide Teile, die Mitte bleibt offen (Holmkasten).');
    App.selectRow(gt.body, 'Abweichende Rippen', [['0', 'Aus — alle gleich'], ['2', 'Jede 2. Rippe'], ['3', 'Jede 3. Rippe'], ['4', 'Jede 4. Rippe'], ['5', 'Jede 5. Rippe']],
      () => String(rc.typeEvery || 0), v => { rc.typeEvery = parseInt(v, 10) || 0; RB(); },
      'Abwechselnde Bauweise: z. B. Vollrippe — Nasenrippe — Vollrippe … '
      + 'Gezählt wird ab der Wurzelrippe (R1 behält die Standardart).');
    if (rc.typeEvery > 1) {
      App.selectRow(gt.body, 'Art der abweichenden Rippen', RIB_TYPES, () => rc.typeAlt, v => { rc.typeAlt = v; RB(); });
      App.boolRow(gt.body, 'Muster umkehren', () => rc.typeAltInv, v => { rc.typeAltInv = v; RB(); },
        'Ein: jede n-te Rippe bekommt die Standardart, alle übrigen die abweichende.');
      App.hint(gt.body, 'Mit „Zuordnung: Automatisch nach Rippenart" (Menü Rippengruppen) bekommen '
        + 'die beiden Arten automatisch unterschiedliche Werkstoffe/Stärken.');
    }
    App.numRow(gt.body, 'D-Box endet bei (% Sehne)', () => rc.dboxTo, v => { rc.dboxTo = Math.max(2, Math.min(98, v)); RD(); }, { step: 1, min: 2, max: 98, norender: true });
    App.numRow(gt.body, 'Endleistenrippe ab (% Sehne)', () => rc.teFrom, v => { rc.teFrom = Math.max(2, Math.min(98, v)); RD(); }, { step: 1, min: 2, max: 98, norender: true });
    App.hint(gt.body, 'Art je Rippe. „—" = der oben eingestellte Standard. Die Zuordnung zu '
      + 'Werkstoff-Gruppen steht im Menü „Rippengruppen".');
    list.forEach((st, i) => {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label');
      l.textContent = 'R' + (i + 1) + ' · z=' + st.z.toFixed(0);
      const s1 = document.createElement('select');
      [['', '— Standard —']].concat(RIB_TYPES).forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = T(o[1]); s1.appendChild(e); });
      s1.value = rc.typePer[i] || '';
      s1.onchange = () => { if (s1.value) rc.typePer[i] = s1.value; else delete rc.typePer[i]; RD(); };
      row.appendChild(l); row.appendChild(s1); gt.body.appendChild(row);
    });
    side.appendChild(gt.g);

    // --- Ausnahmen je Rippe -----------------------------------------
    const gx = App.grp('Ausnahmen je Rippe', false, 'rf', { key: 'rfEx' });
    App.hint(gx.body, 'Einzelne Rippen von einzelnen Bearbeitungen ausnehmen — z. B. die '
      + 'Wurzelrippe ohne Helling-Nase, eine Sperrholz-Verstärkungsrippe ohne Leichterung, '
      + 'die Randrippe ohne Nasenleisten-Ausschnitt. Angekreuzt = WEGLASSEN.');
    {
      const cols = [['sheet', 'Beplankung'], ['spar', 'Holme'], ['jig', 'Helling'],
                    ['le', 'Nasenleiste'], ['te', 'Endleiste'], ['flap', 'Ruder'],
                    ['holes', 'Löcher'], ['joiner', 'Steckung']];
      const head = document.createElement('div');
      head.style.cssText = 'display:grid;grid-template-columns:44px repeat(' + cols.length + ',1fr);gap:2px;font-size:10px;color:#8b98a8;margin-top:4px';
      head.appendChild(document.createElement('div'));
      cols.forEach(c => { const d = document.createElement('div'); d.textContent = T(c[1]); d.title = T(c[1]); d.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; head.appendChild(d); });
      gx.body.appendChild(head);
      list.forEach((st, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:44px repeat(' + cols.length + ',1fr);gap:2px;align-items:center';
        const l = document.createElement('div'); l.textContent = 'R' + (i + 1); l.style.fontSize = '11px';
        row.appendChild(l);
        cols.forEach(c => {
          const cb = document.createElement('input'); cb.type = 'checkbox';
          cb.title = 'R' + (i + 1) + ' · ' + T(c[1]);
          cb.checked = !!(rc.exPer[i] && rc.exPer[i][c[0]]);
          cb.onchange = () => {
            if (!rc.exPer[i]) rc.exPer[i] = {};
            if (cb.checked) rc.exPer[i][c[0]] = true; else delete rc.exPer[i][c[0]];
            if (!Object.keys(rc.exPer[i]).length) delete rc.exPer[i];
            RD();
          };
          row.appendChild(cb);
        });
        gx.body.appendChild(row);
      });
    }
    side.appendChild(gx.g);

    // --- Schräge Rippen --------------------------------------------
    const gs = App.grp('Schräge Rippen', false, 'rf', { key: 'rfSkew' });
    App.selectRow(gs.body, 'Ausrichtung', [
      ['none', 'Senkrecht zur Spannweite (Standard)'],
      ['le', 'Senkrecht zur Nasenleiste'],
      ['spar', 'Senkrecht zum Holm'],
      ['hinge', 'Senkrecht zur Scharnierlinie'],
      ['angle', 'Fester Winkel']
    ], () => rc.skewMode, v => { rc.skewMode = v; RB(); },
      'Bei gepfeilten Flächen stehen Rippen oft nicht senkrecht zur Spannweitenachse. '
      + 'Der Querschnitt wird dann entlang der SCHRÄGEN Ebene durch die Fläche berechnet — '
      + 'nicht einfach gestreckt.');
    if (rc.skewMode === 'angle')
      App.numRow(gs.body, 'Winkel (°)', () => rc.skewAngle, v => { rc.skewAngle = Math.max(-70, Math.min(70, v)); RD(); }, { step: 1, min: -70, max: 70, norender: true });
    if (rc.skewMode === 'spar' && sparList().length > 1)
      App.selectRow(gs.body, 'Bezugsholm', sparList().map((sp, j) => [String(j), sp.name || (T('Holm') + ' ' + (j + 1))]),
        () => String(rc.skewSpar | 0), v => { rc.skewSpar = parseInt(v, 10) || 0; RD(); });
    if (rc.skewMode !== 'none')
      App.selectRow(gs.body, 'Gilt für', [['all', 'Ganze Rippe'], ['flap', 'Nur die Ruderrippen']],
        () => rc.skewScope, v => { rc.skewScope = v; RB(); },
        '„Nur die Ruderrippen": der Hauptteil bleibt senkrecht, nur das abgetrennte '
        + 'Ruderstück wird schräg geschnitten (senkrecht zur Scharnierlinie). '
        + 'Dafür muss „Ruder abtrennen" eingeschaltet sein.');
    side.appendChild(gs.g);

    // --- Ruder ------------------------------------------------------
    const gf = App.grp('Ruder (Querruder/Klappe)', false, 'rf', { key: 'rfFlap' });
    App.boolRow(gf.body, 'Ruder an der Scharnierlinie abtrennen', () => rc.flapSplit, v => { rc.flapSplit = v; RB(); },
      'Trennt jede Rippe an der Scharnierlinie in Hauptteil und Ruderteil — beide '
      + 'werden als eigene Teile ausgegeben (Kennung „R").');
    if (rc.flapSplit) {
      App.selectRow(gf.body, 'Scharnierlinie', [['wing', 'Aus dem Tragflächendesign'], ['fixed', 'Fester Sehnenanteil']],
        () => rc.flapMode, v => { rc.flapMode = v; RB(); },
        '„Aus dem Tragflächendesign" nutzt die je Segment eingestellte Scharnierlage (% ab Endleiste).');
      if (rc.flapMode === 'fixed')
        App.numRow(gf.body, 'Scharnier bei (% Sehne ab Nase)', () => rc.flapFrom, v => { rc.flapFrom = Math.max(5, Math.min(98, v)); RD(); }, { step: 1, min: 5, max: 98, norender: true });
      App.selectRow(gf.body, 'Scharnierlage', [['top', 'Oben (Oberseite bleibt glatt)'], ['mid', 'Mittig'], ['bot', 'Unten']],
        () => rc.flapHinge, v => { rc.flapHinge = v; RD(); },
        'Oben: die Oberseite bleibt nahezu spaltfrei, der Spalt liegt unten — das ergibt '
        + 'zugleich eine mechanische Differenzierung (Standard beim Querruder). '
        + 'Mittig: gleiche Spalten oben und unten, symmetrische Ausschläge.');
      App.selectRow(gf.body, 'Ruder-Nase', [
        ['straight', 'Gerade abgeschnitten'],
        ['v', 'V-Anschliff (Keil)'],
        ['round', 'Hohlkehle (Halbkreis)']
      ], () => rc.flapNose, v => { rc.flapNose = v; RB(); },
        '„V-Anschliff": der Scheitel liegt auf der Scharnierachse, der Keilwinkel ist der '
        + 'größte mögliche Ausschlag — bei dicken Rudern frisst der Keil die ganze Nase auf. '
        + '„Hohlkehle": Halbkreis um den Scharnierpunkt, winkelunabhängig, dafür strömt mehr '
        + 'Luft durch den Spalt. Die Flächenseite bekommt die konkave Gegenform.');
      if (rc.flapNose === 'v')
        App.numRow(gf.body, 'Größter Ausschlag (°)', () => rc.flapDefl, v => { rc.flapDefl = Math.max(5, Math.min(80, v)); RD(); }, { step: 5, min: 5, max: 80, norender: true,
          hint: 'Bestimmt den Keilwinkel: bis zu diesem Ausschlag schlägt das Ruder nicht an.' });
      App.numRow(gf.body, 'Ruderspalt (mm)', () => rc.flapGap, v => { rc.flapGap = Math.max(0, v); RD(); }, { step: 0.1, min: 0, norender: true,
        hint: 'Üblich 0,3–0,8 mm. Schon ein Spalt von 0,5 % der Flügeltiefe kostet rund ein '
          + 'Sechstel der Ruderwirkung — deshalb so klein wie möglich und möglichst abdichten.' });
      // --- Hilfsholme (Fläche / Ruder) ---
      App.hint(gf.body, 'Die Hilfsholme sitzen knapp VOR bzw. HINTER der Ruderausformung '
        + '(Spalt, V-Anschliff, Hohlkehle) und verändern sie nicht.');
      const auxRows = (cfg, label, what) => {
        App.boolRow(gf.body, label, () => cfg.on, v => { cfg.on = v; RB(); });
        if (!cfg.on) return;
        App.selectRow(gf.body, 'Bauart ' + what, [
          ['caps', 'Gurte oben und unten (Nuten wie beim Hauptholm)'],
          ['strip', 'Aufgeleimte Leiste (in der Rippe gestrichelt)']
        ], () => cfg.mode, v => { cfg.mode = v; RB(); },
          '„Gurte": die Rippe bekommt oben und unten eine Nut, die Gurtleisten liegen darin — '
          + 'wie beim Hauptholm. „Leiste": wird nur angeleimt, die Rippe bleibt unverändert; '
          + 'ihre Lage ist in der Rippe gestrichelt eingezeichnet.');
        App.numRow(gf.body, 'Breite in Sehnenrichtung (mm)', () => cfg.w, v => { cfg.w = Math.max(0.5, v); RD(); }, { step: 0.5, min: 0.5, norender: true });
        App.selectRow(gf.body, 'Lage ' + what, [['auto', 'Automatisch (1 mm vom Ruderspalt)'], ['mm', 'Abstand zum Ruderspalt, oben/unten getrennt']],
          () => cfg.xMode, v => { cfg.xMode = v; RB(); },
          'Bezug ist die Kante des Ruderspalts an der jeweiligen Oberfläche — bei V-Anschliff '
          + 'und Hohlkehle liegt sie oben und unten verschieden weit von der Scharnierlinie.');
        if (cfg.xMode === 'mm') {
          App.numRow(gf.body, 'Abstand oben (mm)', () => cfg.dTop, v => { cfg.dTop = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true });
          App.numRow(gf.body, 'Abstand unten (mm)', () => cfg.dBot, v => { cfg.dBot = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true });
        }
        if (cfg.mode === 'strip')
          matThickRow(gf.body, 'Werkstoff ' + what, 'Materialstärke (mm)',
            () => cfg.mat, v => { cfg.mat = v; if (v) cfg.t = snapThick(v, cfg.t); },
            () => cfg.t, v => { cfg.t = Math.max(0.2, v); });
        else
          matThickRow(gf.body, 'Werkstoff ' + what, 'Gurtdicke (mm)',
            () => cfg.mat, v => { cfg.mat = v; if (v) cfg.capT = snapThick(v, cfg.capT); },
            () => cfg.capT, v => { cfg.capT = Math.max(0.2, v); });
      };
      auxRows(rc.flapSpar, 'Hilfsholm in der Fläche', 'Hilfsholm');
      auxRows(rc.flapRSpar, 'Nasenholm im Ruder', 'Nasenholm');
    }
    side.appendChild(gf.g);

    // --- Holme: Gurte, Stege, Kämme --------------------------------
    const gh = App.grp('Holme, Gurte & Stege', true, 'rf', { key: 'rfSpars' });
    App.selectRow(gh.body, 'Holme', [['own', 'Eigene Holme (hier festgelegt)'], ['wing', 'Aus dem Tragflächendesign']],
      () => rc.sparSrc, v => { rc.sparSrc = v; RB(); },
      '„Aus dem Tragflächendesign": Lage und Breite der dort angelegten Holmausschnitte '
      + 'werden übernommen (Gurt-/Stegaufbau hier).');
    if (rc.sparSrc === 'wing' && (!state.spars || !state.spars.length))
      App.hint(gh.body, 'Noch keine Holme im Tragflächendesigner angelegt.');
    const spl = sparList();
    spl.forEach((sp, j) => {
      const box = document.createElement('div');
      box.style.cssText = 'border:1px solid #2a3340;border-radius:6px;padding:6px;margin:6px 0';
      const hd = document.createElement('div'); hd.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
      const nm = document.createElement('input'); nm.type = 'text'; nm.style.flex = '1';
      nm.value = sp.name || (T('Holm') + ' ' + (j + 1));
      nm.oninput = () => { sp.name = nm.value; renderRf(); };
      hd.appendChild(nm);
      if (rc.sparSrc === 'own' && rc.sparsOwn.length > 1) {
        const del = document.createElement('button'); del.textContent = '✕';
        del.onclick = () => { rc.sparsOwn.splice(j, 1); RB(); };
        hd.appendChild(del);
      }
      box.appendChild(hd);
      const ro = rc.sparSrc === 'wing';
      if (!ro) {
        App.selectRow(box, 'Lage angeben in', [['pct', '% der Sehne'], ['mm', 'mm ab Nase']], () => sp.posMode, v => { sp.posMode = v; RB(); });
        App.numRow(box, sp.posMode === 'mm' ? 'Abstand ab Nase (mm)' : 'Lage (% Sehne)', () => sp.pos, v => { sp.pos = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
        const segOpts = (state.segments || []).map((s, i) => [String(i), 'Segment ' + (i + 1)]);
        if (segOpts.length > 1) {
          App.selectRow(box, 'von Segment', segOpts, () => String(Math.min(sp.segFrom | 0, segOpts.length - 1)), v => { sp.segFrom = parseInt(v, 10); RD(); });
          App.selectRow(box, 'bis Segment', segOpts, () => String(Math.min(sp.segTo | 0, segOpts.length - 1)), v => { sp.segTo = parseInt(v, 10); RD(); });
        }
      } else App.hint(box, 'Lage/Breite kommen aus dem Tragflächendesign.');
      App.selectRow(box, 'Gurte', [['both', 'Oben und unten'], ['top', 'Nur oben'], ['bot', 'Nur unten'], ['none', 'Keine']],
        () => sp.capMode, v => { sp.capMode = v; RB(); },
        'Holmgurte werden als Nut in die Rippen eingelassen und als abgewickelte Leiste ausgegeben.');
      if (sp.capMode !== 'none') {
        App.numRow(box, 'Gurtbreite Wurzel (mm)', () => sp.capW, v => { sp.capW = Math.max(0.5, v); RD(); }, { step: 0.5, min: 0.5, norender: true });
        App.boolRow(box, 'Gurt nach außen verjüngen', () => sp.capTaper, v => { sp.capTaper = v; RB(); });
        if (sp.capTaper) App.numRow(box, 'Gurtbreite Rand (mm)', () => sp.capWTip, v => { sp.capWTip = Math.max(0.5, v); RD(); }, { step: 0.5, min: 0.5, norender: true });
        App.hint(box, 'Gurtdicke = Tiefe der Nut in der Rippe.');
        matThickRow(box, 'Werkstoff Gurt', 'Gurtdicke (mm)',
          () => sp.capMat, v => { sp.capMat = v; if (v) sp.capT = snapThick(v, sp.capT); },
          () => sp.capT, v => { sp.capT = Math.max(0.2, v); });
      }
      App.selectRow(box, 'Steg', [
        ['none', 'Kein Steg'], ['flat', 'Aufgeleimte Stegblätter'],
        ['comb', 'Rippenkamm (bleibt als Steg drin)'],
        ['jigcomb', 'Rippenkamm nur als Bauhilfe'],
        ['hole', 'Durchbruch für Holm/Rohr']
      ], () => sp.web, v => { sp.web = v; RB(); },
        '„Rippenkamm": der Steg bekommt an jeder Rippenlage einen Schlitz und die Rippe '
        + 'den passenden Gegenschlitz — die Fläche steckt sich selbst zusammen und ist '
        + 'dadurch verzugsfrei ausgerichtet.');
      if (sp.web === 'flat') {
        App.boolRow(box, 'Stegblätter zwischen den Rippen', () => sp.webBetween, v => { sp.webBetween = v; RB(); },
          'So werden sie gebaut: je Rippenfeld ein Blättchen, das zwischen die Rippen '
          + 'auf den Holm geleimt wird. Aus: ein durchgehendes Band über die ganze Länge.');
        App.selectRow(box, 'Lage am Holm', [['front', 'Vorn'], ['rear', 'Hinten'], ['both', 'Vorn und hinten']],
          () => sp.webSide, v => { sp.webSide = v; RD(); },
          'Aufgeleimte Stege sitzen vor und/oder hinter den Gurten. „Vorn und hinten" '
          + 'gibt je Feld zwei Blättchen aus.');
      }
      if (sp.web === 'flat' || sp.web === 'comb' || sp.web === 'jigcomb') {
        matThickRow(box, 'Werkstoff Steg', 'Stegdicke (mm)',
          () => sp.webMat, v => { sp.webMat = v; if (v) sp.webT = snapThick(v, sp.webT); },
          () => sp.webT, v => { sp.webT = Math.max(0.2, v); });
        App.boolRow(box, 'Leichterungslöcher im Steg', () => sp.webHoles, v => { sp.webHoles = v; RD(); });
      }
      if (sp.web === 'comb' || sp.web === 'jigcomb') {
        if (sp.web === 'jigcomb') App.hint(box, 'Reine Bauhilfe: der Kamm richtet die Rippen '
          + 'beim Bau aus und wird danach an der Sollbruchstelle abgebrochen. Er zählt '
          + 'nicht zur Struktur — die Rippen bekommen trotzdem den Gegenschlitz.');
        App.numRow(box, 'Schlitztiefe (mm, 0 = halbe Höhe)', () => sp.combDepth, v => { sp.combDepth = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
        App.boolRow(box, 'Rippe von oben schlitzen', () => sp.combTop, v => { sp.combTop = v; RD(); },
          'Standard: die Rippe wird von UNTEN geschlitzt und von oben auf den Kamm gesteckt.');
        App.numRow(box, 'Nutzugabe in Sehnenrichtung (mm)', () => sp.combGap, v => { sp.combGap = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true,
          hint: 'Macht die Nut in der Rippe länger als der Kamm dick ist — nötig bei schrägen '
            + 'Rippen, weil der Kamm die Rippe dann schräg durchdringt.' });
        App.boolRow(box, 'Sollbruch-Perforation im Kamm', () => sp.combSlit, v => { sp.combSlit = v; RB(); },
          'Reihe kurzer Schlitze über die ganze Länge: nach dem Bau lässt sich der Kamm '
          + 'dort sauber abbrechen, der Rest bleibt als Holmsteg in der Fläche.');
        if (sp.combSlit) {
          App.numRow(box, 'Höhe über der Unterkante (mm)', () => sp.combSlitY, v => { sp.combSlitY = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
          App.numRow(box, 'Schlitzlänge (mm)', () => sp.combSlitLen, v => { sp.combSlitLen = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
          App.numRow(box, 'Steg dazwischen (mm)', () => sp.combSlitGap, v => { sp.combSlitGap = Math.max(0.5, v); RD(); }, { step: 0.5, min: 0.5, norender: true });
          App.numRow(box, 'Schlitzbreite (mm)', () => sp.combSlitW, v => { sp.combSlitW = Math.max(0.2, v); RD(); }, { step: 0.1, min: 0.2, norender: true });
        }
      }
      if (sp.web === 'hole') {
        App.selectRow(box, 'Holmform', [['rect', 'Vierkant / Kastenholm'], ['round', 'Rundholm / Rohr']],
          () => sp.holeShape, v => { sp.holeShape = v; RB(); },
          '„Rundholm": kreisrunde Aufnahme auf der Skelettlinie — Durchmesser = Breite.');
        App.numRow(box, sp.holeShape === 'round' ? 'Durchmesser (mm)' : 'Durchbruch Breite (mm)', () => sp.holeW, v => { sp.holeW = Math.max(0.5, v); RD(); }, { step: 0.5, min: 0.5, norender: true });
        if (sp.holeShape !== 'round')
          App.numRow(box, 'Durchbruch Höhe (mm, 0 = halbe Profilhöhe)', () => sp.holeH, v => { sp.holeH = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true });
      }
      App.numRow(box, 'Passung je Seite (mm)', () => sp.notchFit, v => { sp.notchFit = Math.max(0, v); RD(); }, { step: 0.05, min: 0, norender: true,
        hint: 'Übermaß der Nuten/Schlitze — Ausgleich für Laserfuge und Leimspalt.' });
      gh.body.appendChild(box);
    });
    if (rc.sparSrc === 'own')
      btn(gh.body, '+ Holm anlegen', () => { rc.sparsOwn.push(rfSparDefault(rc.sparsOwn.length ? 60 : 30)); RB(); }, true);
    side.appendChild(gh.g);

    // --- Beplankung -------------------------------------------------
    const gb = App.grp('Beplankung', false, 'rf', { key: 'rfSheet' });
    App.selectRow(gb.body, 'Dicke', [['wing', 'Aus dem Tragflächendesign'], ['global', 'Eigener Wert']],
      () => rc.sheetSrc, v => { rc.sheetSrc = v; RB(); });
    if (rc.sheetSrc === 'global') {
      App.numRow(gb.body, 'Beplankung oben (mm)', () => rc.sheetTop, v => { rc.sheetTop = Math.max(0, v); RD(); }, { step: 0.1, min: 0, norender: true });
      App.numRow(gb.body, 'Beplankung unten (mm)', () => rc.sheetBot, v => { rc.sheetBot = Math.max(0, v); RD(); }, { step: 0.1, min: 0, norender: true });
    }
    matRow(gb.body, 'Werkstoff Beplankung', () => rc.sheetMat, v => { rc.sheetMat = v; });
    if (rc.sheetSrc === 'global') {
      thickSel(gb.body, 'Lieferstärke oben übernehmen', rc.sheetMat, () => rc.sheetTop, v => { rc.sheetTop = v; });
      thickSel(gb.body, 'Lieferstärke unten übernehmen', rc.sheetMat, () => rc.sheetBot, v => { rc.sheetBot = v; });
    }
    App.hint(gb.body, 'Wo beplankt wird, ist die RIPPE um die Beplankungsdicke kleiner — '
      + 'dort, wo die Beplankung endet, bleibt eine senkrechte Stufe stehen.');
    const zz = rc.zones;
    App.boolRow(gb.body, 'Vollbeplankung', () => zz.full, v => { zz.full = v; RB(); });
    if (!zz.full) {
      App.boolRow(gb.body, 'D-Box (Nase, oben+unten)', () => zz.dbox, v => { zz.dbox = v; RB(); });
      if (zz.dbox) {
        App.numRow(gb.body, 'D-Box bis (% Sehne)', () => zz.dboxTo, v => { zz.dboxTo = Math.max(2, Math.min(98, v)); RD(); }, { step: 1, min: 2, max: 98, norender: true });
        edgeRows(gb.body, zz.dboxEdge, 'D-Box-Kante', zz.dboxTo);
      }
      App.boolRow(gb.body, 'Endleistenbereich beplanken', () => zz.te, v => { zz.te = v; RB(); });
      if (zz.te) {
        App.numRow(gb.body, 'Endleistenbeplankung ab (% Sehne)', () => zz.teFrom, v => { zz.teFrom = Math.max(2, Math.min(98, v)); RD(); }, { step: 1, min: 2, max: 98, norender: true });
        edgeRows(gb.body, zz.teEdge, 'Endleisten-Kante', zz.teFrom);
        App.boolRow(gb.body, 'auch unten', () => zz.teBoth, v => { zz.teBoth = v; RD(); });
      }
    }
    if (rc.flapSplit && !zz.full)
      App.boolRow(gb.body, 'Ruder ganz beplanken (oben + unten)', () => zz.flap, v => { zz.flap = v; RB(); },
        'Beplankt das Ruder ab der Scharnierlinie vollständig — unabhängig vom '
        + 'Endleistenbereich. Die Beplankungsbahnen werden an der Scharnierlinie geteilt.');
    const cs = rc.capStrip;
    App.boolRow(gb.body, 'Rippenaufleimer', () => cs.on, v => { cs.on = v; RB(); },
      'Leisten auf Ober- und Unterseite jeder Rippe, von der Beplankungskante bis zur '
      + 'Endleiste — Auflage für die Bespannung (Oldtimer-Bauweise).');
    if (cs.on) {
      App.numRow(gb.body, 'Aufleimer Breite (mm)', () => cs.w, v => { cs.w = Math.max(0.5, v); RD(); }, { step: 0.5, min: 0.5, norender: true });
      App.boolRow(gb.body, 'auch auf der Unterseite', () => cs.bot, v => { cs.bot = v; RD(); });
      matThickRow(gb.body, 'Werkstoff Aufleimer', 'Aufleimer Dicke (mm)',
        () => cs.mat, v => { cs.mat = v; if (v) cs.t = snapThick(v, cs.t); },
        () => cs.t, v => { cs.t = Math.max(0.2, v); });
    }
    App.boolRow(gb.body, 'Grenzen im Grundriss zeigen', () => rc.show.sheetLines !== false,
      v => { rc.show.sheetLines = v; RD(); },
      'Zeichnet die beplankten Bereiche und ihre Kanten in die Draufsicht — so lässt sich '
      + 'sehen, wo die Beplankung endet und wo die Rippen ihre Stufe bekommen.');
    App.boolRow(gb.body, 'Beplankung abwickeln (als Teil ausgeben)', () => rc.devOn, v => { rc.devOn = v; rc.show.sheet = v; RB(); },
      'Die Beplankungsbahnen werden über die KERNKONTUR abgewickelt (Bogenlängen um '
      + 'die Nase) und als flache Zuschnitte ausgegeben — direkt schneidbar.');
    side.appendChild(gb.g);

    // --- Helling ----------------------------------------------------
    const gj = App.grp('Helling (Baulehre)', false, 'rf', { key: 'rfJig' });
    App.boolRow(gj.body, 'Helling erzeugen', () => rc.jig.on, v => { rc.jig.on = v; rc.show.jig = v; RB(); },
      'Baulehre, die alle Rippen verzugsfrei auf der Bauplatte hält.');
    if (rc.jig.on) {
      const j = rc.jig;
      App.selectRow(gj.body, 'Art', [
        ['tab', 'Schlitzbrett + Rippennasen'],
        ['cradle', 'Auflageböcke je Rippe'],
        ['neg', 'Negativ der Rippen (zweiteilig)']
      ], () => j.mode, v => { j.mode = v; RB(); },
        '„Schlitzbrett": jede Rippe bekommt unten eine Nase, das Brett den passenden Schlitz. '
        + '„Auflageböcke": je Rippe ein Bock, dessen Oberkante die Rippenunterseite abbildet. '
        + '„Negativ der Rippen": ein Brett, aus dem die Rippenkontur ausgeschnitten ist, an der '
        + 'Bezugslinie geteilt — die Rippe liegt ringsum in ihrer Sollform.');
      App.selectRow(gj.body, 'Bezugslinie', [['te', 'Endleiste'], ['chord', 'Sehne'], ['le', 'Nasenleiste']],
        () => j.ref, v => { j.ref = v; RD(); },
        'Woran die Rippen in der Höhe ausgerichtet werden — das ist die Linie, die '
        + 'auf der Bauplatte waagerecht liegt (Schränkung ist eingerechnet).');
      if (j.mode === 'tab') {
        App.numRow(gj.body, 'Nasenbreite (mm)', () => j.tabW, v => { j.tabW = Math.max(2, v); RD(); }, { step: 1, min: 2, norender: true });
        App.numRow(gj.body, 'Nasenhöhe (mm)', () => j.tabH, v => { j.tabH = Math.max(2, v); RD(); }, { step: 1, min: 2, norender: true });
        App.numRow(gj.body, 'Nase 1 bei (% Sehne)', () => j.tabPos, v => { j.tabPos = Math.max(2, Math.min(98, v)); RD(); }, { step: 1, min: 2, max: 98, norender: true });
        App.boolRow(gj.body, 'Zweite Nase (Verdrehsicherung)', () => j.tab2, v => { j.tab2 = v; RB(); });
        if (j.tab2) App.numRow(gj.body, 'Nase 2 bei (% Sehne)', () => j.tabPos2, v => { j.tabPos2 = Math.max(2, Math.min(98, v)); RD(); }, { step: 1, min: 2, max: 98, norender: true });
        App.boolRow(gj.body, 'Fuß nur seitlich anbinden (Sollbruch)', () => j.tabBreak, v => { j.tabBreak = v; RB(); },
          'Der Fuß hängt nur an zwei schmalen Stegen links und rechts; dazwischen läuft die '
          + 'RIPPENKONTUR weiter. Nach dem Bau bricht er dort ab und die Rippe bleibt in '
          + 'ihrer Sollform — kein Nacharbeiten.');
        if (j.tabBreak) {
          App.numRow(gj.body, 'Anbindung je Seite (mm)', () => j.tabBridge, v => { j.tabBridge = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true });
          App.numRow(gj.body, 'Breite des Trennschlitzes (mm)', () => j.tabSlit, v => { j.tabSlit = Math.max(0.2, v); RD(); }, { step: 0.1, min: 0.2, norender: true });
        }
        App.numRow(gj.body, 'Bretthöhe (mm)', () => j.railH, v => { j.railH = Math.max(10, v); RD(); }, { step: 5, min: 10, norender: true });
        App.boolRow(gj.body, 'Oberkante der V-Form folgen', () => !!j.follow, v => { j.follow = v; RD(); },
          'Nur sinnvoll, wenn die ganze Fläche in EINER Helling gebaut wird. Sonst je Segment '
          + 'bauen und die Oberkante gerade lassen.');
      } else {
        if (j.mode === 'cradle') App.selectRow(gj.body, 'Auflage', [['bot', 'Bock unter der Rippe'], ['top', 'Negativbett über der Rippe']],
          () => j.cradleSide, v => { j.cradleSide = v; RD(); },
          '„Negativbett": die Oberkante bildet die OBERSEITE der Rippe ab — die Fläche wird '
          + 'zum Beplanken hineingelegt, damit sie sich beim Anpressen nicht verzieht.');
        if (j.mode === 'neg')
          App.numRow(gj.body, 'Rand um die Rippe (mm)', () => j.margin, v => { j.margin = Math.max(2, v); RD(); }, { step: 2, min: 2, norender: true });
        else
          App.numRow(gj.body, 'Bockhöhe (mm)', () => j.h, v => { j.h = Math.max(10, v); RD(); }, { step: 5, min: 10, norender: true });
      }
      matThickRow(gj.body, 'Werkstoff Helling', 'Materialstärke Helling (mm)',
        () => j.mat, v => { j.mat = v; if (v) j.railT = snapThick(v, j.railT); },
        () => j.railT, v => { j.railT = Math.max(0.5, v); });
      App.numRow(gj.body, 'Passung Schlitz (mm)', () => j.fit, v => { j.fit = Math.max(0, v); RD(); }, { step: 0.05, min: 0, norender: true });
    }
    side.appendChild(gj.g);

    // --- Geodätische Rippen (Rautengitter) ------------------------------
    // Beide Menüs bearbeiten dieselbe Diagonal-Maschine (rc.geo); die Bauweise
    // entscheidet: „cross" = geodätisch, sonst Fachwerkrippen. Sie schließen
    // sich deshalb gegenseitig aus.
    const g = rc.geo;
    const isGeod = g.on && g.mode === 'cross';
    const isTruss = g.on && g.mode !== 'cross';
    const commonRows = (body) => {
      App.numRow(body, 'Winkel (°)', () => g.angle, v => { g.angle = Math.max(5, Math.min(80, v)); RD(); }, { step: 5, min: 5, max: 80, norender: true });
      App.selectRow(body, 'Teilung', [
        ['auto', 'Automatisch aus Winkel und Feldtiefe'], ['perBay', 'Eine je Rippenfeld'], ['spacing', 'Fester Abstand (mm)']
      ], () => g.spaceMode, v => { g.spaceMode = v; RB(); });
      if (g.spaceMode === 'spacing') App.numRow(body, 'Abstand (mm)', () => g.spacing, v => { g.spacing = Math.max(20, v); RD(); }, { step: 10, min: 20, norender: true });
      App.boolRow(body, 'Nur im Ruderbereich', () => g.inFlap, v => { g.inFlap = v; if (v) rc.flapSplit = true; RB(); },
        'Die Diagonalen liegen nur im Ruder (ab der Ruder-Nase bis zur Endleiste) und ersetzen '
        + 'dort die Ruderrippen. Schaltet das Abtrennen des Ruders mit ein.');
      if (!g.inFlap) {
        App.numRow(body, 'Bereich von (% Sehne)', () => g.from, v => { g.from = Math.max(0, Math.min(99, v)); RD(); }, { step: 1, min: 0, max: 99, norender: true,
          hint: 'Üblich: vorne die beplankte D-Box mit normalen Rippen, dahinter die Diagonalen.' });
      }
      App.numRow(body, 'Bereich bis (% Sehne)', () => g.to, v => { g.to = Math.max(1, Math.min(100, v)); RD(); }, { step: 1, min: 1, max: 100, norender: true });
      matThickRow(body, 'Werkstoff', 'Materialstärke (mm)',
        () => g.mat, v => { g.mat = v; if (v) g.t = snapThick(v, g.t); },
        () => g.t, v => { g.t = Math.max(0.2, v); });
    };
    const gg2 = App.grp('Geodätische Rippen', false, 'rf', { key: 'rfGeod' });
    App.boolRow(gg2.body, 'Geodätische Rippen', () => isGeod,
      v => { if (v) { g.on = true; g.mode = 'cross'; g.both = true; g.full = true; g.notch = true; g.replace = true; }
             else if (g.mode === 'cross') g.on = false;
             rc.show.geo = g.on; RB(); },
      'Rautengitter wie bei modernen DLG-/F3K-Flächen und der Vickers Wellington: zwei Scharen '
      + 'schräger Rippen über die ganze Profilhöhe, an JEDER Kreuzung halb/halb verzahnt. Sie '
      + 'ersetzen hinter der D-Box die normalen Rippen (Wurzel- und Randrippe bleiben). '
      + 'Schließt die Fachwerkrippen aus.');
    if (isGeod) {
      commonRows(gg2.body);
      App.numRow(gg2.body, 'Normale Rippen behalten bis (% Sehne)', () => geoKeepTo(),
        v => { g.keepTo = Math.max(0, Math.min(100, v)); RD(); }, { step: 1, min: 0, max: 100, norender: true,
        hint: 'Höher als „Bereich von": die Diagonalen laufen in die D-Box und werden dort mit den '
          + 'stehengebliebenen Rippen verzahnt.' });
      App.boolRow(gg2.body, 'Leichterung der Rippen', () => g.holes, v => { g.holes = v; RB(); },
        'Die Felder zwischen den Kreuzungen werden ausgespart — an den Kreuzungen bleibt voller Steg.');
      if (g.holes) {
        App.selectRow(gg2.body, 'Bauart', [['offset', 'Der Kontur folgend (Randsteg)'], ['truss', 'Fachwerk (Diagonalstege)'], ['ellipse', 'Einzelne Löcher']],
          () => g.holeStyle, v => { g.holeStyle = v; RD(); });
        App.numRow(gg2.body, 'Stegbreite (mm)', () => g.holeWeb, v => { g.holeWeb = Math.max(1, v); RD(); }, { step: 0.5, min: 1, norender: true });
      }
    }
    side.appendChild(gg2.g);

    // --- Fachwerkrippen (Zickzack / zusätzliche Diagonalen) -------------
    const gd = App.grp('Fachwerkrippen', false, 'rf', { key: 'rfGeo' });
    App.boolRow(gd.body, 'Fachwerkrippen', () => isTruss,
      v => { if (v) { g.on = true; if (g.mode === 'cross') g.mode = 'zigzag'; } else if (g.mode !== 'cross') g.on = false;
             rc.show.geo = g.on; RB(); },
      'Schräge Rippen als Fachwerk: „Zickzack" — Diagonalen Ende an Ende, sie bilden Dreiecke '
      + '(Warren); „Zusätzlich" — die normalen Rippen bleiben, je Feld eine Diagonale dazwischen '
      + '(Oldtimer-Praxis im hinteren Feld). Schließt die geodätischen Rippen aus.');
    if (isTruss) {
      App.selectRow(gd.body, 'Bauweise', [['zigzag', 'Zickzack / Dreiecke (Warren)'], ['extra', 'Zusätzlich zwischen den Rippen']],
        () => g.mode, v => { g.mode = v; g.replace = v !== 'extra'; RB(); });
      commonRows(gd.body);
      if (g.mode !== 'extra')
        App.boolRow(gd.body, 'Normale Rippen im Bereich weglassen', () => g.replace, v => { g.replace = v; RD(); });
      App.boolRow(gd.body, 'Volle Rippen statt Leisten', () => !!g.full, v => { g.full = v; RB(); },
        'Aus: nur ein schmales Band entlang der Ober- und Unterseite.');
      if (!g.full) App.numRow(gd.body, 'Leistenbreite (mm)', () => g.width, v => { g.width = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
    }
    side.appendChild(gd.g);

    // --- Leichterung, Leisten ---------------------------------------
    const gl = App.grp('Leichterung der Rippen', false, 'rf', { key: 'rfLight' });
    App.boolRow(gl.body, 'Leichterungslöcher in den Rippen', () => rc.holes.on, v => { rc.holes.on = v; RB(); });
    if (rc.holes.on) {
      App.selectRow(gl.body, 'Bauart', [
        ['ellipse', 'Einzelne Löcher (rund/oval)'],
        ['offset', 'Der Rippenkontur folgend (Randsteg)'],
        ['truss', 'Fachwerk (Diagonalstreben)']
      ], () => rc.holes.style, v => { rc.holes.style = v; RB(); },
        '„Der Rippenkontur folgend": je Feld EIN großes Loch, das im gleichen Abstand '
        + 'zur Rippenkontur verläuft — es bleibt ringsum ein Steg stehen. '
        + '„Fachwerk": dasselbe Feld, zusätzlich durch schräge Stege unterteilt — '
        + 'die klassische, sehr steife Leichtbau-Rippe.');
      App.numRow(gl.body, rc.holes.style === 'ellipse' ? 'Randabstand (mm)' : 'Stegbreite am Rand (mm)',
        () => rc.holes.margin, v => { rc.holes.margin = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
      if (rc.holes.style === 'truss') {
        App.numRow(gl.body, 'Breite der Diagonalstege (mm)', () => rc.holes.webW, v => { rc.holes.webW = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
        App.numRow(gl.body, 'Neigung der Diagonalstege (°)', () => rc.holes.angle, v => { rc.holes.angle = Math.max(15, Math.min(80, v)); RD(); }, { step: 5, min: 15, max: 80, norender: true });
      }
      App.numRow(gl.body, 'Kleinstes Loch (mm)', () => rc.holes.min, v => { rc.holes.min = Math.max(3, v); RD(); }, { step: 1, min: 3, norender: true });
      App.numRow(gl.body, 'Ecken verrunden (mm)', () => rc.holes.fillet, v => { rc.holes.fillet = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true,
        hint: 'Scharfe Ecken reißen im Holz ein und sind mit dem Fräser nicht herstellbar. 0 = keine Verrundung.' });
      if (rc.holes.style === 'ellipse') {
        App.numRow(gl.body, 'Größtes Loch (mm)', () => rc.holes.max, v => { rc.holes.max = Math.max(5, v); RD(); }, { step: 5, min: 5, norender: true });
        App.boolRow(gl.body, 'Runde Löcher', () => rc.holes.round, v => { rc.holes.round = v; RD(); });
      }
    }
    side.appendChild(gl.g);

    // --- Nasenleiste (eigenes Menü) ---------------------------------
    const gle = App.grp('Nasenleiste', false, 'rf', { key: 'rfLE' });
    App.boolRow(gle.body, 'Nasenleiste', () => rc.leOn, v => { rc.leOn = v; rc.show.le = v; RB(); },
      'Setzt eine Nasenleiste vor die Rippen. Die Rippen werden dafür vorn abgeschnitten — '
      + 'beim Rundstab zusätzlich mit halbrunder Einlassung.');
    if (rc.leOn) {
      App.selectRow(gle.body, 'Bauart', [
        ['strip', 'Vierkantleiste (aus der Platte)'],
        ['tri', 'Dreikantleiste'],
        ['round', 'Rundstab (eingelassen)']
      ], () => rc.leShape, v => { rc.leShape = v; RB(); },
        '„Dreikantleiste": die senkrechte Kathete klebt an der Rippe, die Schräge wird '
        + 'nach dem Bau auf Profilform verschliffen. „Rundstab": liegt zur Hälfte in einer '
        + 'halbrunden Einlassung der Rippe.');
      App.boolRow(gle.body, 'Rippen vorn abschneiden', () => rc.leCut, v => { rc.leCut = v; RD(); },
        'Aus: die Rippen bleiben voll, die Leiste wird nur als Teil ausgegeben.');
      if (rc.leShape === 'round') {
        App.numRow(gle.body, 'Durchmesser (mm)', () => rc.leD, v => { rc.leD = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
        App.numRow(gle.body, 'Passung der Einlassung (mm)', () => rc.leFit, v => { rc.leFit = Math.max(0, v); RD(); }, { step: 0.05, min: 0, norender: true });
        matRow(gle.body, 'Werkstoff Nasenleiste', () => rc.leMat, v => { rc.leMat = v; });
      } else if (rc.leShape === 'tri') {
        App.numRow(gle.body, 'Kathete waagerecht (mm)', () => rc.leTriW, v => { rc.leTriW = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true,
          hint: 'So weit wird die Rippe vorn abgeschnitten.' });
        App.numRow(gle.body, 'Kathete senkrecht (mm)', () => rc.leTriH, v => { rc.leTriH = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
        matRow(gle.body, 'Werkstoff Nasenleiste', () => rc.leMat, v => { rc.leMat = v; });
      } else {
        App.numRow(gle.body, 'Breite in Sehnenrichtung (mm)', () => rc.leW, v => { rc.leW = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
        matThickRow(gle.body, 'Werkstoff Nasenleiste', 'Nasenleiste Stärke (mm)',
          () => rc.leMat, v => { rc.leMat = v; if (v) rc.leH = snapThick(v, rc.leH); },
          () => rc.leH, v => { rc.leH = Math.max(0.5, v); });
      }
    }
    side.appendChild(gle.g);

    // --- Endleiste (eigenes Menü) -----------------------------------
    const gte = App.grp('Endleiste', false, 'rf', { key: 'rfTE' });
    App.boolRow(gte.body, 'Endleistenbrett (Grundriss) ausgeben', () => rc.teOn, v => { rc.teOn = v; rc.show.te = v; RB(); });
    if (rc.teOn) {
      App.boolRow(gte.body, 'Rippen hinten abschneiden', () => rc.teCut, v => { rc.teCut = v; RD(); },
        'Die Rippen enden vor dem Endleistenbrett. Aus: die Rippen bleiben voll.');
      App.numRow(gte.body, 'Endleiste Breite (mm)', () => rc.teW, v => { rc.teW = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
      matThickRow(gte.body, 'Werkstoff Endleiste', 'Endleiste Stärke (mm)',
        () => rc.teMat, v => { rc.teMat = v; if (v) rc.teH = snapThick(v, rc.teH); },
        () => rc.teH, v => { rc.teH = Math.max(0.5, v); });
    }
    side.appendChild(gte.g);


    // --- Profil ------------------------------------------------------
    const gp = App.grp('Profil (nur Rippenfläche)', false, 'rf', { key: 'rfProf' });
    App.hint(gp.body, 'Gilt nur hier — Tragfläche und G-Code bleiben unberührt.');
    App.selectRow(gp.body, 'Profilpunkte', [['60', '60 (grob)'], ['100', '100'], ['160', '160 (Standard)'], ['240', '240'], ['320', '320 (fein)']],
      () => String(rc.points || 160), v => { rc.points = parseInt(v, 10) || 160; RD(); });
    App.numRow(gp.body, 'Endleistendicke (mm)', () => rc.teThk, v => { rc.teThk = Math.max(0, v); RD(); }, { step: 0.1, min: 0, norender: true });
    side.appendChild(gp.g);

    // --- Steckung (Flächenverbinder) --------------------------------
    const gj2 = App.grp('Steckung (Flächenverbinder)', false, 'rf', { key: 'rfJoin' });
    const jo = rc.joiner;
    App.boolRow(gj2.body, 'Steckungs-Ausnehmung', () => jo.on, v => { jo.on = v; RB(); },
      'Ausschnitt für Steckungsrohr, Rundstahl oder Flachstahl in den Rippen nahe der '
      + 'Wurzel — dort, wo die Fläche am Rumpf steckt.');
    if (jo.on) {
      App.selectRow(gj2.body, 'Form', [['round', 'Rund (Rohr/Rundstahl)'], ['rect', 'Flach/Vierkant']],
        () => jo.shape, v => { jo.shape = v; RB(); });
      App.numRow(gj2.body, jo.shape === 'round' ? 'Durchmesser (mm)' : 'Breite (mm)',
        () => jo.w, v => { jo.w = Math.max(0.5, v); RD(); }, { step: 1, min: 0.5, norender: true });
      if (jo.shape !== 'round')
        App.numRow(gj2.body, 'Höhe (mm)', () => jo.h, v => { jo.h = Math.max(0.5, v); RD(); }, { step: 1, min: 0.5, norender: true });
      App.selectRow(gj2.body, 'Lage angeben in', [['pct', '% der Sehne'], ['mm', 'mm ab Nase']],
        () => jo.posMode, v => { jo.posMode = v; RB(); });
      App.numRow(gj2.body, jo.posMode === 'mm' ? 'Abstand ab Nase (mm)' : 'Lage (% Sehne)',
        () => jo.pos, v => { jo.pos = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
      App.selectRow(gj2.body, 'Höhenlage', [['mid', 'Auf der Skelettlinie'], ['mm', 'Fester Abstand zur Sehne']],
        () => jo.yMode, v => { jo.yMode = v; RB(); });
      if (jo.yMode === 'mm')
        App.numRow(gj2.body, 'Höhe über der Sehne (mm)', () => jo.y, v => { jo.y = v; RD(); }, { step: 0.5, norender: true });
      App.numRow(gj2.body, 'Neigung der Steckung (°)', () => jo.angle, v => { jo.angle = Math.max(-30, Math.min(30, v)); RD(); }, { step: 0.5, min: -30, max: 30, norender: true,
        hint: 'Bei V-Form steht die Steckung schräg zur Fläche — die Ausnehmung wandert dann '
          + 'von Rippe zu Rippe in der Höhe. Üblich: halber V-Winkel.' });
      App.numRow(gj2.body, 'Passung ringsum (mm)', () => jo.fit, v => { jo.fit = Math.max(0, v); RD(); }, { step: 0.05, min: 0, norender: true });
      App.selectRow(gj2.body, 'Gilt für', [['count', 'Die ersten n Rippen'], ['group', 'Eine Rippengruppe']],
        () => jo.scope, v => { jo.scope = v; RB(); },
        '„Rippengruppe": alle Rippen der gewählten Gruppe bekommen die Ausnehmung — '
        + 'praktisch, wenn die Wurzelrippen ohnehin eine eigene (dickere) Gruppe sind.');
      if (jo.scope === 'group')
        App.selectRow(gj2.body, 'Rippengruppe', rc.groups.map((g, gi) => [String(gi), g.name || ('Gruppe ' + (gi + 1))]),
          () => String(Math.min(jo.group | 0, rc.groups.length - 1)), v => { jo.group = parseInt(v, 10) || 0; RD(); });
      else {
        App.numRow(gj2.body, 'Anzahl Rippen', () => jo.count, v => { jo.count = Math.max(1, Math.round(v)); RD(); }, { int: true, min: 1, max: 40, norender: true });
        App.selectRow(gj2.body, 'Von', [['root', 'Ab der Wurzel'], ['tip', 'Ab dem Rand'], ['both', 'Beide Enden']],
          () => jo.side, v => { jo.side = v; RD(); });
      }
    }
    side.appendChild(gj2.g);

    // --- Teile & Ausgabe ---------------------------------------------
    const go = App.grp('Teile & Ausgabe', true, 'rf', { key: 'rfOut' });
    const SHOW = [['ribs', 'Rippen'], ['caps', 'Holmgurte'], ['webs', 'Holmstege / Rippenkämme'],
      ['flap', 'Hilfs-/Nasenholm am Ruder'], ['sheet', 'Beplankung (abgewickelt)'], ['jig', 'Helling'],
      ['geo', 'Geodäten / Diagonalrippen'], ['le', 'Nasenleiste'], ['te', 'Endleistenbrett']];
    SHOW.forEach(([k, l]) => App.boolRow(go.body, l, () => rc.show[k], v => { rc.show[k] = v; RD(); }));
    App.boolRow(go.body, 'Rippen auf die Sehne drehen', () => rc.flatten, v => { rc.flatten = v; RD(); },
      'Dreht die Schränkung aus den Rippen heraus (Sehne waagerecht) — übersichtlicher '
      + 'beim Zuschneiden. ACHTUNG: mit Helling-Nasen muss das AUS bleiben, sonst stimmt '
      + 'die Höhenlage der Rippen in der Baulehre nicht.');
    App.boolRow(go.body, 'Je Werkstoff/Stärke eine Platte', () => rc.plateSplit, v => { rc.plateSplit = v; RD(); },
      'Teile werden nach Werkstoff UND Materialstärke getrennt angeordnet — jede Platte '
      + 'lässt sich so in einem Zug zuschneiden.');
    App.numRow(go.body, 'Plattenbreite (mm, 0 = unbegrenzt)', () => rc.plateW, v => { rc.plateW = Math.max(0, v); RD(); }, { step: 10, min: 0, norender: true,
      hint: 'Maß der Materialplatte (z. B. Balsa 100 × 1000 mm). Die Teile werden dann auf '
        + 'echte Platten verteilt — die Zahl der nötigen Platten steht in der Überschrift.' });
    App.numRow(go.body, 'Plattenlänge (mm, 0 = unbegrenzt)', () => rc.plateH, v => { rc.plateH = Math.max(0, v); RD(); }, { step: 50, min: 0, norender: true });
    App.numRow(go.body, 'Abstand der Teile (mm)', () => rc.gap, v => { rc.gap = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
    App.numRow(go.body, 'Spalten (0 = automatisch)', () => rc.cols, v => { rc.cols = Math.max(0, Math.round(v)); RD(); }, { int: true, min: 0, max: 30, norender: true });
    App.numRow(go.body, 'Schnittfugen-Ausgleich (mm)', () => rc.kerf, v => { rc.kerf = Math.max(0, v); RD(); }, { step: 0.05, min: 0, norender: true,
      hint: 'Laser-/Fräserbreite: Außenkonturen wachsen um die halbe Fuge, Löcher schrumpfen.' });
    App.boolRow(go.body, 'Teile beschriften', () => rc.label, v => { rc.label = v; RD(); });
    if (rc.label) App.numRow(go.body, 'Schrifthöhe (mm)', () => rc.labelH, v => { rc.labelH = Math.max(1, v); RD(); }, { step: 0.5, min: 1, norender: true });
    btn(go.body, '▦ 3D-Ansicht des Flügels…', rf3dOpen);
    btn(go.body, '⤓ Alle Teile als DXF', rfExportDxf, true, true);
    btn(go.body, '⤓ Stückliste als CSV', rfExportCsv, false, true);
    if (App.cadEnsureLayer) btn(go.body, '→ In die CAD-Bearbeitung übernehmen', rfToCad);
    if (DEMO.on) App.hint(go.body, DEMO.msg);
    side.appendChild(go.g);
  }

  // ==================================================================
  // 15. Verdrahtung und Registry
  // ==================================================================
  function rfWireUp() {
    if (!App.setupNav) return;
    App.setupNav('cRf', 'rf', renderRf);
    App.setupNav('cRfPlan', 'rfplan', renderRfPlan);
    // 3D-Ansicht: eigenes Fenster (schließen über ×, Hintergrund, Esc).
    rf3dNav();
    const md = document.getElementById('rf3dModal'), cl = document.getElementById('rf3dClose');
    if (cl) cl.onclick = rf3dClose;
    if (md) md.addEventListener('mousedown', e => { if (e.target === md) rf3dClose(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && md && md.classList.contains('open')) rf3dClose(); });
  }
  Object.assign(App, {
    rfCfg, rfStations, rfParts, rfLayout, rfLayers, rfSidebar, rfWireUp,
    renderRf, renderRfPlan, rfExportDxf, rfExportCsv, rfToCad,
    rfPolyBool: polyBool, rfObliqueOutline: obliqueOutline, rfBuildRib: buildRib,
    rf3dOpen, rf3dClose, rf3dRender, rf3dBuild
  });
})();
