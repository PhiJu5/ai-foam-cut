"""XFOIL-Anbindung fuer den Reiter „Aerodynamik“ (Endpunkt /__xfoil__).

Startet das echte xfoil.exe (Drela, MIT) als Unterprozess: Profil als .dat
schreiben, Befehle ueber stdin (Grafik aus, PANE, OPER/VISC/PACC/ASEQ), Polar-
datei zuruecklesen. Mehrere Re-Stufen laufen parallel in eigenen Temp-Ordnern.
Gemeinsam genutzt von launcher.py und .claude/dev_server.py (electron/server.js
hat eine eigene Node-Fassung derselben Logik).

GET  -> {"ok": true, "exe": Pfad oder null}
POST {"name", "pts": [[x,y],...], "exe"?, "cores"?, "jobs": [{Re, type, ncrit, a0, a1, da, mach, iter, pts?, name?}]}
     cores = gleichzeitige XFOIL-Prozesse (0/fehlt = alle CPU-Kerne)
     -> {"ok": true, "results": [{"Re", "type", "ncrit", "pts": [{alpha, cl, cd, cdp, cm, xtrU, xtrL}]} | null]}
"""
import json, math, os, re, shutil, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor

TIMEOUT = 120         # Sekunden je XFOIL-Prozess hoechstens
STALL = 8             # Sekunden ohne neuen Polarpunkt → Prozess beenden (Haenger am Abriss)


def find_exe(dirs, wanted=None):
    """xfoil.exe suchen: erst der in den Einstellungen angegebene Pfad (nur wenn
    er wirklich auf xfoil*.exe zeigt — der Endpunkt startet sonst beliebige
    Programme), dann XFOIL/xfoil.exe in den uebergebenen Ordnern, dann PATH."""
    if wanted:
        w = os.path.abspath(os.path.expanduser(str(wanted)))
        if os.path.isdir(w):
            w = os.path.join(w, "xfoil.exe" if os.name == "nt" else "xfoil")
        if re.match(r"^xfoil[\w.-]*?(\.exe)?$", os.path.basename(w), re.I) and os.path.isfile(w):
            return w
    names = ["xfoil.exe", "xfoil"] if os.name == "nt" else ["xfoil", "xfoil.exe"]
    for d in dirs:
        for sub in ("XFOIL", "xfoil", ""):
            for nm in names:
                p = os.path.join(d, sub, nm)
                if os.path.isfile(p):
                    return p
    return shutil.which("xfoil")


def _prep_points(pts):
    """Profilpunkte fuer XFOIL: Doppelpunkte raus, Umlauf Endleiste → Oberseite →
    Nase → Unterseite (positive Flaeche), Nase auf 0, Sehne auf 1 — OHNE Drehung,
    damit Alpha wie bei NeuralFoil/Windkanal auf die x-Achse des Profils bezogen bleibt."""
    P = []
    for q in pts:
        x, y = float(q[0]), float(q[1])
        if not (math.isfinite(x) and math.isfinite(y)):
            continue
        if P and abs(P[-1][0] - x) < 1e-9 and abs(P[-1][1] - y) < 1e-9:
            continue
        P.append((x, y))
    if len(P) < 10:
        return None
    a = sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1] for i in range(len(P)))
    if a < 0:
        P.reverse()
    te = ((P[0][0] + P[-1][0]) / 2, (P[0][1] + P[-1][1]) / 2)
    le = max(P, key=lambda q: (q[0] - te[0]) ** 2 + (q[1] - te[1]) ** 2)
    c = math.hypot(te[0] - le[0], te[1] - le[1]) or 1.0
    return [((x - le[0]) / c, (y - le[1]) / c) for x, y in P]


def _num(v, d, lo, hi):
    try:
        v = float(v)
    except Exception:
        return d
    return d if not math.isfinite(v) else max(lo, min(hi, v))


def _dir_size(d):
    try:
        return sum(e.stat().st_size for e in os.scandir(d))
    except OSError:
        return -1


def _sweep(exe, d, head, seq, polname):
    """Ein XFOIL-Prozess mit Wachhund: XFOIL bleibt nahe dem Abriss gern in
    einer Endlosschleife haengen. Kommt STALL Sekunden lang keine neue
    Ausgabe (Polarpunkt/Dump), oder ist TIMEOUT erreicht, wird er beendet —
    die bis dahin geschriebenen Punkte zaehlen. seq = Befehle nach PACC."""
    pol = os.path.join(d, polname)
    cmd = head + ["PACC", polname, ""] + list(seq) + ["", "QUIT", ""]
    kw = {}
    if os.name == "nt":
        kw["creationflags"] = 0x08000000              # CREATE_NO_WINDOW
    pr = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, cwd=d, **kw)
    try:
        pr.stdin.write("\n".join(cmd).encode("ascii")); pr.stdin.close()
    except OSError:
        pass
    t0 = last = time.time(); size = -1
    while pr.poll() is None:
        time.sleep(0.1)
        now = time.time()
        sz = _dir_size(d)
        if sz != size:
            size, last = sz, now
        if now - last > STALL or now - t0 > TIMEOUT:
            pr.kill(); pr.wait()
            break
    pts = []
    try:
        with open(pol) as f:
            body = False
            for ln in f:
                if ln.strip().startswith("------"):
                    body = True; continue
                if not body:
                    continue
                v = ln.split()
                if len(v) < 7:
                    continue
                try:
                    al, cl, cd, cdp, cm, xu, xl = (float(t) for t in v[:7])
                except ValueError:
                    continue
                pts.append({"alpha": al, "cl": cl, "cd": cd, "cdp": cdp, "cm": cm, "xtrU": xu, "xtrL": xl})
    except OSError:
        pass
    return pts


def _read_dump(path):
    """DUMP-Datei: nur die Profiloberflaeche (Endleiste oben → Nase → Endleiste
    unten); der Nachlauf beginnt mit einer Zeile, deren s nicht mehr waechst."""
    rows, s0 = [], -1.0
    try:
        with open(path) as f:
            for ln in f:
                if ln.startswith("#"):
                    continue
                v = ln.split()
                if len(v) < 7:
                    continue
                try:
                    s, x, y, ue, ds, th, cf = (float(t) for t in v[:7])
                except ValueError:
                    continue
                if rows and s <= s0:
                    break
                s0 = s
                rows.append([round(x, 6), round(y, 6), round(ue, 5), round(cf, 6)])
    except OSError:
        return None
    return rows if len(rows) > 20 else None


def _run_dump(exe, d, head, job, visc, Re, ncrit):
    """Umstroemung: je Anstellwinkel Oberflaechengeschwindigkeit + cf (DUMP),
    Beiwerte/Umschlag aus der Polardatei (nur konvergierte Punkte). Zwei Laeufe
    ab 0° nach oben/unten wie bei den Polaren."""
    al = sorted({round(_num(a, 0, -30, 30), 3) for a in (job.get("alphas") or [])[:200]})
    if not al:
        return None
    up = [a for a in al if a >= 0]
    dn = sorted((a for a in al if a < 0), reverse=True)
    names = {}
    def seq(lst, tag):
        out = []
        for i, a in enumerate(lst):
            fn = "%s%03d.txt" % (tag, i); names[a] = fn
            out += ["ALFA %.4f" % a, "DUMP " + fn]
        return out
    pts = []
    if up:
        pts += _sweep(exe, d, head, seq(up, "u"), "pu.txt")
    if dn:
        pts += _sweep(exe, d, head, seq(dn, "d"), "pd.txt")
    conv = {round(q["alpha"], 3): q for q in pts}
    res = []
    for a in al:
        rows = _read_dump(os.path.join(d, names[a]))
        if not rows:
            continue
        q = conv.get(a)
        res.append({"alpha": a, "conv": bool(q) or not visc, "rows": rows,
                    "cl": q["cl"] if q else None, "cd": q["cd"] if q else None, "cm": q["cm"] if q else None,
                    "xtrU": q["xtrU"] if q else None, "xtrL": q["xtrL"] if q else None})
    return {"dump": True, "visc": visc, "Re": Re, "ncrit": ncrit, "alphas": res} if res else None


def _run_points(exe, d, head, pq, typ, Re, ncrit):
    """Einzelpunkte (Profiloptimierung): {alphas: [...], cls: [...]} — je Liste
    ein Prozess, aufsteigend (warmer Start von Punkt zu Punkt). Nur
    konvergierte Punkte kommen zurueck; der Aufrufer ordnet sie zu."""
    al = sorted({round(_num(a, 0, -30, 30), 4) for a in (pq.get("alphas") or [])[:100]})
    cl = sorted({round(_num(c, 0, -3, 4), 4) for c in (pq.get("cls") or [])[:100]})
    pts = []
    if al:
        pts += _sweep(exe, d, head, ["ALFA %.4f" % a for a in al], "pa.txt")
    if cl:
        # Anlauf: XFOIL konvergiert bei einem kalt angefragten cl (v. a. Typ 2)
        # oft nicht — Zwischenpunkte in 0,15er-Schritten davor (kommen mit
        # zurueck, der Aufrufer ordnet nur die angefragten Werte zu)
        warm = [round(0.1 + 0.15 * k, 4) for k in range(20) if 0.1 + 0.15 * k < cl[0] - 0.05]
        pts += _sweep(exe, d, head, ["CL %.4f" % c for c in warm + cl], "pc.txt")
    return {"points": True, "Re": Re, "type": typ, "ncrit": ncrit, "pts": pts}


def _run_one(exe, name, P, job):
    Re = _num(job.get("Re"), 1e5, 1e3, 1e8)
    typ = 2 if int(_num(job.get("type"), 1, 1, 2)) == 2 else 1
    ncrit = _num(job.get("ncrit"), 9, 0.5, 20)
    a0 = _num(job.get("a0"), -6, -30, 30)
    a1 = _num(job.get("a1"), 18, -30, 30)
    da = abs(_num(job.get("da"), 0.5, 0.05, 5))
    mach = _num(job.get("mach"), 0, 0, 0.8)
    it = int(_num(job.get("iter"), 100, 10, 500))
    a0, a1 = min(a0, a1), max(a0, a1)
    d = tempfile.mkdtemp(prefix="xfoil_")
    try:
        with open(os.path.join(d, "foil.dat"), "w") as f:
            f.write((re.sub(r"[^\w .,()+-]", "_", name or "Profil")[:60] or "Profil") + "\n")
            for x, y in P:
                f.write("%.7f %.7f\n" % (x, y))
        # Zwei getrennte Laeufe ab ~0° (nach oben / nach unten) — XFOIL
        # konvergiert vom anliegenden Zustand aus deutlich besser als von a0,
        # und ein Haenger kurz vor dem Abriss reisst die negativen Winkel nicht mit.
        s = max(a0, min(a1, 0.0))
        visc = job.get("visc") is not False
        head = ["PLOP", "G F", "", "LOAD foil.dat", "PANE", "OPER", "TYPE %d" % typ]
        if visc:
            head += ["VISC %.6g" % Re]
        head += ["MACH %.4f" % mach, "VPAR", "N %.3f" % ncrit, "", "ITER %d" % it]
        if job.get("dump"):
            return _run_dump(exe, d, head, job, visc, Re, ncrit)
        if job.get("points"):
            return _run_points(exe, d, head, job.get("points") or {}, typ, Re, ncrit)
        pts = []
        if a1 >= s:
            pts += _sweep(exe, d, head, ["ASEQ %.4f %.4f %.4f" % (s, a1, da)], "pu.txt")
        if a0 < s - 1e-9:
            pts += _sweep(exe, d, head, ["ASEQ %.4f %.4f %.4f" % (s - da, a0, -da)], "pd.txt")
        pts.sort(key=lambda q: q["alpha"])
        out = []
        for q in pts:                                # Doppelpunkte (Start beider Laeufe) raus
            if out and abs(out[-1]["alpha"] - q["alpha"]) < 1e-6:
                continue
            out.append(q)
        return {"Re": Re, "type": typ, "ncrit": ncrit, "pts": out} if len(out) > 2 else None
    finally:
        shutil.rmtree(d, ignore_errors=True)


def handle(body, dirs):
    """POST-Rumpf (bytes) → Antwort (bytes, JSON)."""
    try:
        req = json.loads(body.decode("utf-8") or "{}")
    except Exception:
        return json.dumps({"ok": False, "err": "bad json"}).encode()
    exe = find_exe(dirs, req.get("exe"))
    if not exe:
        return json.dumps({"ok": False, "err": "xfoil.exe nicht gefunden"}).encode()
    # Profil oben fuer alle Laeufe, oder je Lauf eigenes "pts"/"name" (dann
    # rechnen mehrere Profile gemeinsam ueber alle Kerne)
    P0 = _prep_points(req.get("pts") or []) if req.get("pts") else None
    jobs = [j for j in list(req.get("jobs") or [])[:400] if isinstance(j, dict)]
    work = []
    for j in jobs:
        P = _prep_points(j["pts"]) if j.get("pts") else P0
        work.append((j.get("name") or req.get("name"), P, j))
    # Kerne: manuell eingestellt (cores > 0) oder alle; nie mehr als Laeufe
    ncpu = os.cpu_count() or 4
    try:
        want = int(req.get("cores") or 0)
    except Exception:
        want = 0
    n = max(1, min(len(work) or 1, want if want > 0 else ncpu, ncpu))
    with ThreadPoolExecutor(n) as ex:
        def one(w):
            t0 = time.time()
            r = _run_one(exe, w[0], w[1], w[2]) if w[1] else None
            if isinstance(r, dict):
                r["t"] = round(time.time() - t0, 2)       # Rechenzeit (Diagnose)
            return r
        res = list(ex.map(one, work))
    return json.dumps({"ok": True, "exe": exe, "cores": n, "results": res}).encode()


def info(dirs, wanted=None):
    return json.dumps({"ok": True, "exe": find_exe(dirs, wanted), "cpus": os.cpu_count() or 1}).encode()


def same_origin(headers):
    """Nur Anfragen der App selbst: fremde Webseiten koennten sonst per
    Formular-POST an 127.0.0.1 XFOIL-Laeufe anstossen."""
    o = headers.get("Origin")
    if not o:
        return True
    h = headers.get("Host", "")
    return re.sub(r"^https?://", "", o).rstrip("/") == h


if __name__ == "__main__":                           # Schnelltest: python xfoilrun.py
    here = os.path.dirname(os.path.abspath(__file__))
    t = [i / 60 for i in range(61)]
    up = [(1 - math.cos(math.pi * s)) / 2 for s in t]
    def yt(x): return 0.6 * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    pts = [[x, yt(x)] for x in reversed(up)] + [[x, -yt(x)] for x in up[1:]]
    r = handle(json.dumps({"name": "NACA0012", "pts": pts, "jobs": [{"Re": 2e5}, {"Re": 5e5, "type": 2}]}).encode(), [here])
    print(r.decode()[:600])
