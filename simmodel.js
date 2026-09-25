/* simmodel.js — Import von Flugzeugmodellen aus Flugsimulatoren (Reiter „3D-Modell")
 *
 * Liefert wie parseSTL/parseOBJ eine Dreieckssuppe (Float32Array, 9 Floats je
 * Dreieck) in Millimetern, Z nach oben. Unterstützt:
 *   - X-Plane OBJ8 (.obj, Kopf „I/A · 800 · OBJ"): VT/IDX/IDX10/TRIS, nur erste
 *     LOD-Stufe, Animationen im Ruhezustand (erster Schlüssel) angewendet.
 *   - FlightGear / AC3D (.ac): OBJECT-Baum mit loc/rot, SURF-Polygone.
 *   - glTF 2.0 (.gltf + .bin / .glb): MSFS 2020/2024, Aerofly-Exporte, Blender …
 *     Knoten-Transformationen (matrix/TRS), Modi TRIANGLES/STRIP/FAN.
 * Alle drei Formate arbeiten in Metern mit Y nach oben → ×1000 und (x,y,z)→(x,−z,y).
 * FSX/P3D-.mdl und verschlüsselte MSFS-Marketplace-Pakete sind nicht lesbar. */
(function () {
  'use strict';
  const T = s => (window.T ? window.T(s) : s);
  const SC = 1000;                                    // m → mm

  // ---- 4×4-Matrizen (spaltenweise wie glTF) ----
  const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  const trans = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  function rotAxis(x, y, z, deg) {
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
            t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
            t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
  }
  function trs(t, q, s) {
    t = t || [0, 0, 0]; q = q || [0, 0, 0, 1]; s = s || [1, 1, 1];
    const [x, y, z, w] = q;
    return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
            2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
            2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
            t[0], t[1], t[2], 1];
  }
  // Punkt (Y oben, m) über Matrix m in die Ausgabe (Z oben, mm).
  function emit(out, m, x, y, z) {
    const X = m[0] * x + m[4] * y + m[8] * z + m[12];
    const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
    const Z = m[2] * x + m[6] * y + m[10] * z + m[14];
    out.push(X * SC, -Z * SC, Y * SC);
  }

  // ======================= X-Plane OBJ8 ==================================
  function isXPlane(txt) {
    const l = txt.slice(0, 200).split(/\r?\n/).map(s => s.trim());
    return (l[0] === 'I' || l[0] === 'A') && /^800\b/.test(l[1] || '') && /^OBJ\b/.test(l[2] || '');
  }
  function parseXPlane(txt) {
    const vt = [], idx = [], out = [];
    const lines = txt.split(/\r?\n/);
    // Pass 1: Vertex- und Indextabelle
    for (const s of lines) {
      const p = s.trim().split(/\s+/);
      if (p[0] === 'VT') vt.push(+p[1], +p[2], +p[3]);
      else if (p[0] === 'IDX10' || p[0] === 'IDX') for (let k = 1; k < p.length; k++) idx.push(+p[k]);
    }
    // Pass 2: Befehle mit Animationsstapel
    let m = I4(); const stack = []; let lod = 0, rotBlock = null, trBlock = null;
    for (const s of lines) {
      const p = s.trim().split(/\s+/); const c = p[0];
      if (c === 'ATTR_LOD') { if (++lod > 1) break; }
      else if (c === 'ANIM_begin') stack.push(m);
      else if (c === 'ANIM_end') m = stack.pop() || I4();
      else if (c === 'ANIM_trans') m = mul(m, trans(+p[1], +p[2], +p[3]));
      else if (c === 'ANIM_rotate') m = mul(m, rotAxis(+p[1], +p[2], +p[3], +p[4]));
      else if (c === 'ANIM_rotate_begin') rotBlock = { ax: [+p[1], +p[2], +p[3]], done: false };
      else if (c === 'ANIM_rotate_key' && rotBlock && !rotBlock.done) {
        m = mul(m, rotAxis(rotBlock.ax[0], rotBlock.ax[1], rotBlock.ax[2], +p[2])); rotBlock.done = true;
      }
      else if (c === 'ANIM_rotate_end') rotBlock = null;
      else if (c === 'ANIM_trans_begin') trBlock = { done: false };
      else if (c === 'ANIM_trans_key' && trBlock && !trBlock.done) { m = mul(m, trans(+p[2], +p[3], +p[4])); trBlock.done = true; }
      else if (c === 'ANIM_trans_end') trBlock = null;
      else if (c === 'TRIS') {
        const off = +p[1], n = +p[2];
        for (let k = off; k + 2 < off + n && k + 2 < idx.length; k += 3) {
          for (let j = 0; j < 3; j++) { const v = idx[k + j] * 3; emit(out, m, vt[v], vt[v + 1], vt[v + 2]); }
        }
      }
    }
    return new Float32Array(out);
  }

  // ======================= AC3D (FlightGear) =============================
  function parseAC3D(txt) {
    const tok = txt.split(/\r?\n/); let li = 0; const out = [];
    if (!/^AC3D/.test(tok[0] || '')) throw new Error(T('Keine AC3D-Datei.'));
    li = 1;
    function readObject(parent) {
      let loc = [0, 0, 0], rot = [1, 0, 0, 0, 1, 0, 0, 0, 1], verts = [], polys = [], kids = 0;
      while (li < tok.length) {
        const s = tok[li++].trim(); if (!s) continue;
        const p = s.split(/\s+/); const c = p[0];
        if (c === 'loc') loc = [+p[1], +p[2], +p[3]];
        else if (c === 'rot') rot = p.slice(1, 10).map(Number);
        else if (c === 'data') {           // n Zeichen Freitext, ggf. über mehrere Zeilen
          let n = +p[1]; while (n > 0 && li < tok.length) n -= tok[li++].length + 1;
        }
        else if (c === 'numvert') {
          const n = +p[1];
          for (let k = 0; k < n; k++) { const q = tok[li++].trim().split(/\s+/); verts.push(+q[0], +q[1], +q[2]); }
        }
        else if (c === 'numsurf') {
          const n = +p[1];
          for (let k = 0; k < n; k++) {
            let flags = 0, refs = [];
            while (li < tok.length) {
              const q = tok[li++].trim().split(/\s+/);
              if (q[0] === 'SURF') flags = parseInt(q[1], 16) || parseInt(q[1], 10) || 0;
              else if (q[0] === 'refs') {
                const r = +q[1];
                for (let j = 0; j < r; j++) refs.push(parseInt(tok[li++], 10));
                break;
              }
            }
            if ((flags & 15) === 0) polys.push(refs);          // nur Polygone, keine Linien
          }
        }
        else if (c === 'kids') { kids = +p[1]; break; }
      }
      // AC3D: v' = rot·v + loc (rot zeilenweise), relativ zum Elternobjekt
      const local = [rot[0], rot[3], rot[6], 0, rot[1], rot[4], rot[7], 0, rot[2], rot[5], rot[8], 0, loc[0], loc[1], loc[2], 1];
      const m = mul(parent, local);
      const nv = verts.length / 3;
      for (const r of polys) for (let k = 2; k < r.length; k++) {
        const t = [r[0], r[k - 1], r[k]];
        if (t.some(i => !(i >= 0 && i < nv))) continue;
        for (const i of t) emit(out, m, verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
      }
      for (let k = 0; k < kids; k++) {
        while (li < tok.length && !/^OBJECT\b/.test(tok[li].trim())) li++;
        if (li >= tok.length) break;
        li++; readObject(m);
      }
    }
    while (li < tok.length) {
      if (/^OBJECT\b/.test(tok[li].trim())) { li++; readObject(I4()); } else li++;
    }
    return new Float32Array(out);
  }

  // ======================= glTF 2.0 / GLB (MSFS) =========================
  function b64buf(uri) {
    const bin = atob(uri.slice(uri.indexOf(',') + 1)); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer;
  }
  async function parseGLTF(file, extras) {
    let json, glbBin = null;
    const ab = await file.arrayBuffer(); const dv = new DataView(ab);
    if (ab.byteLength >= 12 && dv.getUint32(0, true) === 0x46546C67) {   // „glTF"
      let o = 12;
      while (o + 8 <= ab.byteLength) {
        const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
        if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, o + 8, len)));
        else if (type === 0x004E4942) glbBin = ab.slice(o + 8, o + 8 + len);
        o += 8 + len;
      }
    } else json = JSON.parse(new TextDecoder().decode(ab));
    if (!json) throw new Error(T('glTF ohne JSON-Teil.'));
    const req = json.extensionsRequired || [];
    const bad = req.filter(e => /draco|meshopt/i.test(e));
    if (bad.length) throw new Error(T('Komprimierte Geometrie nicht unterstützt: ') + bad.join(', '));
    // Puffer beschaffen
    const byName = {};
    (extras || []).forEach(f => { byName[f.name.toLowerCase()] = f; });
    const bufs = [];
    for (let i = 0; i < (json.buffers || []).length; i++) {
      const b = json.buffers[i];
      if (b.uri == null) { bufs.push(glbBin); continue; }
      if (/^data:/.test(b.uri)) { bufs.push(b64buf(b.uri)); continue; }
      const nm = decodeURIComponent(b.uri).split(/[\\/]/).pop().toLowerCase();
      const f = byName[nm];
      if (!f) throw new Error(T('Pufferdatei fehlt: ') + nm + T(' — bitte zusammen mit der .gltf auswählen.'));
      bufs.push(await f.arrayBuffer());
    }
    const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
    const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    function readAcc(ai) {
      const a = json.accessors[ai]; const nc = NC[a.type], cs = CS[a.componentType];
      const res = new Float64Array(a.count * nc);
      if (a.bufferView == null) return res;
      const bv = json.bufferViews[a.bufferView];
      const d = new DataView(bufs[bv.buffer]);
      const base = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || nc * cs;
      const rd = { 5120: (o) => d.getInt8(o), 5121: (o) => d.getUint8(o), 5122: (o) => d.getInt16(o, true),
        5123: (o) => d.getUint16(o, true), 5125: (o) => d.getUint32(o, true), 5126: (o) => d.getFloat32(o, true) }[a.componentType];
      const nrm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
      for (let i = 0; i < a.count; i++) for (let k = 0; k < nc; k++) {
        let v = rd(base + i * stride + k * cs); if (nrm) v = Math.max(v / nrm, -1); res[i * nc + k] = v;
      }
      return res;
    }
    const out = []; const meshCache = {};
    function drawMesh(mi, m) {
      const mesh = json.meshes[mi];
      for (const pr of mesh.primitives || []) {
        const mode = pr.mode == null ? 4 : pr.mode;
        if (mode < 4 || pr.attributes.POSITION == null) continue;
        const key = mi + ':' + mesh.primitives.indexOf(pr);
        let c = meshCache[key];
        if (!c) {
          const P = readAcc(pr.attributes.POSITION);
          let I = pr.indices != null ? readAcc(pr.indices) : null;
          if (!I) { I = new Float64Array(P.length / 3); for (let i = 0; i < I.length; i++) I[i] = i; }
          const tri = [];
          if (mode === 4) for (let i = 0; i + 2 < I.length; i += 3) tri.push(I[i], I[i + 1], I[i + 2]);
          else if (mode === 5) for (let i = 2; i < I.length; i++) tri.push(...(i & 1 ? [I[i - 1], I[i - 2], I[i]] : [I[i - 2], I[i - 1], I[i]]));
          else if (mode === 6) for (let i = 2; i < I.length; i++) tri.push(I[0], I[i - 1], I[i]);
          c = meshCache[key] = { P, tri };
        }
        for (const i of c.tri) emit(out, m, c.P[i * 3], c.P[i * 3 + 1], c.P[i * 3 + 2]);
      }
    }
    function walk(ni, parent) {
      const n = json.nodes[ni];
      const local = n.matrix ? n.matrix.slice() : trs(n.translation, n.rotation, n.scale);
      const m = mul(parent, local);
      if (n.mesh != null) drawMesh(n.mesh, m);
      (n.children || []).forEach(c => walk(c, m));
    }
    let roots;
    if (json.scenes && json.scenes.length) roots = json.scenes[json.scene || 0].nodes || [];
    else {
      const child = new Set(); (json.nodes || []).forEach(n => (n.children || []).forEach(c => child.add(c)));
      roots = (json.nodes || []).map((_, i) => i).filter(i => !child.has(i));
    }
    if (json.nodes && json.nodes.length) roots.forEach(r => walk(r, I4()));
    else (json.meshes || []).forEach((_, i) => drawMesh(i, I4()));
    return new Float32Array(out);
  }

  // ======================= IL-2 Sturmovik 1946 (.msh/.him) ===============
  // Nur entpackte Text-Dateien (Mods). IL-2 arbeitet in Metern, X vorne, Y links,
  // Z oben → nur ×1000, keine Achsvertauschung. Nach Community-Beschreibung
  // gebaut, noch nicht an echten Dateien geprüft.
  function sections(txt) {
    const sec = {}; let cur = null;
    for (const raw of txt.split(/\r?\n/)) {
      const s = raw.replace(/\/\/.*$/, '').trim(); if (!s) continue;
      const h = /^\[(.+)\]$/.exec(s);
      if (h) { cur = h[1]; if (!sec[cur]) sec[cur] = []; continue; }
      if (cur) sec[cur].push(s.split(/\s+/));
    }
    return sec;
  }
  function isBinaryText(txt) {
    let bad = 0; const n = Math.min(txt.length, 2000);
    for (let i = 0; i < n; i++) { const c = txt.charCodeAt(i); if (c < 9 || (c > 13 && c < 32) || c === 0xFFFD) bad++; }
    return bad > n * 0.05;
  }
  // Ein .msh → Dreiecke im lokalen System (Array x,y,z …, m).
  function il2Mesh(txt, name) {
    if (isBinaryText(txt)) throw new Error(name + T(': binäre/verschlüsselte .msh — nur entpackte Text-Dateien sind lesbar.'));
    const S = sections(txt);
    const V = (S['Vertices_Frame0'] || []).map(p => [+p[0], +p[1], +p[2]]);
    const F = (S['Faces'] || []).map(p => [+p[0], +p[1], +p[2]]);
    if (!V.length || !F.length) return [];
    // FaceGroups: Zeile 1 = Gesamtzahlen, danach je Gruppe
    // „Material Startvertex AnzVertices Startfläche AnzFlächen". Ob die Flächen-
    // Indizes je Gruppe lokal oder global sind, ist nicht sicher belegt → lokal
    // nur, wenn sonst ein Index außerhalb der Gruppe läge.
    const G = (S['FaceGroups'] || []).slice(1).filter(p => p.length >= 5).map(p => p.map(Number));
    const out = [];
    const put = (f, base) => { for (const i of f) { const v = V[i + base]; if (!v) return false; } for (const i of f) out.push(...V[i + base]); return true; };
    if (G.length) {
      for (const [, sv, nv, sf, nf] of G) {
        const fs = F.slice(sf, sf + nf);
        const local = fs.every(f => f.every(i => i < nv)) && fs.some(f => f.some(i => i < sv));
        fs.forEach(f => put(f, local ? sv : 0));
      }
    } else F.forEach(f => put(f, 0));
    return out;
  }
  async function parseIL2(file, extras) {
    const all = [file].concat(extras || []);
    const byName = {};
    all.forEach(f => { byName[f.name.toLowerCase()] = f; });
    const out = [];
    const put3 = (m, x, y, z) => {     // Zeilenvektor · Attaching (Rotation + Verschiebung)
      out.push((x * m[0] + y * m[3] + z * m[6] + m[9]) * SC,
               (x * m[1] + y * m[4] + z * m[7] + m[10]) * SC,
               (x * m[2] + y * m[5] + z * m[8] + m[11]) * SC);
    };
    const mulA = (a, b) => {           // erst a (Kind), dann b (Eltern)
      const r = new Array(12);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j] + (i === 3 ? b[9 + j] : 0);
      }
      return r;
    };
    const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const him = /\.him$/i.test(file.name) ? file : all.find(f => /\.him$/i.test(f.name));
    if (!him) {                        // einzelne .msh ohne Hierarchie
      for (const f of all.filter(f => /\.msh$/i.test(f.name))) {
        const t = il2Mesh(await f.text(), f.name);
        for (let i = 0; i < t.length; i += 3) put3(ID, t[i], t[i + 1], t[i + 2]);
      }
      return new Float32Array(out);
    }
    const txt = await him.text();
    if (isBinaryText(txt)) throw new Error(T('.him ist binär/verschlüsselt.'));
    // Knoten: Parent, Mesh, Attaching (4 Zeilen à 3 Zahlen), Hidden
    const nodes = {}; let cur = null, att = null;
    for (const raw of txt.split(/\r?\n/)) {
      const s = raw.replace(/\/\/.*$/, '').trim(); if (!s) continue;
      const h = /^\[(.+)\]$/.exec(s);
      if (h) { cur = nodes[h[1]] = { name: h[1], parent: null, mesh: null, m: ID, hidden: false }; att = null; continue; }
      if (!cur) continue;
      const p = s.split(/\s+/);
      if (att) {
        if (p.length >= 3 && p.slice(0, 3).every(v => isFinite(+v))) { att.push(+p[0], +p[1], +p[2]); if (att.length === 12) { cur.m = att; att = null; } continue; }
        att = null;
      }
      if (p[0] === 'Parent') cur.parent = p[1];
      else if (p[0] === 'Mesh') cur.mesh = p[1];
      else if (p[0] === 'Attaching') att = [];
      else if (p[0] === 'Hidden') cur.hidden = true;
    }
    const world = n => {
      if (n.w) return n.w;
      const par = n.parent && nodes[n.parent];
      return (n.w = par ? mulA(n.m, world(par)) : n.m);
    };
    const hiddenUp = n => { for (let k = n; k; k = k.parent && nodes[k.parent]) if (k.hidden) return true; return false; };
    let missing = [];
    for (const n of Object.values(nodes)) {
      // Nur Grundzustand: Schadensstufen _D1…_D3 und versteckte Teile weglassen.
      if (!n.mesh || hiddenUp(n) || /_D[1-9]$/i.test(n.name)) continue;
      const f = byName[(n.mesh + '.msh').toLowerCase()];
      if (!f) { missing.push(n.mesh); continue; }
      const m = world(n), t = il2Mesh(await f.text(), f.name);
      for (let i = 0; i < t.length; i += 3) put3(m, t[i], t[i + 1], t[i + 2]);
    }
    if (!out.length && missing.length) throw new Error(T('Keine .msh zur .him gefunden — bitte alle Dateien des Ordners wählen. Fehlend: ') + missing.slice(0, 5).join(', '));
    if (missing.length) console.warn('IL-2: fehlende Meshes', missing);
    return new Float32Array(out);
  }

  // Ein oder mehrere Dateien → { verts, name } oder null (kein Simulatorformat).
  async function parse(file, extras) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'him' || ext === 'msh') return parseIL2(file, extras);
    if (ext === 'gltf' || ext === 'glb') return parseGLTF(file, extras);
    if (ext === 'ac') return parseAC3D(await file.text());
    if (ext === 'obj') {
      const txt = await file.text();
      if (isXPlane(txt)) return parseXPlane(txt);
      return null;
    }
    if (ext === 'mdl') throw new Error(T('FSX/P3D-.mdl ist nicht lesbar — bitte in glTF/OBJ umwandeln (z. B. ModelConverterX).'));
    return null;
  }

  window.SimModel = { parse, isXPlane, parseXPlane, parseAC3D, parseGLTF, parseIL2 };
})();
