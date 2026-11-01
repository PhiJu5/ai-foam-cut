/* rproSpanten.js — Reiter „Rumpf Spanten" (Feature „rproSpanten", braucht „rumpfpro").
 * Leitet aus dem Rumpf (rumpfpro.js, window.RumpfPro.api()) einen Bausatz in Spantbauweise ab —
 * wie die Rippenfläche für Tragflächen, Vorbild DevFus (Formers thickness, Sheeting, Spars,
 * Lightening holes, Formers splitting, Building jig, Draw-Export):
 *   - Spantkontur je Spant (reiner Rumpf oder mit Anbauten), um die Beplankung nach innen versetzt
 *     (Vollbeplankung überall, Teilbeplankung nur unter den Beplankungsfeldern)
 *   - schräge Spanten: Neigung je Spant um einen Drehpunkt (Schnitt der geneigten Ebene mit dem Rumpf)
 *   - Aussparungen für Gurte/Leisten (Lage als Winkel um den Spantmittelpunkt, beidseitig gespiegelt)
 *   - Leichterung: Innenausschnitt mit Randbreite ODER frei gezeichnete Ausnehmungen (Geraden + Splines)
 *   - Teilung links/rechts oder oben/unten (Steg an der Leichterung bleibt stehen)
 *   - Haubenausschnitt: Spanten an der Haubenlinie getrennt (Haubenteile extra) + Kabinenrahmen (abgewickelt)
 *   - Beplankungsfelder mit Abwicklung (Dreiecksstreifen von der dicksten Stelle aus aufgefaltet)
 *   - Servobretter (waagrecht, zwischen den Spanten geteilt, Servoausschnitte)
 *   - Helling: Füße bis zu einer gemeinsamen Grundlinie mit Zapfen + Hellingbrett mit Schlitzen,
 *     auf Wunsch kopfüber (Rücken unten); Abtrennlinie der Füße als Markierung
 *   - Ausgabe: geschachteltes DXF, Stückliste (CSV), Übergabe in die CAD-Bearbeitung
 * Teilekoordinaten: x = Z (Breite), y = Y (Höhe) des Spants (bei schrägen Spanten y entlang der Neigung,
 * wahre Länge); Hellingbrett und Servobretter in X/Z; Beplankung/Rahmen abgewickelt.
 * Andere Module rufen nur geschützt (App.rprobSidebar && …, window.RproSpanten).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10;
  const RAD = Math.PI / 180;

  // ---------- Konfiguration --------------------------------------------------------------
  const DEF = {
    src: 'body',               // 'body' nur Rumpf | 'all' mit Anbauten (Tragflächenübergang, Leitwerk)
    skip: [],                  // Spant-Indizes, die nicht gebaut werden
    thick: 3,                  // Spantdicke (mm) — Hellingschlitze, Stückliste
    mat: 'Pappelsperrholz',    // Werkstoff (nur Stückliste)
    sheet: 1.5,                // Beplankung (mm): Spantkontur wird um diesen Wert nach innen versetzt
    sheetMode: 'full',         // 'full' überall | 'panels' nur unter den Beplankungsfeldern
    sheetMat: 'Balsa',         // Werkstoff der Beplankung (Stückliste)
    panels: [],                // Beplankungsfelder {name,on,x0,x1,a0,a1,t,margin,dev}
    fr: {},                    // je Spant-Index: { tilt (°, + = Oberkante nach hinten), piv 'bot'|'mid'|'top' }
    spars: [                   // Gurte/Leisten: Lage als Winkel (0 = oben, 90 = seitlich, 180 = unten), Breite × Tiefe
      { name: 'Gurt oben', ang: 35, b: 5, h: 5, on: true },
      { name: 'Gurt unten', ang: 145, b: 5, h: 5, on: true },
      { name: 'Kielleiste', ang: 180, b: 8, h: 3, on: false }
    ],
    light: { on: true, rim: 8 },          // Leichterung: Randbreite (mm)
    cuts: [],                             // frei gezeichnete Ausnehmungen {fr (Index | -1 = alle), mir, nodes [{u,v,l,k}]}
    split: 'none',                        // 'none' | 'lr' links/rechts | 'tb' oben/unten (an der breitesten Stelle)
    hatch: { on: false, src: 'auto', x0: null, x1: null, y0: null, y1: null, top: true, frame: true, frameW: 8 },
    boards: [],                           // Servobretter {name,on,x0,x1,y,t,w,split,n,sl,sb,sx,gap}
    jig: { on: false, mode: 'bottom', base: 15, footW: 30, boardT: 6 },   // Helling
    label: { on: true, h: 5 },
    sheetW: 600, gap: 6                   // Anordnung: Plattenbreite, Abstand
  };
  function cfg() {
    let c = state.cfg.rprob;
    if (!c || typeof c !== 'object') c = state.cfg.rprob = JSON.parse(JSON.stringify(DEF));
    for (const k in DEF) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEF[k]));
    for (const k of ['light', 'jig', 'label', 'hatch']) for (const q in DEF[k]) if (c[k][q] === undefined) c[k][q] = DEF[k][q];
    for (const k of ['skip', 'spars', 'panels', 'cuts', 'boards']) if (!Array.isArray(c[k])) c[k] = [];
    if (!c.fr || typeof c.fr !== 'object' || Array.isArray(c.fr)) c.fr = {};
    return c;
  }

  // ---------- Polygon-Helfer ([{x,y}], geschlossen, ohne Wiederholung des Startpunkts) ---------------
  const P = (x, y) => ({ x, y });
  function area(L) { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
  function centroid(L) { let a = 0, cx = 0, cy = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length], k = p.x * q.y - q.x * p.y; a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k; } if (Math.abs(a) < 1e-12) { let sx = 0, sy = 0; for (const p of L) { sx += p.x; sy += p.y; } return P(sx / L.length, sy / L.length); } return P(cx / (3 * a), cy / (3 * a)); }
  function dedupe(L, eps) { const o = []; for (const p of L) { const q = o[o.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) > eps) o.push(p); } while (o.length > 2 && Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y) <= eps) o.pop(); return o; }
  // Gleichmäßig nach Bogenlänge neu abtasten (n Punkte).
  function resample(L, n) {
    const m = L.length, cum = [0];
    for (let i = 1; i <= m; i++) { const p = L[i - 1], q = L[i % m]; cum.push(cum[i - 1] + Math.hypot(q.x - p.x, q.y - p.y)); }
    const tot = cum[m], out = []; let j = 0;
    for (let k = 0; k < n; k++) {
      const s = tot * k / n; while (j < m - 1 && cum[j + 1] < s) j++;
      const d = cum[j + 1] - cum[j], t = d > 1e-12 ? (s - cum[j]) / d : 0, p = L[j], q = L[(j + 1) % m];
      out.push(P(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t));
    }
    return out;
  }
  // Offene Halbkontur [[y,z],…] (oben -> unten) nach Bogenlänge auf n Punkte verteilen.
  function resampleOpen(H, n) {
    const cum = [0]; for (let i = 1; i < H.length; i++) cum.push(cum[i - 1] + Math.hypot(H[i][0] - H[i - 1][0], H[i][1] - H[i - 1][1]));
    const tot = cum[cum.length - 1], out = []; let j = 0;
    for (let k = 0; k < n; k++) {
      const s = tot * k / (n - 1); while (j < H.length - 2 && cum[j + 1] < s) j++;
      const d = cum[j + 1] - cum[j], t = d > 1e-12 ? clamp((s - cum[j]) / d, 0, 1) : 0, p = H[j], q = H[Math.min(j + 1, H.length - 1)];
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
    return out;
  }
  function segX(a, b, c, d) {
    const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y }, den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den, u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
    return (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) ? { t, p: P(a.x + r.x * t, a.y + r.y * t) } : null;
  }
  function selfX(L) {
    const n = L.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segX(L[i], L[(i + 1) % n], L[j], L[(j + 1) % n])) return true; }
    return false;
  }
  function inPoly(p, L) { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; }
  // Selbstüberschneidungen entfernen: an jeder Kreuzung die kleinere Schlaufe herausschneiden.
  function deloop(L) {
    for (let guard = 0; guard < 400; guard++) {
      const n = L.length; let hit = null;
      outer: for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const x = segX(L[i], L[(i + 1) % n], L[j], L[(j + 1) % n]); if (x) { hit = { i, j, p: x.p }; break outer; }
      }
      if (!hit) return L;
      const A = [hit.p].concat(L.slice(hit.i + 1, hit.j + 1)), B = L.slice(hit.j + 1).concat(L.slice(0, hit.i + 1), [hit.p]);
      L = Math.abs(area(A)) > Math.abs(area(B)) ? A : B;
    }
    return L;
  }
  // Parallelversatz: d > 0 nach außen, d < 0 nach innen (unabhängig vom Umlaufsinn). d auch als Wert je Punkt (Array).
  function offset(L, d) {
    const n = L.length, sg = area(L) > 0 ? 1 : -1, out = [];
    for (let i = 0; i < n; i++) {
      const di = Array.isArray(d) ? d[i] : d;
      const a = L[(i - 1 + n) % n], p = L[i], b = L[(i + 1) % n];
      if (!di) { out.push(P(p.x, p.y)); continue; }
      const e1 = { x: p.x - a.x, y: p.y - a.y }, e2 = { x: b.x - p.x, y: b.y - p.y }, l1 = Math.hypot(e1.x, e1.y) || 1, l2 = Math.hypot(e2.x, e2.y) || 1;
      const n1 = { x: e1.y / l1 * sg, y: -e1.x / l1 * sg }, n2 = { x: e2.y / l2 * sg, y: -e2.x / l2 * sg };   // nach außen
      let m = { x: n1.x + n2.x, y: n1.y + n2.y }; const lm = Math.hypot(m.x, m.y);
      if (lm < 1e-9) m = n1; else { m.x /= lm; m.y /= lm; }
      const c = Math.max(0.35, m.x * n1.x + m.y * n1.y);   // Gehrung, begrenzt
      out.push(P(p.x + m.x * di / c, p.y + m.y * di / c));
    }
    return deloop(out);
  }
  // Halbebene: behält die Punkte mit f(p) >= 0 (Sutherland–Hodgman; f linear, sonst Näherung bei dichter Kontur).
  function clipHalf(L, f) {
    const out = [];
    for (let i = 0; i < L.length; i++) {
      const p = L[i], q = L[(i + 1) % L.length], fp = f(p), fq = f(q);
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push(P(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t)); }
    }
    return dedupe(out, 1e-6);
  }
  function bbox(list) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const L of list) for (const p of L) { a = Math.min(a, p.x); b = Math.min(b, p.y); c = Math.max(c, p.x); d = Math.max(d, p.y); } return { minx: a, miny: b, maxx: c, maxy: d, w: c - a, h: d - b }; }
  // Punkt bei Bogenlänge s (geschlossen) + Index des Segments.
  function atS(L, cum, s) {
    const tot = cum[L.length]; s = ((s % tot) + tot) % tot;
    let j = 0; while (j < L.length - 1 && cum[j + 1] < s) j++;
    const d = cum[j + 1] - cum[j], t = d > 1e-12 ? (s - cum[j]) / d : 0, p = L[j], q = L[(j + 1) % L.length];
    return { p: P(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t), j };
  }
  function cumOf(L) { const c = [0]; for (let i = 1; i <= L.length; i++) { const p = L[i - 1], q = L[i % L.length]; c.push(c[i - 1] + Math.hypot(q.x - p.x, q.y - p.y)); } return c; }
  // Strahl vom Punkt c in Richtung dir: am weitesten entfernter Schnitt mit der Kontur -> Bogenlänge.
  // Segmentenden zählen mit — der Strahl bei 0°/90°/180° trifft eine symmetrische Kontur genau in einem Punkt.
  function rayHit(L, c, dir) {
    const cum = cumOf(L); let best = null;
    for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length], s = { x: b.x - a.x, y: b.y - a.y }, den = dir.x * s.y - dir.y * s.x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a.x - c.x) * s.y - (a.y - c.y) * s.x) / den, u = ((a.x - c.x) * dir.y - (a.y - c.y) * dir.x) / den;
      if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && (!best || t > best.t)) { const uu = clamp(u, 0, 1); best = { t, s: cum[i] + uu * Math.hypot(s.x, s.y), p: P(a.x + s.x * uu, a.y + s.y * uu) }; }
    }
    return best;
  }
  // Rechteckige Aussparung (Breite b entlang der Kontur, Tiefe h nach innen) um Bogenlänge s.
  function notch(L, s, b, h) {
    const cum = cumOf(L), tot = cum[L.length];
    if (b >= tot * 0.45) return L;
    const Q = atS(L, cum, s).p, A0 = atS(L, cum, s - 0.5).p, B0 = atS(L, cum, s + 0.5).p;
    let T0 = { x: B0.x - A0.x, y: B0.y - A0.y }; const lt = Math.hypot(T0.x, T0.y) || 1; T0 = { x: T0.x / lt, y: T0.y / lt };
    const sg = area(L) > 0 ? 1 : -1, N = { x: -T0.y * sg, y: T0.x * sg };   // nach innen
    const ea = P(Q.x - T0.x * b / 2, Q.y - T0.y * b / 2), eb = P(Q.x + T0.x * b / 2, Q.y + T0.y * b / 2);
    // Wandfußpunkte: Konturpunkte, deren Projektion auf die Tangente die Wand trifft
    const foot = (sgn) => { let bs = s, bd = Infinity; for (let k = 0; k <= 60; k++) { const ss = s + sgn * b * k / 40, p = atS(L, cum, ss).p, d = Math.abs((p.x - Q.x) * T0.x + (p.y - Q.y) * T0.y - sgn * b / 2); if (d < bd) { bd = d; bs = ss; } } return bs; };
    const sa = foot(-1), sb = foot(1);
    const pa = atS(L, cum, sa), pb = atS(L, cum, sb);
    const ia = P(ea.x + N.x * h, ea.y + N.y * h), ib = P(eb.x + N.x * h, eb.y + N.y * h);
    // neuer Umlauf: ab pb weiter bis pa, dann Aussparung
    const out = [pb.p];
    const n = L.length; let k = (pb.j + 1) % n;
    const stopAt = pa.j;
    for (let g = 0; g < n; g++) { out.push(L[k]); if (k === stopAt) break; k = (k + 1) % n; }
    out.push(pa.p, ia, ib);
    return dedupe(out, 1e-4);
  }
  // Fuß der Helling: Kontur unten zwischen z = ±fw/2 durch ein Rechteck bis yBase ersetzen (mit Zapfen).
  function addFoot(L, fw, yBase, tenonH) {
    // Startpunkt: Kontur unten auf der Mittellinie (kleinstes |z| in der unteren Hälfte; flache Böden!)
    const n = L.length, hw = fw / 2; let cy = 0; for (const p of L) cy += p.y; cy /= n;
    let ib = -1; for (let i = 0; i < n; i++) if (L[i].y < cy && (ib < 0 || Math.abs(L[i].x) < Math.abs(L[ib].x) - 1e-9 || (Math.abs(Math.abs(L[i].x) - Math.abs(L[ib].x)) <= 1e-9 && L[i].y < L[ib].y))) ib = i;
    if (ib < 0) return { L, mark: null };
    // vom tiefsten Punkt in beide Richtungen, bis die Kontur |z| = hw überschreitet
    const walk = dir => {
      let i = ib;
      for (let g = 0; g < n; g++) {
        const j = (i + dir + n) % n, p = L[i], q = L[j];
        if (Math.abs(q.x) >= hw) { const sx = Math.sign(q.x), t = clamp((sx * hw - p.x) / ((q.x - p.x) || 1e-9), 0, 1); return { in: i, out: j, p: P(sx * hw, p.y + (q.y - p.y) * t), sx }; }
        i = j;
      }
      return null;
    };
    const a = walk(1), b = walk(-1);
    if (!a || !b || a.sx === b.sx) return { L, mark: null };
    const out = [a.p];
    for (let k = a.out, g = 0; g < n; g++) { out.push(L[k]); if (k === b.out) break; k = (k + 1) % n; }
    const q = hw / 2;
    out.push(b.p, P(b.sx * hw, yBase));
    if (tenonH > 0) out.push(P(b.sx * q, yBase), P(b.sx * q, yBase - tenonH), P(a.sx * q, yBase - tenonH), P(a.sx * q, yBase));
    out.push(P(a.sx * hw, yBase));
    const mark = [b.p];
    for (let k = b.in, g = 0; g < n; g++) { mark.push(L[k]); if (k === a.in) break; k = (k + 1) % n; }
    mark.push(a.p);
    return { L: dedupe(out, 1e-4), mark };
  }
  // Waagrechte Linie y durch die Kontur: äußerste Schnittpunkte links/rechts (oder null).
  function chordAt(L, y) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; if ((p.y > y) !== (q.y > y)) { const x = p.x + (q.x - p.x) * (y - p.y) / (q.y - p.y); lo = Math.min(lo, x); hi = Math.max(hi, x); } }
    return hi > lo ? [P(lo, y), P(hi, y)] : null;
  }
  // Halbe Breite einer Halbkontur [[y,z],…] in Höhe y (größtes z der Schnittpunkte, 0 = keiner).
  function halfWidth(H, y) {
    let z = 0, hit = false;
    for (let i = 0; i + 1 < H.length; i++) { const a = H[i], b = H[i + 1]; if ((a[0] >= y) !== (b[0] >= y)) { const t = (y - a[0]) / ((b[0] - a[0]) || 1e-12); z = Math.max(z, a[1] + (b[1] - a[1]) * t); hit = true; } }
    return hit ? z : 0;
  }

  // ---------- Frei gezeichnete Ausnehmungen: Knoten -> Kontur -----------------------------------
  // Knoten {u,v,l,k}: l = Strecke zum nächsten Knoten gerade, k = Ecke (Spline knickt hier).
  // Spline-Abschnitte als Hermite-Kurven; an Geraden tangential angeschlossen, sonst Catmull-Rom.
  function cutSegs(pts, nodes, closed) {
    const n = pts.length; if (n < 2) return [];
    const segs = closed ? n : n - 1, out = [];
    const nb = (i, d) => closed ? (i + d + n) % n : clamp(i + d, 0, n - 1);
    const sub = (a, b) => P(a.x - b.x, a.y - b.y), len = v => Math.hypot(v.x, v.y);
    const straight = i => !!(nodes[i] && nodes[i].l) && (closed || i < n - 1);
    const dirTo = (d, l) => { const q = len(d) || 1; return P(d.x / q * l, d.y / q * l); };
    // Tangente am Knoten j für den Spline-Abschnitt seg (Anfang: seg === j)
    const tan = (j, seg, chord) => {
      const isStart = seg === j, prevSeg = closed ? (j - 1 + n) % n : j - 1;
      if ((nodes[j] || {}).k || (!closed && (j === 0 || j === n - 1))) return isStart ? sub(pts[nb(j, 1)], pts[j]) : sub(pts[j], pts[nb(j, -1)]);
      if (isStart && prevSeg >= 0 && straight(prevSeg)) return dirTo(sub(pts[j], pts[nb(j, -1)]), chord);
      if (!isStart && j < segs && straight(j)) return dirTo(sub(pts[nb(j, 1)], pts[j]), chord);
      const d = sub(pts[nb(j, 1)], pts[nb(j, -1)]); return P(d.x / 2, d.y / 2);
    };
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[nb(i, 1)], pc = [P(a.x, a.y)];
      if (!straight(i)) {
        const ch = len(sub(b, a)), ta = tan(i, i, ch), tb = tan(nb(i, 1), i, ch), M = 16;
        for (let s = 1; s < M; s++) {
          const t = s / M, t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
          pc.push(P(h00 * a.x + h10 * ta.x + h01 * b.x + h11 * tb.x, h00 * a.y + h10 * ta.y + h01 * b.y + h11 * tb.y));
        }
      }
      pc.push(P(b.x, b.y)); out.push(pc);
    }
    return out;
  }
  function cutCurve(pts, nodes, closed) {
    if (pts.length < 2) return pts.slice();
    const out = []; cutSegs(pts, nodes, closed).forEach(pc => pc.slice(0, -1).forEach(p => out.push(p)));
    if (!closed) out.push(P(pts[pts.length - 1].x, pts[pts.length - 1].y));
    return out;
  }
  // Knoten (normiert auf die Spantkontur E) -> mm
  const toMM = (nd, E) => P(E.cx + nd.u * E.hw, E.cy + nd.v * E.hh);
  const fromMM = (p, E) => ({ u: (p.x - E.cx) / E.hw, v: (p.y - E.cy) / E.hh });
  function cutPolys(cut, E) {
    const pts = cut.nodes.map(nd => toMM(nd, E)); if (pts.length < 3) return [];
    const L = dedupe(cutCurve(pts, cut.nodes, true), 1e-4), out = [L];
    if (cut.mir) out.push(L.map(p => P(-p.x, p.y)).reverse());
    return out;
  }

  // ---------- Bausatz aufbauen ------------------------------------------------------------------
  let cache = null, cacheKey = null;
  // Quelle: Rumpf oder ein eigenes STL-Modell (stlbody.js, gleiche Schnittstelle)
  function srcApi() {
    if (cfg().from === 'stl') return (window.StlBody && StlBody.api && StlBody.api()) || null;
    return (window.RumpfPro && RumpfPro.api && RumpfPro.api()) || null;
  }
  function hasModel() { return !!srcApi(); }
  // Rumpfoberfläche als Gitter (für schräge Spanten): je Spalte x die Halbkontur, nach Bogenlänge gleich verteilt.
  function surfGrid(X) {
    if (X.grid) return X.grid;
    const api = X.api, N = 200, MH = 120, xs = [], rows = [];
    for (let k = 0; k <= N; k++) { const x = api.x0 + (api.x1 - api.x0) * k / N, H = X.hf(x); if (H && H.length > 1) { xs.push(x); rows.push(resampleOpen(H, MH)); } }
    return (X.grid = { xs, rows, MH });
  }
  // Geometrie eines Spants: Halbkontur in Teilekoordinaten + Umrechnung Teil -> Rumpf (X, Y).
  function frGeo(X, f) {
    const c = X.c, o = c.fr[f.i] || {}, phi = clamp(+o.tilt || 0, -60, 60) * RAD;
    const b = X.api.box(f.x), yc = o.piv === 'top' ? b.top : o.piv === 'bot' ? b.bot : (b.top + b.bot) / 2;
    const sn = Math.sin(phi), cs = Math.cos(phi);
    const g = { phi, yc, sn, cs, xc: f.x, X: p => f.x + (p.y - yc) * sn, Y: p => yc + (p.y - yc) * cs, toPart: y => yc + (y - yc) / cs };
    if (Math.abs(phi) < 1e-6) { g.half = X.hf(f.x); return g; }
    // geneigte Ebene (X − xc)·cos φ − (Y − yc)·sin φ = 0 mit jeder Längslinie des Gitters schneiden
    const G = surfGrid(X), half = [];
    for (let a = 0; a < G.MH; a++) {
      let best = null;
      for (let k = 0; k + 1 < G.xs.length; k++) {
        const A = G.rows[k][a], B = G.rows[k + 1][a];
        const ga = (G.xs[k] - f.x) * cs - (A[0] - yc) * sn, gb = (G.xs[k + 1] - f.x) * cs - (B[0] - yc) * sn;
        if (ga === 0 || (ga < 0) !== (gb < 0)) {
          const t = ga === gb ? 0 : ga / (ga - gb), x = G.xs[k] + (G.xs[k + 1] - G.xs[k]) * t;
          if (!best || Math.abs(x - f.x) < Math.abs(best.x - f.x)) best = { x, y: A[0] + (B[0] - A[0]) * t, z: A[1] + (B[1] - A[1]) * t };
        }
      }
      if (best) half.push([yc + (best.x - f.x) * sn + (best.y - yc) * cs, Math.max(0, best.z)]);
    }
    g.half = half;
    return g;
  }
  const loopOf = half => dedupe(half.map(q => P(q[1], q[0])).concat(half.slice(1, -1).reverse().map(q => P(-q[1], q[0]))), 1e-3);
  // Polarwinkel um den Spantmittelpunkt (0 = oben, 90 = seitlich, 180 = unten), beidseitig gleich.
  const angOf = (p, cy) => Math.atan2(Math.abs(p.x), p.y - cy) / RAD;
  function panelOn(pn, x, a) { return pn.on && x >= Math.min(pn.x0, pn.x1) && x <= Math.max(pn.x0, pn.x1) && a >= Math.min(pn.a0, pn.a1) - 1e-6 && a <= Math.max(pn.a0, pn.a1) + 1e-6; }
  // Beplankungsdicke je Konturpunkt
  function sheetArr(X, x, L) {
    const c = X.c;
    if (c.sheetMode !== 'panels') { const d = Math.max(0, +c.sheet || 0); return L.map(() => -d); }
    const cy = centroid(L).y;
    return L.map(p => { let d = 0; for (const pn of c.panels) if (panelOn(pn, x, angOf(p, cy))) d = Math.max(d, +pn.t || 0); return -d; });
  }
  function sheetMax(X, x) {
    const c = X.c; if (c.sheetMode !== 'panels') return Math.max(0, +c.sheet || 0);
    let d = 0; for (const pn of c.panels) if (pn.on && x >= Math.min(pn.x0, pn.x1) && x <= Math.max(pn.x0, pn.x1)) d = Math.max(d, +pn.t || 0); return d;
  }
  // Haubenausschnitt: Schnittlinie N [{x,y}] in der Seitenansicht + Schnitthöhe je x
  function hatchOf(X) {
    const h = X.c.hatch, api = X.api; if (!h.on) return null;
    const can = api.canopy;
    if (h.src !== 'manual' && can && can.line && can.line.length > 1) {
      return { src: 'rpro', N: can.line.map(q => P(q[0], q[1])), x0: can.x0, x1: can.x1, ycut: x => { if (x < can.x0 || x > can.x1) return null; const s = can.spans(x); return s && s.length ? s[0][0] : null; } };
    }
    if (h.src !== 'manual') return { err: T('Im Rumpf ist keine Kabinenhaube angelegt — Quelle „Gerade (eigene Werte)" wählen.') };
    hatchDefaults(api, h);
    const x0 = Math.min(h.x0, h.x1), x1 = Math.max(h.x0, h.x1), y0 = h.x0 <= h.x1 ? +h.y0 : +h.y1, y1 = h.x0 <= h.x1 ? +h.y1 : +h.y0;
    if (!(x1 - x0 > 1)) return { err: T('Haubenausschnitt zu kurz.') };
    const N = []; for (let k = 0; k <= 40; k++) { const t = k / 40; N.push(P(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)); }
    return { src: 'manual', N, x0, x1, ycut: x => (x < x0 || x > x1) ? null : y0 + (y1 - y0) * (x - x0) / (x1 - x0) };
  }
  function hatchDefaults(api, h) {
    const L = api.x1 - api.x0;
    if (h.x0 == null || !isFinite(+h.x0)) h.x0 = r1(api.x0 + 0.15 * L);
    if (h.x1 == null || !isFinite(+h.x1)) h.x1 = r1(api.x0 + 0.38 * L);
    const yAt = x => { const b = api.box(x); return r1(b.top - 0.35 * (b.top - b.bot)); };
    if (h.y0 == null || !isFinite(+h.y0)) h.y0 = yAt(+h.x0);
    if (h.y1 == null || !isFinite(+h.y1)) h.y1 = yAt(+h.x1);
  }

  // Beplankungsfeld: Umfangslinie je Station zwischen den Winkeln a0..a1 (rechte Hälfte), m+1 Punkte in 3D
  function girth(X, x, a0, a1, m) {
    const H = X.hf(x); if (!H || H.length < 3) return null;
    const L = loopOf(H); if (L.length < 3 || Math.abs(area(L)) < 1) return null;
    const cy = centroid(L).y, cum = [0], ang = [];
    for (let i = 0; i < H.length; i++) { if (i) cum.push(cum[i - 1] + Math.hypot(H[i][0] - H[i - 1][0], H[i][1] - H[i - 1][1])); ang.push(Math.atan2(Math.max(0, H[i][1]), H[i][0] - cy) / RAD); }
    const sAt = a => {
      if (a <= ang[0]) return 0;
      for (let i = 0; i + 1 < H.length; i++) if ((ang[i] <= a && a <= ang[i + 1]) || (ang[i] >= a && a >= ang[i + 1])) { const d = ang[i + 1] - ang[i]; return cum[i] + (cum[i + 1] - cum[i]) * (Math.abs(d) > 1e-12 ? (a - ang[i]) / d : 0); }
      return cum[cum.length - 1];
    };
    const sA = sAt(Math.min(a0, a1)), sB = sAt(Math.max(a0, a1)); if (!(sB - sA > 0.5)) return null;
    const pts = []; let j = 0;
    for (let k = 0; k <= m; k++) {
      const s = sA + (sB - sA) * k / m; while (j < H.length - 2 && cum[j + 1] < s) j++;
      const d = cum[j + 1] - cum[j], t = d > 1e-12 ? clamp((s - cum[j]) / d, 0, 1) : 0;
      pts.push([x, H[j][0] + (H[j + 1][0] - H[j][0]) * t, H[j][1] + (H[j + 1][1] - H[j][1]) * t]);
    }
    let len = 0; for (let k = 1; k <= m; k++) len += Math.hypot(pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]);
    return { pts, len };
  }
  // Abwicklung: Umfangslinie der dicksten Station gerade auslegen, dann Station für Station Dreiecke anfalten
  // (jeder neue Punkt aus zwei bekannten mit den wahren 3D-Abständen). Doppelt gekrümmt = Näherung, Verzerrung wird gemeldet.
  function develop(X, pn, frXs) {
    const api = X.api, xa = Math.max(Math.min(pn.x0, pn.x1), api.x0 + 0.5), xb = Math.min(Math.max(pn.x0, pn.x1), api.x1 - 0.5);
    if (!(xb - xa > 5)) return null;
    const n = clamp(Math.round((xb - xa) / 8), 6, 120); let xs = [];
    for (let k = 0; k <= n; k++) xs.push(xa + (xb - xa) * k / n);
    frXs.forEach(x => { if (x > xa + 0.5 && x < xb - 0.5) xs.push(x); });
    xs.sort((a, b) => a - b); xs = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.3);
    const m = 24, rows = [];
    for (const x of xs) { const g = girth(X, x, pn.a0, pn.a1, m); if (g) rows.push(g); }
    if (rows.length < 2) return null;
    const K = rows.length, D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let kc = 0; rows.forEach((r, k) => { if (r.len > rows[kc].len) kc = k; }); kc = Math.min(kc, K - 2);
    const jc = m / 2, Q = rows.map(() => new Array(m + 1));
    // neuer Punkt C aus A (Abstand dA) und B (dB); Seite so, dass die Lage (k, −j) erhalten bleibt
    const place = (ka, ja, kb, jb, kc2, jc2) => {
      const A = Q[ka][ja], B = Q[kb][jb], p3 = rows[kc2].pts[jc2], dA = D(p3, rows[ka].pts[ja]), dB = D(p3, rows[kb].pts[jb]);
      const ex = B.x - A.x, ey = B.y - A.y, d = Math.hypot(ex, ey) || 1e-9, ux = ex / d, uy = ey / d;
      const a = (dA * dA - dB * dB + d * d) / (2 * d), h = Math.sqrt(Math.max(0, dA * dA - a * a));
      const sg = Math.sign((kb - ka) * -(jc2 - ja) - -(jb - ja) * (kc2 - ka)) || 1;
      // Kreuzprodukt (B−A)×(C−A) = d·h·side -> side = sg
      Q[kc2][jc2] = P(A.x + ux * a - uy * h * sg, A.y + uy * a + ux * h * sg);
    };
    // Startstreifen an der dicksten Stelle als Dreiecksstreifen (exakt; die Umfangslinie wird dabei nicht gerade erzwungen —
    // auf einem Kegel wird sie zum Bogen)
    Q[kc][0] = P(0, 0); Q[kc + 1][0] = P(D(rows[kc + 1].pts[0], rows[kc].pts[0]), 0);
    for (let j = 1; j <= m; j++) { place(kc, j - 1, kc + 1, j - 1, kc, j); place(kc, j, kc + 1, j - 1, kc + 1, j); }
    const march = (k, kp) => {
      place(kp, jc, kp, jc + 1, k, jc);
      for (let j = jc + 1; j <= m; j++) place(k, j - 1, kp, j, k, j);
      for (let j = jc - 1; j >= 0; j--) place(k, j + 1, kp, j, k, j);
    };
    for (let k = kc + 2; k < K; k++) march(k, k - 1);
    for (let k = kc - 1; k >= 0; k--) march(k, k + 1);
    // Verzerrung an den nicht benutzten Diagonalen
    // (längengewichtetes Mittel in %, größte Abweichung in mm — an der Nase sind die Zellen winzig, ein Größtwert in % sagt dort nichts)
    let eSum = 0, lSum = 0, dmm = 0;
    for (let k = 1; k < K; k++) for (let j = 0; j < m; j++) { const d3 = D(rows[k].pts[j], rows[k - 1].pts[j + 1]), d2 = Math.hypot(Q[k][j].x - Q[k - 1][j + 1].x, Q[k][j].y - Q[k - 1][j + 1].y), e = Math.abs(d2 - d3); eSum += e; lSum += d3; dmm = Math.max(dmm, e); }
    const dist = lSum > 0 ? eSum / lSum : 0;
    const ring = [];
    for (let k = 0; k < K; k++) ring.push(Q[k][0]);
    for (let j = 1; j <= m; j++) ring.push(Q[K - 1][j]);
    for (let k = K - 2; k >= 0; k--) ring.push(Q[k][m]);
    for (let j = m - 1; j >= 1; j--) ring.push(Q[0][j]);
    let R = dedupe(ring, 1e-4); const mg = Math.max(0, +pn.margin || 0); if (mg > 0) R = offset(R, mg);
    const marks = [];
    frXs.forEach(x => { const k = rows.findIndex(r => Math.abs(r.pts[0][0] - x) < 1e-6); if (k >= 0) marks.push(Q[k].slice()); });
    const band = rows.map(r => P(r.pts[0][0], r.pts[0][1])).concat(rows.slice().reverse().map(r => P(r.pts[m][0], r.pts[m][1])));
    return { ring: R, marks, dist, dmm, band, len: xb - xa };
  }
  // Kabinenrahmen: Fläche der Schnittfläche (Haubenlinie × Z, abwickelbar) innerhalb der Spantkontur, innen um die Rahmenbreite ausgeschnitten.
  function framePart(X, H) {
    const N = []; for (let i = 0; i + 1 < H.N.length; i++) { const a = H.N[i], b = H.N[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2)); for (let k = 0; k < n; k++) N.push(P(a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n)); }
    N.push(H.N[H.N.length - 1]);
    const R = [], Lf = []; let u = 0;
    N.forEach((p, i) => {
      if (i) u += Math.hypot(p.x - N[i - 1].x, p.y - N[i - 1].y);
      if (p.x <= X.api.x0 || p.x >= X.api.x1) return;
      const hw = halfWidth(X.hf(p.x), p.y) - sheetMax(X, p.x);
      if (hw > 0.3) { R.push(P(u, hw)); Lf.push(P(u, -hw)); }
    });
    if (R.length < 3) return null;
    const outer = dedupe(R.concat(Lf.reverse()), 1e-4); if (Math.abs(area(outer)) < 10) return null;
    const w = Math.max(1, +X.c.hatch.frameW || 0), inner = offset(outer, -w);
    return { rings: [outer], holes: inner.length > 3 && Math.abs(area(inner)) > w * w && !selfX(inner) ? [inner] : [] };
  }
  // Servobrett: waagrecht in Höhe y (Unterseite) … y + t, Breite = Rumpf innen (oder fest), an den Spanten geteilt.
  function boardParts(X, bd, frs, warn) {
    const api = X.api, c = X.c, th = Math.max(0.3, +c.thick || 0), y = +bd.y || 0, t = Math.max(0.3, +bd.t || 0);
    const xa = Math.max(Math.min(bd.x0, bd.x1), api.x0 + 0.5), xb = Math.min(Math.max(bd.x0, bd.x1), api.x1 - 0.5);
    if (!(xb - xa > 3)) { warn.push(bd.name + ': ' + T('zu kurz')); return []; }
    const hw = x => { const H = X.hf(x); let w = Math.min(halfWidth(H, y), halfWidth(H, y + t)) - sheetMax(X, x); if (+bd.w > 0) w = Math.min(w, bd.w / 2); return w; };
    // Spanten, die das Brett kreuzen (X in Brett-Höhe) -> Lücken
    let iv = [[xa, xb]];
    if (bd.split) for (const f of frs) {
      const xf = f.g.X(P(0, f.g.toPart(y + t / 2)));
      if (xf <= xa || xf >= xb) continue;
      const g0 = xf - th / 2 / Math.max(0.3, f.g.cs), g1 = xf + th / 2 / Math.max(0.3, f.g.cs);
      iv = [].concat(...iv.map(([a, b]) => b <= g0 || a >= g1 ? [[a, b]] : [[a, g0], [g1, b]].filter(q => q[1] - q[0] > 1e-6)));
    }
    const out = [], nS = Math.max(0, Math.round(+bd.n || 0)), sl = Math.max(1, +bd.sl || 0), sb = Math.max(1, +bd.sb || 0), gp = Math.max(0, +bd.gap || 0);
    const tot = nS * sb + Math.max(0, nS - 1) * gp, sx = +bd.sx || (xa + xb) / 2;
    let servoDone = nS === 0;
    iv.forEach(([a, b], k) => {
      if (b - a < 3) return;
      const n = Math.max(2, Math.ceil((b - a) / 2)), R = [], Lf = []; let bad = false;
      for (let q = 0; q <= n; q++) { const x = a + (b - a) * q / n, w = hw(x); if (!(w > 0.5)) { bad = true; break; } R.push(P(x, w)); Lf.push(P(x, -w)); }
      if (bad) { warn.push(bd.name + ': ' + T('passt bei X') + ' ' + r1(a) + '…' + r1(b) + ' ' + T('nicht in den Rumpf')); return; }
      const holes = [];
      if (!servoDone && sx - sl / 2 >= a + 1 && sx + sl / 2 <= b - 1) {
        let wmin = Infinity; for (let q = 0; q <= 8; q++) wmin = Math.min(wmin, hw(sx - sl / 2 + sl * q / 8));
        if (tot / 2 < wmin - 1) { for (let s = 0; s < nS; s++) { const z0 = -tot / 2 + s * (sb + gp); holes.push([P(sx - sl / 2, z0), P(sx + sl / 2, z0), P(sx + sl / 2, z0 + sb), P(sx - sl / 2, z0 + sb)]); } servoDone = true; }
      }
      out.push({ name: bd.name + (iv.length > 1 ? ' ' + String.fromCharCode(65 + k) : ''), kind: 'brett', x: (a + b) / 2, rings: [dedupe(R.concat(Lf.reverse()), 1e-4)], holes, marks: [], thick: t });
    });
    if (!servoDone) warn.push(bd.name + ': ' + T('Servoausschnitt passt nicht (Lage/Größe oder Spant im Weg)'));
    return out;
  }

  function parts() {
    const api = srcApi();
    if (!api) return null;
    const c = cfg(), FR = api.formers();
    const X = { api, c, hf: c.src === 'all' && c.from !== 'stl' ? api.fullHalf : api.bodyHalf };
    const res = { parts: [], formers: [], fl: [], skipped: [], warn: [], ed: {}, panels: [], spars: c.spars.filter(s => s.on).map(s => ({ name: s.name, b: s.b, h: s.h, pts: [] })), api };
    const H = hatchOf(X); res.hatch = H; if (H && H.err) res.warn.push(H.err);
    const hatch = H && !H.err ? H : null;
    // gemeinsame Hellinggrundlinie
    let yLow = Infinity, yHigh = -Infinity;
    FR.forEach(f => { if (c.skip.indexOf(f.i) >= 0) return; const b = api.box(f.x); yLow = Math.min(yLow, b.bot); yHigh = Math.max(yHigh, b.top); });
    const jig = c.jig.on, top = c.jig.mode === 'top', yBase = top ? yHigh + Math.max(0, +c.jig.base || 0) : yLow - Math.max(0, +c.jig.base || 0);
    res.yBase = yBase;
    const rim = Math.max(1, +c.light.rim || 0), built = [];
    for (const f of FR) {
      const skip = c.skip.indexOf(f.i) >= 0, g = skip ? null : frGeo(X, f), half = g && g.half;
      if (!g || !half || half.length < 2) { res.fl.push({ i: f.i, a: P(f.x, api.box(f.x).top), b: P(f.x, api.box(f.x).bot), skip: true }); continue; }
      let loop = loopOf(half);
      if (loop.length < 3 || Math.abs(area(loop)) < 1) { res.fl.push({ i: f.i, a: P(f.x, api.box(f.x).top), b: P(f.x, api.box(f.x).bot), skip: true }); continue; }
      loop = resample(loop, 240);
      const sd = sheetArr(X, f.x, loop);
      if (sd.some(d => d)) loop = offset(loop, sd);
      if (loop.length < 3 || Math.abs(area(loop)) < 1) continue;
      const loopS = loop.slice(), bS = bbox([loopS]);
      const E = { cx: (bS.minx + bS.maxx) / 2, cy: (bS.miny + bS.maxy) / 2, hw: Math.max(1, bS.w / 2), hh: Math.max(1, bS.h / 2), x: f.x, g };
      const name = 'S' + (f.i + 1);
      // Gurte/Leisten
      let cx = 0, cy = 0; for (const p of loop) { cx += p.x; cy += p.y; } cx /= loop.length; cy /= loop.length;
      let maxH = 0;
      for (const [si, s] of c.spars.filter(s => s.on).entries()) {
        const angs = (Math.abs(s.ang) < 0.5 || Math.abs(s.ang - 180) < 0.5) ? [s.ang] : [s.ang, -s.ang];
        for (const a of angs) {
          const rad = a * RAD, hit = rayHit(loop, P(cx, cy), P(Math.sin(rad), Math.cos(rad)));
          if (!hit) { res.skipped.push(name + ' ' + s.name); continue; }
          // zu kleiner Spant (Nase/Heck): Aussparung würde die Kontur zerschneiden -> weglassen
          const nb = notch(loop, hit.s, Math.max(0.5, +s.b || 0), Math.max(0.5, +s.h || 0));
          if (nb.length < 3 || selfX(nb) || Math.abs(area(nb)) < 0.5 * Math.abs(area(loop))) { res.skipped.push(name + ' ' + s.name); continue; }
          loop = nb;
          if (a === s.ang) res.spars[si].pts.push([g.X(hit.p), hit.p.x, g.Y(hit.p)]);
        }
        maxH = Math.max(maxH, +s.h || 0);
      }
      // Ausnehmungen: frei gezeichnet (ersetzen die Leichterung) oder automatisch
      const own = c.cuts.filter(k => k.nodes && k.nodes.length > 2 && (k.fr === f.i || k.fr === -1));
      let holes = [], auto = null;
      if (c.light.on || own.length) {
        const inner = offset(resample(loopS, 240), -(rim + maxH));
        if (inner.length > 3 && Math.abs(area(inner)) > 4 * rim * rim) auto = inner;
      }
      if (own.length) {
        for (const k of own) for (const L of cutPolys(k, E)) {
          if (L.length < 3 || selfX(L) || !L.every(p => inPoly(p, loop))) { res.skipped.push(name + ' ' + T('Ausnehmung')); continue; }
          holes.push(L);
        }
      } else if (c.light.on && auto) holes = [auto];
      // Servobretter: Lage als Markierung auf dem Spant
      const marks = [];
      for (const bd of c.boards) {
        if (!bd.on || f.x < Math.min(bd.x0, bd.x1) || f.x > Math.max(bd.x0, bd.x1)) continue;
        for (const yy of [+bd.y || 0, (+bd.y || 0) + Math.max(0.3, +bd.t || 0)]) { const ch = chordAt(loop, g.toPart(yy)); if (ch) marks.push(ch); }
      }
      // Helling
      let mark = null, tenon = 0;
      if (jig) {
        // Fuß höchstens 80 % der Spantbreite (schmale Spanten an Nase/Heck), Zapfen halb so breit wie der Fuß
        let wmax = 0; for (const p of loop) wmax = Math.max(wmax, Math.abs(p.x));
        const fw = Math.min(Math.max(4, +c.jig.footW || 0), 1.6 * wmax), tH = Math.max(0, +c.jig.boardT || 0) / Math.max(0.3, g.cs), pb = g.toPart(yBase);
        let r;
        if (top) { const flip = L => L.map(p => P(p.x, -p.y)).reverse(); r = addFoot(flip(loop), fw, -pb, tH); r.L = flip(r.L); if (r.mark) r.mark = r.mark.map(p => P(p.x, -p.y)); }
        else r = addFoot(loop, fw, pb, tH);
        if (r.mark) { loop = r.L; mark = r.mark; tenon = fw / 2; } else res.skipped.push(name + ' ' + T('Hellingfuß'));
      }
      if (mark) marks.push(mark);
      // Haubenausschnitt: Trennlinie für den Zeichenmodus
      let hl = null;
      if (hatch) { const yc2 = hatch.ycut(f.x); if (yc2 != null) hl = chordAt(loop, g.toPart(yc2)); }
      Object.assign(E, { L: loop, holes, auto, marks, hl });
      res.ed[f.i] = E;
      // Teile: Teilung × Haubenausschnitt
      const wide = (() => { let b = half[0]; for (const q of half) if (q[1] > b[1]) b = q; return b[0]; })();
      let pieces = [{ suf: '', fns: [], hfns: [] }];
      const cross = (opts) => { const o = []; pieces.forEach(p => opts.forEach(q => o.push({ suf: p.suf + q.suf, fns: p.fns.concat(q.fn ? [q.fn] : []), hfns: p.hfns.concat(q.hf ? [q.hf] : []), top: p.top || q.top }))); pieces = o; };
      if (c.split === 'lr') cross([{ suf: ' R', fn: p => p.x, hf: p => p.x - rim / 2 }, { suf: ' L', fn: p => -p.x, hf: p => -p.x - rim / 2 }]);
      else if (c.split === 'tb') cross([{ suf: ' O', fn: p => p.y - wide, hf: p => p.y - wide - rim / 2 }, { suf: ' U', fn: p => wide - p.y, hf: p => wide - p.y - rim / 2 }]);
      if (hatch) {
        const lo = p => { const yc2 = hatch.ycut(g.X(p)); return yc2 == null ? 1e3 : yc2 - g.Y(p); };
        let cuts = false; for (const p of loop) if (lo(p) < 0) { cuts = true; break; }
        if (cuts) cross([{ suf: '', fn: lo, hf: p => lo(p) - rim }].concat(c.hatch.top ? [{ suf: ' H', fn: p => -lo(p), hf: p => -lo(p) - rim, top: true }] : []));
      }
      for (const pc of pieces) {
        let o = loop; for (const fn of pc.fns) o = clipHalf(o, fn);
        if (o.length < 3 || Math.abs(area(o)) < 1) continue;
        const hs = holes.map(hh => { let q = hh; for (const fn of pc.hfns) q = clipHalf(q, fn); return q; }).filter(hh => hh.length > 2 && Math.abs(area(hh)) > 1);
        const mk2 = marks.map(m => pc.fns.length ? m.filter(p => pc.fns.every(fn => fn(p) >= -1e-6)) : m).filter(m => m.length > 1);
        res.parts.push({ name: name + pc.suf, kind: pc.top ? 'haube' : 'spant', x: f.x, rings: [o], holes: hs, marks: mk2 });
      }
      // Seitenansicht: Spantlinie (bei schrägen Spanten geneigt)
      let pyT = -Infinity, pyB = Infinity; for (const p of loop) { pyT = Math.max(pyT, p.y); pyB = Math.min(pyB, p.y); }
      res.fl.push({ i: f.i, a: P(g.X(P(0, pyT)), g.Y(P(0, pyT))), b: P(g.X(P(0, pyB)), g.Y(P(0, pyB))), tilt: g.phi });
      const xb = g.X(P(0, g.toPart(yBase)));
      res.formers.push({ i: f.i, x: f.x, xb, slot: Math.max(0.5, +c.thick || 0) / Math.max(0.3, g.cs), tenon });
      built.push({ f, g });
    }
    // Hellingbrett (X/Z): Schlitze = Zapfen der Spantfüße
    if (jig && res.formers.length) {
      const fw = Math.max(4, +c.jig.footW || 0), fs = res.formers.filter(f => f.tenon > 0), xs = res.formers.map(f => f.xb);
      const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 30, W2 = fw;
      const ring = [P(x0, -W2), P(x1, -W2), P(x1, W2), P(x0, W2)];
      const holes = (+c.jig.boardT > 0) ? fs.map(f => { const q = f.tenon / 2; return [P(f.xb - f.slot / 2, -q), P(f.xb + f.slot / 2, -q), P(f.xb + f.slot / 2, q), P(f.xb - f.slot / 2, q)]; }) : [];
      const marks = (+c.jig.boardT > 0) ? [] : fs.map(f => [P(f.xb, -W2), P(f.xb, W2)]);
      res.parts.push({ name: T('Hellingbrett'), kind: 'helling', rings: [ring], holes, marks });
    }
    // Kabinenrahmen
    if (hatch && c.hatch.frame) { const fp = framePart(X, hatch); if (fp) res.parts.push(Object.assign({ name: T('Kabinenrahmen'), kind: 'rahmen', marks: [] }, fp)); else res.warn.push(T('Kabinenrahmen: keine Fläche (Haubenlinie außerhalb des Rumpfs?)')); }
    // Servobretter
    for (const bd of c.boards) if (bd.on) boardParts(X, bd, built, res.warn).forEach(p => res.parts.push(p));
    // Beplankungsfelder + Abwicklung (je Feld 2 Stück, gespiegelt)
    const frXs = built.filter(b => Math.abs(b.g.phi) < 1e-6).map(b => b.f.x);
    c.panels.forEach((pn, k) => {
      if (!pn.on) return;
      const d = develop(X, pn, frXs);
      if (!d) { res.warn.push((pn.name || ('#' + (k + 1))) + ': ' + T('keine Abwicklung (Bereich prüfen)')); return; }
      res.panels.push({ k, band: d.band, dist: d.dist, name: pn.name });
      if (pn.dev !== false) res.parts.push({ name: T('Bepl.') + ' ' + (pn.name || ('#' + (k + 1))), kind: 'bepl', qty: 2, rings: [d.ring], holes: [], marks: d.marks, thick: +pn.t || 0, dist: d.dist, dmm: d.dmm });
    });
    // Gurtlängen (Polylinie durch die Aussparungen)
    for (const s of res.spars) { s.pts.sort((a, b) => a[0] - b[0]); let L = 0; for (let k = 1; k < s.pts.length; k++) { const a = s.pts[k - 1], b = s.pts[k]; L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); } s.len = L; }
    return res;
  }
  // Regal-Anordnung auf Plattenbreite sheetW.
  function layout(list) {
    const c = cfg(), W = Math.max(50, +c.sheetW || 600), gap = Math.max(0, +c.gap || 0), lab = c.label.on ? (+c.label.h || 5) + 3 : 0;
    const items = list.map(p => ({ p, bb: bbox(p.rings.concat(p.holes)) })).sort((a, b) => b.bb.h - a.bb.h);
    let x = 0, y = 0, rowH = 0;
    for (const it of items) {
      if (x > 0 && x + it.bb.w > W) { x = 0; y -= rowH + gap + lab; rowH = 0; }
      it.p.ox = x - it.bb.minx; it.p.oy = y - it.bb.maxy; it.p.bb = it.bb;
      x += it.bb.w + gap; rowH = Math.max(rowH, it.bb.h);
    }
    return { W, H: -y + rowH + lab };
  }
  const place = (p, L) => L.map(q => P(q.x + p.ox, q.y + p.oy));
  function build() {
    try {
      const api = srcApi(), key = api ? JSON.stringify(cfg()) : '';
      if (api && cache && cacheKey && cacheKey.m === (api.model || api) && cacheKey.s === key) return cache;
      const r = parts(); if (r) r.lay = layout(r.parts); cache = r; cacheKey = api ? { m: api.model || api, s: key } : null;
    } catch (e) { console.error(e); cache = { err: e.message }; cacheKey = null; }
    return cache;
  }

  // ---------- Ausgabe ------------------------------------------------------------------------------
  const LAYER = { spant: 'SPANT', haube: 'HAUBENSPANT', helling: 'HELLING', bepl: 'BEPLANKUNG', rahmen: 'KABINENRAHMEN', brett: 'SERVOBRETT' };
  const partLabel = p => p.name + (p.qty > 1 ? '  ' + p.qty + '×' : '') + (p.x != null && p.kind !== 'brett' ? '  X' + r1(p.x) : '');
  function dxf(r) {
    const c = cfg(), L = ['0', 'SECTION', '2', 'ENTITIES'];
    const pl = (lay, pts, closed) => { L.push('0', 'LWPOLYLINE', '8', lay, '90', String(pts.length), '70', closed ? '1' : '0'); for (const q of pts) L.push('10', q.x.toFixed(4), '20', q.y.toFixed(4)); };
    for (const p of r.parts) {
      const lay = LAYER[p.kind] || 'SPANT';
      p.rings.forEach(R => pl(lay, place(p, R), true)); p.holes.forEach(R => pl(lay === 'SPANT' || lay === 'HAUBENSPANT' ? 'LEICHTERUNG' : lay, place(p, R), true));
      p.marks.forEach(R => pl('MARKIERUNG', place(p, R), false));
      if (c.label.on) L.push('0', 'TEXT', '8', 'BESCHRIFTUNG', '10', (p.bb.minx + p.ox).toFixed(3), '20', (p.bb.miny + p.oy - (+c.label.h || 5) - 2).toFixed(3), '40', String(+c.label.h || 5), '1', partLabel(p));
    }
    L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\n');
  }
  function base() { return ((state.projectName || 'rumpf').replace(/[^\w\-]+/g, '_')) || 'rumpf'; }
  function save(name, data, mime, which) { if (typeof App.download === 'function') App.download(name, data, mime, which); else if (App.anchorDownload) App.anchorDownload(name, data, mime); }
  function exportDxf() { const r = build(); if (!r || !r.parts || !r.parts.length) { alert(T('Keine Teile.')); return; } save(base() + '_rumpf_spanten.dxf', dxf(r), 'application/dxf', 'svDxf'); }
  function exportCsv() {
    const r = build(); if (!r || !r.parts) return;
    const c = cfg(), rows = [[T('Teil'), T('Anzahl'), T('Lage X (mm)'), T('Breite (mm)'), T('Höhe (mm)'), T('Fläche (cm²)'), T('Stärke (mm)'), T('Werkstoff')].join(';')];
    for (const p of r.parts) {
      const a = p.rings.reduce((s, R) => s + Math.abs(area(R)), 0) - p.holes.reduce((s, R) => s + Math.abs(area(R)), 0);
      const th = p.kind === 'bepl' || p.kind === 'brett' ? p.thick : c.thick, mat = p.kind === 'bepl' ? c.sheetMat : c.mat;
      rows.push([p.name, p.qty || 1, p.x != null ? r1(p.x) : '', r1(p.bb.w), r1(p.bb.h), (a / 100).toFixed(1), th, mat].join(';').replace(/\./g, ','));
    }
    rows.push('');
    rows.push([T('Gurt/Leiste'), T('Querschnitt (mm)'), T('Länge ca. (mm)')].join(';'));
    for (const s of r.spars) rows.push([s.name, s.b + ' x ' + s.h, Math.round(s.len)].join(';'));
    save(base() + '_rumpf_stueckliste.csv', '﻿' + rows.join('\r\n'), 'text/csv', 'svCsv');
  }
  function toCad() {
    if (!App.cadEnsureLayer || !App.cadAddEntity) { (App.toast || alert)(T('CAD-Bearbeitung nicht verfügbar.')); return; }
    const r = build(); if (!r || !r.parts || !r.parts.length) { (App.cadFlash || App.toast || alert)(T('Keine Teile.')); return; }
    if (App.cadClearAsk && !App.cadClearAsk()) return;
    if (App.cadPushUndo) App.cadPushUndo();
    const c = state.cad, cf = cfg();
    c.layers = {}; c.order = []; c.texts = []; c.layerColors = {}; c.layerHidden = {}; c.lineStyles = {};
    const mk = (pts, closed) => { const a = pts.map(p => ({ x: p.x, y: p.y })); a.closed = !!closed; return a; };
    const LAY = { spant: 'Spanten', haube: 'Haubenspanten', helling: 'Helling', bepl: 'Beplankung', rahmen: 'Kabinenrahmen', brett: 'Servobretter' };
    const HEX = { Spanten: '#4aa3ff', Haubenspanten: '#6fd6e0', Leichterung: '#57d38c', Helling: '#b58cf0', Beplankung: '#f5c35c', Kabinenrahmen: '#ff7aa8', Servobretter: '#f5a35c' };
    for (const p of r.parts) {
      const lay = LAY[p.kind] || 'Spanten';
      App.cadEnsureLayer(lay); c.layerColors[lay] = HEX[lay];
      p.rings.forEach(R => App.cadAddEntity(lay, mk(place(p, R), true)));
      if (p.holes.length) { const hl = lay === 'Spanten' || lay === 'Haubenspanten' ? 'Leichterung' : lay; App.cadEnsureLayer(hl); c.layerColors[hl] = HEX[hl]; p.holes.forEach(R => App.cadAddEntity(hl, mk(place(p, R), true))); }
      if (p.marks.length) { App.cadEnsureLayer('Markierung'); c.lineStyles.Markierung = 'dashed'; p.marks.forEach(R => App.cadAddEntity('Markierung', mk(place(p, R), false))); }
      if (cf.label.on) c.texts.push({ x: p.bb.minx + p.ox, y: p.bb.miny + p.oy - (+cf.label.h || 5) - 2, h: +cf.label.h || 5, text: partLabel(p), rot: 0, layer: 'Beschriftung' });
    }
    if (cf.label.on) App.cadEnsureLayer('Beschriftung');
    c.edit.active = c.order[0] || null; c.edit.sel = []; c.edit.draft = null; state.cad.view = null;
    if (App.nav && App.nav.cad) { App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0; }
    App.buildSidebar(); if (App.renderCad) App.renderCad();
    (App.cadFlash || App.toast || (() => {}))(T('Rumpf Spanten geladen: ') + r.parts.length + ' ' + T('Teile.'));
  }

  // ---------- Darstellung --------------------------------------------------------------------------
  // Zeichenmodus für Ausnehmungen: fr = gewählter Spant-Index, cut = Index in cfg().cuts, sel = Knoten
  const ed = { on: false, fr: null, cut: -1, sel: -1, drag: false, justDragged: false, V: null, VP: null, PL: null };
  const nav = key => (App.nav[key] || (App.nav[key] = { z: 1, ox: 0, oy: 0 }));
  const COL = { spant: '#4aa3ff', haube: '#6fd6e0', helling: '#b58cf0', bepl: '#f5c35c', rahmen: '#ff7aa8', brett: '#f5a35c' };
  function renderPlan(r) {
    const cv = document.getElementById('cRprobPlan'); if (!cv || !App.fitCanvas) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    if (!r || !r.api) return;
    const api = r.api, N = 160, top = [], bot = [];
    for (let k = 0; k <= N; k++) { const x = api.x0 + (api.x1 - api.x0) * k / N, b = api.box(x); top.push(P(x, b.top)); bot.push(P(x, b.bot)); }
    const pts = top.concat(bot); if (cfg().jig.on) pts.push(P(api.x0, r.yBase), P(api.x1, r.yBase));
    const V = App.makeView(w, h, App.bounds(pts), 40, nav('rprobplan')); ed.VP = V;
    if (App.grid) App.grid(ctx, w, h, V);
    const c = cfg();
    // Beplankungsfelder
    r.panels.forEach(pn => { ctx.fillStyle = 'rgba(245,195,92,.16)'; ctx.strokeStyle = 'rgba(245,195,92,.55)'; ctx.lineWidth = 1; App.poly(ctx, V, pn.band, true); ctx.fill(); ctx.stroke(); });
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1.8; App.poly(ctx, V, top, false); ctx.stroke(); App.poly(ctx, V, bot, false); ctx.stroke();
    // Haubenlinie
    if (r.hatch && r.hatch.N) { ctx.strokeStyle = '#ff7aa8'; ctx.lineWidth = 2; ctx.setLineDash([7, 4]); App.poly(ctx, V, r.hatch.N, false); ctx.stroke(); ctx.setLineDash([]); }
    // Servobretter
    c.boards.forEach(bd => { if (!bd.on) return; const y = +bd.y || 0, t = Math.max(0.3, +bd.t || 0); ctx.fillStyle = 'rgba(245,163,92,.35)'; ctx.strokeStyle = '#f5a35c'; ctx.lineWidth = 1.2; App.poly(ctx, V, [P(bd.x0, y), P(bd.x1, y), P(bd.x1, y + t), P(bd.x0, y + t)], true); ctx.fill(); ctx.stroke(); });
    ctx.font = '10px system-ui';
    const PL = [];
    for (const fl of r.fl) {
      const sel = ed.fr === fl.i;
      let a = fl.a, b = fl.b;
      if (!fl.skip && c.jig.on) { const ext = (p, q, y) => { const t = (y - p.y) / ((q.y - p.y) || 1e-9); return P(p.x + (q.x - p.x) * t, y); }; if (c.jig.mode === 'top') a = ext(b, a, r.yBase); else b = ext(a, b, r.yBase); }
      ctx.strokeStyle = fl.skip ? 'rgba(160,170,180,.35)' : sel ? '#6fe8ff' : 'rgba(255,200,120,.9)'; ctx.lineWidth = fl.skip ? 1 : sel ? 3 : 2; ctx.setLineDash(fl.skip ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(V.X(a.x), V.Y(a.y)); ctx.lineTo(V.X(b.x), V.Y(b.y)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = fl.skip ? '#789' : sel ? '#6fe8ff' : '#ffd08a'; ctx.fillText('S' + (fl.i + 1) + (fl.tilt ? ' ' + Math.round(fl.tilt / RAD) + '°' : ''), V.X(a.x) - 6, V.Y(a.y) - 5);
      PL.push({ i: fl.i, a, b });
    }
    ed.PL = PL;
    const SC = ['#57d38c', '#f5a35c', '#b58cf0', '#ff7aa8', '#6fd6e0'];
    r.spars.forEach((s, k) => { if (s.pts.length < 2) return; ctx.strokeStyle = SC[k % SC.length]; ctx.lineWidth = 1.4; App.poly(ctx, V, s.pts.map(q => P(q[0], q[2])), false); ctx.stroke(); });
    if (c.jig.on) { ctx.strokeStyle = '#b58cf0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(V.X(api.x0 - 20), V.Y(r.yBase)); ctx.lineTo(V.X(api.x1 + 20), V.Y(r.yBase)); ctx.stroke(); }
  }
  function cutsOf(i) { return cfg().cuts.map((k, j) => ({ k, j })).filter(o => o.k.fr === i || o.k.fr === -1); }
  function renderEditor(r, ctx, w, h, info) {
    const E = r.ed && r.ed[ed.fr];
    if (!E) { if (info) info.textContent = T('Gewählter Spant wird nicht gebaut (abgewählt oder zu klein).'); return; }
    const bE = bbox([E.L]); bE.maxy += 0.45 * bE.h;   // Platz für den Hinweis oben
    const V = App.makeView(w, h, bE, 50, nav('rprobed')); ed.V = V;
    if (App.grid) App.grid(ctx, w, h, V);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#4aa3ff'; ctx.fillStyle = 'rgba(74,163,255,.10)'; App.poly(ctx, V, E.L, true); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,120,.8)'; ctx.setLineDash([4, 3]); E.marks.forEach(R => { App.poly(ctx, V, R, false); ctx.stroke(); }); ctx.setLineDash([]);
    if (E.hl) { ctx.strokeStyle = '#ff7aa8'; ctx.lineWidth = 1.5; ctx.setLineDash([7, 4]); App.poly(ctx, V, E.hl, false); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
    ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.moveTo(V.X(0), V.Y(E.cy - E.hh * 1.2)); ctx.lineTo(V.X(0), V.Y(E.cy + E.hh * 1.2)); ctx.stroke();
    const list = cutsOf(ed.fr);
    if (!list.length && E.auto && cfg().light.on) { ctx.strokeStyle = 'rgba(87,211,140,.5)'; ctx.setLineDash([5, 4]); App.poly(ctx, V, E.auto, true); ctx.stroke(); ctx.setLineDash([]); }
    for (const { k, j } of list) {
      const act = j === ed.cut, pts = k.nodes.map(nd => toMM(nd, E));
      if (pts.length >= 2) {
        const closed = pts.length >= 3, L = cutCurve(pts, k.nodes, closed);
        const ok = !closed || (!selfX(L) && L.every(p => inPoly(p, E.L)));
        ctx.lineWidth = act ? 2 : 1.4; ctx.strokeStyle = !ok ? '#ff6b6b' : act ? '#ffe066' : '#57d38c';
        App.poly(ctx, V, L, closed); ctx.stroke();
        if (k.mir && closed) { ctx.setLineDash([5, 4]); App.poly(ctx, V, L.map(p => P(-p.x, p.y)), true); ctx.stroke(); ctx.setLineDash([]); }
      }
      if (!act) continue;
      pts.forEach((p, q) => {
        const X = V.X(p.x), Y = V.Y(p.y), s = q === ed.sel ? 5 : 4;
        ctx.fillStyle = q === ed.sel ? '#ffe066' : '#1b2430'; ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5; ctx.beginPath();
        if (k.nodes[q].k) ctx.rect(X - s, Y - s, 2 * s, 2 * s); else ctx.arc(X, Y, s, 0, 2 * Math.PI);
        ctx.fill(); ctx.stroke();
      });
    }
    if (info) info.innerHTML = '<b>' + T('Ausnehmung zeichnen') + ' — S' + (ed.fr + 1) + '</b><br>' + T('Klick = Punkt anhängen (nahe an der Linie = einfügen) · Punkt ziehen = verschieben · Rechtsklick auf Punkt = Ecke ↔ glatt · Rechtsklick auf Linie = gerade ↔ Spline · Entf = Punkt löschen · Esc = fertig')
      + '<br><span style="opacity:.7">' + T('Gelb = in Arbeit, grün = gültig, rot = ragt aus dem Spant oder überschneidet sich · Rad = Zoom, Ziehen = schieben') + '</span>';
  }
  function render(fast) {
    const r = fast && cache && !cache.err ? cache : build(); renderPlan(r);
    const cv = document.getElementById('cRprob'), info = document.getElementById('rprobInfo'); if (!cv || !App.fitCanvas) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    if (!r) { if (info) info.textContent = cfg().from === 'stl' ? T('Kein STL-Modell geladen.') : T('Kein Rumpf — erst im Reiter „Rumpf" einen Rumpf anlegen.'); return; }
    if (r.err) { if (info) info.textContent = T('Fehler beim Aufbau: ') + r.err; return; }
    if (ed.on && ed.fr != null) { renderEditor(r, ctx, w, h, info); return; }
    if (!r.parts.length) { if (info) info.textContent = T('Keine Teile.'); return; }
    const all = []; r.parts.forEach(p => p.rings.concat(p.holes).forEach(R => all.push(place(p, R))));
    const V = App.makeView(w, h, App.bounds([].concat.apply([], all)), 40, nav('rprob'));
    if (App.grid) App.grid(ctx, w, h, V);
    const c = cfg();
    ctx.strokeStyle = '#3a4657'; ctx.setLineDash([6, 5]); App.poly(ctx, V, [P(0, 0), P(r.lay.W, 0), P(r.lay.W, -r.lay.H), P(0, -r.lay.H)], true); ctx.stroke(); ctx.setLineDash([]);
    for (const p of r.parts) {
      const col = COL[p.kind] || COL.spant;
      ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.fillStyle = App.hexA ? App.hexA(col, 0.1) : 'rgba(74,163,255,.10)';
      p.rings.forEach(R => { App.poly(ctx, V, place(p, R), true); ctx.fill(); ctx.stroke(); });
      ctx.strokeStyle = p.kind === 'spant' || p.kind === 'haube' ? '#57d38c' : col; p.holes.forEach(R => { App.poly(ctx, V, place(p, R), true); ctx.stroke(); });
      ctx.strokeStyle = 'rgba(255,200,120,.8)'; ctx.setLineDash([4, 3]); p.marks.forEach(R => { App.poly(ctx, V, place(p, R), false); ctx.stroke(); }); ctx.setLineDash([]);
      if (c.label.on) { ctx.fillStyle = '#c9d6e3'; ctx.font = '11px system-ui'; ctx.fillText(partLabel(p), V.X(p.bb.minx + p.ox), V.Y(p.bb.miny + p.oy) + 13); }
    }
    if (info) {
      const nS = r.parts.filter(p => p.kind === 'spant' || p.kind === 'haube').length, nB = r.parts.filter(p => p.kind === 'bepl');
      info.innerHTML = nS + ' ' + T('Spantteile') + (c.jig.on ? ' + ' + T('Hellingbrett') : '') + ' · ' + T('Stärke') + ' ' + c.thick + ' mm · ' + T('Beplankung') + ' ' + (c.sheetMode === 'panels' ? T('nur Felder') : c.sheet + ' mm')
        + (r.spars.length ? '<br>' + r.spars.map(s => s.name + ' ' + s.b + '×' + s.h + ' ≈ ' + Math.round(s.len) + ' mm').join(' · ') : '')
        + (nB.length ? '<br>' + T('Abwicklung') + ': ' + nB.map(p => p.name + ' ' + T('Verzerrung') + ' Ø ' + (p.dist * 100).toFixed(1) + ' %, max ' + p.dmm.toFixed(1) + ' mm').join(' · ') : '')
        + (r.skipped.length ? '<br><span style="color:#fb8">' + T('ausgelassen (Spant zu klein):') + ' ' + r.skipped.join(', ') + '</span>' : '')
        + (r.warn.length ? '<br><span style="color:#fb8">' + r.warn.join(' · ') + '</span>' : '')
        + '<br><span style="opacity:.7">' + T('Grün = Leichterung, gestrichelt = Abtrennlinie der Hellingfüße / Lage der Servobretter / Spanten auf der Beplankung · Rad = Zoom, Ziehen = schieben') + '</span>';
    }
  }

  // ---------- Maus: Spant in der Seitenansicht wählen, Ausnehmung zeichnen ----------------------------
  function selectFormer(i) { ed.fr = i; const l = cutsOf(i); ed.cut = l.length ? l[0].j : -1; ed.sel = -1; App.buildSidebar(); render(); }
  function startEdit(on) { ed.on = on && ed.fr != null; ed.sel = -1; App.buildSidebar(); render(); }
  function curE() { return cache && cache.ed && cache.ed[ed.fr]; }
  function hitNode(px, py) {
    const E = curE(), V = ed.V; if (!E || !V) return null;
    const list = cutsOf(ed.fr); let best = null;
    for (const { k, j } of list) k.nodes.forEach((nd, q) => { const p = toMM(nd, E), d = Math.hypot(V.X(p.x) - px, V.Y(p.y) - py); if (d < 8 && (!best || d < best.d || (j === ed.cut && best.j !== ed.cut))) best = { j, q, d }; });
    return best;
  }
  function hitSeg(px, py) {
    const E = curE(), V = ed.V, k = cfg().cuts[ed.cut]; if (!E || !V || !k || k.nodes.length < 2) return null;
    const pts = k.nodes.map(nd => toMM(nd, E)); let best = null;
    cutSegs(pts, k.nodes, pts.length >= 3).forEach((pc, i) => {
      for (let s = 0; s + 1 < pc.length; s++) {
        const A = P(V.X(pc[s].x), V.Y(pc[s].y)), B = P(V.X(pc[s + 1].x), V.Y(pc[s + 1].y)), dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? clamp(((px - A.x) * dx + (py - A.y) * dy) / l2, 0, 1) : 0, d = Math.hypot(A.x + dx * t - px, A.y + dy * t - py);
        if (d < 7 && (!best || d < best.d)) best = { i, d };
      }
    });
    return best;
  }
  function wireMouse() {
    const cv = document.getElementById('cRprob'), pv = document.getElementById('cRprobPlan');
    const pos = (e, el) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('mousedown', e => {
      if (!ed.on || e.button !== 0) return;
      const m = pos(e, cv), hn = hitNode(m.x, m.y); if (!hn) return;
      if (e.shiftKey || e.altKey) { const k = cfg().cuts[hn.j]; k.nodes.splice(hn.q, 1); ed.cut = hn.j; ed.sel = -1; ed.justDragged = true; e.stopImmediatePropagation(); e.preventDefault(); App.buildSidebar(); render(); return; }
      ed.cut = hn.j; ed.sel = hn.q; ed.drag = true; e.stopImmediatePropagation(); e.preventDefault(); render(true);
    });
    window.addEventListener('mousemove', e => {
      if (!ed.drag) return;
      const E = curE(), k = cfg().cuts[ed.cut]; if (!E || !k || !k.nodes[ed.sel]) return;
      const m = pos(e, cv), p = ed.V.inv(m.x, m.y); Object.assign(k.nodes[ed.sel], fromMM(p, E)); ed.justDragged = true; render(true);
    });
    window.addEventListener('mouseup', () => { if (ed.drag) { ed.drag = false; render(); } });
    cv.addEventListener('click', e => {
      if (!ed.on) return;
      if (ed.justDragged) { ed.justDragged = false; return; }
      if (nav('rprobed').moved) return;
      const E = curE(); if (!E || !ed.V) return;
      const c = cfg(), m = pos(e, cv), p = fromMM(ed.V.inv(m.x, m.y), E);
      let k = c.cuts[ed.cut];
      if (!k || (k.fr !== ed.fr && k.fr !== -1)) { k = { fr: ed.fr, mir: false, nodes: [] }; c.cuts.push(k); ed.cut = c.cuts.length - 1; App.buildSidebar(); }
      const hs = hitSeg(m.x, m.y);
      const nd = { u: p.u, v: p.v, l: false, k: false };
      if (hs) { if (k.nodes[hs.i]) nd.l = !!k.nodes[hs.i].l; k.nodes.splice(hs.i + 1, 0, nd); ed.sel = hs.i + 1; }
      else { const at = ed.sel >= 0 && ed.sel < k.nodes.length ? ed.sel + 1 : k.nodes.length; k.nodes.splice(at, 0, nd); ed.sel = at; }
      App.buildSidebar(); render();
    });
    cv.addEventListener('contextmenu', e => {
      if (!ed.on) return; e.preventDefault();
      const m = pos(e, cv), hn = hitNode(m.x, m.y), c = cfg();
      if (hn) { const nd = c.cuts[hn.j].nodes[hn.q]; nd.k = !nd.k; ed.cut = hn.j; ed.sel = hn.q; render(); return; }
      const hs = hitSeg(m.x, m.y); if (hs) { const nd = c.cuts[ed.cut].nodes[hs.i]; nd.l = !nd.l; render(); }
    });
    window.addEventListener('keydown', e => {
      if (!ed.on || state.activeTab !== 'rprob') return;
      const tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
      if (e.key === 'Escape') { startEdit(false); e.preventDefault(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const k = cfg().cuts[ed.cut]; if (!k || ed.sel < 0 || !k.nodes[ed.sel]) return;
        k.nodes.splice(ed.sel, 1); ed.sel = Math.min(ed.sel, k.nodes.length - 1); e.preventDefault(); App.buildSidebar(); render();
      }
    });
    // Seitenansicht: Klick auf eine Spantlinie wählt den Spant
    pv.addEventListener('click', e => {
      if (nav('rprobplan').moved || !ed.VP || !ed.PL) return;
      const m = pos(e, pv), V = ed.VP; let best = null;
      for (const s of ed.PL) {
        const A = P(V.X(s.a.x), V.Y(s.a.y)), B = P(V.X(s.b.x), V.Y(s.b.y)), dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? clamp(((m.x - A.x) * dx + (m.y - A.y) * dy) / l2, 0, 1) : 0, d = Math.hypot(A.x + dx * t - m.x, A.y + dy * t - m.y);
        if (d < 10 && (!best || d < best.d)) best = { i: s.i, d };
      }
      if (best) selectFormer(best.i);
    });
  }
  let wired = false;
  function show() {
    if (!wired && App.setupNav) { wired = true; wireMouse(); App.setupNav('cRprob', () => ed.on ? 'rprobed' : 'rprob', () => render(true)); App.setupNav('cRprobPlan', 'rprobplan', () => render(true)); }
    render();
  }

  // ---------- Seitenleiste ---------------------------------------------------------------------
  function rprobSidebar(side) {
    const { grp, hint, boolRow, selectRow, mkMini, subhead, buildSidebar } = App, numRow = App.numRowEnter || App.numRow;   // Zahlen erst bei Enter/Verlassen/Pfeil (Setter bauen die Leiste neu)
    const c = cfg(), RD = () => render(), RB = () => { buildSidebar(); render(); };
    const txt = (body, label, get, set) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = T(label); const i = document.createElement('input'); i.type = 'text'; i.value = get(); i.onchange = () => { const v = i.value; setTimeout(() => set(v), 0); }; r.appendChild(l); r.appendChild(i); body.appendChild(r); };
    const bar = body => { const b = document.createElement('div'); b.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px'; body.appendChild(b); return b; };
    const g0 = grp('Rumpf Spanten', true, 'rprob', { key: 'rprobMain' });
    hint(g0.body, 'Bausatz in Spantbauweise aus dem Rumpf (wie die Rippenfläche für Tragflächen): Spantkonturen mit Beplankungsabzug, Aussparungen für Gurte/Leisten, Leichterung, Teilung und Helling. Form und Lage der Spanten werden im Reiter „Rumpf" festgelegt.');
    if (window.StlBody) {
      selectRow(g0.body, 'Rumpf aus', [['rpro', 'Reiter „Rumpf"'], ['stl', 'eigenes STL-Modell']], () => c.from || 'rpro', v => { c.from = v; c.skip = []; RB(); });
      if (c.from === 'stl') StlBody.rows(g0.body, () => { const a = srcApi(), n = a ? a.formers().length : 0; c.skip = c.skip.filter(i => i < n); render(); }, { formers: true });
    }
    if (!hasModel()) { hint(g0.body, c.from === 'stl' ? 'Kein STL-Modell geladen.' : 'Kein Rumpf vorhanden.'); side.appendChild(g0.g); return; }
    const api = srcApi(), FR = api.formers(), xL = api.x0, xR = api.x1;
    if (c.from !== 'stl') selectRow(g0.body, 'Kontur', [['body', 'nur Rumpf'], ['all', 'mit Anbauten (Tragflächenübergang, Leitwerk)']], () => c.src, v => { c.src = v; RD(); });
    numRow(g0.body, 'Spantdicke (mm)', () => c.thick, v => { c.thick = Math.max(0.3, v); RD(); }, { step: 0.5, min: 0.3, norender: true });
    txt(g0.body, 'Werkstoff (Stückliste)', () => c.mat, v => { c.mat = v; });
    subhead(g0.body, 'Spanten bauen');
    const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px 8px;font-size:11px';
    FR.forEach(f => {
      const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:3px;align-items:center';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = c.skip.indexOf(f.i) < 0;
      cb.onchange = () => { const k = c.skip.indexOf(f.i); if (cb.checked && k >= 0) c.skip.splice(k, 1); if (!cb.checked && k < 0) c.skip.push(f.i); RD(); };
      l.title = 'X ' + r1(f.x) + ' mm'; l.appendChild(cb); l.appendChild(document.createTextNode('S' + (f.i + 1))); row.appendChild(l);
    });
    g0.body.appendChild(row);
    side.appendChild(g0.g);

    // --- gewählter Spant: Neigung + frei gezeichnete Ausnehmungen
    const gS = grp('Gewählter Spant (schräg, Ausnehmung)', false, 'rprob', { key: 'rprobSel' });
    hint(gS.body, 'Spant in der Seitenansicht anklicken oder hier wählen. Schräge Spanten (z. B. Motorspant mit Sturz, Kabinen- oder Flächenspant): Neigung um den Drehpunkt, die Kontur ist der wahre Schnitt der geneigten Ebene mit dem Rumpf.');
    if (ed.fr != null && !FR.some(f => f.i === ed.fr)) { ed.fr = null; ed.on = false; }
    selectRow(gS.body, 'Spant', [['', '— wählen —']].concat(FR.map(f => [String(f.i), 'S' + (f.i + 1) + '  (X ' + r1(f.x) + ')'])), () => ed.fr == null ? '' : String(ed.fr), v => { if (v === '') { ed.fr = null; ed.on = false; RB(); } else selectFormer(+v); });
    if (ed.fr != null) {
      const o = c.fr[ed.fr] || (c.fr[ed.fr] = {});
      numRow(gS.body, 'Neigung (°, + = Oberkante nach hinten)', () => +o.tilt || 0, v => { o.tilt = clamp(v, -60, 60); RD(); }, { step: 1, min: -60, max: 60, norender: true });
      selectRow(gS.body, 'Drehpunkt', [['mid', 'Mitte'], ['bot', 'unten (Boden)'], ['top', 'oben (Rücken)']], () => o.piv || 'mid', v => { o.piv = v; RD(); });
      subhead(gS.body, 'Innenausnehmung (frei gezeichnet)');
      hint(gS.body, 'Eigene Ausnehmungen aus Geraden und Splines; sie ersetzen für diesen Spant die automatische Leichterung. „Für alle Spanten" überträgt die Form maßstäblich (bezogen auf Breite/Höhe des Spants) auf jeden Spant.');
      const b0 = bar(gS.body);
      b0.appendChild(mkMini(ed.on ? T('✓ Zeichnen beenden') : T('✎ Zeichnen'), () => startEdit(!ed.on)));
      b0.appendChild(mkMini(T('+ Neue Ausnehmung'), () => { c.cuts.push({ fr: ed.fr, mir: false, nodes: [] }); ed.cut = c.cuts.length - 1; ed.sel = -1; ed.on = true; RB(); }));
      b0.appendChild(mkMini(T('Leichterung als Vorlage'), () => {
        const E = curE(); if (!E || !E.auto) { (App.toast || alert)(T('Keine automatische Leichterung für diesen Spant.')); return; }
        const L = resample(E.auto, 12); c.cuts.push({ fr: ed.fr, mir: false, nodes: L.map(p => Object.assign(fromMM(p, E), { l: false, k: false })) }); ed.cut = c.cuts.length - 1; ed.sel = -1; ed.on = true; RB();
      }));
      cutsOf(ed.fr).forEach(({ k, j }, n) => {
        const d = document.createElement('div'); d.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:11px;margin-top:4px;padding:3px 4px;border-radius:4px' + (j === ed.cut ? ';background:rgba(255,224,102,.12)' : '');
        const lab = document.createElement('span'); lab.textContent = T('Ausnehmung') + ' ' + (n + 1) + ' (' + k.nodes.length + ' ' + T('Punkte') + ')'; d.appendChild(lab);
        const ck = (label, get, set) => { const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:3px;align-items:center'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = get(); cb.onchange = () => { set(cb.checked); RB(); }; l.appendChild(cb); l.appendChild(document.createTextNode(T(label))); d.appendChild(l); };
        ck('spiegeln', () => !!k.mir, v => { k.mir = v; });
        ck('für alle Spanten', () => k.fr === -1, v => { k.fr = v ? -1 : ed.fr; });
        d.appendChild(mkMini(T('bearbeiten'), () => { ed.cut = j; ed.sel = -1; ed.on = true; RB(); }));
        d.appendChild(mkMini(T('entfernen'), () => { c.cuts.splice(j, 1); ed.cut = -1; ed.sel = -1; RB(); }));
        gS.body.appendChild(d);
      });
    }
    side.appendChild(gS.g);

    const g1 = grp('Gurte & Leisten', false, 'rprob', { key: 'rprobSpars' });
    hint(g1.body, 'Rechteckige Aussparungen in allen Spanten. Lage als Winkel um den Spantmittelpunkt (0° = oben, 90° = seitlich, 180° = unten), beidseitig gespiegelt. Breite entlang der Kontur, Tiefe nach innen.');
    c.spars.forEach((s, k) => {
      subhead(g1.body, s.name || ('#' + (k + 1)));
      boolRow(g1.body, 'aktiv', () => !!s.on, v => { s.on = v; RD(); });
      txt(g1.body, 'Name', () => s.name, v => { s.name = v; RB(); });
      numRow(g1.body, 'Lage (° von oben)', () => s.ang, v => { s.ang = clamp(v, 0, 180); RD(); }, { step: 5, min: 0, max: 180, norender: true });
      numRow(g1.body, 'Breite (mm)', () => s.b, v => { s.b = Math.max(0.5, v); RD(); }, { step: 0.5, min: 0.5, norender: true });
      numRow(g1.body, 'Tiefe (mm)', () => s.h, v => { s.h = Math.max(0.5, v); RD(); }, { step: 0.5, min: 0.5, norender: true });
      bar(g1.body).appendChild(mkMini(T('entfernen'), () => { c.spars.splice(k, 1); RB(); }));
    });
    bar(g1.body).appendChild(mkMini(T('+ Gurt/Leiste'), () => { c.spars.push({ name: T('Leiste') + ' ' + (c.spars.length + 1), ang: 90, b: 5, h: 5, on: true }); RB(); }));
    side.appendChild(g1.g);

    // --- Beplankung
    const gB = grp('Beplankung & Abwicklung', false, 'rprob', { key: 'rprobSheet' });
    selectRow(gB.body, 'Beplankung', [['full', 'Vollbeplankung (Spanten überall zurückgesetzt)'], ['panels', 'Teilbeplankung (nur unter den Feldern)']], () => c.sheetMode, v => { c.sheetMode = v; RB(); },
      'Die Spantkontur wird um die Beplankungsdicke nach innen versetzt. Bei Teilbeplankung nur dort, wo ein Beplankungsfeld liegt (z. B. nur Rumpfnase oder nur Seitenwände) — mit Absatz an den Feldrändern.');
    if (c.sheetMode !== 'panels') numRow(gB.body, 'Beplankung (mm)', () => c.sheet, v => { c.sheet = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true, hint: '0 = Spant = Außenkontur.' });
    txt(gB.body, 'Werkstoff Beplankung (Stückliste)', () => c.sheetMat, v => { c.sheetMat = v; });
    hint(gB.body, 'Beplankungsfelder: Bereich in X und als Winkel um den Spantmittelpunkt (0° = Rücken, 90° = Seite, 180° = Kiel, wie bei den Gurten), beidseitig. Die Abwicklung wird von der dicksten Stelle aus aufgefaltet (doppelt gekrümmte Flächen nur näherungsweise — Verzerrung steht unter den Teilen); je Feld 2 Stück (links/rechts gespiegelt), Spantlagen als Markierung.');
    c.panels.forEach((pn, k) => {
      subhead(gB.body, pn.name || ('#' + (k + 1)));
      boolRow(gB.body, 'aktiv', () => !!pn.on, v => { pn.on = v; RD(); });
      txt(gB.body, 'Name', () => pn.name, v => { pn.name = v; RB(); });
      numRow(gB.body, 'X von (mm)', () => pn.x0, v => { pn.x0 = v; RD(); }, { step: 5, norender: true });
      numRow(gB.body, 'X bis (mm)', () => pn.x1, v => { pn.x1 = v; RD(); }, { step: 5, norender: true });
      numRow(gB.body, 'Winkel von (° von oben)', () => pn.a0, v => { pn.a0 = clamp(v, 0, 180); RD(); }, { step: 5, min: 0, max: 180, norender: true });
      numRow(gB.body, 'Winkel bis (° von oben)', () => pn.a1, v => { pn.a1 = clamp(v, 0, 180); RD(); }, { step: 5, min: 0, max: 180, norender: true });
      numRow(gB.body, 'Dicke (mm)', () => pn.t, v => { pn.t = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true });
      numRow(gB.body, 'Zugabe am Rand (mm)', () => pn.margin, v => { pn.margin = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
      boolRow(gB.body, 'Abwicklung als Teil ausgeben', () => pn.dev !== false, v => { pn.dev = v; RD(); });
      bar(gB.body).appendChild(mkMini(T('entfernen'), () => { c.panels.splice(k, 1); RB(); }));
    });
    const bp = bar(gB.body);
    const addPn = (name, a0, a1) => { c.panels.push({ name: T(name), on: true, x0: r1(xL + 1), x1: r1(xR - 1), a0, a1, t: +c.sheet || 1.5, margin: 3, dev: true }); RB(); };
    bp.appendChild(mkMini(T('+ Feld ganze Seite'), () => addPn('Seite', 0, 180)));
    bp.appendChild(mkMini(T('+ Feld Rücken'), () => addPn('Rücken', 0, 45)));
    bp.appendChild(mkMini(T('+ Feld Seitenwand'), () => addPn('Seitenwand', 45, 135)));
    bp.appendChild(mkMini(T('+ Feld Boden'), () => addPn('Boden', 135, 180)));
    side.appendChild(gB.g);

    // --- Haubenausschnitt & Kabinenrahmen
    const gH = grp('Haubenausschnitt & Kabinenrahmen', false, 'rprob', { key: 'rprobHatch' });
    hint(gH.body, 'Spanten im Bereich der Kabinenhaube werden an der Haubenlinie getrennt: unten bleibt der Rumpfspant (Randsteg zur Leichterung), oben entsteht der Haubenspant (S… H). Der Kabinenrahmen ist die Schnittfläche entlang der Haubenlinie, in wahrer Länge abgewickelt, innen um die Rahmenbreite ausgeschnitten.');
    boolRow(gH.body, 'Haubenausschnitt', () => !!c.hatch.on, v => { c.hatch.on = v; RB(); });
    if (c.hatch.on) {
      const hasCan = !!(api.canopy && api.canopy.line);
      selectRow(gH.body, 'Haubenlinie', [['auto', 'Kabinenhaube aus dem Rumpf'], ['manual', 'Gerade (eigene Werte)']], () => c.hatch.src, v => { c.hatch.src = v; if (v === 'manual') hatchDefaults(api, c.hatch); RB(); });
      if (c.hatch.src !== 'manual' && !hasCan) hint(gH.body, 'Im Rumpf ist keine Kabinenhaube angelegt (Gruppe „Kabinenhaube"). Alternativ „Gerade (eigene Werte)".');
      if (c.hatch.src === 'manual') {
        hatchDefaults(api, c.hatch);
        numRow(gH.body, 'X vorne (mm)', () => c.hatch.x0, v => { c.hatch.x0 = v; RD(); }, { step: 5, norender: true });
        numRow(gH.body, 'Höhe vorne Y (mm)', () => c.hatch.y0, v => { c.hatch.y0 = v; RD(); }, { step: 1, norender: true });
        numRow(gH.body, 'X hinten (mm)', () => c.hatch.x1, v => { c.hatch.x1 = v; RD(); }, { step: 5, norender: true });
        numRow(gH.body, 'Höhe hinten Y (mm)', () => c.hatch.y1, v => { c.hatch.y1 = v; RD(); }, { step: 1, norender: true });
      }
      boolRow(gH.body, 'Haubenspanten als eigene Teile', () => !!c.hatch.top, v => { c.hatch.top = v; RD(); });
      boolRow(gH.body, 'Kabinenrahmen erzeugen', () => !!c.hatch.frame, v => { c.hatch.frame = v; RB(); });
      if (c.hatch.frame) numRow(gH.body, 'Rahmenbreite (mm)', () => c.hatch.frameW, v => { c.hatch.frameW = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true });
    }
    side.appendChild(gH.g);

    // --- Servobretter
    const gV = grp('Servobretter', false, 'rprob', { key: 'rprobBoards' });
    hint(gV.body, 'Waagrechtes Brett im Rumpf (Höhe = Unterseite), Breite bis an die Spantkontur (abzüglich Beplankung) oder fest. „An den Spanten teilen" schneidet Lücken in Spantdicke, das Brett wird zwischen die Spanten geklebt; die Lage steht als Markierung auf den Spanten. Servoausschnitte nebeneinander quer zur Flugrichtung.');
    c.boards.forEach((bd, k) => {
      subhead(gV.body, bd.name || ('#' + (k + 1)));
      boolRow(gV.body, 'aktiv', () => !!bd.on, v => { bd.on = v; RD(); });
      txt(gV.body, 'Name', () => bd.name, v => { bd.name = v; RB(); });
      numRow(gV.body, 'X von (mm)', () => bd.x0, v => { bd.x0 = v; RD(); }, { step: 5, norender: true });
      numRow(gV.body, 'X bis (mm)', () => bd.x1, v => { bd.x1 = v; RD(); }, { step: 5, norender: true });
      numRow(gV.body, 'Höhe Unterseite Y (mm)', () => bd.y, v => { bd.y = v; RD(); }, { step: 1, norender: true });
      numRow(gV.body, 'Dicke (mm)', () => bd.t, v => { bd.t = Math.max(0.3, v); RD(); }, { step: 0.5, min: 0.3, norender: true });
      numRow(gV.body, 'Breite (mm, 0 = ganze Rumpfbreite)', () => bd.w, v => { bd.w = Math.max(0, v); RD(); }, { step: 2, min: 0, norender: true });
      boolRow(gV.body, 'An den Spanten teilen', () => !!bd.split, v => { bd.split = v; RD(); });
      numRow(gV.body, 'Servos nebeneinander', () => bd.n, v => { bd.n = clamp(Math.round(v), 0, 8); RD(); }, { step: 1, min: 0, max: 8, int: true, norender: true });
      if (bd.n > 0) {
        numRow(gV.body, 'Servo-Ausschnitt Länge in X (mm)', () => bd.sl, v => { bd.sl = Math.max(1, v); RD(); }, { step: 0.5, min: 1, norender: true });
        numRow(gV.body, 'Servo-Ausschnitt Breite quer (mm)', () => bd.sb, v => { bd.sb = Math.max(1, v); RD(); }, { step: 0.5, min: 1, norender: true });
        numRow(gV.body, 'Mitte der Ausschnitte X (mm)', () => bd.sx, v => { bd.sx = v; RD(); }, { step: 1, norender: true });
        numRow(gV.body, 'Abstand zwischen den Servos (mm)', () => bd.gap, v => { bd.gap = Math.max(0, v); RD(); }, { step: 0.5, min: 0, norender: true });
      }
      bar(gV.body).appendChild(mkMini(T('entfernen'), () => { c.boards.splice(k, 1); RB(); }));
    });
    bar(gV.body).appendChild(mkMini(T('+ Servobrett'), () => {
      const L = xR - xL, x0 = r1(xL + 0.3 * L), x1 = r1(xL + 0.45 * L), b = api.box((x0 + x1) / 2);
      c.boards.push({ name: T('Servobrett') + ' ' + (c.boards.length + 1), on: true, x0, x1, y: r1((b.top + b.bot) / 2 - 10), t: 3, w: 0, split: true, n: 2, sl: 23, sb: 12.5, sx: r1((x0 + x1) / 2), gap: 4 }); RB();
    }));
    side.appendChild(gV.g);

    const g2 = grp('Leichterung & Teilung', false, 'rprob', { key: 'rprobLight' });
    boolRow(g2.body, 'Leichterung (Innenausschnitt)', () => !!c.light.on, v => { c.light.on = v; RB(); });
    if (c.light.on) numRow(g2.body, 'Randbreite (mm)', () => c.light.rim, v => { c.light.rim = Math.max(1, v); RD(); }, { step: 1, min: 1, norender: true, hint: 'Steg zwischen Außenkontur und Ausschnitt (zusätzlich zur Tiefe der Gurtaussparungen).' });
    selectRow(g2.body, 'Spanten teilen', [['none', 'nicht teilen'], ['lr', 'links / rechts (Halbschalenbau)'], ['tb', 'oben / unten (an der breitesten Stelle)']], () => c.split, v => { c.split = v; RD(); },
      'Wie DevFus „Formers splitting": für Rümpfe, die in zwei Hälften gebaut werden. Die Leichterung lässt an der Trennlinie einen Steg stehen.');
    side.appendChild(g2.g);

    const g3 = grp('Helling (Baulehre)', false, 'rprob', { key: 'rprobJig' });
    hint(g3.body, 'Jeder Spant bekommt einen Fuß bis zu einer gemeinsamen Grundlinie; ein Zapfen steckt im Hellingbrett. Nach dem Verkleben der Gurte/Beplankung werden die Füße an der gestrichelten Linie abgetrennt. „Kopfüber" baut auf dem Rücken (DevFus „Top-Down").');
    boolRow(g3.body, 'Helling erzeugen', () => !!c.jig.on, v => { c.jig.on = v; RB(); });
    if (c.jig.on) {
      selectRow(g3.body, 'Lage', [['bottom', 'aufrecht (Füße unten)'], ['top', 'kopfüber (Füße oben am Rücken)']], () => c.jig.mode, v => { c.jig.mode = v; RD(); });
      numRow(g3.body, 'Abstand Grundlinie zum Rumpf (mm)', () => c.jig.base, v => { c.jig.base = Math.max(0, v); RD(); }, { step: 5, min: 0, norender: true });
      numRow(g3.body, 'Fußbreite (mm)', () => c.jig.footW, v => { c.jig.footW = Math.max(4, v); RD(); }, { step: 2, min: 4, norender: true });
      numRow(g3.body, 'Brettdicke / Zapfenlänge (mm, 0 = ohne Zapfen)', () => c.jig.boardT, v => { c.jig.boardT = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
    }
    side.appendChild(g3.g);

    const g4 = grp('Teile & Ausgabe', true, 'rprob', { key: 'rprobOut' });
    numRow(g4.body, 'Plattenbreite für die Anordnung (mm)', () => c.sheetW, v => { c.sheetW = Math.max(50, v); RD(); }, { step: 10, min: 50, norender: true });
    numRow(g4.body, 'Abstand der Teile (mm)', () => c.gap, v => { c.gap = Math.max(0, v); RD(); }, { step: 1, min: 0, norender: true });
    boolRow(g4.body, 'Beschriftung (S1, S2 …)', () => !!c.label.on, v => { c.label.on = v; RB(); });
    if (c.label.on) numRow(g4.body, 'Schrifthöhe (mm)', () => c.label.h, v => { c.label.h = Math.max(1, v); RD(); }, { step: 0.5, min: 1, norender: true });
    const bb = bar(g4.body);
    bb.appendChild(mkMini(T('DXF speichern…'), exportDxf));
    bb.appendChild(mkMini(T('Stückliste (CSV)…'), exportCsv));
    if (App.cadEnsureLayer) bb.appendChild(mkMini(T('→ In die CAD-Bearbeitung übernehmen'), toCad));
    side.appendChild(g4.g);
  }

  Object.assign(App, { rprobSidebar, rprobToCad: toCad });
  window.RproSpanten = { show, render, build, exportDxf, exportCsv, toCad, _test: { offset, notch, addFoot, clipHalf, deloop, area, parts, layout, rayHit, cutCurve, develop, frGeo, ed } };
})();
