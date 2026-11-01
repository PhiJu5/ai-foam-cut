/* meshocc.js — echte CAD-Volumenkörper (B-Rep) für die 3D-Bearbeitung (Feature „occad", braucht „meshedit")
 *
 * OpenCascade als WebAssembly (occad_lib.js + occad_wasm.js, replicad-opencascadejs, LGPL-2.1; erzeugt mit
 * .claude/make_occad.py). Wird erst beim ersten Gebrauch entpackt und gestartet (ca. 1 s).
 * meshedit.js hält je Körper zusätzlich die exakte Form (b.brep = TopoDS_Shape); das Dreiecksnetz wird aus
 * ihr erzeugt (tess), jede OpenCascade-Fläche ist eine Flächengruppe (gleiche Reihenfolge wie faces()).
 * Formen sind unveränderlich: jede Operation liefert eine neue Form (Rückgängig teilt sich die alten).
 * Aufrufe nur geschützt: window.MeshOCC && MeshOCC.available().
 */
(function () {
  'use strict';
  const Ti = s => window.I18N ? window.I18N.t(s) : s;   // Übersetzung der Fehlermeldungen
  let P = null, oc = null;
  const quiet = () => {};
  function available() { return typeof window.OcadModule === 'function' && !!window.OCAD_WASM_GZ64 && typeof DecompressionStream === 'function' && typeof WebAssembly === 'object'; }
  function isReady() { return !!oc; }
  function ready() {
    if (P) return P;
    if (!available()) return Promise.reject(new Error(Ti('OpenCascade (Volumenkörper) ist in dieser Ausgabe nicht enthalten.')));
    P = (async () => {
      const bin = atob(window.OCAD_WASM_GZ64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const ds = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      const wasm = new Uint8Array(await new Response(ds).arrayBuffer());
      oc = await window.OcadModule({ wasmBinary: wasm, print: quiet, printErr: quiet });
      return api;
    })();
    P.catch(() => { P = null; });
    return P;
  }
  function attach(m) { oc = m; return api; }   // Node-Tests: fertiges Modul einhängen

  // ---------- Hilfen ----------
  const PR = () => new oc.Message_ProgressRange();
  const ENUM = (e, k) => oc[e][k];
  const isNull = s => !s || s.IsNull();
  function explore(shape, kind) {
    const out = [], ex = new oc.TopExp_Explorer(shape, ENUM('TopAbs_ShapeEnum', 'TopAbs_' + kind), ENUM('TopAbs_ShapeEnum', 'TopAbs_SHAPE'));
    for (; ex.More(); ex.Next()) out.push(ex.Current());
    ex.delete(); return out;
  }
  // Flächen in fester Reihenfolge (= Flächengruppen im Netz); je Form zwischengespeichert
  function faces(shape) {
    if (shape.__faces) return shape.__faces;
    // (Volumen/Schale: jede Fläche kommt im Explorer genau einmal vor; die Indexkarte ist im Build nicht gebunden)
    return (shape.__faces = explore(shape, 'FACE').map(f => oc.TopoDS.Face(f)));
  }
  function edgesOf(list) {
    const out = [];   // jede Kante grenzt an zwei Flächen → Doppelte per IsSame entfernen
    for (const s of list) for (const e of explore(s, 'EDGE')) if (!out.some(o => o.IsSame(e))) out.push(oc.TopoDS.Edge(e));
    return out;
  }
  function done(mk, what) {
    if (mk.IsDone && !mk.IsDone() && mk.Build) { try { mk.Build(PR()); } catch (e) { throw new Error(Ti(what) + Ti(' ist fehlgeschlagen.')); } }
    if (mk.IsDone && !mk.IsDone()) throw new Error(Ti(what) + Ti(' ist fehlgeschlagen.'));
    const s = mk.Shape(); if (isNull(s)) throw new Error(Ti(what) + Ti(': leeres Ergebnis.'));
    return s;
  }
  function unify(s) {
    try { const u = new oc.ShapeUpgrade_UnifySameDomain(s, true, true, false); u.Build(); const r = u.Shape(); u.delete(); return isNull(r) ? s : r; } catch (e) { return s; }
  }
  function valid(s) { try { const a = new oc.BRepCheck_Analyzer(s, true, false, false); const v = a.IsValid(); a.delete(); return v; } catch (e) { return false; } }
  function volume(s) { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(s, g, false, false, false); const m = g.Mass(); g.delete(); return m; }
  function kindOf(s) { return String(s.ShapeType()).replace('TopAbs_', ''); }
  const vec = v => new oc.gp_Vec(v[0], v[1], v[2]);
  const pnt = v => new oc.gp_Pnt(v[0], v[1], v[2]);

  // ---------- STEP ----------
  let fsN = 0;
  function readSTEP(data) {
    const fn = '/r' + (++fsN) + '.step'; oc.FS.writeFile(fn, data);
    const r = new oc.STEPControl_Reader();
    try {
      const st = r.ReadFile(fn);
      if (String(st) !== 'IFSelect_RetDone') throw new Error(Ti('STEP-Datei nicht lesbar (') + st + ').');
      r.TransferRoots(PR());
      const sh = r.OneShape(); if (isNull(sh)) throw new Error(Ti('Die STEP-Datei enthält keine Form.'));
      return sh;
    } finally { r.delete(); try { oc.FS.unlink(fn); } catch (e) {} }
  }
  // eine Form → Körper: Volumen einzeln, sonst Schalen, sonst alles zusammen
  function splitBodies(sh) {
    let L = explore(sh, 'SOLID'); if (L.length) return L;
    L = explore(sh, 'SHELL'); if (L.length) return L;
    return explore(sh, 'FACE').length ? [sh] : [];
  }
  function writeSTEP(list) {
    const fn = '/w' + (++fsN) + '.step', w = new oc.STEPControl_Writer();
    try {
      for (const s of list) {   // je Körper ein Transfer (BRep_Builder ist im Build nicht gebunden)
        const st = w.Transfer(s, ENUM('STEPControl_StepModelType', 'STEPControl_AsIs'), true, PR());
        if (String(st) !== 'IFSelect_RetDone') throw new Error(Ti('STEP-Ausgabe fehlgeschlagen (') + st + ').');
      }
      w.Write(fn);
      return oc.FS.readFile(fn, { encoding: 'utf8' });
    } finally { w.delete(); try { oc.FS.unlink(fn); } catch (e) {} }
  }
  const fromText = txt => readSTEP(new TextEncoder().encode(txt));

  // ---------- Vernetzung ----------
  // lin = Sehnenfehler (mm), ang = Winkel (rad). Ergebnis: Dreieckssuppe + Flächenindex je Dreieck; mit wantN
  // zusätzlich die exakten Flächennormalen je Dreiecksecke (aus der CAD-Fläche am UV-Knoten, NaN wo entartet,
  // z. B. Pol einer Kugel) — gemittelte Netznormalen zeigen auf langen, schmalen B-Spline-Dreiecken Streifen.
  function tess(shape, lin, ang, wantN) {
    const mesh = new oc.BRepMesh_IncrementalMesh(shape, lin, false, ang, false); mesh.delete();
    const F = faces(shape), soup = [], grp = [], nrm = wantN ? [] : null;
    F.forEach((f, fi) => {
      const loc = new oc.TopLoc_Location(), tr = oc.BRep_Tool.Triangulation(f, loc, 0);
      const T = tr && (typeof tr.get === 'function' ? tr.get() : tr);   // Handle oder direkt (je nach Bindung)
      if (!T || typeof T.NbNodes !== 'function') { loc.delete(); return; }
      const ident = loc.IsIdentity(), trsf = ident ? null : loc.Transformation();
      const nn = T.NbNodes(), X = new Float64Array(nn * 3);
      for (let i = 1; i <= nn; i++) {
        let p = T.Node(i); if (trsf) { const q = p.Transformed(trsf); p.delete(); p = q; }
        X[(i - 1) * 3] = p.X(); X[(i - 1) * 3 + 1] = p.Y(); X[(i - 1) * 3 + 2] = p.Z(); p.delete();
      }
      const rev = String(f.Orientation()) === 'TopAbs_REVERSED', nt = T.NbTriangles();
      let N = null;
      if (nrm && T.HasUVNodes()) {
        N = new Float32Array(nn * 3).fill(NaN);
        try {
          const sa = new oc.BRepAdaptor_Surface(f, true), Q = new oc.gp_Pnt(0, 0, 0), du = new oc.gp_Vec(0, 0, 0), dv = new oc.gp_Vec(0, 0, 0);
          for (let i = 1; i <= nn; i++) {
            const uv = T.UVNode(i); sa.D1(uv.X(), uv.Y(), Q, du, dv); uv.delete();
            const x = du.Y() * dv.Z() - du.Z() * dv.Y(), y = du.Z() * dv.X() - du.X() * dv.Z(), z = du.X() * dv.Y() - du.Y() * dv.X();
            const L = Math.hypot(x, y, z), du2 = du.SquareMagnitude(), dv2 = dv.SquareMagnitude();
            if (L > 1e-9 * Math.sqrt(du2 * dv2) && L > 0) { const sg = rev ? -1 : 1; N[(i - 1) * 3] = sg * x / L; N[(i - 1) * 3 + 1] = sg * y / L; N[(i - 1) * 3 + 2] = sg * z / L; }
          }
          sa.delete(); Q.delete(); du.delete(); dv.delete();
        } catch (e) { N = null; }
      }
      for (let i = 1; i <= nt; i++) {
        const t = T.Triangle(i); let a = t.Value(1) - 1, b = t.Value(2) - 1, c = t.Value(3) - 1; t.delete();
        if (rev) { const s = b; b = c; c = s; }
        for (const k of [a, b, c]) {
          soup.push(X[k * 3], X[k * 3 + 1], X[k * 3 + 2]);
          if (nrm) { if (N) nrm.push(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]); else nrm.push(NaN, NaN, NaN); }
        }
        grp.push(fi);
      }
      loc.delete();
    });
    return { soup: new Float32Array(soup), grp: new Int32Array(grp), nf: F.length, nrm: nrm ? new Float32Array(nrm) : null };
  }
  // Art der Fläche fi (Ebene, Zylinder, B-Spline …) für die Anzeige
  function faceType(shape, fi) {
    const f = faces(shape)[fi]; if (!f) return '';
    try { const a = new oc.BRepAdaptor_Surface(f, true), t = String(a.GetType()).replace('GeomAbs_', ''); a.delete(); return t; } catch (e) { return ''; }
  }

  // ---------- Operationen (liefern neue Formen) ----------
  // affin: p' = M·(p − c) + c + t  (M = Drehung · gleichmäßiger Maßstab, auch gespiegelt)
  function transform(shape, M, c, t) {
    M = M || [1, 0, 0, 0, 1, 0, 0, 0, 1]; c = c || [0, 0, 0]; t = t || [0, 0, 0];
    const b = [0, 1, 2].map(i => c[i] + t[i] - (M[i * 3] * c[0] + M[i * 3 + 1] * c[1] + M[i * 3 + 2] * c[2]));
    const tr = new oc.gp_Trsf();
    tr.SetValues(M[0], M[1], M[2], b[0], M[3], M[4], M[5], b[1], M[6], M[7], M[8], b[2]);
    const mk = new oc.BRepBuilderAPI_Transform(shape, tr, true, false), s = done(mk, 'Transformation'); mk.delete(); tr.delete();
    return s;
  }
  function translate(shape, t) { return transform(shape, null, null, t); }
  function bool(kind, a, b) {
    const C = kind === 'fuse' ? oc.BRepAlgoAPI_Fuse : kind === 'cut' ? oc.BRepAlgoAPI_Cut : oc.BRepAlgoAPI_Common;
    const mk = new C(a, b, PR()); const s = done(mk, kind === 'fuse' ? 'Vereinen' : kind === 'cut' ? 'Abziehen' : 'Schnittmenge'); mk.delete();
    return s;
  }
  // Boolean-Ergebnisse sind Verbunde; enthalten sie genau ein Volumen, dieses zurückgeben
  function single(s) { if (kindOf(s) !== 'COMPOUND') return s; const L = explore(s, 'SOLID'); return L.length === 1 ? L[0] : s; }
  function fuseAll(list) { let s = list[0]; for (let i = 1; i < list.length; i++) s = bool('fuse', s, list[i]); return single(unify(s)); }
  function cut(a, b) { return single(unify(bool('cut', a, b))); }
  function common(a, b) { return single(unify(bool('common', a, b))); }
  function reverse(shape) { return shape.Reversed(); }
  // Fläche entlang dir um d verschieben (Push/Pull): Prisma der Fläche anbauen (d > 0) bzw. abziehen (d < 0)
  function pushPull(shape, fis, dir, d) {
    if (!d) return shape;
    const F = faces(shape), prisms = [];
    for (const fi of fis) {
      const f = F[fi]; if (!f) continue;
      const mk = new oc.BRepPrimAPI_MakePrism(f, vec(dir.map(x => x * d)), true, true);
      prisms.push(done(mk, 'Prisma')); mk.delete();
    }
    if (!prisms.length) return shape;
    let s = shape;
    for (const p of prisms) s = bool(d > 0 ? 'fuse' : 'cut', s, p);
    return single(unify(s));
  }
  // großer Quader für Halbraum-Schnitte
  function box(mn, mx) { const mk = new oc.BRepPrimAPI_MakeBox(pnt(mn), pnt(mx)); const s = done(mk, 'Quader'); mk.delete(); return s; }
  function bboxOf(shape) {
    const bx = new oc.Bnd_Box(); oc.BRepBndLib.Add(shape, bx, false);
    const a = bx.CornerMin(), b = bx.CornerMax(), r = { mn: [a.X(), a.Y(), a.Z()], mx: [b.X(), b.Y(), b.Z()] };
    a.delete(); b.delete(); bx.delete(); return r;
  }
  // ebene Flächen von s, die in der Ebene axis = pos liegen
  function planarFacesAt(s, axis, pos, tol) {
    const out = [];
    for (const f of faces(s)) {
      let ok = false;
      try {
        const ad = new oc.BRepAdaptor_Surface(f, true);
        if (String(ad.GetType()) === 'GeomAbs_Plane') {
          const pl = ad.Plane(), ax = pl.Axis(), d = ax.Direction(), lp = pl.Location();
          const n = [d.X(), d.Y(), d.Z()], q = [lp.X(), lp.Y(), lp.Z()];
          ok = Math.abs(Math.abs(n[axis]) - 1) < 1e-7 && Math.abs(q[axis] - pos) < tol;
        }
        ad.delete();
      } catch (e) {}
      if (ok) out.push(f);
    }
    return out;
  }
  // Querschnitt an der Ebene axis = pos um d einfügen: Teil dahinter um d verschieben, Lücke mit dem Querschnitt füllen
  function insertSlab(shape, axis, pos, d) {
    const bb = bboxOf(shape), big = Math.max(1, ...[0, 1, 2].map(k => bb.mx[k] - bb.mn[k])) * 4;
    if (!(pos > bb.mn[axis] && pos < bb.mx[axis])) return null;
    const lo = bb.mn.map(v => v - big), hi = bb.mx.map(v => v + big);
    const loMx = hi.slice(); loMx[axis] = pos; const hiMn = lo.slice(); hiMn[axis] = pos;
    const A = common(shape, box(lo, loMx)), B = common(shape, box(hiMn, hi));
    const tol = Math.max(1e-6, big * 1e-7), caps = planarFacesAt(A, axis, pos, tol);
    if (!caps.length) throw new Error(Ti('Kein Querschnitt an der Ebene gefunden.'));
    const dv = [0, 0, 0]; dv[axis] = d;
    const parts = [A, translate(B, dv)];
    for (const f of caps) { const mk = new oc.BRepPrimAPI_MakePrism(f, vec(dv), true, true); parts.push(done(mk, 'Prisma')); mk.delete(); }
    return fuseAll(parts);
  }
  // Kanten runden / fasen: alle Kanten der Flächen fis (leer = alle Kanten des Körpers)
  function fillet(shape, fis, r, chamfer) {
    const F = faces(shape), src = fis && fis.length ? fis.map(i => F[i]).filter(Boolean) : [shape];
    const E = edgesOf(src); if (!E.length) return shape;
    const mk = chamfer ? new oc.BRepFilletAPI_MakeChamfer(shape) : new oc.BRepFilletAPI_MakeFillet(shape, ENUM('ChFi3d_FilletShape', 'ChFi3d_Rational'));
    for (const e of E) mk.Add(r, e);
    const s = done(mk, chamfer ? 'Fasen' : 'Runden'); mk.delete(); return s;
  }
  // Aushöhlen: Wandstärke th nach innen, Flächen fis bleiben offen
  function hollow(shape, fis, th) {
    const F = faces(shape), L = new oc.NCollection_List_TopoDS_Shape();
    for (const i of fis || []) if (F[i]) L.Append(F[i]);
    const mk = new oc.BRepOffsetAPI_MakeThickSolid();
    mk.MakeThickSolidByJoin(shape, L, -Math.abs(th), 1e-3, ENUM('BRepOffset_Mode', 'BRepOffset_Skin'), false, false, ENUM('GeomAbs_JoinType', 'GeomAbs_Arc'), false, PR());
    const s = done(mk, 'Aushöhlen'); mk.delete(); L.delete(); return s;
  }
  // Teile verbinden: Loft zwischen den Außenrändern zweier Flächen (A auf Körper sa, B auf sb), dann vereinen.
  // soft > 0: zusätzliche Zwischenquerschnitte (Ränder entlang der Flächennormalen versetzt) → weicher Übergang
  function bridge(sa, fa, nA, sb, fb, nB, dist, soft) {
    const wa = oc.BRepTools.OuterWire(faces(sa)[fa]), wb = oc.BRepTools.OuterWire(faces(sb)[fb]);
    const mk = new oc.BRepOffsetAPI_ThruSections(true, !(soft > 0), 1e-6);
    mk.CheckCompatibility(true);
    mk.AddWire(wa);
    if (soft > 0) {
      const k = Math.min(0.45, soft / 3) * dist;
      mk.AddWire(oc.TopoDS.Wire(translate(wa, nA.map(x => x * k))));
      mk.AddWire(oc.TopoDS.Wire(translate(wb, nB.map(x => x * k))));
    }
    mk.AddWire(wb);
    const loft = done(mk, 'Übergangsfläche'); mk.delete();
    return sa === sb ? fuseAll([sa, loft]) : fuseAll([sa, loft, sb]);
  }

  // ---------- Lücke füllen (tangential) ----------
  const V3s = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], V3d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const V3x = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const V3n = a => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
  const xyz = p => [p.X(), p.Y(), p.Z()];
  // Rand der Stirnfläche fi als geordnete, dichte Punktfolge; je Punkt die Richtung, in der die angrenzende
  // Seitenfläche über die Kante hinaus weiterläuft (senkrecht zur Kante in ihrer Tangentialebene, zur Lücke hin)
  function rimSamples(shape, fi, nEnd, total) {
    const F = faces(shape), fe = F[fi]; if (!fe) throw new Error(Ti('Fläche nicht gefunden.'));
    const E = edgesOf([oc.BRepTools.OuterWire(fe)]), segs = [];
    // Abtastdichte nach Kantenlänge (sonst liegt der Füllrand auf Sehnen statt auf der Kante)
    const lens = E.map(e => { const g = new oc.GProp_GProps(); oc.BRepGProp.LinearProperties(e, g, false, false); const m = g.Mass(); g.delete(); return m; });
    const sum = lens.reduce((x, y) => x + y, 0) || 1;
    E.forEach((e, ei) => {
      const per = Math.max(8, Math.ceil(total * lens[ei] / sum));
      let side = null;
      for (const f of F) { if (f.IsSame(fe)) continue; if (explore(f, 'EDGE').some(x => x.IsSame(e))) { side = f; break; } }
      // (u,v) auf der Seitenfläche aus der Parameterkurve der Kante (keine Punktprojektion: die belegt in diesem
      // Build je Aufruf ~0,7 MB WASM-Speicher, der nicht wieder frei wird)
      const ca = new oc.BRepAdaptor_Curve(e), t0 = ca.FirstParameter(), t1 = ca.LastParameter(), pts = [];
      let c2 = null, sa = null;
      if (side) { try { c2 = new oc.BRepAdaptor_Curve2d(e, side); sa = new oc.BRepAdaptor_Surface(side, true); } catch (err) { c2 = sa = null; } }
      const Q = new oc.gp_Pnt(0, 0, 0), du = new oc.gp_Vec(0, 0, 0), dv = new oc.gp_Vec(0, 0, 0);
      for (let k = 0; k <= per; k++) {
        const t = t0 + (t1 - t0) * k / per, P = ca.Value(t), p = xyz(P); let n = null;
        if (c2) {
          try { const uv = c2.Value(t); sa.D1(uv.X(), uv.Y(), Q, du, dv); uv.delete(); n = V3n(V3x(xyz(du), xyz(dv))); } catch (err) { n = null; }
        }
        // Kantentangente direkt aus der Kurve (die Sehne zu den Nachbarpunkten liegt an Ecken quer)
        let tg = null; try { const T1 = new oc.gp_Vec(0, 0, 0); ca.D1(t, P, T1); tg = xyz(T1); T1.delete(); if (!(V3d(tg, tg) > 1e-20)) tg = null; else tg = V3n(tg); } catch (err) { tg = null; }
        P.delete(); pts.push({ p, n, t: tg });
      }
      Q.delete(); du.delete(); dv.delete(); if (c2) c2.delete();
      ca.delete(); if (sa) sa.delete();
      segs.push(pts);
    });
    // Kanten zu einer Schleife verketten; am Stoß zweier Kanten die Seitenflächennormale beider merken (Ecke)
    const loop = segs.shift().slice(), d2 = (a, b) => { const v = V3s(a, b); return V3d(v, v); };
    const flip = s => { s.reverse(); for (const q of s) if (q.t) q.t = q.t.map(x => -x); };
    while (segs.length) {
      const end = loop[loop.length - 1].p; let bi = 0, rev = false, bd = Infinity;
      segs.forEach((s, i) => { const a = d2(s[0].p, end), b = d2(s[s.length - 1].p, end); if (a < bd) { bd = a; bi = i; rev = false; } if (b < bd) { bd = b; bi = i; rev = true; } });
      const s = segs.splice(bi, 1)[0]; if (rev) flip(s);
      loop[loop.length - 1].n2 = s[0].n;
      loop.push(...s.slice(1));
    }
    if (loop.length > 2 && d2(loop[0].p, loop[loop.length - 1].p) < 1e-12) { loop[0].n2 = loop[loop.length - 1].n; loop.pop(); }
    // Tangentialrichtung: d = n × Kantentangente, Vorzeichen zur Lücke hin (Stirnflächennormale);
    // an einer Ecke zwischen zwei nicht tangentialen Seitenflächen entlang ihrer gemeinsamen Kante
    const m = loop.length;
    for (let i = 0; i < m; i++) {
      const q = loop[i], t = q.t || V3n(V3s(loop[(i + 1) % m].p, loop[(i - 1 + m) % m].p));   // (Vorzeichen egal, d wird zur Lücke gedreht)
      let d = q.n ? V3n(V3x(q.n, t)) : nEnd.slice();
      if (q.n && q.n2 && Math.abs(V3d(q.n, q.n2)) < 0.94) { const e = V3x(q.n, q.n2); if (V3d(e, e) > 1e-12) d = V3n(e); }
      if (V3d(d, nEnd) < 0) d = d.map(x => -x);
      if (!(V3d(d, nEnd) > 0.02)) d = nEnd.slice();   // Seitenfläche parallel zur Stirnfläche: senkrecht weiter
      q.d = d;
    }
    return loop;
  }
  // geschlossene Punktfolge auf N Punkte gleicher Bogenlänge (Richtungen mitinterpoliert)
  function resampleLoop(L, N) {
    const m = L.length, c = new Float64Array(m + 1);
    for (let i = 1; i <= m; i++) c[i] = c[i - 1] + Math.sqrt(V3d(V3s(L[i % m].p, L[i - 1].p), V3s(L[i % m].p, L[i - 1].p)));
    const tot = c[m], out = []; let j = 0;
    for (let k = 0; k < N; k++) {
      const s = tot * k / N; while (j < m - 1 && c[j + 1] <= s) j++;
      const a = L[j], b = L[(j + 1) % m], f = c[j + 1] > c[j] ? (s - c[j]) / (c[j + 1] - c[j]) : 0;
      out.push({ p: a.p.map((x, q) => x + (b.p[q] - x) * f), d: V3n(a.d.map((x, q) => x + (b.d[q] - x) * f)) });
    }
    return out;
  }
  const centroid = L => { const c = [0, 0, 0]; for (const q of L) for (let k = 0; k < 3; k++) c[k] += q.p[k] / L.length; return c; };
  // Umlaufsinn um die Achse n (Fläche des Polygons)
  function areaAbout(L, n) { let s = [0, 0, 0]; for (let i = 0; i < L.length; i++) { const x = V3x(L[i].p, L[(i + 1) % L.length].p); s = [s[0] + x[0], s[1] + x[1], s[2] + x[2]]; } return V3d(s, n); }
  // Pole einer periodischen kubischen B-Spline mit gleichmäßigen Knoten durch die Punkte Q (zyklisch tridiagonal)
  function periodicPoles(Q) {
    const N = Q.length, P = Q.map(q => q.slice());
    for (let it = 0; it < 80; it++) for (let i = 0; i < N; i++) { const a = P[(i - 1 + N) % N], b = P[(i + 1) % N]; for (let k = 0; k < 3; k++) P[i][k] = (6 * Q[i][k] - a[k] - b[k]) / 4; }
    return P;
  }
  // Lücke zwischen Stirnfläche fa (Form sa, Normale nA zur Lücke) und fb (sb, nB) füllen. Die Füllfläche ist in
  // Längsrichtung kubisch (Bézier): ihre inneren Kontrollpunkte liegen in Verlängerung der Seitenflächen → tangentialer
  // Anschluss an beiden Rändern. tension = Länge der Tangenten in Vielfachen des Abstands. mode 'solid' | 'face'.
  function gapFill(sa, fa, nA, sb, fb, nB, opt) {
    opt = opt || {}; const N = Math.max(24, Math.min(400, opt.n || 160)), tension = opt.tension > 0 ? opt.tension : 0.35;
    let A = resampleLoop(rimSamples(sa, fa, nA, N * 6), N), B = resampleLoop(rimSamples(sb, fb, nB, N * 6), N);
    const cA = centroid(A), cB = centroid(B), axis = V3n(V3s(cB, cA)), dist = Math.sqrt(V3d(V3s(cB, cA), V3s(cB, cA)));
    if (!(dist > 1e-9)) throw new Error(Ti('Die beiden Flächen liegen aufeinander.'));
    if (areaAbout(A, axis) < 0) A.reverse();
    if (areaAbout(B, axis) < 0) B.reverse();
    // Startversatz von B: kleinste Abstandssumme der auf die Mitten bezogenen Punkte
    let best = 0, bc = Infinity;
    for (let s = 0; s < N; s++) { let c = 0; for (let i = 0; i < N; i += 2) { const a = V3s(A[i].p, cA), b = V3s(B[(i + s) % N].p, cB), v = V3s(a, b); c += V3d(v, v); } if (c < bc) { bc = c; best = s; } }
    B = B.slice(best).concat(B.slice(0, best));
    const h = tension * dist;
    const rows = [A.map(q => q.p), A.map(q => q.p.map((x, k) => x + q.d[k] * h)), B.map(q => q.p.map((x, k) => x + q.d[k] * h)), B.map(q => q.p)].map(periodicPoles);
    const poles = new oc.NCollection_Array2_gp_Pnt(1, N, 1, 4);
    for (let i = 0; i < N; i++) for (let r = 0; r < 4; r++) { const p = pnt(rows[r][(i + N - 1) % N]); poles.SetValue(i + 1, r + 1, p); p.delete(); }
    const uk = new oc.NCollection_Array1_double(1, N + 1), um = new oc.NCollection_Array1_int(1, N + 1);
    for (let i = 1; i <= N + 1; i++) { uk.SetValue(i, i - 1); um.SetValue(i, 1); }
    const vk = new oc.NCollection_Array1_double(1, 2), vm = new oc.NCollection_Array1_int(1, 2);
    vk.SetValue(1, 0); vk.SetValue(2, 1); vm.SetValue(1, 4); vm.SetValue(2, 4);
    const surf = new oc.Geom_BSplineSurface(poles, uk, vk, um, vm, 3, 3, true, false);
    // Verschiebung der Pole gegenüber den Knoten prüfen (Punkt bei u = 0 muss A[0] sein)
    const p0 = xyz(surf.Value(0, 0)), dev0 = Math.sqrt(V3d(V3s(p0, A[0].p), V3s(p0, A[0].p)));
    const mkF = new oc.BRepBuilderAPI_MakeFace(surf, 1e-6), face = done(mkF, 'Füllfläche'); mkF.delete();
    // größte Abweichung des Füllrands von den echten Kanten (zwischen den Stützpunkten)
    let dev = 0;
    for (const [L, v] of [[A, 0], [B, 1]]) for (let i = 0; i < N; i++) {
      const q = xyz(surf.Value(i + 0.5, v)), a = L[i].p, b = L[(i + 1) % N].p, mid = a.map((x, k) => (x + b[k]) / 2);
      dev = Math.max(dev, Math.sqrt(V3d(V3s(q, mid), V3s(q, mid))));
    }
    const info = { dev, dev0, N, tension, dist };
    if (opt.mode === 'face') return { shape: face, info };
    // Volumen: Seitenflächen beider Körper ohne die Stirnflächen + Füllfläche vernähen
    const tol = Math.max(1e-4, dev * 3, dist * 1e-6), sew = new oc.BRepBuilderAPI_Sewing(tol, true, true, true, false);
    faces(sa).forEach((f, i) => { if (i !== fa) sew.Add(f); });
    if (sb !== sa) faces(sb).forEach((f, i) => { if (i !== fb) sew.Add(f); });
    else faces(sa).forEach(() => {});
    sew.Add(face); sew.Perform(PR());
    const sh = sew.SewedShape(); sew.delete();
    const shells = explore(sh, 'SHELL'); if (shells.length !== 1) throw new Error(Ti('Vernähen ergab ') + shells.length + Ti(' Schalen (Ränder passen nicht genau).'));
    const fix = new oc.ShapeFix_Solid(); let so = fix.SolidFromShell(oc.TopoDS.Shell(shells[0])); fix.delete();
    if (volume(so) < 0) so = so.Reversed();
    info.tol = tol;
    return { shape: so, info };
  }

  const api = {
    available, ready, isReady, attach,
    readSTEP, splitBodies, writeSTEP, fromText, tess, faces, faceType, kindOf, valid, volume, bboxOf,
    transform, translate, fuseAll, cut, common, reverse, pushPull, insertSlab, fillet, hollow, bridge, unify, gapFill,
    get oc() { return oc; }
  };
  window.MeshOCC = api;
})();
