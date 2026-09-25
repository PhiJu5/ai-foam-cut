/* dxf.js — minimaler DXF-Import + Konturaufbereitung für den Reiter
 * „DXF-Formen". Liest die ENTITIES-Sektion, gruppiert die Geometrie nach
 * Layer (Gruppencode 8) und liefert je Layer eine Liste geschlossener/offener
 * Konturen (Punktfolgen). Bögen, Kreise und Splines werden in Punkte zerlegt;
 * lose LINE/ARC-Segmente werden über zusammenfallende Endpunkte zu Ketten
 * verbunden. Für die Heißdraht-Anwendung sind zwei Layer relevant: „INNEN“ und
 * „AUSSEN“ — die beiden Turmprofile.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const D2R = Math.PI / 180;

  // ---- Tessellierung -------------------------------------------------
  function arcPts(cx, cy, r, a0, a1, ccw) {
    // Bogen von a0 nach a1 (rad). ccw=true -> gegen den Uhrzeigersinn.
    let sweep = a1 - a0;
    if (ccw) { while (sweep < 0) sweep += TAU; } else { while (sweep > 0) sweep -= TAU; }
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));   // ~5°/Schritt
    const out = [];
    for (let k = 0; k <= steps; k++) {
      const a = a0 + sweep * k / steps;
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return out;
  }
  // Bogen aus zwei Polyline-Punkten + bulge (LWPOLYLINE/POLYLINE-Wölbung).
  function bulgeArc(p0, p1, bulge) {
    const theta = 4 * Math.atan(bulge);            // eingeschlossener Winkel
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const c = Math.hypot(dx, dy);
    if (c < 1e-9 || Math.abs(bulge) < 1e-9) return [p0, p1];
    const r = c / (2 * Math.sin(Math.abs(theta) / 2));
    const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
    // Abstand Sehnenmitte -> Mittelpunkt
    const h = r * Math.cos(theta / 2);
    const nx = -dy / c, ny = dx / c;               // Normale (links)
    const s = bulge > 0 ? 1 : -1;
    const cx = mx + nx * h * s, cy = my + ny * h * s;
    const a0 = Math.atan2(p0.y - cy, p0.x - cx);
    const a1 = Math.atan2(p1.y - cy, p1.x - cx);
    return arcPts(cx, cy, r, a0, a1, bulge > 0);
  }

  // ---- Parser --------------------------------------------------------
  function tokenize(text) {
    const raw = text.split(/\r\n|\r|\n/);
    const t = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const code = parseInt(raw[i], 10);
      if (isNaN(code)) continue;                    // Robustheit: kaputte Zeile überspringen
      t.push({ code, val: raw[i + 1] });
    }
    return t;
  }

  function parse(text) {
    const t = tokenize(text);
    const n = t.length;
    const layers = {}, order = [];
    const add = (layer, loop) => {
      layer = (layer || '0').trim();
      if (!layers[layer]) { layers[layer] = []; order.push(layer); }
      if (loop && loop.length >= 2) layers[layer].push(loop);
    };
    // Felder einer Entität bis zum nächsten Code 0 einsammeln.
    function fields(i) {
      const f = [];
      while (i < n && t[i].code !== 0) { f.push(t[i]); i++; }
      return { f, next: i };
    }
    const layerOf = f => { const g = f.find(x => x.code === 8); return g ? g.val.trim() : '0'; };
    const num = (f, code, def) => { const g = f.find(x => x.code === code); return g ? parseFloat(g.val) : def; };

    let section = null, i = 0;
    while (i < n) {
      if (t[i].code !== 0) { i++; continue; }
      const type = (t[i].val || '').trim();
      if (type === 'SECTION') { section = (t[i + 1] && t[i + 1].code === 2) ? t[i + 1].val.trim() : null; i += 2; continue; }
      if (type === 'ENDSEC') { section = null; i++; continue; }
      if (section !== 'ENTITIES') { i++; continue; }

      if (type === 'LINE') {
        const { f, next } = fields(i + 1);
        add(layerOf(f), mkLoop([{ x: num(f, 10, 0), y: num(f, 20, 0) },
                                { x: num(f, 11, 0), y: num(f, 21, 0) }], false));
        i = next; continue;
      }
      if (type === 'CIRCLE') {
        const { f, next } = fields(i + 1);
        const cx = num(f, 10, 0), cy = num(f, 20, 0), r = num(f, 40, 0);
        add(layerOf(f), mkLoop(arcPts(cx, cy, r, 0, TAU, true), true));
        i = next; continue;
      }
      if (type === 'ARC') {
        const { f, next } = fields(i + 1);
        const cx = num(f, 10, 0), cy = num(f, 20, 0), r = num(f, 40, 0);
        add(layerOf(f), mkLoop(arcPts(cx, cy, r, num(f, 50, 0) * D2R, num(f, 51, 0) * D2R, true), false));
        i = next; continue;
      }
      if (type === 'LWPOLYLINE') {
        const { f, next } = fields(i + 1);
        const closed = (num(f, 70, 0) & 1) === 1;
        // Vertices in Reihenfolge: 10 (x) / 20 (y), optional 42 (bulge davor/danach).
        const verts = [];
        for (let k = 0; k < f.length; k++) {
          if (f[k].code === 10) {
            const x = parseFloat(f[k].val);
            let y = 0, bulge = 0;
            for (let m = k + 1; m < f.length && f[m].code !== 10; m++) {
              if (f[m].code === 20) y = parseFloat(f[m].val);
              if (f[m].code === 42) bulge = parseFloat(f[m].val);
            }
            verts.push({ x, y, bulge });
          }
        }
        add(layerOf(f), expandBulge(verts, closed));
        i = next; continue;
      }
      if (type === 'POLYLINE') {
        // Alte Form: POLYLINE-Kopf + folgende VERTEX-Entitäten bis SEQEND.
        const { f, next } = fields(i + 1);
        const closed = (num(f, 70, 0) & 1) === 1;
        const lay = layerOf(f);
        const verts = [];
        let j = next;
        while (j < n) {
          if (t[j].code !== 0) { j++; continue; }
          const vt = (t[j].val || '').trim();
          if (vt === 'VERTEX') {
            const r = fields(j + 1);
            verts.push({ x: num(r.f, 10, 0), y: num(r.f, 20, 0), bulge: num(r.f, 42, 0) });
            j = r.next; continue;
          }
          break;   // SEQEND o. Ä. -> Ende der Polyline
        }
        // SEQEND überspringen
        if (j < n && (t[j].val || '').trim() === 'SEQEND') { j = fields(j + 1).next; }
        add(lay, expandBulge(verts, closed));
        i = j; continue;
      }
      if (type === 'SPLINE') {
        const { f, next } = fields(i + 1);
        // Fit-Punkte (11/21) bevorzugen, sonst Kontrollpunkte (10/20).
        const fit = [], ctrl = [];
        for (let k = 0; k < f.length; k++) {
          if (f[k].code === 11) fit.push({ x: parseFloat(f[k].val), y: nextY(f, k, 21) });
          if (f[k].code === 10) ctrl.push({ x: parseFloat(f[k].val), y: nextY(f, k, 20) });
        }
        const closed = (num(f, 70, 0) & 1) === 1;
        add(layerOf(f), mkLoop(fit.length >= 2 ? fit : ctrl, closed));
        i = next; continue;
      }
      i++;   // unbekannte Entität überspringen
    }

    // Lose Segmente je Layer zu Ketten/Schleifen verbinden.
    for (const name of order) layers[name] = chain(layers[name], 1e-3);
    return { layers, order };
  }

  function nextY(f, k, code) {
    for (let m = k + 1; m < f.length; m++) { if (f[m].code === code) return parseFloat(f[m].val); if (f[m].code === f[k].code) break; }
    return 0;
  }
  function mkLoop(pts, closed) {
    const a = pts.map(p => ({ x: p.x, y: p.y }));
    a.closed = !!closed;
    return a;
  }
  function expandBulge(verts, closed) {
    if (verts.length < 2) return mkLoop(verts, closed);
    const out = [];
    const last = closed ? verts.length : verts.length - 1;
    for (let k = 0; k < last; k++) {
      const a = verts[k], b = verts[(k + 1) % verts.length];
      const seg = Math.abs(a.bulge) > 1e-9 ? bulgeArc(a, b, a.bulge) : [a, b];
      for (let m = 0; m < seg.length - 1; m++) out.push({ x: seg[m].x, y: seg[m].y });
    }
    if (!closed) { const e = verts[verts.length - 1]; out.push({ x: e.x, y: e.y }); }
    return mkLoop(out, closed);
  }

  // Lose Konturen über zusammenfallende Endpunkte verketten. Geschlossene
  // Schleifen bleiben unangetastet.
  function chain(loops, tol) {
    if (!loops || !loops.length) return [];
    const closed = loops.filter(l => l.closed);
    let open = loops.filter(l => !l.closed).map(l => l.slice());
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
    const result = closed.map(l => mkLoop(l, true));
    let guard = 0;
    while (open.length && guard++ < 10000) {
      let cur = open.shift();
      let merged = true;
      while (merged) {
        merged = false;
        for (let k = 0; k < open.length; k++) {
          const o = open[k];
          const ce = cur[cur.length - 1], cs = cur[0];
          if (near(ce, o[0])) { cur = cur.concat(o.slice(1)); }
          else if (near(ce, o[o.length - 1])) { cur = cur.concat(o.slice(0, -1).reverse()); }
          else if (near(cs, o[o.length - 1])) { cur = o.slice(0, -1).concat(cur); }
          else if (near(cs, o[0])) { cur = o.slice().reverse().slice(0, -1).concat(cur); }
          else continue;
          open.splice(k, 1); merged = true; break;
        }
      }
      const isClosed = cur.length > 2 && near(cur[0], cur[cur.length - 1]);
      if (isClosed) cur = cur.slice(0, -1);
      result.push(mkLoop(cur, isClosed));
    }
    return result;
  }

  // ---- Geometrie-Hilfen (Synchronisation) ----------------------------
  function perimeter(pts, closed) {
    let s = 0; const n = pts.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) { const a = pts[i], b = pts[(i + 1) % n]; s += Math.hypot(b.x - a.x, b.y - a.y); }
    return s;
  }
  // Größte Kontur eines Layers (nach Umfang) — das eigentliche Profil.
  function pickLoop(loops) {
    if (!loops || !loops.length) return null;
    let best = loops[0], bp = perimeter(loops[0], loops[0].closed);
    for (const l of loops) { const p = perimeter(l, l.closed); if (p > bp) { bp = p; best = l; } }
    return best;
  }
  // Teilstück einer (geschlossenen) Punktfolge von Index a nach b in Richtung
  // dir (+1/-1), inklusive beider Endpunkte, mit Umlauf.
  function loopSlice(pts, a, b, dir) {
    const n = pts.length, out = [pts[a]];
    // a === b: kompletter Umlauf (nur ein Synchronpaar bzw. gleicher Querschnitt)
    // — sonst bliebe nur der Startpunkt übrig und die Bahn hätte 2 Punkte.
    if (a === b) { for (let k = 1; k <= n; k++) out.push(pts[(a + dir * k + n * k) % n]); return out; }
    let i = a, guard = 0;
    while (i !== b && guard++ < n + 2) { i = (i + dir + n) % n; out.push(pts[i]); }
    return out;
  }
  // Längenanteile (0..1) der ECHTEN Ecken (Richtungswechsel > 12°) einer offenen Punktfolge.
  const CORNER_COS = Math.cos(12 * Math.PI / 180);
  function cornerFracs(pts) {
    const n = pts.length, out = [];
    if (n < 3) return out;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[n - 1] || 1;
    for (let i = 1; i < n - 1; i++) {
      // Nachbarn mit echtem Abstand (doppelte Punkte überspringen)
      let a = i - 1; while (a > 0 && Math.hypot(pts[a].x - pts[i].x, pts[a].y - pts[i].y) < 1e-9) a--;
      let c = i + 1; while (c < n - 1 && Math.hypot(pts[c].x - pts[i].x, pts[c].y - pts[i].y) < 1e-9) c++;
      const ux = pts[i].x - pts[a].x, uy = pts[i].y - pts[a].y, vx = pts[c].x - pts[i].x, vy = pts[c].y - pts[i].y;
      const L = Math.hypot(ux, uy) * Math.hypot(vx, vy); if (L < 1e-12) continue;
      if ((ux * vx + uy * vy) / L < CORNER_COS) out.push(cum[i] / total);
    }
    return out;
  }
  // Gleichmäßige Längenanteile 0..1 (count Stück), wobei die nächstliegenden
  // inneren Stützstellen auf die Anker verschoben werden (Anzahl bleibt count).
  function anchoredFracs(count, anchors) {
    const u = Array.from({ length: count }, (_, k) => k / (count - 1));
    if (count < 3 || !anchors.length) return u;
    const used = new Set();
    anchors.slice().sort((a, b) => a - b).forEach(a => {
      if (a <= 1e-9 || a >= 1 - 1e-9) return;
      let k = Math.round(a * (count - 1));
      k = Math.max(1, Math.min(count - 2, k));
      // schon belegt -> nächsten freien inneren Index suchen
      if (used.has(k)) { if (!used.has(k + 1) && k + 1 <= count - 2) k = k + 1; else if (!used.has(k - 1) && k - 1 >= 1) k = k - 1; else return; }
      used.add(k); u[k] = a;
    });
    u.sort((a, b) => a - b);
    return u;
  }
  // Offene Punktfolge an vorgegebenen Längenanteilen (0..1, aufsteigend) abtasten.
  function sampleAtFracs(pts, fracs) {
    if (pts.length === 0) return [];
    if (pts.length === 1) return fracs.map(() => ({ x: pts[0].x, y: pts[0].y }));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1] || 1;
    const out = [];
    let seg = 0;
    for (const f of fracs) {
      const target = total * f;
      while (seg < pts.length - 2 && cum[seg + 1] < target - 1e-12) seg++;
      const segLen = (cum[seg + 1] - cum[seg]) || 1;
      const t = Math.max(0, Math.min(1, (target - cum[seg]) / segLen));
      out.push({ x: pts[seg].x + t * (pts[seg + 1].x - pts[seg].x), y: pts[seg].y + t * (pts[seg + 1].y - pts[seg].y) });
    }
    return out;
  }
  // Offene Punktfolge längenproportional auf count Punkte neu abtasten.
  function resampleOpen(pts, count) {
    if (pts.length === 0) return [];
    if (pts.length === 1 || count <= 1) return Array.from({ length: Math.max(1, count) }, () => ({ x: pts[0].x, y: pts[0].y }));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1] || 1;
    const out = [];
    let seg = 0;
    for (let k = 0; k < count; k++) {
      const target = total * k / (count - 1);
      while (seg < pts.length - 2 && cum[seg + 1] < target) seg++;
      const segLen = (cum[seg + 1] - cum[seg]) || 1;
      const f = (target - cum[seg]) / segLen;
      out.push({ x: pts[seg].x + f * (pts[seg + 1].x - pts[seg].x),
                 y: pts[seg].y + f * (pts[seg + 1].y - pts[seg].y) });
    }
    return out;
  }

  /* Zwei Konturen anhand von Synchronpaaren auf gleiche, synchron durchlaufene
   * Punktfolgen bringen.
   *   inner/outer : Punktarray (mit .closed-Property)
   *   pairs       : [{i,j}] Index in inner (i) und outer (j)
   *   start       : Index in pairs -> dort beginnt der Schnitt
   *   dir         : +1 / -1 Umlaufrichtung
   *   density     : Zielpunkte gesamt (längenproportional auf die Intervalle verteilt)
   *   opt.perMM   : > 0 -> Punktdichte (Punkte je mm) statt „gesamt"
   *   Punktzahl je Intervall: das STARTPAAR des Intervalls kann `n` tragen
   *                 (pair.n) -> feste Punktzahl für dieses Segment.
   * Rückgabe: { inner:[...], outer:[...] } gleich lang, an den Sync-Paaren deckungsgleich.
   */
  function buildSync(inner, outer, pairs, start, dir, density, opt) {
    opt = opt || {};
    if (!pairs || pairs.length < 1) return null;
    // Paare in inner-Umlaufreihenfolge sortieren, dann an 'start' rotieren.
    let ord = pairs.slice().sort((a, b) => a.i - b.i);
    const si = ((start % ord.length) + ord.length) % ord.length;
    // Startpaar über seinen inner-Index finden (nach Sortierung verschoben).
    const startPair = pairs[si] || pairs[0];
    let rot = ord.findIndex(p => p.i === startPair.i && p.j === startPair.j);
    if (rot < 0) rot = 0;
    ord = ord.slice(rot).concat(ord.slice(0, rot));
    if (dir < 0) ord = [ord[0]].concat(ord.slice(1).reverse());

    const closed = !!(inner.closed && outer.closed);
    const nInt = closed ? ord.length : ord.length - 1;
    if (nInt < 1) return null;

    // Umlaufrichtung der AUSSEN-Kontur unabhängig von der INNEN-Kontur bestimmen:
    // inner/outer können gegenläufig gewickelt sein (DXF-Orientierung beliebig).
    // Wird der Außen-Bogen mit derselben Index-Richtung wie innen geschnitten,
    // läuft er „falschherum“ fast einmal um die ganze Kontur — und die Summe über
    // alle Intervalle fährt das Außenprofil mehrfach ab. Daher je Intervall den
    // Bogen wählen, der KEINEN anderen Synchronpunkt enthält.
    const oN = outer.length;
    const allJ = ord.map(p => p.j);
    // Enthält der Index-Bogen a->b (Richtung d) einen fremden Synchronpunkt?
    const arcFree = (a, b, d) => {
      const others = allJ.filter(j => j !== a && j !== b);
      let i = a, guard = 0;
      while (i !== b && guard++ < oN + 2) { i = (i + d + oN) % oN; if (i !== b && others.indexOf(i) >= 0) return false; }
      return true;
    };
    const idxSpan = (a, b, d) => { let i = a, c = 0, guard = 0; while (i !== b && guard++ < oN + 2) { i = (i + d + oN) % oN; c++; } return c; };
    const outerDir = (a, b) => {
      if (a === b) return dir;
      const f1 = arcFree(a, b, 1), f2 = arcFree(a, b, -1);
      if (f1 && !f2) return 1;
      if (f2 && !f1) return -1;
      return idxSpan(a, b, 1) <= idxSpan(a, b, -1) ? 1 : -1;   // beide/keiner frei -> kürzerer Bogen
    };

    // Intervall-Längen (längere Seite) für die proportionale Punktverteilung.
    const segs = [];
    let sumLen = 0;
    for (let k = 0; k < nInt; k++) {
      const A = ord[k], B = ord[(k + 1) % ord.length];
      const iSub = loopSlice(inner, A.i, B.i, dir);
      const oSub = loopSlice(outer, A.j, B.j, outerDir(A.j, B.j));
      const len = Math.max(perimeter(iSub, false), perimeter(oSub, false));
      segs.push({ iSub, oSub, len, start: A });   // Startpaar für pair.n-Override
      sumLen += len;
    }
    sumLen = sumLen || 1;
    const innerOut = [], outerOut = [];
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      let cnt;
      if (s.start && s.start.n > 0) cnt = Math.max(2, Math.round(s.start.n));   // feste Punktzahl je Segment
      else if (opt.perMM > 0) cnt = Math.max(2, Math.round(s.len * opt.perMM));  // Punktdichte
      else cnt = Math.max(2, Math.round(density * s.len / sumLen));              // gesamt, längenproportional
      // Eckentreu abtasten: Ecken BEIDER Konturen (INNEN und AUSSEN) werden als
      // Anker auf einen Bahnpunkt gelegt — auf beiden Seiten bei demselben
      // Längenanteil, damit die Bahnen synchron bleiben. Ohne Anker läge eine
      // Ecke nur zufällig auf einem Punkt (Sehne statt Spitze: stumpfe Spitzen,
      // ungleichmäßige Abbrand-Gehrungen).
      const fr = anchoredFracs(cnt, cornerFracs(s.iSub).concat(cornerFracs(s.oSub)));
      const ri = sampleAtFracs(s.iSub, fr), ro = sampleAtFracs(s.oSub, fr);
      // Verbindungspunkt zum Vorintervall nicht doppelt ablegen.
      const from = k === 0 ? 0 : 1;
      for (let m = from; m < cnt; m++) { innerOut.push(ri[m]); outerOut.push(ro[m]); }
    }
    return { inner: innerOut, outer: outerOut };
  }

  // ---- Writer --------------------------------------------------------
  /* Maximal kompatibler DXF-Export im ALTEN Format R12 (AC1009). Erwartet eine
   * Liste benannter Layer, jeder mit einer oder mehreren Polylinien:
   *   layers = [{ name, color, polys:[{ pts:[{x,y}], closed:bool }] }]
   *   color  : AutoCAD-Color-Index (1=rot, 2=gelb, 3=grün, 4=cyan, 5=blau,
   *            6=magenta, 7=weiß/schwarz). Fehlt er, wird 7 verwendet.
   * R12 kennt KEINE LWPOLYLINE — daher werden klassische POLYLINE/VERTEX/SEQEND
   * geschrieben. Dieses Format öffnet praktisch jedes CAD, auch ältere/einfache
   * Programme (z. B. nanoCAD, LibreCAD, DraftSight). Einheiten: Millimeter. */
  function write(layers, opt) {
    opt = opt || {};
    const prec = opt.precision != null ? opt.precision : 4;
    const f = v => (+v).toFixed(prec);
    const L = [];
    const g = (code, val) => { L.push(String(code)); L.push(String(val)); };

    // Ausdehnung für $EXTMIN/$EXTMAX (hilft manchen Programmen beim Zoom).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layers.forEach(ly => (ly.polys || []).forEach(pl => (pl.pts || []).forEach(p => {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    })));
    if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 0; }

    // --- HEADER (R12 / AC1009) ---
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$INSUNITS'); g(70, 4);              // 4 = Millimeter
    g(9, '$EXTMIN'); g(10, f(minX)); g(20, f(minY)); g(30, f(0));
    g(9, '$EXTMAX'); g(10, f(maxX)); g(20, f(maxY)); g(30, f(0));
    g(0, 'ENDSEC');
    // --- TABLES ---
    // Strenge Leser (z. B. nanoCAD) verlangen, dass referenzierte Linientypen und
    // Textstile in eigenen Tabellen definiert sind — sonst wird die Datei nicht
    // geöffnet. Daher LTYPE (CONTINUOUS), LAYER (inkl. „0") und STYLE (STANDARD).
    g(0, 'SECTION'); g(2, 'TABLES');
    // LTYPE: CONTINUOUS + gängige gestrichelte/gepunktete Linientypen.
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 4);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, f(0));
    g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, 'Dashed __ __ __'); g(72, 65); g(73, 2); g(40, f(9)); g(49, f(6)); g(74, 0); g(49, f(-3)); g(74, 0);
    g(0, 'LTYPE'); g(2, 'DOTTED'); g(70, 0); g(3, 'Dotted . . . .'); g(72, 65); g(73, 2); g(40, f(3)); g(49, f(0)); g(74, 0); g(49, f(-3)); g(74, 0);
    g(0, 'LTYPE'); g(2, 'DASHDOT'); g(70, 0); g(3, 'Dash dot _._._'); g(72, 65); g(73, 4); g(40, f(12)); g(49, f(6)); g(74, 0); g(49, f(-3)); g(74, 0); g(49, f(0)); g(74, 0); g(49, f(-3)); g(74, 0);
    g(0, 'ENDTAB');
    // LAYER: Standardlayer „0" + alle benannten Layer (mit optionalem Linientyp).
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length + 1);
    g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
    layers.forEach(ly => {
      g(0, 'LAYER'); g(2, ly.name); g(70, 0);
      g(62, ly.color != null ? ly.color : 7); g(6, ly.ltype || 'CONTINUOUS');
    });
    g(0, 'ENDTAB');
    // STYLE: STANDARD (für TEXT-Entitäten)
    g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
    g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0);
    g(40, f(0)); g(41, f(1)); g(50, f(0)); g(71, 0);
    g(42, f(2.5)); g(3, 'txt'); g(4, '');
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    // --- ENTITIES ---
    g(0, 'SECTION'); g(2, 'ENTITIES');
    layers.forEach(ly => {
      (ly.polys || []).forEach(pl => {
        const pts = pl.pts || [];
        if (pts.length < 2) return;
        // Klassische POLYLINE (R12): Kopf + VERTEX-Liste + SEQEND.
        g(0, 'POLYLINE'); g(8, ly.name);
        g(66, 1);                              // Vertices folgen
        g(70, pl.closed ? 1 : 0);
        g(10, f(0)); g(20, f(0)); g(30, f(0)); // Dummy-Basispunkt
        pts.forEach(p => {
          g(0, 'VERTEX'); g(8, ly.name);
          g(10, f(p.x)); g(20, f(p.y)); g(30, f(0));
        });
        g(0, 'SEQEND'); g(8, ly.name);
      });
      // Beschriftungen (z. B. Maßtext). rot in Grad, zentriert (72=1) am Punkt.
      (ly.texts || []).forEach(tx => {
        if (tx.text == null || tx.text === '') return;
        g(0, 'TEXT'); g(8, ly.name);
        g(10, f(tx.x)); g(20, f(tx.y)); g(30, f(0));
        g(40, f(tx.h || 3)); g(1, String(tx.text));
        if (tx.rot) g(50, f(tx.rot));
        g(7, 'STANDARD');                                        // Textstil (in TABLES definiert)
        g(72, 1); g(11, f(tx.x)); g(21, f(tx.y)); g(31, f(0));   // horizontal zentriert
      });
    });
    g(0, 'ENDSEC');
    g(0, 'EOF');
    return L.join('\r\n') + '\r\n';
  }


  // ---------- SVG-Import (Konturen aus einer SVG-Datei) ----------------
  // Liegt im Kern, weil auch der Profil-Import (Datei → Profil aus SVG)
  // ihn braucht — der Reiter „DXF-Formen“ ist als Funktion abwählbar.
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);
  function sampleSvgEl(el) {
    const type = el.tagName.toLowerCase();
    let pts = [], closed = false;
    if (type === 'polyline' || type === 'polygon') {
      const raw = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number).filter(v => !isNaN(v));
      for (let i = 0; i + 1 < raw.length; i += 2) pts.push({ x: raw[i], y: raw[i + 1] });
      closed = type === 'polygon';
    } else if (type === 'line') {
      pts = [{ x: +el.getAttribute('x1') || 0, y: +el.getAttribute('y1') || 0 },
             { x: +el.getAttribute('x2') || 0, y: +el.getAttribute('y2') || 0 }];
    } else if (typeof el.getTotalLength === 'function') {
      let L = 0; try { L = el.getTotalLength(); } catch (e) { return null; }
      if (!(L > 0)) return null;
      const steps = Math.min(1600, Math.max(24, Math.round(L)));
      for (let k = 0; k <= steps; k++) { const p = el.getPointAtLength(L * k / steps); pts.push({ x: p.x, y: p.y }); }
      closed = type === 'path' ? /[zZ]/.test(el.getAttribute('d') || '') : true;
    } else return null;
    if (pts.length < 2) return null;
    const m = el.getCTM && el.getCTM();      // Transform bis zum SVG-Viewport
    const out = pts.map(p => {
      let x = p.x, y = p.y;
      if (m) { const nx = m.a * x + m.c * y + m.e, ny = m.b * x + m.d * y + m.f; x = nx; y = ny; }
      return { x, y: -y };
    });
    out.closed = closed;
    return out;
  }
  function parseSvgToLayers(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror'))
      throw new Error(T('SVG konnte nicht gelesen werden.'));
    // Unsichtbar ins Dokument einhängen, damit Längen/Transforms berechenbar sind.
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden';
    const imported = document.importNode(svg, true);
    host.appendChild(imported); document.body.appendChild(host);
    const layers = {}, order = [];
    try {
      const els = imported.querySelectorAll('path,polyline,polygon,line,rect,circle,ellipse');
      let idx = 0;
      els.forEach(el => {
        const loop = sampleSvgEl(el);
        if (!loop || loop.length < 2) return;
        idx++;
        let nm = el.getAttribute('id') || el.getAttribute('inkscape:label')
              || (el.tagName.toLowerCase() + ' ' + idx);
        const base = nm; let k = 2; while (layers[nm]) nm = base + ' (' + (k++) + ')';
        layers[nm] = [loop]; order.push(nm);
      });
    } finally { document.body.removeChild(host); }
    if (!order.length) throw new Error(T('Keine Konturen (Pfade/Polygone) in der SVG gefunden.'));
    return { layers, order };
  }

  global.Dxf = { parse, write, pickLoop, perimeter, buildSync, resampleOpen, loopSlice };
  global.Svg = { parseSvgToLayers, sampleSvgEl };
  // Auch im App-Verzeichnis anmelden: die Module binden ihre Namen daraus.
  const App = (global.App = global.App || {});
  App.parseSvgToLayers = parseSvgToLayers; App.sampleSvgEl = sampleSvgEl;
})(window);
