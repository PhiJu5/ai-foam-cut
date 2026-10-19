/* stlpreview.js — 3D-Vorschau vor JEDEM STL-Export.
 *
 *   Zeigt genau das, was in der Datei landet: die fertigen STL-Daten (binär oder
 *   ASCII) werden zurückgelesen und angezeigt — inkl. Exporttransformation
 *   (Z oben, Nullpunkt, Formhälfte gedreht, Segmentierung …). Erst „Speichern“
 *   öffnet den Explorer-Dialog (der Klick liefert die nötige Nutzeraktivierung).
 *
 *   Einhängen:
 *   - Einzeldateien: App.download und App.exportViaPicker werden umhüllt; alles,
 *     was .stl heißt bzw. model/stl ist, läuft erst durch die Vorschau.
 *   - Mehrere Dateien (Ordner-Dialog): Module rufen geschützt
 *     `if (App.stlPreview && !(await App.stlPreview(list))) return;`
 *     list = [{ name, data }] mit data = ArrayBuffer | String | Float32Array (Eckpunkte).
 *   - App.stlSaveMany(list, which): Vorschau + Ordner-Dialog + Download-Rückfall.
 *
 *   Ansicht: Z oben (Druckerkonvention), orthografisch, WebGL2 (Rückfall 2D).
 *   Links ziehen = drehen, rechts/Mitte ziehen = verschieben, Rad = Zoom zum Cursor,
 *   Mausrad-Doppelklick = Drehpunkt, ⌂/Pos1 = Ansicht zurücksetzen.
 *   Rückseiten (falsch orientierte Dreiecke) erscheinen rot; offene Kanten werden gezählt. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => window.I18N ? window.I18N.t(s) : s;

  const COLORS = [[0.62, 0.74, 0.88], [0.95, 0.72, 0.42], [0.55, 0.84, 0.62], [0.82, 0.62, 0.90], [0.92, 0.85, 0.50], [0.50, 0.82, 0.86], [0.92, 0.60, 0.66], [0.72, 0.72, 0.72]];
  const YAW0 = -0.62, PITCH0 = 0.52;
  const isStl = (name, mime) => /\.stl$/i.test(name || '') || mime === 'model/stl';

  // ---------- STL lesen ---------------------------------------------------------------------------
  function toVerts(data) {
    if (data instanceof Float32Array) return data;
    if (Array.isArray(data)) return new Float32Array(data);
    if (typeof data === 'string') return parseAscii(data);
    const buf = data instanceof ArrayBuffer ? data : (data && data.buffer instanceof ArrayBuffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null);
    if (!buf) return new Float32Array(0);
    if (buf.byteLength >= 84) {
      const dv = new DataView(buf), n = dv.getUint32(80, true);
      if (84 + n * 50 === buf.byteLength) {
        const v = new Float32Array(n * 9);
        for (let i = 0, o = 84 + 12; i < n; i++, o += 50) for (let k = 0; k < 9; k++) v[i * 9 + k] = dv.getFloat32(o + k * 4, true);
        return v;
      }
    }
    return parseAscii(new TextDecoder().decode(buf));
  }
  function parseAscii(s) {
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g, out = [];
    let m; while ((m = re.exec(s))) out.push(+m[1], +m[2], +m[3]);
    out.length -= out.length % 9;
    return new Float32Array(out);
  }
  function bytesOf(data) {
    if (typeof data === 'string') return data.length;
    if (data && data.byteLength != null) return data instanceof Float32Array ? 84 + (data.length / 9) * 50 : data.byteLength;
    return 0;
  }
  function boundsOf(v) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; let bad = 0;
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i], y = v[i + 1], z = v[i + 2];
      if (!(isFinite(x) && isFinite(y) && isFinite(z))) { bad++; continue; }
      if (x < mn[0]) mn[0] = x; if (x > mx[0]) mx[0] = x;
      if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
      if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
    }
    return { mn, mx, bad };
  }
  // Offene / mehrfach genutzte Kanten zählen (Eckpunkte über exakte Float-Lage verschmolzen).
  const CHECK_MAX = 800000;
  function edgeCheck(v) {
    const n = v.length / 9; if (n > CHECK_MAX) return null;
    const ids = new Map(), id = new Uint32Array(n * 3);
    for (let i = 0; i < n * 3; i++) {
      const k = v[i * 3] + ',' + v[i * 3 + 1] + ',' + v[i * 3 + 2];
      let q = ids.get(k); if (q === undefined) { q = ids.size; ids.set(k, q); } id[i] = q;
    }
    const E = new Map(), M = 4194304;
    let degen = 0;
    for (let t = 0; t < n; t++) {
      const a = id[t * 3], b = id[t * 3 + 1], c = id[t * 3 + 2];
      if (a === b || b === c || a === c) { degen++; continue; }
      for (const [p, q] of [[a, b], [b, c], [c, a]]) { const key = p < q ? p * M + q : q * M + p; E.set(key, (E.get(key) || 0) + 1); }
    }
    let open = 0, multi = 0; for (const c of E.values()) { if (c === 1) open++; else if (c > 2) multi++; }
    return { open, multi, degen };
  }

  // ---------- Dialog ------------------------------------------------------------------------------
  let dom = null;
  function css() {
    if (document.getElementById('stlPrevCss')) return;
    const st = document.createElement('style'); st.id = 'stlPrevCss';
    st.textContent = '#stlPrevModal .modal{width:min(1200px,100%);height:min(780px,90vh)}'
      + '#stlPrevModal .sp-main{flex:1;min-height:0;display:flex}'
      + '#stlPrevModal .sp-view{flex:1;min-width:0;position:relative;overflow:hidden;background:var(--bg2,#0c0f13)}'
      + '#stlPrevModal .sp-view canvas{position:absolute;inset:0;width:100%;height:100%;display:block}'
      + '#stlPrevModal .sp-side{width:270px;border-left:1px solid var(--line);overflow:auto;padding:8px 10px;font-size:12px}'
      + '#stlPrevModal .sp-file{display:flex;gap:7px;align-items:flex-start;padding:6px 4px;border-radius:5px;cursor:pointer}'
      + '#stlPrevModal .sp-file:hover{background:var(--panel2)}'
      + '#stlPrevModal .sp-file.off{opacity:.45}'
      + '#stlPrevModal .sp-sw{width:11px;height:11px;border-radius:2px;margin-top:3px;flex:none}'
      + '#stlPrevModal .sp-nm{word-break:break-all;color:var(--txt)}'
      + '#stlPrevModal .sp-meta{color:var(--muted);font-size:11px;line-height:1.45;margin-top:2px}'
      + '#stlPrevModal .sp-ok{color:var(--good)}#stlPrevModal .sp-bad{color:var(--accent2)}'
      + '#stlPrevModal .sp-view{min-height:180px}'
      + '#stlPrevModal .foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}'
      + '#stlPrevModal .sp-sum{flex:1;color:var(--muted);font-size:12px}'
      + '#stlPrevModal .sp-hint{position:absolute;left:10px;top:8px;color:var(--muted);font-size:11px;pointer-events:none;text-shadow:0 0 3px #000}'
      + '@media (max-width:700px){#stlPrevModal .sp-main{flex-direction:column}#stlPrevModal .sp-side{width:auto;max-height:30%;border-left:0;border-top:1px solid var(--line)}}';
    document.head.appendChild(st);
  }
  function build() {
    if (dom) return dom;
    css();
    const bd = document.createElement('div'); bd.className = 'modal-backdrop'; bd.id = 'stlPrevModal';
    bd.innerHTML = '<div class="modal"><div class="head"><h2 class="sp-title"></h2><span style="flex:1"></span><button class="close-x sp-x">×</button></div>'
      + '<div class="sp-main"><div class="sp-view"><canvas class="sp-gl"></canvas><canvas class="sp-ov"></canvas><div class="sp-hint"></div></div><div class="sp-side"></div></div>'
      + '<div class="foot"><span class="sp-sum"></span><label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px"><input type="checkbox" class="sp-back" checked> <span class="sp-backl"></span></label>'
      + '<button class="sp-cancel"></button><button class="primary sp-save"></button></div></div>';
    document.body.appendChild(bd);
    const q = s => bd.querySelector(s);
    dom = { bd, title: q('.sp-title'), x: q('.sp-x'), view: q('.sp-view'), gl: q('.sp-gl'), ov: q('.sp-ov'), hint: q('.sp-hint'), side: q('.sp-side'), sum: q('.sp-sum'), back: q('.sp-back'), backl: q('.sp-backl'), cancel: q('.sp-cancel'), save: q('.sp-save') };
    dom.x.title = T('Abbrechen (Esc)');
    dom.back.onchange = () => { V.showBack = dom.back.checked; draw(); };
    dom.x.onclick = dom.cancel.onclick = () => close(false);
    dom.save.onclick = () => close(true);
    bd.addEventListener('mousedown', e => { if (e.target === bd) close(false); });
    window.addEventListener('keydown', e => {
      if (!bd.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === 'Enter' && !(document.activeElement && document.activeElement.tagName === 'INPUT')) { e.preventDefault(); e.stopPropagation(); close(true); }
    }, true);
    bindMouse(dom.ov);
    if (window.ViewCube && ViewCube.midDbl) ViewCube.midDbl(dom.ov, (x, y) => setPivotAt(x, y));
    if (window.ViewCube && ViewCube.home) ViewCube.home({ canvas: () => dom.ov, reset: resetView, redraw: () => draw(), active: () => bd.classList.contains('open') });
    window.addEventListener('resize', () => { if (bd.classList.contains('open')) draw(); });
    return dom;
  }

  // ---------- Zustand / Kamera --------------------------------------------------------------------
  const V = { files: [], mc: [0, 0, 0], R: 1, pivot: null, yaw: YAW0, pitch: PITCH0, zoom: 1, px: 0, py: 0, showBack: true, W: 0, H: 0, resolve: null };
  function mat() {
    const c = Math.cos(V.yaw), s = Math.sin(V.yaw), cp = Math.cos(V.pitch), sp = Math.sin(V.pitch);
    return [c, -s, 0, s * sp, c * sp, cp, -s * cp, -c * cp, sp];   // Zeilen: rechts, oben, zum Betrachter
  }
  const ctr = () => V.pivot || V.mc;
  const scale = () => 0.45 * Math.min(V.W, V.H) / V.R * V.zoom;
  function proj(x, y, z, M) {
    M = M || mat(); const C = ctr(), dx = x - C[0], dy = y - C[1], dz = z - C[2], s = scale();
    return { x: V.W / 2 + V.px + s * (M[0] * dx + M[1] * dy + M[2] * dz), y: V.H / 2 + V.py - s * (M[3] * dx + M[4] * dy + M[5] * dz), d: -(M[6] * dx + M[7] * dy + M[8] * dz) };
  }
  function resetView() { V.yaw = YAW0; V.pitch = PITCH0; V.zoom = 1; V.px = 0; V.py = 0; V.pivot = null; }
  function setPivotAt(x, y) {
    const M = mat(), each = cb => { for (const f of V.files) { if (!f.on) continue; const v = f.v, st = Math.max(3, Math.floor(v.length / 3 / 200000) * 3); for (let i = 0; i < v.length; i += st) cb(v[i], v[i + 1], v[i + 2]); } };
    const p = window.ViewCube && ViewCube.pickNear ? ViewCube.pickNear(x, y, each, (a, b, c) => proj(a, b, c, M), 14) : null;
    if (!p) return false;
    const q = proj(p[0], p[1], p[2], M);   // Bildlage des neuen Drehpunkts -> Verschiebung so, dass nichts springt
    V.px = q.x - V.W / 2; V.py = q.y - V.H / 2; V.pivot = p; draw(); return true;
  }
  function bindMouse(cv) {
    let drag = null;
    cv.style.cursor = 'grab';
    cv.addEventListener('mousedown', e => { e.preventDefault(); drag = { b: e.button, x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.b === 0) { V.yaw += dx * 0.01; V.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, V.pitch + dy * 0.01)); }
      else { V.px += dx; V.py += dy; }
      draw();
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; cv.style.cursor = 'grab'; } });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - V.W / 2, my = e.clientY - r.top - V.H / 2, f = Math.exp(-e.deltaY * 0.0015);
      V.zoom *= f; V.px = mx - f * (mx - V.px); V.py = my - f * (my - V.py); draw();
    }, { passive: false });
    cv.addEventListener('dblclick', e => { if (e.button === 0) { resetView(); draw(); } });
  }

  // ---------- WebGL2 ------------------------------------------------------------------------------
  let gl = null, prog = null, glFailed = false, ctx2d = null;
  const VS = '#version 300 es\nin vec3 aP;in vec3 aN;uniform mat3 uM;uniform vec3 uC;uniform vec3 uMc;uniform vec2 uS;uniform vec2 uPan;uniform float uR;out vec3 vN;\n'
    + 'void main(){vec3 v=uM*(aP-uC);vec3 w=uM*(aP-uMc);vN=uM*aN;gl_Position=vec4(v.x*uS.x+uPan.x,v.y*uS.y+uPan.y,-w.z/(uR*1.8),1.0);}';
  const FS = '#version 300 es\nprecision mediump float;in vec3 vN;uniform vec3 uCol;uniform float uBack;out vec4 o;\n'
    + 'void main(){vec3 n=normalize(vN);vec3 c=uCol;float a=0.28;if(!gl_FrontFacing){n=-n;if(uBack>0.5){c=vec3(0.95,0.22,0.20);a=0.6;}}\n'
    + 'vec3 L=normalize(vec3(-0.35,0.55,0.75));float d=max(dot(n,L),0.0);float h=pow(max(dot(n,normalize(L+vec3(0,0,1))),0.0),40.0);\n'
    + 'o=vec4(c*(a+(1.0-a)*d)+vec3(0.18*h),1.0);}';
  function initGl() {
    if (gl || glFailed) return gl;
    try {
      gl = dom.gl.getContext('webgl2', { antialias: true, preserveDrawingBuffer: false });
      if (!gl) throw new Error('no webgl2');
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      prog.u = {}; for (const k of ['uM', 'uC', 'uMc', 'uS', 'uPan', 'uR', 'uCol', 'uBack']) prog.u[k] = gl.getUniformLocation(prog, k);
      prog.aP = gl.getAttribLocation(prog, 'aP'); prog.aN = gl.getAttribLocation(prog, 'aN');
    } catch (e) { console.warn('STL-Vorschau: WebGL2 nicht verfügbar, 2D-Rückfall', e); gl = null; glFailed = true; }
    return gl;
  }
  function upload(f) {
    if (!gl) return;
    const v = f.v, n = new Float32Array(v.length);
    for (let i = 0; i < v.length; i += 9) {
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      for (let k = 0; k < 9; k += 3) { n[i + k] = nx; n[i + k + 1] = ny; n[i + k + 2] = nz; }
    }
    f.vao = gl.createVertexArray(); gl.bindVertexArray(f.vao);
    f.bP = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, f.bP); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(prog.aP); gl.vertexAttribPointer(prog.aP, 3, gl.FLOAT, false, 0, 0);
    f.bN = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, f.bN); gl.bufferData(gl.ARRAY_BUFFER, n, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(prog.aN); gl.vertexAttribPointer(prog.aN, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }
  function freeGl() {
    if (!gl) return;
    for (const f of V.files) { if (f.vao) gl.deleteVertexArray(f.vao); if (f.bP) gl.deleteBuffer(f.bP); if (f.bN) gl.deleteBuffer(f.bN); f.vao = f.bP = f.bN = null; }
  }
  function sizeCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, r = dom.view.getBoundingClientRect();
    V.W = r.width; V.H = r.height;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }

  function draw() {
    if (!dom || !dom.bd.classList.contains('open')) return;
    const dpr = sizeCanvas(dom.ov); sizeCanvas(dom.gl);
    if (!(V.W > 0 && V.H > 0)) return;
    const M = mat(), s = scale(), C = ctr();
    const o = dom.ov.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0); o.clearRect(0, 0, V.W, V.H);
    if (initGl()) {
      gl.viewport(0, 0, dom.gl.width, dom.gl.height);
      gl.clearColor(0.047, 0.059, 0.075, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.useProgram(prog);
      // GLSL mat3 ist spaltenweise -> Zeilenmatrix transponiert übergeben
      gl.uniformMatrix3fv(prog.u.uM, true, M);
      gl.uniform3fv(prog.u.uC, C); gl.uniform3fv(prog.u.uMc, V.mc);
      gl.uniform2f(prog.u.uS, 2 * s / V.W, 2 * s / V.H); gl.uniform2f(prog.u.uPan, 2 * V.px / V.W, -2 * V.py / V.H);
      gl.uniform1f(prog.u.uR, V.R); gl.uniform1f(prog.u.uBack, V.showBack ? 1 : 0);
      for (const f of V.files) {
        if (!f.on || !f.vao) continue;
        gl.uniform3fv(prog.u.uCol, f.col); gl.bindVertexArray(f.vao); gl.drawArrays(gl.TRIANGLES, 0, f.v.length / 3);
      }
      gl.bindVertexArray(null);
    } else draw2d(o, M);
    // Bodenraster-Rahmen (Bauplattform z = min) + Achsenkreuz + Drehpunkt
    drawFloor(o, M); drawAxes(o, M);
    if (V.pivot && window.ViewCube && ViewCube.drawPivot) { const q = proj(V.pivot[0], V.pivot[1], V.pivot[2], M); ViewCube.drawPivot(o, q.x, q.y); }
  }
  // 2D-Rückfall: Maler-Algorithmus, bei großen Netzen ausgedünnt.
  function draw2d(o, M) {
    o.fillStyle = '#0c0f13'; o.fillRect(0, 0, V.W, V.H);
    const tris = [];
    for (const f of V.files) {
      if (!f.on) continue;
      const v = f.v, n = v.length / 9, st = Math.max(1, Math.ceil(n / 60000));
      for (let t = 0; t < n; t += st) {
        const i = t * 9, a = proj(v[i], v[i + 1], v[i + 2], M), b = proj(v[i + 3], v[i + 4], v[i + 5], M), c = proj(v[i + 6], v[i + 7], v[i + 8], M);
        const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        tris.push({ a, b, c, d: a.d + b.d + c.d, back: cr > 0, col: f.col, lit: Math.min(1, Math.abs(cr) / (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - a.x, c.y - a.y) + 1e-9)) });
      }
    }
    tris.sort((p, q) => p.d - q.d);
    for (const t of tris) {
      const c = t.back && V.showBack ? [0.92, 0.25, 0.22] : t.col, k = 0.35 + 0.65 * t.lit;
      o.fillStyle = (window.DrawTheme ? DrawTheme.raw('rgb(' + Math.round(c[0] * 255 * k) + ',' + Math.round(c[1] * 255 * k) + ',' + Math.round(c[2] * 255 * k) + ')') : 'rgb(' + Math.round(c[0] * 255 * k) + ',' + Math.round(c[1] * 255 * k) + ',' + Math.round(c[2] * 255 * k) + ')');
      o.beginPath(); o.moveTo(t.a.x, t.a.y); o.lineTo(t.b.x, t.b.y); o.lineTo(t.c.x, t.c.y); o.closePath(); o.fill();
    }
  }
  function drawFloor(o, M) {
    const B = V.bb; if (!B) return;
    const z = B.mn[2], pts = [[B.mn[0], B.mn[1]], [B.mx[0], B.mn[1]], [B.mx[0], B.mx[1]], [B.mn[0], B.mx[1]]].map(p => proj(p[0], p[1], z, M));
    o.save(); o.strokeStyle = 'rgba(139,152,168,.45)'; o.setLineDash([4, 4]); o.lineWidth = 1;
    o.beginPath(); pts.forEach((p, i) => i ? o.lineTo(p.x, p.y) : o.moveTo(p.x, p.y)); o.closePath(); o.stroke(); o.restore();
  }
  function drawAxes(o, M) {
    const x0 = 46, y0 = V.H - 40, L = 28, ax = [[1, 0, 0, '#ff6b6b', 'X'], [0, 1, 0, '#57d38c', 'Y'], [0, 0, 1, '#4aa3ff', 'Z']];
    ax.map(a => ({ a, sx: M[0] * a[0] + M[1] * a[1] + M[2] * a[2], sy: M[3] * a[0] + M[4] * a[1] + M[5] * a[2], d: M[6] * a[0] + M[7] * a[1] + M[8] * a[2] }))
      .sort((p, q) => p.d - q.d)
      .forEach(q => {
        const ex = x0 + q.sx * L, ey = y0 - q.sy * L;
        o.strokeStyle = q.a[3]; o.lineWidth = 2; o.beginPath(); o.moveTo(x0, y0); o.lineTo(ex, ey); o.stroke();
        o.fillStyle = q.a[3]; o.font = 'bold 11px system-ui'; o.textAlign = 'center'; o.textBaseline = 'middle';
        o.fillText(q.a[4], x0 + q.sx * (L + 9), y0 - q.sy * (L + 9));
      });
  }

  // ---------- Öffnen / Schließen ------------------------------------------------------------------
  const fmt = x => (Math.abs(x) >= 100 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, '') || '0';
  const fmtBytes = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';
  const fmtInt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  function sideList() {
    dom.side.innerHTML = '';
    const multi = V.files.length > 1;
    V.files.forEach((f, i) => {
      const row = document.createElement('div'); row.className = 'sp-file' + (f.on ? '' : ' off');
      const sw = document.createElement('span'); sw.className = 'sp-sw'; sw.style.background = 'rgb(' + f.col.map(c => Math.round(c * 255)).join(',') + ')';
      const tx = document.createElement('div'); tx.style.minWidth = '0';
      const B = f.bb, sz = B.mx.map((m, k) => m - B.mn[k]);
      let chk;
      if (f.check === undefined) chk = '<span>' + T('Kanten werden geprüft …') + '</span>';
      else if (f.check === null) chk = '<span>' + T('Kantenprüfung übersprungen (sehr großes Netz)') + '</span>';
      else if (!f.check.open && !f.check.multi) chk = '<span class="sp-ok">✓ ' + T('geschlossen (wasserdicht)') + '</span>';
      else chk = '<span class="sp-bad">⚠ ' + [f.check.open ? fmtInt(f.check.open) + ' ' + T('offene Kanten') : '', f.check.multi ? fmtInt(f.check.multi) + ' ' + T('mehrfach genutzte Kanten') : ''].filter(Boolean).join(', ') + '</span>';
      tx.innerHTML = '<div class="sp-nm"></div><div class="sp-meta">'
        + fmt(sz[0]) + ' × ' + fmt(sz[1]) + ' × ' + fmt(sz[2]) + ' mm<br>'
        + fmtInt(f.v.length / 9) + ' ' + T('Dreiecke') + ' · ' + fmtBytes(f.bytes) + '<br>'
        + T('Lage') + ' X ' + fmt(B.mn[0]) + '…' + fmt(B.mx[0]) + ', Y ' + fmt(B.mn[1]) + '…' + fmt(B.mx[1]) + ', Z ' + fmt(B.mn[2]) + '…' + fmt(B.mx[2]) + '<br>'
        + chk + (f.bb.bad ? '<br><span class="sp-bad">⚠ ' + fmtInt(f.bb.bad) + ' ' + T('ungültige Eckpunkte (NaN)') + '</span>' : '') + '</div>';
      tx.querySelector('.sp-nm').textContent = f.name;
      row.appendChild(sw); row.appendChild(tx);
      if (multi) {
        row.title = T('Klick = ein-/ausblenden, Doppelklick = nur diese Datei');
        row.onclick = () => { f.on = !f.on; sideList(); draw(); };
        row.ondblclick = () => { V.files.forEach(g => { g.on = g === f; }); sideList(); draw(); };
      }
      dom.side.appendChild(row);
    });
    if (multi) {
      const all = document.createElement('button'); all.textContent = T('Alle zeigen'); all.style.marginTop = '6px';
      all.onclick = () => { V.files.forEach(g => { g.on = true; }); sideList(); draw(); };
      dom.side.appendChild(all);
    }
  }
  function summary() {
    const nt = V.files.reduce((s, f) => s + f.v.length / 9, 0), nb = V.files.reduce((s, f) => s + f.bytes, 0), B = V.bb;
    const sz = B ? B.mx.map((m, k) => m - B.mn[k]) : [0, 0, 0];
    dom.sum.textContent = (V.files.length > 1 ? V.files.length + ' ' + T('Dateien') + ' · ' : '') + T('Gesamt') + ' ' + fmt(sz[0]) + ' × ' + fmt(sz[1]) + ' × ' + fmt(sz[2]) + ' mm · ' + fmtInt(nt) + ' ' + T('Dreiecke') + ' · ' + fmtBytes(nb);
  }
  function close(ok) {
    if (!dom || !dom.bd.classList.contains('open')) return;
    dom.bd.classList.remove('open');
    freeGl(); const r = V.resolve; V.resolve = null; V.files = [];
    if (r) r(!!ok);
  }
  function open(list) {
    build();
    const files = list.map((it, i) => {
      const v = toVerts(it.data != null ? it.data : (it.v || (it.mesh && it.mesh.v)));
      return { name: it.name || 'modell.stl', v, bytes: it.data != null ? bytesOf(it.data) : 84 + v.length / 9 * 50, bb: boundsOf(v), col: COLORS[i % COLORS.length], on: true, check: undefined };
    });
    V.files = files;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const f of files) for (let k = 0; k < 3; k++) { if (f.bb.mn[k] < mn[k]) mn[k] = f.bb.mn[k]; if (f.bb.mx[k] > mx[k]) mx[k] = f.bb.mx[k]; }
    const okB = isFinite(mn[0]);
    V.bb = okB ? { mn, mx } : null;
    V.mc = okB ? mn.map((m, k) => (m + mx[k]) / 2) : [0, 0, 0];
    V.R = okB ? (Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 || 1) : 1;
    resetView();
    dom.title.textContent = T('STL-Vorschau') + ' — ' + (files.length > 1 ? files.length + ' ' + T('Dateien') : files[0].name);
    dom.hint.textContent = T('Links ziehen = drehen · rechts ziehen = verschieben · Rad = Zoom · Doppelklick = Ansicht zurücksetzen');
    dom.backl.textContent = T('Rückseiten rot');
    dom.back.checked = V.showBack;
    dom.cancel.textContent = T('Abbrechen');
    dom.save.textContent = files.length > 1 ? '💾 ' + files.length + ' ' + T('Dateien speichern…') : '💾 ' + T('Speichern…');
    dom.bd.classList.add('open');
    if (initGl()) for (const f of files) upload(f);
    sideList(); summary();
    requestAnimationFrame(() => { draw(); dom.save.focus(); });
    // Kantenprüfung nach dem ersten Bild, Datei für Datei
    let i = 0;
    const step = () => {
      if (V.files !== files || i >= files.length) return;
      const f = files[i++];
      try { f.check = edgeCheck(f.v); } catch (e) { f.check = null; }
      sideList(); setTimeout(step, 0);
    };
    setTimeout(step, 60);
    return new Promise(res => { V.resolve = res; });
  }

  // Warteschlange: mehrere Exporte hintereinander (z. B. „Alle Segmente“) zeigen ihre Vorschau nacheinander.
  let chain = Promise.resolve();
  function enqueue(job) { const p = chain.then(job, job); chain = p.catch(() => {}); return p; }
  function stlPreview(list) {
    list = (list || []).filter(Boolean);
    if (!list.length) return Promise.resolve(false);
    return enqueue(() => open(list));
  }

  // Mehrere STL-Dateien: Vorschau, dann Ordner-Dialog (sonst nacheinander als Download).
  async function stlSaveMany(list, which) {
    which = which || 'svStl';
    if (App.demoSaveBlocked && App.demoSaveBlocked(which)) return;
    if (!list.length) return;
    const buf = it => it.data != null ? it.data : (App.stlBinary ? App.stlBinary(it.v) : it.v);
    return enqueue(async () => {
      if (!(await open(list))) return;
      if (list.length === 1) { await rawDownload(list[0].name, buf(list[0]), 'model/stl', which); return; }
      if (App.FS_SUPPORTED && window.showDirectoryPicker) {
        const dh = App.dirHandles || {}; let root;
        try { root = await window.showDirectoryPicker({ mode: 'readwrite', startIn: dh[which] || dh.save || 'documents' }); } catch (e) { return; }
        try {
          for (const it of list) { const fh = await root.getFileHandle(it.name, { create: true }), w = await fh.createWritable(); await w.write(buf(it)); await w.close(); }
          if (App.toast) App.toast(T('Gespeichert: ') + list.length + ' ' + T('Dateien') + '  (' + (root.name || T('Ordner')) + ')');
        } catch (e) { alert(T('Speichern fehlgeschlagen: ') + (e && e.message ? e.message : e)); }
        return;
      }
      let i = 0; for (const it of list) setTimeout(() => App.anchorDownload(it.name, buf(it), 'model/stl', which), 300 * i++);
    });
  }
  // Binär-STL aus Eckpunkten (für stlSaveMany mit {v}).
  function stlBinary(v) {
    const n = Math.floor(v.length / 9), buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), hdr = 'AI Foam Cut';
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let i = 0; i < n * 9; i += 9) {
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, L = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / L, true); dv.setFloat32(o + 4, ny / L, true); dv.setFloat32(o + 8, nz / L, true); o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, v[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }

  // ---------- Einhängen in die Einzeldatei-Schreibwege -------------------------------------------
  const ORIG = {};
  function rawDownload(name, data, mime, which) {
    if (ORIG.download) return ORIG.download(name, data, mime, which);
    if (ORIG.exportViaPicker) return ORIG.exportViaPicker(name, data, mime, which);
    return App.anchorDownload(name, data, mime, which);
  }
  function wrap(key) {
    const orig = App[key];
    if (typeof orig !== 'function' || orig._stlPrev) return;
    ORIG[key] = orig;
    const w = function (name, data, mime, which) {
      if (!isStl(name, mime)) return orig.apply(this, arguments);
      if (App.demoSaveBlocked && App.demoSaveBlocked(which)) return Promise.resolve(null);
      const self = this, args = arguments;
      return enqueue(async () => (await open([{ name, data }])) ? orig.apply(self, args) : null);
    };
    w._stlPrev = true;
    App[key] = w;
  }
  wrap('download'); wrap('exportViaPicker');

  Object.assign(App, { stlPreview, stlSaveMany, stlBinary });
})();
