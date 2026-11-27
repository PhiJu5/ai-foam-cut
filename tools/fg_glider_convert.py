"""FlightGear-Segler (AC3D .ac + Modell-XML) -> kompaktes Datenpaket fsim_<id>.js fuer den Flugsimulator (flugsim.js).

Aufruf:  python -I tools/fg_glider_convert.py <Ordner mit FGAddon-Downloads> <Zielordner>
Erwartet je Typ den Ordner aus FGAddon trunk/Aircraft (LS4, ASK21, Ka6, Arcus, DG-300) mit Models/*.ac, Models/*.xml, Texturen.

Koordinaten: AC3D (x hinten, y oben, z links) -> FlightGear (x hinten, y rechts, z oben) = (x, -z, y)
             -> Simulator-Koerper (X vorn, Y oben, Z rechts) = (-x, y, -z)   (reine Drehung, keine Spiegelung)
Ruder-/Klappenanimationen (rotate/translate) aus der Modell-XML: Achse/Drehpunkt in Koerperkoordinaten, Grad je Einheit;
das Vorzeichen fuer Quer/Hoehe/Seite wird hier physikalisch festgelegt (+Quer: linkes Ruder runter, +Hoehe: Endleiste hoch,
+Seite: Endleiste nach rechts). Ecken je Teil als Uint16 im Quader, Normalen Int8, UV Uint16, Indizes Uint16/32.
Lizenz der Modelle: GNU GPL v2 oder spaeter (FlightGear-Wiki) - Datenpakete bleiben unter dieser Lizenz.
"""
import sys, os, re, math, json, base64, io
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]

MODELS = {
    'ls4': dict(dir='LS4', ac='Models/ls4.ac', xml='Models/ls4.xml', extra=['Models/pilot.ac'],
                name='Rolladen-Schneider LS4', credit='Bea Wolf (D-ECHO), nach der ASK 13 von Patrice Poly',
                hide=[r'^wheelR$', r'^wheelRfairing$', r'^wing\.struts$', r'^canopy\.jettison']),
    'ask21': dict(dir='ASK21', ac='Models/ask21.ac', xml='Models/ask21.xml', extra=[],
                  name='Schleicher ASK 21', credit='Heiko Schulz, AJ MacLeod, Thomas Polzer, Viktor Radnai, Bea Wolf, Gilberto Agostinho',
                  hide=[r'-mi', r'^engine', r'^engdoor', r'^prop', r'^spinner', r'^spinballast', r'^screw\.', r'^wingwheel', r'^pitot_extension$', r'^gearfairing1mi$']),
    'ka6': dict(dir='Ka6', ac='Models/ka6.ac', xml='Models/ka6.xml', extra=[],
                name='Schleicher Ka 6 CR', credit='Bea Wolf (D-ECHO), nach der ASK 13 von Patrice Poly',
                hide=[r'^cables\.disconnected$', r'cabrio', r'spring', r'^air_pressure_tubes$']),
    'arcus': dict(dir='Arcus', ac='Models/arcus.ac', xml='Models/Arcus.xml', extra=[],
                  name='Schempp-Hirth Arcus', credit='Bea Wolf (D-ECHO), nach der ASK 21',
                  hide=[r'\.m$', r'^engine', r'^prop', r'^wheelR\.m$']),
    'dg300': dict(dir='DG-300', ac='Models/dg300.ac', xml='Models/dg300.xml', extra=[],
                  name='Glaser-Dirks DG-300 Elan', credit='Bea Wolf (D-ECHO)', hide=[]),
}
CTL = {'left-aileron-pos-norm': 'ail', 'right-aileron-pos-norm': 'ail', 'elevator-pos-norm': 'ele',
       'rudder-pos-norm': 'rud', 'speedbrake-pos-norm': 'brk', 'spoiler-pos-norm': 'brk'}


def ac_to_body(p):
    return np.array([-p[0], p[1], -p[2]])


def fg_to_body(p):
    return np.array([-p[0], p[2], p[1]])


# ---------------- AC3D ----------------
def parse_ac(path):
    L = open(path, 'rb').read().decode('latin-1').splitlines()
    mats, objs, i = [], [], 0
    while i < len(L) and not L[i].startswith('OBJECT'):
        t = L[i].strip()
        if t.startswith('MATERIAL'):
            m = re.search(r'rgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+).*?trans\s+([-\d.e]+)', t)
            nm = re.search(r'MATERIAL\s+"([^"]*)"', t)
            mats.append(dict(name=nm.group(1) if nm else '', rgb=[float(m.group(k)) for k in (1, 2, 3)], trans=float(m.group(4))))
        i += 1

    def obj(M):
        nonlocal i
        i += 1
        o = dict(name='', tex=None, verts=None, surfs=[], crease=45.0)
        loc, rot, texoff, texrep = np.zeros(3), np.eye(3), (0.0, 0.0), (1.0, 1.0)
        verts = []
        while i < len(L):
            t = L[i].strip(); w = t.split()
            if not w:
                i += 1; continue
            k = w[0]
            if k == 'name': o['name'] = t[5:].strip().strip('"'); i += 1
            elif k == 'texture': o['tex'] = t.split('"')[1] if '"' in t else w[1]; i += 1
            elif k == 'texrep': texrep = (float(w[1]), float(w[2])); i += 1
            elif k == 'texoff': texoff = (float(w[1]), float(w[2])); i += 1
            elif k == 'crease': o['crease'] = float(w[1]); i += 1
            elif k == 'loc': loc = np.array([float(x) for x in w[1:4]]); i += 1
            elif k == 'rot': rot = np.array([float(x) for x in w[1:10]]).reshape(3, 3).T; i += 1
            elif k == 'numvert':
                n = int(w[1]); i += 1
                for _ in range(n): verts.append([float(x) for x in L[i].split()[:3]]); i += 1
            elif k == 'numsurf':
                n = int(w[1]); i += 1
                for _ in range(n):
                    flags, mat = 0, 0
                    while not L[i].strip().startswith('refs'):
                        s = L[i].split()
                        if s[0] == 'SURF': flags = int(s[1], 16)
                        elif s[0] == 'mat': mat = int(s[1])
                        i += 1
                    nr = int(L[i].split()[1]); i += 1; refs = []
                    for _ in range(nr):
                        s = L[i].split(); refs.append((int(s[0]), float(s[1]) * texrep[0] + texoff[0], float(s[2]) * texrep[1] + texoff[1])); i += 1
                    o['surfs'].append((flags, mat, refs))
            elif k == 'kids':
                nk = int(w[1]); i += 1
                Mo = M.copy(); Mo[:3, 3] = M[:3, :3] @ loc + M[:3, 3]; Mo[:3, :3] = M[:3, :3] @ rot
                V = np.array(verts) if verts else np.zeros((0, 3))
                o['verts'] = (V @ Mo[:3, :3].T + Mo[:3, 3]) if len(V) else V
                objs.append(o)
                for _ in range(nk): obj(Mo)
                return
            else:
                i += 1

    obj(np.eye(4))
    return mats, objs


# ---------------- Modell-XML ----------------
def anims_of(xml_path, axis_obj):
    root = ET.parse(xml_path).getroot()
    out = {}

    def f(e, p):
        x = e.find(p)
        return float(x.text) if x is not None and x.text and x.text.strip() not in ('',) else None
    for a in root.iter('animation'):
        ty = (a.findtext('type') or '').strip()
        if ty not in ('rotate', 'translate'): continue
        prop = (a.findtext('property') or '').strip().split('/')[-1]
        if prop not in CTL: continue
        fac = f(a, 'factor') or 0.0
        off = f(a, 'offset-deg') or f(a, 'offset-m') or 0.0
        ax = a.find('axis'); c = np.zeros(3); d = None
        if ax is not None:
            if ax.find('object-name') is not None:
                nm = ax.findtext('object-name').strip()
                if nm in axis_obj:
                    p0, p1 = axis_obj[nm]; c, d = p0, p1 - p0
            elif ax.find('x1-m') is not None:
                p0 = fg_to_body([f(ax, 'x1-m') or 0, f(ax, 'y1-m') or 0, f(ax, 'z1-m') or 0])
                p1 = fg_to_body([f(ax, 'x2-m') or 0, f(ax, 'y2-m') or 0, f(ax, 'z2-m') or 0])
                c, d = p0, p1 - p0
            else:
                d = fg_to_body([f(ax, 'x') or 0, f(ax, 'y') or 0, f(ax, 'z') or 0])
                ce = a.find('center')
                if ce is not None: c = fg_to_body([f(ce, 'x-m') or 0, f(ce, 'y-m') or 0, f(ce, 'z-m') or 0])
        if d is None or np.linalg.norm(d) < 1e-9: continue
        d = d / np.linalg.norm(d)
        rec = dict(t='r' if ty == 'rotate' else 't', c=CTL[prop], p=[round(x, 5) for x in c], a=[round(x, 6) for x in d], f=fac, o=off)
        for o in a.findall('object-name'):
            out.setdefault(o.text.strip(), []).append(rec)
    return out


def rotate_pts(P, c, a, deg):
    t = math.radians(deg); a = np.asarray(a); v = P - c
    return c + v * math.cos(t) + np.cross(a, v) * math.sin(t) + np.outer(v @ a, a) * (1 - math.cos(t))


# ---------------- Netz je Objekt ----------------
def mesh_of(o):
    V = o['verts']; tris = []
    for flags, mat, refs in o['surfs']:
        if flags & 0x0F: continue                     # Linien
        if len(refs) < 3: continue
        for k in range(1, len(refs) - 1): tris.append((mat, refs[0], refs[k], refs[k + 1]))
    if not tris: return None
    P = np.array([ac_to_body(p) for p in V]) if len(V) else np.zeros((0, 3))
    fn = []
    for mat, a, b, c in tris:
        n = np.cross(P[b[0]] - P[a[0]], P[c[0]] - P[a[0]]); fn.append(n)
    # AC3D-Umlaufsinn (gegen den Uhrzeigersinn) wird durch die Achsdrehung nicht gespiegelt
    fn = np.array(fn); fu = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    by_v = {}
    for ti, (mat, a, b, c) in enumerate(tris):
        for r in (a, b, c): by_v.setdefault(r[0], []).append(ti)
    cos_cr = math.cos(math.radians(min(89.0, max(1.0, o['crease']))))
    verts, index, idx = {}, [], []
    out_P, out_N, out_U = [], [], []
    mats = set()
    for ti, (mat, a, b, c) in enumerate(tris):
        mats.add(mat)
        for r in (a, b, c):
            ns = np.zeros(3)
            for tj in by_v[r[0]]:
                if fu[tj] @ fu[ti] >= cos_cr: ns += fn[tj]
            nl = np.linalg.norm(ns); nn = ns / nl if nl > 1e-12 else fu[ti]
            key = (r[0], round(r[1], 5), round(r[2], 5), int(nn[0] * 60), int(nn[1] * 60), int(nn[2] * 60))
            if key not in verts:
                verts[key] = len(out_P); out_P.append(P[r[0]]); out_N.append(nn); out_U.append((r[1], 1.0 - r[2]))
            idx.append(verts[key])
    return dict(P=np.array(out_P), N=np.array(out_N), U=np.array(out_U), I=np.array(idx, dtype=np.int64), mats=mats)


def b64(a): return base64.b64encode(a.tobytes()).decode('ascii')


def pack(name, m, mat, tex, glass, anims):
    P, N, U, I = m['P'], m['N'], m['U'], m['I']
    lo, hi = P.min(0), P.max(0); span = np.maximum(hi - lo, 1e-6)
    q = np.round((P - lo) / span * 65535).astype('<u2')
    nq = np.clip(np.round(N * 127), -127, 127).astype('i1')
    ulo, uhi = U.min(0), U.max(0); us = np.maximum(uhi - ulo, 1e-9)
    uq = np.round((U - ulo) / us * 65535).astype('<u2')
    ii = I.astype('<u2' if len(P) < 65536 else '<u4')
    return dict(n=name, col=[round(x, 3) for x in mat['rgb']], tr=round(mat['trans'], 3), tex=tex, gl=1 if glass else 0,
                lo=[round(float(x), 5) for x in lo], hi=[round(float(x), 5) for x in hi], ulo=[float(x) for x in ulo], uhi=[float(x) for x in uhi],
                nv=len(P), ni=len(I), i32=0 if len(P) < 65536 else 1, P=b64(q), N=b64(nq), U=b64(uq), I=b64(ii), an=anims)


def concat(ms):
    P, N, U, I, off = [], [], [], [], 0
    for m in ms:
        P.append(m['P']); N.append(m['N']); U.append(m['U']); I.append(m['I'] + off); off += len(m['P'])
    return dict(P=np.vstack(P), N=np.vstack(N), U=np.vstack(U), I=np.concatenate(I))


def texture(path):
    im = Image.open(path); has_a = im.mode in ('RGBA', 'LA') and im.getextrema()[-1][0] < 250
    im = im.convert('RGBA' if has_a else 'RGB')
    if max(im.size) > 1024: im = im.resize((min(1024, im.size[0]), min(1024, im.size[1])), Image.LANCZOS)
    buf = io.BytesIO()
    if has_a: im.save(buf, 'PNG', optimize=True); mime = 'image/png'
    else: im.save(buf, 'JPEG', quality=86, optimize=True); mime = 'image/jpeg'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(buf.getvalue()).decode('ascii'))


def convert(mid, spec):
    base = os.path.join(SRC, spec['dir'])
    mats, objs = parse_ac(os.path.join(base, spec['ac']))
    for e in spec['extra']:
        m2, o2 = parse_ac(os.path.join(base, e)); off = len(mats); mats += m2
        for o in o2: o['surfs'] = [(fl, mt + off, r) for fl, mt, r in o['surfs']]
        objs += o2
    axis_obj = {}
    for o in objs:
        if o['verts'] is not None and len(o['verts']) == 2:
            axis_obj[o['name']] = (ac_to_body(o['verts'][0]), ac_to_body(o['verts'][1]))
    anims = anims_of(os.path.join(base, spec['xml']), axis_obj)
    hide = [re.compile(h) for h in spec['hide']]
    parts_static, parts, texs, wing_pts = {}, [], {}, []
    for o in objs:
        nm = o['name']
        if o['verts'] is None or len(o['verts']) < 3 or nm.endswith('_axis') or nm.endswith('.axis'): continue
        if any(h.search(nm) for h in hide): continue
        m = mesh_of(o)
        if m is None: continue
        mat = mats[min(m['mats'])] if m['mats'] else dict(rgb=[1, 1, 1], trans=0)
        glass = mat['trans'] > 0.3
        if glass and nm.endswith('.int'): continue     # Innenansicht-Glas doppelt
        if not glass: wing_pts.append((m['P'], m['I']))
        an = [dict(x) for x in anims.get(nm, [])]
        # Querruder ohne XML-Achse (Ka 6, DG-300): Scharnier aus der Geometrie (vorderste Punkte an Innen- und Außenende)
        if re.match(r'^aileron', nm, re.I) and not any(a['c'] == 'ail' for a in an):
            P = m['P']; z = np.abs(P[:, 2]); zi, zo = z.min(), z.max(); band = (zo - zi) * 0.08
            ends = []
            for sel in (z <= zi + band, z >= zo - band):
                Q = P[sel]; j = np.argmax(Q[:, 0]); ends.append(np.array([Q[j, 0], Q[:, 1].mean(), Q[j, 2]]))
            d = ends[1] - ends[0]; d = d / np.linalg.norm(d)
            an.append(dict(t='r', c='ail', p=[round(x, 5) for x in ends[0]], a=[round(x, 6) for x in d], f=20.0, o=0.0))
        # Vorzeichen physikalisch festlegen
        cen = m['P'].mean(0)
        for a in an:
            if a['t'] != 'r' or a['c'] == 'brk': a['s'] = 1; continue
            q = rotate_pts(cen[None, :], np.array(a['p']), np.array(a['a']), 5.0 * (1 if a['f'] >= 0 else -1))[0] - cen
            if a['c'] == 'ail': want = -1 if cen[2] < 0 else 1; got = np.sign(q[1])
            elif a['c'] == 'ele': want, got = 1, np.sign(q[1])
            else: want, got = 1, np.sign(q[2])
            # wirksamer Winkel = s·f·Wert: in FG-Richtung (Vorzeichen von f), wenn die Probe stimmt, sonst umgekehrt
            a['s'] = (1 if got == want or got == 0 else -1) * (1 if a['f'] >= 0 else -1)
            a['f'] = abs(a['f'])
            # sichtbarer Mindestausschlag der Ruderflächen (manche FG-Modelle animieren nur wenige Grad)
            if re.match(r'^(aileron|flaperon|elevator|rudder)', nm, re.I): a['f'] = max(a['f'], {'ail': 16.0, 'ele': 18.0, 'rud': 22.0}[a['c']])
        tex = o['tex'] if o['tex'] else None
        if tex and tex not in texs:
            tp = os.path.join(base, 'Models', tex)
            if os.path.exists(tp): texs[tex] = texture(tp)
            else: tex = None
        if an or glass:
            parts.append(pack(nm, m, mat, tex, glass, an))
        else:
            parts_static.setdefault((tex, tuple(mat['rgb'])), []).append((nm, m, mat))
    for (tex, _), lst in parts_static.items():
        # zu große Sammlungen teilen (Uint16-Indizes)
        group, cnt = [], 0
        for item in lst + [None]:
            if item is None or (cnt + len(item[1]['P']) > 60000 and group):
                if group: parts.insert(0, pack('+'.join(g[0] for g in group)[:80], concat([g[1] for g in group]), group[0][2], tex, False, []))
                group, cnt = [], 0
            if item is not None: group.append(item); cnt += len(item[1]['P'])
    # Spannweite aus allen undurchsichtigen Teilen (Flügelspitzen liegen außen); Wurzeltiefe: Punkte knapp außerhalb des Rumpfs,
    # vor dem Leitwerksbereich (Höhenleitwerk liegt hinten)
    W = np.vstack([p for p, _ in wing_pts])
    span = float(W[:, 2].max() - W[:, 2].min()); x0, x1 = W[:, 0].min(), W[:, 0].max()
    # Flügeltiefe im Schnitt z = ±1,5 m (Dreiecke schneiden; Ecken liegen oft nur an den Rippenstößen)
    cut = []
    for P, I in wing_pts:
        T = P[I.reshape(-1, 3)]
        for zc in (1.5, -1.5):
            d = T[:, :, 2] - zc
            for e0, e1 in ((0, 1), (1, 2), (2, 0)):
                m_ = (d[:, e0] * d[:, e1]) < 0
                if not m_.any(): continue
                t = d[m_, e0] / (d[m_, e0] - d[m_, e1])
                cut.append(T[m_, e0] + (T[m_, e1] - T[m_, e0]) * t[:, None])
    root = np.vstack(cut); root = root[root[:, 0] > x0 + 0.4 * (x1 - x0)]
    allP = np.vstack([np.array(p['lo'])[None, :] for p in parts] + [np.array(p['hi'])[None, :] for p in parts])
    ref = dict(span=round(span, 4), le=round(float(root[:, 0].max()), 4), te=round(float(root[:, 0].min()), 4), yw=round(float(root[:, 1].mean()), 4),
               bot=round(float(allP[:, 1].min()), 4), xmin=round(float(allP[:, 0].min()), 4), xmax=round(float(allP[:, 0].max()), 4))
    data = dict(v=1, id=mid, name=spec['name'], credit=spec['credit'], license='GPL-2.0-or-later',
                source='FlightGear FGAddon, trunk/Aircraft/' + spec['dir'], ref=ref, tex=texs, parts=parts)
    js = ('/* fsim_%s.js — Flugsimulator: %s aus FlightGear (FGAddon, Aircraft/%s), Modell: %s.\n'
          ' * Lizenz: GNU GPL v2 oder später (siehe THIRD_PARTY_LICENSES.md). Erzeugt mit tools/fg_glider_convert.py —\n'
          ' * nicht von Hand bearbeiten. Ecken je Teil Uint16 im Quader lo…hi (Körper: X vorn, Y oben, Z rechts, Meter, Original 1:1),\n'
          ' * Normalen Int8, UV Uint16 in ulo…uhi, Indizes Uint16/32; an = Ruderanimationen (Drehpunkt p, Achse a, Grad f je Einheit). */\n'
          '(window.FsimGliders = window.FsimGliders || {})[%s] = %s;\n') % (mid, spec['name'], spec['dir'], spec['credit'], json.dumps(mid), json.dumps(data, separators=(',', ':')))
    open(os.path.join(OUT, 'fsim_%s.js' % mid), 'w', encoding='utf-8', newline='\n').write(js)
    na = sum(len(p['an']) for p in parts)
    print('%-6s Teile %3d  Ecken %6d  Dreiecke %6d  Anim %2d  Texturen %d  Spannweite %.2f m  Wurzel %.2f..%.2f  -> %d kB' % (
        mid, len(parts), sum(p['nv'] for p in parts), sum(p['ni'] for p in parts) // 3, na, len(texs), span, ref['te'], ref['le'], len(js) // 1024))
    for p in parts:
        if p['an']: print('        ', p['n'], [(a['t'], a['c'], a['f'], a.get('s')) for a in p['an']])


for mid in (sys.argv[3:] or MODELS):
    convert(mid, MODELS[mid])
