"""AI Foam Cut - Build-Tool mit Oberflaeche.

Zeigt alle optionalen Funktionen (aus features.json) mit Haekchen an, dazu
Versionsnummer, exe-Name und Ablaufdatum, und baut daraus die exe. Nur die
angehakten Funktionen (und immer der Kern) landen in der exe; die Reiter der
weggelassenen Funktionen werden aus der HTML entfernt.

Auswahlen lassen sich als Profil speichern (build_profiles/*.json), z. B.
"Tester Meier" = nur Basis + Stege.

Aufruf:
    python build_tool.py                       -> Oberflaeche
    python build_tool.py --profile NAME        -> ohne Oberflaeche mit gespeichertem Profil bauen
    python build_tool.py --profile NAME --version 1.30

Am einfachsten: BUILD_TOOL.bat doppelklicken.
Der Quellordner wird NICHT veraendert - der Build laeuft in build/_stage_<name>/.
"""
import os, re, sys, json, glob, shutil, datetime, subprocess, threading, queue

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = "AI Foam Cut.html"
ENTRY = "launcher.py"
MANIFEST = "features.json"
PROFILE_DIR = os.path.join(HERE, "build_profiles")
BASENAME = "AI Foam Cut"


# ---------------------------------------------------------------- Manifest
def load_manifest():
    with open(os.path.join(HERE, MANIFEST), encoding="utf-8") as f:
        m = json.load(f)
    feats = m.get("features", [])
    for ft in feats:
        ft.setdefault("files", [])
        ft.setdefault("tabs", [])
        ft.setdefault("views", [])       # <div class="view" id="..."> zum Entfernen
        ft.setdefault("requires", [])    # IDs anderer Funktionen, die gebraucht werden
        ft.setdefault("kern_bis", "")    # war bis zu diesem Datum fester Bestandteil des Kerns
        ft.setdefault("default", True)
        ft.setdefault("description", "")
        ft.setdefault("demo", False)      # kann als Demo (ohne Export) gebaut werden
    return feats


def html_scripts(html):
    """Alle <script src="x.js?v=..."> der HTML in Ladereihenfolge."""
    return re.findall(r'<script src="([^"?]+\.js)', html)


def read_html():
    with open(os.path.join(HERE, HTML), encoding="utf-8") as f:
        return f.read()


def core_files(feats, html):
    """Kern = alle in der HTML eingebundenen Skripte, die keinem Feature gehoeren."""
    feat_files = {f for ft in feats for f in ft["files"]}
    return [s for s in html_scripts(html) if s not in feat_files]


def resolve_requires(feats, selected):
    """Gewaehlte Funktionen um ihre Voraussetzungen ergaenzen (transitiv).
    Liefert (menge, hinzugekommen). Beispiel: 'cad' zieht 'dxfshapes' mit."""
    by = {ft["id"]: ft for ft in feats}
    out, todo = set(selected), list(selected)
    while todo:
        ft = by.get(todo.pop())
        if not ft:
            continue
        for r in ft["requires"]:
            if r in by and r not in out:
                out.add(r); todo.append(r)
    return out, sorted(out - set(selected))


def profile_features(p, feats):
    """Funktionsauswahl aus einem gespeicherten Profil. Funktionen, die es beim
    Speichern noch nicht gab (sie steckten damals im Kern), gelten als angehakt -
    sonst verloere ein altes Testerprofil stillschweigend ganze Reiter."""
    chosen = set(p.get("features", []))
    known = set(p.get("known") or [ft["id"] for ft in feats if not ft["kern_bis"]])
    return sorted(ft["id"] for ft in feats if ft["id"] in chosen or ft["id"] not in known)


def dependents(feats, fid):
    """IDs der Funktionen, die fid brauchen (direkt)."""
    return [ft["id"] for ft in feats if fid in ft["requires"]]


def drop_view_divs(html, view_ids):
    """<div class="view" id="xView"> ... </div> samt Inhalt entfernen. Ohne das
    bliebe das Markup abgewaehlter Reiter in der exe stehen."""
    for vid in view_ids:
        m = re.search(r'[ \t]*<div class="view[^"]*" id="%s"[^>]*>' % re.escape(vid), html)
        if not m:
            raise RuntimeError('Ansicht id="%s" nicht in der HTML gefunden.' % vid)
        depth, cut = 1, None
        for tag in re.finditer(r'<(/?)div\b', html[m.end():]):
            depth += -1 if tag.group(1) else 1
            if depth == 0:
                cut = m.end() + tag.end()
                break
        if cut is None:
            raise RuntimeError('Ansicht id="%s": kein passendes </div> gefunden.' % vid)
        cut = html.find(">", cut) + 1                      # schliessendes </div> mitnehmen
        nl = html.find("\n", cut)
        html = html[:m.start()] + html[(nl + 1) if nl >= 0 else cut:]
    return html


def next_version():
    """Vorschlag fuer das Feld "Version": die Version des zuletzt gebauten
    Stands - also die AKTUELLE, nicht die naechste.

    So laesst sich eine Version in mehreren Ausgaben bauen (Design, Test,
    Download ...), ohne die Nummer jedes Mal neu einzutippen; eine neue
    Version traegt man bewusst von Hand ein.

    Massgeblich sind die Begleitdateien dist/*.build.json (dort steht die
    Version im Klartext, samt Datum). Nur wenn es keine gibt, wird aus den
    Dateinamen in dist/ und build/ geraten. Der Ordner "old" bleibt aussen
    vor: dort liegen noch Dateien der alten Zaehlweise (v1.25 ... v1.27),
    die sonst eine Version 1.28 vorschlagen wuerden.
    """
    neueste, stand = None, ("", 0.0)
    for p in glob.glob(os.path.join(HERE, "dist", "*.build.json")):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            v = str(d.get("version") or "").strip()
            if not re.match(r"^\d+(\.\d+)*$", v):
                continue
            kennung = (str(d.get("date") or ""), os.path.getmtime(p))
        except (OSError, ValueError):
            continue
        if kennung > stand:
            neueste, stand = v, kennung
    if neueste:
        return neueste

    best = (1, 0)
    pat = re.compile(r"AI Foam Cut v(\d+)\.(\d+)", re.I)
    for folder in ("dist", "build"):
        for p in glob.glob(os.path.join(HERE, folder, "*")):
            m = pat.search(os.path.basename(p))
            if m:
                v = (int(m.group(1)), int(m.group(2)))
                if v > best:
                    best = v
    return "%d.%d" % best


def current_expiry():
    with open(os.path.join(HERE, ENTRY), encoding="utf-8") as f:
        m = re.search(r"EXPIRY\s*=\s*datetime\.date\((\d+),\s*(\d+),\s*(\d+)\)", f.read())
    return "%04d-%02d-%02d" % tuple(int(x) for x in m.groups()) if m else ""


# ---------------------------------------------------------------- Profile
def normalize_expiry(expiry):
    """Ablaufdatum pruefen und vereinheitlichen. Leer = kein Ablaufdatum."""
    s = (expiry or "").strip()
    if not s:
        return ""
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)
    if not m:
        raise ValueError("Das Ablaufdatum muss JJJJ-MM-TT sein (z. B. 2027-03-31) "
                         "oder leer bleiben (kein Ablaufdatum). Eingetragen ist: %r" % s)
    y, mo, d = (int(x) for x in m.groups())
    try:
        datetime.date(y, mo, d)
    except ValueError as e:
        raise ValueError("Das Ablaufdatum %r gibt es nicht (%s)." % (s, e))
    return "%04d-%02d-%02d" % (y, mo, d)


def profile_path(name):
    safe = "".join(c for c in name.strip() if c.isalnum() or c in " -_").strip()
    return os.path.join(PROFILE_DIR, safe + ".json")


def list_profiles():
    return sorted(os.path.splitext(os.path.basename(p))[0]
                  for p in glob.glob(os.path.join(PROFILE_DIR, "*.json")))


def save_profile(name, data):
    os.makedirs(PROFILE_DIR, exist_ok=True)
    with open(profile_path(name), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def load_profile(name):
    with open(profile_path(name), encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- Build
def ensure_pyinstaller(log):
    try:
        import PyInstaller  # noqa: F401
        return
    except ImportError:
        pass
    log("PyInstaller fehlt - wird installiert ...")
    subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], check=True)


def patch_html(html, feats, selected, build_info):
    """HTML fuer den Build: Skripte + Reiter nicht gewaehlter Features entfernen,
    window.FEATURES / window.BUILD_INFO vor dem ersten Skript einfuegen."""
    drop_files, drop_tabs, drop_views = set(), set(), []
    for ft in feats:
        if ft["id"] not in selected:
            drop_files.update(ft["files"])
            drop_tabs.update(ft["tabs"])
            drop_views += [v for v in ft["views"] if v not in drop_views]
    for f in drop_files:
        html, n = re.subn(r'[ \t]*<script src="%s(\?[^"]*)?"></script>\r?\n?' % re.escape(f), "", html)
        if not n:
            raise RuntimeError("Skript-Tag fuer %s nicht in der HTML gefunden." % f)
    for t in drop_tabs:
        html, n = re.subn(r'[ \t]*<button data-view="%s"[^>]*>.*?</button>\r?\n?' % re.escape(t), "", html)
        if not n:
            raise RuntimeError("Reiter data-view=\"%s\" nicht in der HTML gefunden." % t)
    html = drop_view_divs(html, drop_views)
    inject = ("<script>window.FEATURES=%s;window.BUILD_INFO=%s;</script>\n"
              % (json.dumps(sorted(selected)), json.dumps(build_info, ensure_ascii=False)))
    m = re.search(r'<script src="', html)
    if not m:
        raise RuntimeError("Kein <script src> in der HTML gefunden.")
    return html[:m.start()] + inject + html[m.start():]


def patch_launcher(src, expiry):
    """expiry leer = kein Ablaufdatum (EXPIRY = None)."""
    if expiry:
        y, mo, d = (int(x) for x in expiry.split("-"))
        neu = "EXPIRY = datetime.date(%d, %d, %d)" % (y, mo, d)
    else:
        neu = "EXPIRY = None"
    new, n = re.subn(r"EXPIRY\s*=\s*(?:datetime\.date\(\d+,\s*\d+,\s*\d+\)|None)",
                     neu, src, count=1)
    if not n:
        raise RuntimeError("EXPIRY-Zeile in launcher.py nicht gefunden.")
    return new


def run_build(cfg, log, cancel=None):
    """cfg: {name, version, expiry, features:[ids], profile, edition, demo:[ids]}
    demo = Feature-IDs, die enthalten sind, aber ohne Exportfunktionen laufen
    (window.BUILD_INFO.demo; das Modul prueft das selbst).
    Baut dist/<name>.exe. Wirft bei Fehlern eine Exception."""
    feats = load_manifest()
    html = read_html()
    selected = set(cfg["features"])
    unknown = selected - {ft["id"] for ft in feats}
    if unknown:
        raise RuntimeError("Unbekannte Feature-IDs: %s" % ", ".join(sorted(unknown)))
    # Voraussetzungen automatisch mitnehmen (z. B. "cad" braucht "dxfshapes").
    selected, added = resolve_requires(feats, selected)
    cfg["features"] = sorted(selected)
    name = cfg["name"]
    cfg["expiry"] = normalize_expiry(cfg["expiry"])   # "" = kein Ablaufdatum
    demo = sorted(set(cfg.get("demo", [])) & selected)
    # Kern-Demo: Pseudo-Funktion "kern" - das Programm sperrt damit JEDEN
    # Schreibweg (Speichern, Exportieren, G-Code kopieren); Schneiden bleibt.
    # Design-Ausgabe: Pseudo-Funktion "kernp" - wie "kern", aber "Projekt
    # speichern" (.json) bleibt erlaubt (freie Design-exe ohne Fertigungsdaten).
    # "kern" hat Vorrang, falls beides angehakt ist.
    if cfg.get("demo_kern"):
        demo.append("kern")
    elif cfg.get("export_lock"):
        demo.append("kernp")

    files = list(core_files(feats, html))
    # Jede Datei einer gewaehlten Funktion braucht ihr <script src>-Tag in der HTML -
    # sonst wuerde die exe zwar die Datei enthalten, aber nie laden (z. B. wenn die
    # HTML aus einem aelteren Stand ueberschrieben wurde).
    tags = set(html_scripts(html))
    no_tag = [f for ft in feats if ft["id"] in selected for f in ft["files"] if f not in tags]
    if no_tag:
        raise RuntimeError("Kein <script src>-Tag in %s fuer: %s - HTML pruefen (aelterer Stand?)."
                           % (HTML, ", ".join(no_tag)))
    for ft in feats:
        if ft["id"] in selected:
            files += ft["files"]
    missing = [f for f in files if not os.path.isfile(os.path.join(HERE, f))]
    if missing:
        raise RuntimeError("Dateien fehlen: %s" % ", ".join(missing))

    log("=" * 60)
    log("Build: %s" % name)
    log("Ablauf: %s   Profil: %s   Ausgabe: %s" % (cfg["expiry"] or "kein Ablaufdatum",
        cfg.get("profile") or "-", cfg.get("edition") or "-"))
    log("Funktionen: %s" % (", ".join(sorted(selected)) or "nur Kern"))
    if added:
        log("  mitgenommen, weil vorausgesetzt: %s" % ", ".join(added))
    if cfg.get("demo_kern"):
        log("Kern als Demo: kein Speichern, kein Exportieren, kein Kopieren des G-Codes "
            "- Schneiden bleibt moeglich.")
    elif cfg.get("export_lock"):
        log("Design-Ausgabe: Export gesperrt - moeglich bleiben \"Projekt speichern\" (.json) "
            "und der Flugzeug-Export (XFLR5/FLZ/PC2).")
    if [d for d in demo if d not in ("kern", "kernp")]:
        log("Nur Demo (ohne Export): %s" % ", ".join(d for d in demo if d not in ("kern", "kernp")))
    log("=" * 60)
    log("Dateien (%d): %s" % (len(files) + 1, ", ".join(files + [HTML])))

    ensure_pyinstaller(log)

    build_info = {
        "name": name, "version": cfg["version"], "expiry": cfg["expiry"],
        "date": datetime.date.today().isoformat(), "profile": cfg.get("profile") or "",
        "edition": cfg.get("edition", "Demo"), "features": sorted(selected),
        "demo": demo,
    }

    stage = os.path.join(HERE, "build", "_stage_" + name)
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    for f in files:
        shutil.copy2(os.path.join(HERE, f), stage)
    with open(os.path.join(stage, HTML), "w", encoding="utf-8") as f:
        f.write(patch_html(html, feats, selected, build_info))
    with open(os.path.join(HERE, ENTRY), encoding="utf-8") as f:
        launcher = f.read()
    with open(os.path.join(stage, ENTRY), "w", encoding="utf-8") as f:
        f.write(patch_launcher(launcher, cfg["expiry"]))
    with open(os.path.join(stage, "build_info.json"), "w", encoding="utf-8") as f:
        json.dump(build_info, f, indent=2, ensure_ascii=False)

    dist = os.path.join(HERE, "dist")
    exe = os.path.join(dist, name + ".exe")
    if os.path.isfile(exe):
        try:
            os.remove(exe)
        except OSError:
            raise RuntimeError("%s ist in Benutzung - bitte schliessen." % exe)
    shutil.rmtree(os.path.join(HERE, "build", name), ignore_errors=True)

    cmd = [sys.executable, "-m", "PyInstaller", "--onefile", "--noconsole", "--clean",
           "--noconfirm", "--name", name, "--distpath", dist,
           "--workpath", os.path.join(HERE, "build", name), "--specpath", stage]
    for f in files + [HTML]:
        cmd += ["--add-data", "%s;." % os.path.join(stage, f)]
    cmd.append(os.path.join(stage, ENTRY))

    log("PyInstaller laeuft ...")
    proc = subprocess.Popen(cmd, cwd=stage, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace")
    for line in proc.stdout:
        log(line.rstrip())
        if cancel and cancel():
            proc.kill()
            raise RuntimeError("Abgebrochen.")
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError("PyInstaller-Fehler (Code %d) - Stage bleibt zur Fehlersuche: %s"
                           % (proc.returncode, stage))
    if not os.path.isfile(exe):
        raise RuntimeError("Keine exe erzeugt.")

    # Bauprotokoll neben die exe (welche Funktionen stecken drin?)
    with open(os.path.join(dist, name + ".build.json"), "w", encoding="utf-8") as f:
        json.dump(build_info, f, indent=2, ensure_ascii=False)
    shutil.rmtree(stage, ignore_errors=True)
    shutil.rmtree(os.path.join(HERE, "build", name), ignore_errors=True)
    log("")
    log("FERTIG: %s  (%.1f MB)" % (exe, os.path.getsize(exe) / 1e6))
    return exe


# ---------------------------------------------------------------- UI
def run_ui():
    import tkinter as tk
    from tkinter import ttk, messagebox, simpledialog

    feats = load_manifest()
    html = read_html()
    core = core_files(feats, html)

    root = tk.Tk()
    root.title("AI Foam Cut - EXE bauen")
    root.minsize(760, 640)

    pad = {"padx": 8, "pady": 3}
    top = ttk.Frame(root); top.pack(fill="x", **pad)

    # --- Profil
    ttk.Label(top, text="Profil:").grid(row=0, column=0, sticky="w")
    prof_var = tk.StringVar()
    prof_cb = ttk.Combobox(top, textvariable=prof_var, values=list_profiles(), width=28)
    prof_cb.grid(row=0, column=1, sticky="w", padx=4)
    ttk.Button(top, text="Laden", command=lambda: do_load_profile()).grid(row=0, column=2, padx=2)
    ttk.Button(top, text="Speichern", command=lambda: do_save_profile()).grid(row=0, column=3, padx=2)
    ttk.Button(top, text="Loeschen", command=lambda: do_del_profile()).grid(row=0, column=4, padx=2)

    # --- Version / Name / Ablauf
    ttk.Label(top, text="Version:").grid(row=1, column=0, sticky="w")
    ver_var = tk.StringVar(value=next_version())
    ttk.Entry(top, textvariable=ver_var, width=10).grid(row=1, column=1, sticky="w", padx=4)
    ttk.Label(top, text="Zusatz im exe-Namen (z. B. Testername):").grid(row=2, column=0, sticky="w", columnspan=2)
    suffix_var = tk.StringVar()
    ttk.Entry(top, textvariable=suffix_var, width=30).grid(row=2, column=2, columnspan=3, sticky="w", padx=4)
    ttk.Label(top, text="Ablaufdatum (JJJJ-MM-TT, leer = kein Ablaufdatum):").grid(
        row=3, column=0, sticky="w", columnspan=2)
    exp_var = tk.StringVar(value=current_expiry())
    ttk.Entry(top, textvariable=exp_var, width=12).grid(row=3, column=2, sticky="w", padx=4)
    ttk.Label(top, text="Ausgabe (steht im Programm neben der Version, z. B. Demo):").grid(row=4, column=0, sticky="w", columnspan=2)
    ed_var = tk.StringVar(value="Demo")
    ttk.Entry(top, textvariable=ed_var, width=16).grid(row=4, column=2, sticky="w", padx=4)
    name_lbl = ttk.Label(top, text="", foreground="#555")
    name_lbl.grid(row=5, column=0, columnspan=5, sticky="w")

    def exe_name():
        v = ver_var.get().strip().lstrip("vV")
        n = "%s v%s" % (BASENAME, v) if v else BASENAME
        s = "".join(c for c in suffix_var.get().strip() if c.isalnum() or c in " -_.").strip()
        return (n + " " + s) if s else n

    def refresh_name(*_):
        ed = ed_var.get().strip()
        name_lbl.config(text="exe-Name: dist\\%s.exe    Anzeige im Programm: v%s%s"
                        % (exe_name(), ver_var.get().strip().lstrip("vV"), (" · " + ed) if ed else ""))
    ver_var.trace_add("write", refresh_name); suffix_var.trace_add("write", refresh_name)
    ed_var.trace_add("write", refresh_name)
    refresh_name()

    # --- Feature-Liste
    box = ttk.LabelFrame(root, text="Funktionen in der exe"); box.pack(fill="both", expand=False, **pad)
    ttk.Label(box, text="Kern (immer enthalten): " + ", ".join(core), wraplength=700,
              foreground="#555").pack(anchor="w", padx=6, pady=(4, 6))
    vars_ = {}
    demo_vars = {}
    for ft in feats:
        v = tk.BooleanVar(value=bool(ft["default"]))
        vars_[ft["id"]] = v
        row = ttk.Frame(box); row.pack(fill="x", padx=6, pady=2)
        line = ttk.Frame(row); line.pack(fill="x")
        ttk.Checkbutton(line, text=ft["name"], variable=v).pack(side="left")
        if ft["demo"]:
            dv = tk.BooleanVar(value=False)
            demo_vars[ft["id"]] = dv
            dcb = ttk.Checkbutton(line, text="nur Demo (ohne Export)", variable=dv)
            dcb.pack(side="left", padx=16)
            # Demo-Haekchen nur bedienbar, solange die Funktion selbst angehakt ist -
            # sonst sieht "nur Demo" angehakt aus, obwohl die Funktion gar nicht gebaut wird.
            def sync_demo(*_, v=v, dv=dv, dcb=dcb):
                if v.get():
                    dcb.state(["!disabled"])
                else:
                    dv.set(False)
                    dcb.state(["disabled"])
            v.trace_add("write", sync_demo)
            sync_demo()
        info = ft["description"]
        extra = "Dateien: " + ", ".join(ft["files"])
        if ft["tabs"]:
            extra += "   Reiter: " + ", ".join(ft["tabs"])
        if ft["requires"]:
            extra += "   Braucht: " + ", ".join(ft["requires"])
        ttk.Label(row, text=info + "\n" + extra, wraplength=680, foreground="#555",
                  justify="left").pack(anchor="w", padx=24)
    # --- Abhaengigkeiten ("cad" braucht "dxfshapes"): Haken automatisch nachziehen,
    # damit keine Auswahl entsteht, die im Programm Luecken hinterlaesst.
    dep_busy = {"on": False}

    def dep_sync(fid, *_):
        if dep_busy["on"]:
            return
        dep_busy["on"] = True
        try:
            if vars_[fid].get():
                _, added = resolve_requires(feats, {i for i, v in vars_.items() if v.get()})
                for i in added:
                    if i in vars_:
                        vars_[i].set(True)
            else:
                changed = True
                while changed:          # alles abwaehlen, was diese Funktion braucht
                    changed = False
                    for ft in feats:
                        if vars_[ft["id"]].get() and any(
                                r in vars_ and not vars_[r].get() for r in ft["requires"]):
                            vars_[ft["id"]].set(False); changed = True
        finally:
            dep_busy["on"] = False

    for _fid, _v in vars_.items():
        _v.trace_add("write", lambda *a, fid=_fid: dep_sync(fid))
    # --- Kern selbst als Demo bauen: kein Speichern, kein Export, aber schneiden.
    kern_demo_var = tk.BooleanVar(value=False)
    kd = ttk.Frame(box); kd.pack(fill="x", padx=6, pady=(6, 2))
    ttk.Checkbutton(kd, text="Kern: nur Demo - kein Speichern und kein Exportieren "
                             "(Schneiden an der Maschine bleibt moeglich)",
                    variable=kern_demo_var).pack(anchor="w")
    ttk.Label(kd, text="Sperrt in JEDER Funktion jeden Schreibweg: Projekt, Einstellungen, G-Code, "
                       "DXF/STL/GMFC - auch Kopieren und Bearbeiten des G-Codes. Rechnen, Anzeigen, "
                       "Simulation und der Maschinenbetrieb bleiben vollstaendig nutzbar.",
              wraplength=680, foreground="#555", justify="left").pack(anchor="w", padx=24)
    # --- Design-Ausgabe: wie oben, aber "Projekt speichern" (.json) bleibt erlaubt.
    export_lock_var = tk.BooleanVar(value=False)
    el = ttk.Frame(box); el.pack(fill="x", padx=6, pady=(2, 2))
    ttk.Checkbutton(el, text="Design-Ausgabe: nur \"Projekt speichern\" + Flugzeug-Export - alles andere sperren",
                    variable=export_lock_var).pack(anchor="w")
    ttk.Label(el, text="Wie \"Kern: nur Demo\", aber das Projekt (.json) laesst sich weiterhin speichern "
                       "und wieder laden, und der Flugzeug-Export in die Auslegungsprogramme "
                       "(XFLR5/FLZ_Vortex/PC2, reine Designdaten) bleibt frei. Alles andere "
                       "(DXF/STL/G-Code/GMFC/Einstellungen) ist gesperrt. "
                       "Fuer die frei weitergebbare Design-exe. (\"Kern: nur Demo\" hat Vorrang.)",
              wraplength=680, foreground="#555", justify="left").pack(anchor="w", padx=24)
    bt = ttk.Frame(box); bt.pack(fill="x", padx=6, pady=4)
    ttk.Button(bt, text="Alle", command=lambda: [v.set(True) for v in vars_.values()]).pack(side="left")
    ttk.Button(bt, text="Keine (nur Kern)", command=lambda: [v.set(False) for v in vars_.values()]).pack(side="left", padx=4)

    # --- Aktionen + Log
    act = ttk.Frame(root); act.pack(fill="x", **pad)
    build_btn = ttk.Button(act, text="EXE bauen", command=lambda: do_build())
    build_btn.pack(side="left")
    cancel_btn = ttk.Button(act, text="Abbrechen", state="disabled", command=lambda: state.update(cancel=True))
    cancel_btn.pack(side="left", padx=4)
    ttk.Button(act, text="Ordner dist oeffnen",
               command=lambda: os.startfile(os.path.join(HERE, "dist"))).pack(side="left", padx=4)
    status = ttk.Label(act, text=""); status.pack(side="left", padx=12)

    logf = ttk.LabelFrame(root, text="Protokoll"); logf.pack(fill="both", expand=True, **pad)
    txt = tk.Text(logf, height=14, wrap="none", font=("Consolas", 9))
    sb = ttk.Scrollbar(logf, command=txt.yview); txt.configure(yscrollcommand=sb.set)
    sb.pack(side="right", fill="y"); txt.pack(fill="both", expand=True)

    q = queue.Queue()
    state = {"running": False, "cancel": False}

    def log(s):
        q.put(s)

    def pump():
        try:
            while True:
                s = q.get_nowait()
                if isinstance(s, tuple):        # (done, ok, msg)
                    state["running"] = False
                    build_btn.config(state="normal"); cancel_btn.config(state="disabled")
                    status.config(text=s[2], foreground="#080" if s[1] else "#b00")
                    if s[1]:
                        prof_cb.config(values=list_profiles())
                        if messagebox.askyesno("Fertig", s[2] + "\n\nOrdner dist oeffnen?"):
                            os.startfile(os.path.join(HERE, "dist"))
                    else:
                        messagebox.showerror("Build fehlgeschlagen", s[2])
                else:
                    txt.insert("end", s + "\n"); txt.see("end")
        except queue.Empty:
            pass
        root.after(100, pump)

    def current_cfg():
        return {"name": exe_name(), "version": ver_var.get().strip().lstrip("vV"),
                "expiry": exp_var.get().strip(), "profile": prof_var.get().strip(),
                "edition": ed_var.get().strip(),
                "features": [i for i, v in vars_.items() if v.get()],
                "demo": [i for i, v in demo_vars.items() if v.get() and vars_[i].get()],
                "demo_kern": bool(kern_demo_var.get()),
                "export_lock": bool(export_lock_var.get())}

    def do_build():
        if state["running"]:
            return
        cfg = current_cfg()
        if not cfg["features"]:
            if not messagebox.askyesno("Nur Kern", "Es ist keine optionale Funktion angehakt - "
                                       "die exe enthaelt nur den Kern. Trotzdem bauen?"):
                return
        try:
            cfg["expiry"] = normalize_expiry(cfg["expiry"])
        except Exception as e:
            messagebox.showerror("Ablaufdatum", str(e)); return
        state.update(running=True, cancel=False)
        build_btn.config(state="disabled"); cancel_btn.config(state="normal")
        status.config(text="Build laeuft ...", foreground="#555")
        txt.delete("1.0", "end")

        def work():
            try:
                exe = run_build(cfg, log, cancel=lambda: state["cancel"])
                q.put((True, True, "Fertig: " + exe))
            except Exception as e:
                log("FEHLER: %s" % e)
                q.put((True, False, str(e)))
        threading.Thread(target=work, daemon=True).start()

    def do_save_profile():
        name = prof_var.get().strip() or simpledialog.askstring("Profil", "Name des Profils:", parent=root)
        if not name:
            return
        cfg = current_cfg()
        save_profile(name, {"features": cfg["features"], "known": [ft["id"] for ft in feats],
                            "expiry": cfg["expiry"], "suffix": suffix_var.get().strip(),
                            "edition": cfg["edition"], "demo": cfg["demo"], "demo_kern": cfg["demo_kern"],
                            "export_lock": cfg["export_lock"]})
        prof_var.set(name); prof_cb.config(values=list_profiles())
        status.config(text="Profil gespeichert: " + name, foreground="#555")

    def do_load_profile():
        name = prof_var.get().strip()
        if not name or not os.path.isfile(profile_path(name)):
            messagebox.showinfo("Profil", "Kein gespeichertes Profil mit diesem Namen."); return
        p = load_profile(name)
        sel = profile_features(p, feats)
        for i, v in vars_.items():
            v.set(i in sel)
        for i, v in demo_vars.items():
            v.set(i in p.get("demo", []))
        kern_demo_var.set(bool(p.get("demo_kern")))
        export_lock_var.set(bool(p.get("export_lock")))
        if p.get("expiry"):
            exp_var.set(p["expiry"])
        if "edition" in p:
            ed_var.set(p["edition"])
        suffix_var.set(p.get("suffix", ""))
        status.config(text="Profil geladen: " + name, foreground="#555")

    def do_del_profile():
        name = prof_var.get().strip()
        if name and os.path.isfile(profile_path(name)) and messagebox.askyesno("Profil loeschen", "Profil \"%s\" loeschen?" % name):
            os.remove(profile_path(name)); prof_var.set(""); prof_cb.config(values=list_profiles())

    root.after(100, pump)
    root.eval("tk::PlaceWindow . center")
    root.mainloop()


# ---------------------------------------------------------------- CLI
def run_cli(args):
    name = args[args.index("--profile") + 1]
    p = load_profile(name)
    version = args[args.index("--version") + 1].lstrip("vV") if "--version" in args else next_version()
    exe_name = "%s v%s" % (BASENAME, version)
    if p.get("suffix"):
        exe_name += " " + p["suffix"]
    cfg = {"name": exe_name, "version": version, "expiry": p["expiry"] if "expiry" in p else current_expiry(),
           "profile": name, "features": profile_features(p, load_manifest()),
           "edition": p.get("edition", "Demo"), "demo": p.get("demo", []), "demo_kern": bool(p.get("demo_kern")),
           "export_lock": bool(p.get("export_lock"))}
    run_build(cfg, print)


if __name__ == "__main__":
    if "--profile" in sys.argv:
        run_cli(sys.argv[1:])
    else:
        run_ui()
