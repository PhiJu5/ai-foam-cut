// earcut.js — Polygon-Triangulierung mit Löchern (kompakte earcut-Portierung).
// Kern-Datei (immer enthalten): genutzt von ribs.js und model3d.js.
(function () {
  const App = (window.App = window.App || {});
  function ecNode(i, x, y) { return { i, x, y, prev: null, next: null, steiner: false }; }
  function ecInsert(i, x, y, last) { const p = ecNode(i, x, y); if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; } return p; }
  function ecRemove(p) { p.next.prev = p.prev; p.prev.next = p.next; }
  function ecEquals(a, b) { return a.x === b.x && a.y === b.y; }
  function ecArea(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function ecSignedArea(d, s, e) { let sum = 0; for (let i = s, j = e - 2; i < e; i += 2) { sum += (d[j] - d[i]) * (d[i + 1] + d[j + 1]); j = i; } return sum; }
  function ecList(d, start, end, clockwise) {
    let last;
    if (clockwise === (ecSignedArea(d, start, end) > 0)) { for (let i = start; i < end; i += 2) last = ecInsert(i / 2, d[i], d[i + 1], last); }
    else { for (let i = end - 2; i >= start; i -= 2) last = ecInsert(i / 2, d[i], d[i + 1], last); }
    if (last && ecEquals(last, last.next)) { ecRemove(last); last = last.next; }
    return last;
  }
  function ecPtInTri(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
           (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
           (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
  }
  function ecIsEar(ear) {
    const a = ear.prev, b = ear, c = ear.next;
    if (ecArea(a, b, c) >= 0) return false;
    let p = ear.next.next;
    while (p !== ear.prev) { if (ecPtInTri(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && ecArea(p.prev, p, p.next) >= 0) return false; p = p.next; }
    return true;
  }
  function ecFilter(start, end) {
    if (!start) return start; if (!end) end = start;
    let p = start, again;
    do { again = false; if (!p.steiner && (ecEquals(p, p.next) || ecArea(p.prev, p, p.next) === 0)) { ecRemove(p); p = end = p.prev; if (p === p.next) break; again = true; } else p = p.next; } while (again || p !== end);
    return end;
  }
  function ecLinked(ear, tris) {
    if (!ear) return;
    let stop = ear, next;
    let guard = 0, maxG = 1e6;
    while (ear.prev !== ear.next && guard++ < maxG) {
      next = ear.next;
      if (ecIsEar(ear)) { tris.push(ear.prev.i, ear.i, next.i); ecRemove(ear); ear = next.next; stop = next.next; continue; }
      ear = next;
      if (ear === stop) break;
    }
  }
  function ecLeftmost(start) { let p = start, lm = start; do { if (p.x < lm.x || (p.x === lm.x && p.y < lm.y)) lm = p; p = p.next; } while (p !== start); return lm; }
  function ecLocallyInside(a, b) { return ecArea(a.prev, a, a.next) < 0 ? ecArea(a, b, a.next) >= 0 && ecArea(a, a.prev, b) >= 0 : ecArea(a, b, a.prev) < 0 || ecArea(a, a.next, b) < 0; }
  function ecBridge(hole, outer) {
    let p = outer; const hx = hole.x, hy = hole.y; let qx = -Infinity, m;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        const x = p.x + (hy - p.y) / (p.next.y - p.y) * (p.next.x - p.x);
        if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
      }
      p = p.next;
    } while (p !== outer);
    if (!m) return null;
    const stop = m, mx = m.x, my = m.y; let tanMin = Infinity, tan; p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x && ecPtInTri(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        tan = Math.abs(hy - p.y) / (hx - p.x);
        if (ecLocallyInside(p, hole) && (tan < tanMin || (tan === tanMin && p.x > m.x))) { m = p; tanMin = tan; }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function ecSplit(a, b) {
    const a2 = ecNode(a.i, a.x, a.y), b2 = ecNode(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp; return b2;
  }
  function ecEliminate(d, holeIdx, outer) {
    const queue = [];
    for (let i = 0; i < holeIdx.length; i++) {
      const start = holeIdx[i] * 2, end = i < holeIdx.length - 1 ? holeIdx[i + 1] * 2 : d.length;
      const list = ecList(d, start, end, false);
      if (list === list.next) list.steiner = true;
      queue.push(ecLeftmost(list));
    }
    queue.sort((a, b) => a.x - b.x);
    for (let i = 0; i < queue.length; i++) {
      const bridge = ecBridge(queue[i], outer);
      if (!bridge) continue;
      const br = ecSplit(bridge, queue[i]);
      ecFilter(br, br.next);
      outer = ecFilter(bridge, bridge.next);
    }
    return outer;
  }
  // rings: [outer, hole1, ...] jeweils [{x,y},...]. Rückgabe: {V:[[x,y]...], tris:[[i,j,k]...]}.
  function triangulate(rings) {
    const d = [], holeIdx = [];
    rings[0].forEach(p => d.push(p.x, p.y));
    for (let i = 1; i < rings.length; i++) { holeIdx.push(d.length / 2); rings[i].forEach(p => d.push(p.x, p.y)); }
    let outer = ecList(d, 0, rings[0].length * 2, true);
    const tris = [];
    if (!outer || outer.next === outer.prev) return { V: [], tris: [] };
    if (holeIdx.length) outer = ecEliminate(d, holeIdx, outer);
    ecLinked(outer, tris);
    const V = []; for (let i = 0; i < d.length; i += 2) V.push([d[i], d[i + 1]]);
    const out = []; for (let i = 0; i < tris.length; i += 3) out.push([tris[i], tris[i + 1], tris[i + 2]]);
    return { V, tris: out };
  }

  App.earcut = triangulate;
})();
