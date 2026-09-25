/* measure2d.js — Messwerkzeug für die 2D-Ansichten
 * Kerndesign: Grundriss (cPlan) und Profile (cProf); Negativschalendesign: Querschnitt (cNeg).
 * Die Zeichenfunktionen in render.js melden je Ansicht ihre Abbildung (makeView: X/Y/inv/s, Welt in mm,
 * gleicher Maßstab in beiden Richtungen) und die gezeichneten Polylinien als Fanggeometrie über
 * App.meas2dView(); App.meas2dOverlay(tab) zeichnet danach die Messungen auf eine eigene, durchsichtige
 * Canvas über der Ansicht. So kostet die Cursor-Vorschau kein Neuzeichnen der Ansicht.
 * Arten: Abstand (waagrechter/senkrechter Anteil + Winkel zur Waagrechten), Kette, Winkel (3 Punkte,
 * Scheitel = 2. Punkt), Radius (Kreis durch 3 Punkte). Fang: Messpunkte und Stützpunkte (8 px) vor
 * Kanten (6 px) der gezeichneten Konturen; Alt = ohne Fang. Ziehen verschiebt wie gewohnt, Rad zoomt.
 * Punkte-Editor und Messen schließen sich aus (beide belegen den Linksklick). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => window.I18N ? window.I18N.t(s) : s;
  // Achsen je Ansicht: Name + Umrechnung Weltkoordinate -> angezeigter Wert (Grundriss: y = −Sehnenlage)
  const PANES = {
    plan: { cv: 'cPlan', tab: 'core', name: 'Grundriss', ax: ['Spannweite', 'Sehne'], cx: q => [q.x, -q.y], an: ['Z', 'X'] },
    prof: { cv: 'cProf', tab: 'core', name: 'Profile', ax: ['waagrecht', 'senkrecht'], cx: q => [q.x, q.y], an: ['X', 'Y'] },
    neg: { cv: 'cNeg', tab: 'neg', name: 'Querschnitt', ax: ['waagrecht', 'senkrecht'], cx: q => [q.x, q.y], an: ['X', 'Y'] }
  };
  const TAB_UI = { core: { btn: 'coreMeas', panel: 'coreMeasPanel' }, neg: { btn: 'negMeas', panel: 'negMeasPanel' } };
  const MODES = [['dist', 'Abstand'], ['chain', 'Kette'], ['angle', 'Winkel'], ['radius', 'Radius']];
  const NEED = { dist: 2, angle: 3, radius: 3 };   // Kette: offen, Abschluss per Rechtsklick/Enter
  const COL = '#7CFC9A', COL_CUR = '#ffd27a';
  const M = { on: { core: false, neg: false }, mode: 'dist', snap: true, axes: true, list: { plan: [], prof: [], neg: [] }, cur: null, hover: null, views: {}, down: null };
  const st = () => App.state || {};
  const active = p => !!PANES[p] && M.on[PANES[p].tab] && st().activeTab === PANES[p].tab;
  const f2 = v => v.toFixed(2);
  const modeName = k => T((MODES.find(q => q[0] === k) || ['', k])[1]);

  // ---------- Anbindung an render.js ----------
  // Ansicht meldet Abbildung + Fanggeometrie (Arrays von {x,y}; 4 Punkte = geschlossenes Rechteck).
  function meas2dView(p, V, geom) {
    if (!PANES[p]) return;
    M.views[p] = { V, geom: (geom || []).filter(L => Array.isArray(L) && L.length), fresh: true };
  }
  // Nach dem Zeichnen eines Reiters: Überlagerung neu malen (Ansichten ohne frische Meldung gelten als leer).
  function meas2dOverlay(tab) {
    if (M.on[tab] && st().ptEdit && st().ptEdit.on && st().activeTab === tab) { M.on[tab] = false; M.cur = null; M.hover = null; buildPanel(tab); }   // Punkte-Editor wurde eingeschaltet
    for (const p in PANES) {
      if (PANES[p].tab !== tab) continue;
      const vw = M.views[p]; if (vw && !vw.fresh) M.views[p] = null; else if (vw) vw.fresh = false;
      paint(p);
    }
    syncBtn(tab);
  }

  // ---------- Geometrie ----------
  function circle2(A, B, C) {
    const bx = B.x - A.x, by = B.y - A.y, cx = C.x - A.x, cy = C.y - A.y, d = 2 * (bx * cy - by * cx);
    const lb = Math.hypot(bx, by), lc = Math.hypot(cx, cy);
    if (lb < 1e-9 || lc < 1e-9 || Math.abs(d) < 2e-6 * lb * lc) return null;
    const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy, ux = (cy * b2 - by * c2) / d, uy = (bx * c2 - cx * b2) / d;
    return { x: A.x + ux, y: A.y + uy, r: Math.hypot(ux, uy) };
  }
  // Messwert: { v, main, sub } oder null (zu wenige / kollineare Punkte).
  function calc(m) {
    const P = m.pts, pn = PANES[m.pane];
    if (m.type === 'dist' && P.length >= 2) {
      const a = pn.cx(P[0]), b = pn.cx(P[1]), dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]), L = Math.hypot(dx, dy);
      return { v: L, main: f2(L) + ' mm', sub: T(pn.ax[0]) + ' ' + f2(dx) + ' · ' + T(pn.ax[1]) + ' ' + f2(dy) + ' mm · ∠ ' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2) + '° ' + T('zur Waagrechten') };
    }
    if (m.type === 'chain' && P.length >= 2) {
      let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
      return { v: L, main: 'Σ ' + f2(L) + ' mm', sub: (P.length - 1) + ' ' + T('Strecken') };
    }
    if (m.type === 'angle' && P.length >= 3) {
      const ax = P[0].x - P[1].x, ay = P[0].y - P[1].y, bx = P[2].x - P[1].x, by = P[2].y - P[1].y, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 1e-9 || lb < 1e-9) return null;
      const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180 / Math.PI;
      return { v: ang, main: ang.toFixed(2) + '°', sub: T('Ergänzung') + ' ' + (180 - ang).toFixed(2) + '° · ' + T('Schenkel') + ' ' + f2(la) + ' / ' + f2(lb) + ' mm' };
    }
    if (m.type === 'radius' && P.length >= 3) {
      const c = circle2(P[0], P[1], P[2]); if (!c) return null;
      const cc = pn.cx(c);
      return { v: c.r, main: 'R ' + f2(c.r) + ' mm', sub: 'Ø ' + f2(2 * c.r) + ' mm · ' + T('Mitte') + ' ' + pn.an[0] + ' ' + f2(cc[0]) + ' ' + pn.an[1] + ' ' + f2(cc[1]) };
    }
    return null;
  }
  // Punkt unter (x, y) px mit Fang: { x, y, snap: ''|'m'|'v'|'e' } in Weltkoordinaten.
  function hit(p, x, y, free) {
    const vw = M.views[p]; if (!vw) return null;
    const V = vw.V; let q = V.inv(x, y), snap = '';
    if (!free && M.snap) {
      let bd = 8;
      const own = M.list[p].concat(M.cur && M.cur.pane === p ? [M.cur] : []);
      // nächster Punkt gewinnt (Messpunkte zuerst geprüft -> bei Gleichstand bevorzugt)
      for (const m of own) for (const a of m.pts) { const d = Math.hypot(V.X(a.x) - x, V.Y(a.y) - y); if (d < bd) { bd = d; q = { x: a.x, y: a.y }; snap = 'm'; } }
      for (const L of vw.geom) for (const a of L) { const d = Math.hypot(V.X(a.x) - x, V.Y(a.y) - y); if (d < bd) { bd = d; q = { x: a.x, y: a.y }; snap = 'v'; } }
      if (!snap) {
        let be = 6;
        for (const L of vw.geom) {
          const n = L.length, ne = n === 4 ? 4 : n - 1;
          for (let i = 0; i < ne; i++) {
            const a = L[i], b = L[(i + 1) % n], ax = V.X(a.x), ay = V.Y(a.y), dx = V.X(b.x) - ax, dy = V.Y(b.y) - ay, l2 = dx * dx + dy * dy;
            if (l2 < 1e-9) continue;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
            if (d < be) { be = d; q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; snap = 'e'; }
          }
        }
      }
    }
    return { x: q.x, y: q.y, snap };
  }

  // ---------- Zeichnen (eigene Canvas über der Ansicht) ----------
  function overlayCanvas(cv) {
    let oc = cv._measOv;
    if (!oc) {
      oc = document.createElement('canvas'); oc.className = 'meas2d-ov';
      oc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      cv.parentNode.insertBefore(oc, cv.nextSibling); cv._measOv = oc;
    }
    return oc;
  }
  function tag(ctx, W, H, x, y, txt, colr) {
    ctx.font = 'bold 12px system-ui';
    const w = ctx.measureText(txt).width + 10, h = 18;
    const bx = Math.min(Math.max(4, x + 8), W - w - 4), by = Math.min(Math.max(4, y - h - 6), H - h - 4);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, h, 4) : ctx.rect(bx, by, w, h);
    ctx.fillStyle = 'rgba(15,18,22,.85)'; ctx.fill();
    ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = colr; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 5, by + h / 2 + 0.5);
  }
  function drawOne(ctx, W, H, V, m, k, colr, preview) {
    const S = m.pts.map(q => ({ x: V.X(q.x), y: V.Y(q.y) })), r = calc(m);
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    ctx.strokeStyle = colr; ctx.lineWidth = 1.6; ctx.setLineDash(preview ? [5, 4] : []);
    let at = S[S.length - 1];
    if (m.type === 'dist' || m.type === 'chain') {
      for (let i = 1; i < S.length; i++) line(S[i - 1], S[i]);
      if (m.type === 'dist' && S.length === 2) {
        at = { x: (S[0].x + S[1].x) / 2, y: (S[0].y + S[1].y) / 2 };
        // waagrechter + senkrechter Anteil als dünner Winkelzug
        if (M.axes && Math.abs(S[1].x - S[0].x) > 2 && Math.abs(S[1].y - S[0].y) > 2) {
          ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.7; ctx.strokeStyle = '#8fb3d9';
          const c = { x: S[1].x, y: S[0].y }; line(S[0], c); line(c, S[1]); ctx.restore(); ctx.strokeStyle = colr;
        }
      }
    } else if (m.type === 'angle') {
      if (S.length >= 2) line(S[0], S[1]);
      if (S.length >= 3) {
        line(S[1], S[2]);
        const a1 = Math.atan2(S[0].y - S[1].y, S[0].x - S[1].x), a2 = Math.atan2(S[2].y - S[1].y, S[2].x - S[1].x);
        let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        const rr = Math.max(12, Math.min(60, 0.3 * Math.min(Math.hypot(S[0].x - S[1].x, S[0].y - S[1].y), Math.hypot(S[2].x - S[1].x, S[2].y - S[1].y))));
        ctx.setLineDash([]); ctx.beginPath(); ctx.arc(S[1].x, S[1].y, rr, a1, a1 + d, d < 0); ctx.stroke(); ctx.setLineDash(preview ? [5, 4] : []);
        at = { x: S[1].x + rr * Math.cos(a1 + d / 2), y: S[1].y + rr * Math.sin(a1 + d / 2) };
      }
    } else if (m.type === 'radius') {
      ctx.save(); ctx.lineWidth = 1; ctx.globalAlpha = 0.6; for (let i = 1; i < S.length; i++) line(S[i - 1], S[i]); ctx.restore();
      const c = m.pts.length >= 3 ? circle2(m.pts[0], m.pts[1], m.pts[2]) : null;
      if (c) {
        const ce = { x: V.X(c.x), y: V.Y(c.y) };
        ctx.beginPath(); ctx.arc(ce.x, ce.y, c.r * V.s, 0, Math.PI * 2); ctx.stroke();
        ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([4, 3]); line(ce, S[1]); ctx.restore();
        ctx.beginPath(); ctx.moveTo(ce.x - 5, ce.y); ctx.lineTo(ce.x + 5, ce.y); ctx.moveTo(ce.x, ce.y - 5); ctx.lineTo(ce.x, ce.y + 5); ctx.stroke();
        at = ce;
      }
    }
    ctx.setLineDash([]);
    for (const e of S) { ctx.beginPath(); ctx.arc(e.x, e.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = colr; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke(); }
    if (r && at) tag(ctx, W, H, at.x, at.y, (k ? k + ': ' : '') + r.main, colr);
  }
  function paint(p) {
    const cv = document.getElementById(PANES[p].cv); if (!cv) return;
    if (!active(p) && !cv._measOv) return;
    const oc = overlayCanvas(cv), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    const pw = Math.max(1, Math.round(W * dpr)), ph = Math.max(1, Math.round(H * dpr));
    if (oc.width !== pw || oc.height !== ph) { oc.width = pw; oc.height = ph; }
    const ctx = oc.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const vw = M.views[p];
    if (!active(p) || !vw) return;
    const V = vw.V;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    M.list[p].forEach((m, i) => drawOne(ctx, W, H, V, m, i + 1, COL, false));
    const h = M.hover && M.hover.pane === p ? M.hover : null;
    if (M.cur && M.cur.pane === p) drawOne(ctx, W, H, V, h ? { pane: p, type: M.cur.type, pts: M.cur.pts.concat([{ x: h.x, y: h.y }]) } : M.cur, 0, COL_CUR, true);
    if (h) {
      // Cursor-Marke: Kreis + Kreuz frei, Quadrat = Stützpunkt, Dreieck = Kante, Raute = Messpunkt
      const x = V.X(h.x), y = V.Y(h.y);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
      if (h.snap === 'v') ctx.rect(x - 5, y - 5, 10, 10);
      else if (h.snap === 'e') { ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y + 5); ctx.lineTo(x - 6, y + 5); ctx.closePath(); }
      else if (h.snap === 'm') { ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); }
      else { ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.moveTo(x - 10, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 10); }
      ctx.stroke();
    }
    ctx.restore();
  }
  const paintTab = tab => { for (const p in PANES) if (PANES[p].tab === tab) paint(p); };

  // ---------- Bedienung ----------
  function finish() { const m = M.cur; M.cur = null; if (m && calc(m)) M.list[m.pane].push(m); }
  function onClick(p, x, y, right, free) {
    const tab = PANES[p].tab;
    if (right) {
      if (M.cur && M.cur.type === 'chain' && M.cur.pts.length >= 2) finish();
      else if (M.cur) { M.cur.pts.pop(); if (!M.cur.pts.length) M.cur = null; }
      else M.list[p].pop();
      refresh(tab); return;
    }
    const q = hit(p, x, y, free); if (!q) return;
    if (!M.cur || M.cur.pane !== p || M.cur.type !== M.mode) M.cur = { pane: p, type: M.mode, pts: [] };
    const last = M.cur.pts[M.cur.pts.length - 1];
    if (last && Math.hypot(last.x - q.x, last.y - q.y) < 1e-9) return;   // derselbe Punkt (z. B. Doppelklick)
    M.cur.pts.push({ x: q.x, y: q.y });
    const need = NEED[M.cur.type];
    if (need && M.cur.pts.length >= need) {
      if (!calc(M.cur)) { M.cur.pts.pop(); if (App.toast) App.toast(T('Die drei Punkte liegen auf einer Geraden – anderen Punkt wählen.')); }
      else finish();
    }
    refresh(tab);
  }
  function refresh(tab) { buildPanel(tab); paintTab(tab); }
  function toggle(tab) {
    const s = st();
    M.on[tab] = !M.on[tab]; M.cur = null; M.hover = null;
    const ptOff = M.on[tab] && s.ptEdit && s.ptEdit.on;
    if (ptOff) { s.ptEdit.on = false; s.ptEdit.drag = null; if (App.buildSidebar) App.buildSidebar(); }   // Punkte-Editor aus (belegt ebenfalls den Linksklick)
    refresh(tab); syncBtn(tab);
    if (ptOff) { if (tab === 'neg') { if (App.renderNeg) App.renderNeg(); } else if (App.render) App.render(); }
  }
  function syncBtn(tab) {
    const b = document.getElementById(TAB_UI[tab].btn); if (!b) return;
    const on = M.on[tab];
    b.style.background = on ? 'var(--accent,#3b82f6)' : ''; b.style.color = on ? '#fff' : ''; b.style.borderColor = on ? 'transparent' : '';
  }
  // Statuszeile (ohne Neuaufbau des Felds): nächster Schritt + Koordinaten unter dem Cursor.
  function live(tab) {
    const el = document.getElementById(TAB_UI[tab].panel + 'Live'); if (!el) return;
    const n = M.cur ? M.cur.pts.length : 0, md = M.mode;
    const step = md === 'chain' ? T('Punkt') + ' ' + (n + 1) + (n >= 2 ? ' · ' + T('Rechtsklick oder Enter beendet die Kette') : '')
      : md === 'angle' ? [T('1. Schenkelpunkt'), T('Scheitelpunkt'), T('2. Schenkelpunkt')][n] || ''
      : T('Punkt') + ' ' + (n + 1) + ' / ' + NEED[md] + (md === 'radius' ? ' ' + T('auf dem Bogen') : '');
    const h = M.hover && PANES[M.hover.pane] && PANES[M.hover.pane].tab === tab ? M.hover : null;
    let cur = '';
    if (h) {
      const pn = PANES[h.pane], c = pn.cx(h);
      cur = (tab === 'core' ? T(pn.name) + ': ' : '') + pn.an[0] + ' ' + f2(c[0]) + ' · ' + pn.an[1] + ' ' + f2(c[1]);
      if (h.snap) cur += ' · ' + T(h.snap === 'v' ? 'Fang: Stützpunkt' : h.snap === 'e' ? 'Fang: Kontur' : 'Fang: Messpunkt');
    }
    el.innerHTML = '<span style="color:' + COL_CUR + '">' + step + '</span>' + (cur ? '<br><span style="opacity:.85">' + cur + '</span>' : '');
  }
  function listOf(tab) { const out = []; for (const p in PANES) if (PANES[p].tab === tab) M.list[p].forEach((m, i) => out.push({ p, i, m })); return out; }
  function buildPanel(tab) {
    const el = document.getElementById(TAB_UI[tab].panel); if (!el) return;
    el.innerHTML = '';
    if (!M.on[tab]) { el.style.display = 'none'; return; }
    el.style.display = '';
    const row = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;flex-wrap:wrap'; el.appendChild(d); return d; };
    const btn = (r, t, on, fn, title) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = T(t); b.className = on ? 'primary' : ''; b.style.cssText = 'flex:1 1 auto;padding:2px 6px;font-size:11px;min-width:0;width:auto'; if (title) b.title = T(title); b.onclick = fn; r.appendChild(b); return b; };
    const ck = (r, t, on, fn, title) => { const l = document.createElement('label'); l.className = 'ck'; l.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap'; if (title) l.title = T(title); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = on; i.style.width = 'auto'; i.onchange = () => fn(i.checked); l.appendChild(i); l.appendChild(document.createTextNode(T(t))); r.appendChild(l); return l; };
    let r = row(); const h = document.createElement('b'); h.textContent = '📏 ' + T('Messen'); h.style.flex = '1'; r.appendChild(h);
    btn(r, 'aus', false, () => toggle(tab)).style.flex = '0 0 auto';
    r = row();
    const tips = { dist: 'Abstand zwischen zwei Punkten mit waagrechtem/senkrechtem Anteil und Winkel zur Waagrechten', chain: 'Kette: Summe mehrerer Strecken, Rechtsklick oder Enter beendet', angle: 'Winkel aus drei Punkten, der zweite Punkt ist der Scheitel', radius: 'Radius des Kreises durch drei Punkte (z. B. Nasenradius, Übergang)' };
    for (const [k, t] of MODES) btn(r, t, M.mode === k, () => { M.mode = k; M.cur = null; refresh(tab); }, tips[k]);
    r = row();
    ck(r, 'Fang', M.snap, v => { M.snap = v; }, 'Fang auf Stützpunkte, Konturkanten und vorhandene Messpunkte (Alt gedrückt = ohne Fang)');
    ck(r, 'Achsanteile zeigen', M.axes, v => { M.axes = v; paintTab(tab); }, 'Beim Abstand den waagrechten und senkrechten Anteil als Winkelzug einzeichnen');
    const lv = document.createElement('div'); lv.id = TAB_UI[tab].panel + 'Live'; lv.style.cssText = 'display:block;margin:4px 0;line-height:1.35'; el.appendChild(lv);
    const L = listOf(tab);
    if (L.length) {
      const lst = document.createElement('div'); lst.style.cssText = 'display:block;max-height:200px;overflow:auto;margin:4px 0;border-top:1px solid var(--line,#556);padding-top:4px';
      for (const { p, i, m } of L) {
        const res = calc(m); if (!res) continue;
        const it = document.createElement('div'); it.style.cssText = 'display:flex;align-items:flex-start;gap:6px;margin:3px 0';
        const tx = document.createElement('div'); tx.style.cssText = 'display:block;flex:1;min-width:0;line-height:1.3';
        tx.innerHTML = '<b style="color:' + COL + '">' + (tab === 'core' ? T(PANES[p].name) + ' ' : '') + (i + 1) + ': ' + res.main + '</b> <span style="opacity:.7">' + modeName(m.type) + '</span><br><span style="opacity:.75;font-size:10px">' + res.sub + '</span>';
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.title = T('Messung löschen'); x.style.cssText = 'flex:0 0 auto;padding:0 6px;font-size:11px;min-width:0;width:auto';
        x.onclick = () => { M.list[p].splice(i, 1); refresh(tab); };
        it.appendChild(tx); it.appendChild(x); lst.appendChild(it);
      }
      el.appendChild(lst);
      r = row();
      btn(r, '📋 Kopieren', false, () => {
        const t = listOf(tab).map(({ p, i, m }) => { const q = calc(m); return q ? T(PANES[p].name) + '\t' + (i + 1) + '\t' + modeName(m.type) + '\t' + q.main + '\t' + q.sub : ''; }).filter(Boolean).join('\n');
        if (!t) return;
        const ok = () => App.toast && App.toast(T('Messwerte in die Zwischenablage kopiert'));
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, () => {}); else ok();
      }, 'Alle Messwerte als Text (tabulatorgetrennt) in die Zwischenablage');
      btn(r, 'Alle löschen', false, () => { for (const p in PANES) if (PANES[p].tab === tab) M.list[p] = []; M.cur = null; refresh(tab); });
    }
    const hn = document.createElement('div'); hn.style.cssText = 'display:block;opacity:.6;font-size:10px;line-height:1.35;margin-top:4px';
    hn.textContent = T('Klick = Punkt setzen · Alt = ohne Fang · Rechtsklick = letzten Punkt bzw. letzte Messung zurücknehmen · Esc = abbrechen · Ziehen = schieben · Rad = Zoom');
    el.appendChild(hn);
    live(tab);
  }
  function wireUp() {
    for (const p in PANES) {
      const cv = document.getElementById(PANES[p].cv); if (!cv || cv._measWired) continue;
      cv._measWired = true;
      const pane = cv.parentNode, tab = PANES[p].tab;
      const loc = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      const still = e => { const d = M.down; M.down = null; return !!d && d.p === p && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 3; };
      // Capture am Paneel: läuft VOR den Canvas-Handlern (Segmentwahl per Klick im Grundriss, Zoom-Reset per Doppelklick).
      pane.addEventListener('mousedown', e => {
        if (e.target !== cv) return;
        M.down = active(p) ? { p, x: e.clientX, y: e.clientY } : null;
        if (M.down && M.hover) { M.hover = null; paint(p); }
      }, true);
      pane.addEventListener('click', e => {
        if (e.target !== cv || !active(p)) return;
        e.stopPropagation();
        if (!still(e)) return;
        const q = loc(e); onClick(p, q.x, q.y, false, e.altKey);
      }, true);
      pane.addEventListener('contextmenu', e => {
        if (e.target !== cv || !active(p)) return;
        e.preventDefault(); e.stopPropagation();
        if (!still(e)) return;
        const q = loc(e); onClick(p, q.x, q.y, true, e.altKey);
      }, true);
      pane.addEventListener('dblclick', e => { if (e.target === cv && active(p)) e.stopPropagation(); }, true);
      cv.addEventListener('mousemove', e => {
        if (!active(p)) return;
        cv.style.cursor = 'crosshair';
        if (e.buttons) { if (M.hover) { M.hover = null; live(tab); } return; }   // beim Verschieben keine Cursor-Marke
        const q = loc(e), h = hit(p, q.x, q.y, e.altKey);
        M.hover = h ? Object.assign({ pane: p }, h) : null;
        paint(p); live(tab);
      });
      cv.addEventListener('mouseleave', () => { if (M.hover && M.hover.pane === p) { M.hover = null; paint(p); live(tab); } if (active(p)) cv.style.cursor = 'grab'; });
    }
    for (const tab in TAB_UI) { const b = document.getElementById(TAB_UI[tab].btn); if (b && !b._measWired) { b._measWired = true; b.addEventListener('click', () => toggle(tab)); } }
    window.addEventListener('keydown', e => {
      const tab = st().activeTab; if (!TAB_UI[tab] || !M.on[tab]) return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === 'Escape') { if (M.cur) M.cur = null; else { M.on[tab] = false; M.hover = null; syncBtn(tab); } refresh(tab); e.preventDefault(); }
      else if (e.key === 'Enter' && M.cur && M.cur.type === 'chain') { finish(); refresh(tab); e.preventDefault(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUp); else wireUp();

  Object.assign(App, { meas2dView, meas2dOverlay });
  App.meas2dTest = { M, calc, hit, circle2, onClick, toggle };   // Test-Hook
})();
