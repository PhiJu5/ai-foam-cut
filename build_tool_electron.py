#!/usr/bin/env python3
"""Build-Werkzeug fuer die Electron-Ausgabe von AI Foam Cut.

Baut aus dem Projektordner eine eigenstaendige Anwendung mit eigenem Fenster
(Electron + electron-builder) - im Gegensatz zu build_tool.py, das eine
PyInstaller-exe baut, die im Browser laeuft.

Die Funktionsauswahl (features.json), die Abhaengigkeiten zwischen Funktionen
und das Umschreiben der HTML kommen aus build_tool.py - dieses Werkzeug fuegt
nur den Electron-Teil hinzu: electron/config.js und package.json anpassen,
node_modules verlinken, electron-builder aufrufen.

Ziele: Windows (.exe), Linux (AppImage) und macOS (.app im zip, je Prozessor).
Linux und macOS packt electron-builder nicht unter Windows - dort laeuft der
Bau in WSL (siehe wslbuild.py, "Linux-Werkzeuge einrichten"). Unter Linux
oder macOS laeuft er direkt.

Voraussetzungen: Node.js und die Abhaengigkeiten aus package.json. Einmalig
  npm install --prefix %USERPROFILE%\\afc-build

Aufruf:  python build_tool_electron.py            (Fenster)
         python build_tool_electron.py --cli ...  (ohne Fenster, siehe --help)
"""
import os
import sys
import json
import shutil
import subprocess
import datetime
import argparse
import queue
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_tool as bt                                    # noqa: E402  Funktionslogik
import wslbuild as WSL                                     # noqa: E402  Linux/Mac-Bau

PROFILE_DIR = os.path.join(HERE, "build_profiles_electron")
NODE_MODULES = os.path.join(os.path.expanduser("~"), "afc-build", "node_modules")
NODE_DIR = os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "nodejs")
OUT_BASE = os.path.join(HERE, "dist-electron")
STAGE_BASE = os.path.join(HERE, "build")
EXTRA = ["LICENSE", "THIRD_PARTY_LICENSES.md"]             # Lizenztexte muessen mit
BASENAME = "AI Foam Cut"
TARGETS = ("win", "linux", "mac")
LX_OUT = "dist-out"                                        # Ausgabe im Stage (Linux/Mac)
MAC_ARCHS = {"arm64": ["arm64"], "x64": ["x64"], "beide": ["arm64", "x64"]}
MAC_ICON = "icon/icon-1024.png"                            # daraus wird die .icns
MAC_LIESMICH_NAME = "LIESMICH - README.txt"
MAC_LIESMICH = """AI Foam Cut fuer macOS
======================

1. "{app}" aus diesem zip in einen EIGENEN Ordner ziehen, z. B. Dokumente/AI Foam Cut.
   Daneben legt das Programm seine Einstellungen ab.
   (Liegt die App unter "Programme", landen sie in Dokumente/AI Foam Cut.)

2. Die App ist nicht von Apple beglaubigt (kein Entwicklerzertifikat).
   macOS meldet deshalb beim ersten Start "beschaedigt" oder
   "nicht verifizierter Entwickler". Einmalig im Terminal:

       xattr -cr "/Pfad/zu/{app}"

   (Tipp: "xattr -cr " tippen und die App ins Terminalfenster ziehen.)
   Danach startet sie normal per Doppelklick.

3. Maschine: der USB-Anschluss erscheint als /dev/cu.usbserial-... oder
   /dev/cu.usbmodem-... in der Portauswahl.

------------------------------------------------------------------------------

AI Foam Cut for macOS

1. Drag "{app}" out of this zip into a folder of its own (e.g.
   Documents/AI Foam Cut). Settings are stored next to it.
2. The app is not notarized. On first start macOS says it is "damaged" or
   from an "unidentified developer". Run once in Terminal:

       xattr -cr "/path/to/{app}"

3. The machine's USB port shows up as /dev/cu.usbserial-... or /dev/cu.usbmodem-...
"""


def open_dir(p):
    """Ordner im Dateimanager zeigen - Windows, Linux und macOS."""
    if not os.path.isdir(p):
        return
    if os.name == "nt":
        os.startfile(p)                                    # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", p])
    else:
        subprocess.Popen(["xdg-open", p])


# ---------------------------------------------------------------- Profile
def profile_path(name):
    return os.path.join(PROFILE_DIR, name + ".json")


def list_profiles():
    if not os.path.isdir(PROFILE_DIR):
        return []
    # "_linux.json" usw. sind Einstellungen des Werkzeugs, keine Profile.
    return sorted(f[:-5] for f in os.listdir(PROFILE_DIR)
                  if f.endswith(".json") and not f.startswith("_"))


def save_profile(name, data):
    os.makedirs(PROFILE_DIR, exist_ok=True)
    with open(profile_path(name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_profile(name):
    with open(profile_path(name), encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- Node
def node_env():
    env = os.environ.copy()
    if os.path.isfile(os.path.join(NODE_DIR, "node.exe")):
        env["PATH"] = env.get("PATH", "") + os.pathsep + NODE_DIR
    # Ohne Signierzertifikat: die Suche danach abschalten, sonst bricht der Bau ab.
    env["CSC_IDENTITY_AUTO_DISCOVERY"] = "false"
    return env


def builder_cmd():
    cli = os.path.join(NODE_MODULES, "electron-builder", "cli.js")
    node = os.path.join(NODE_DIR, "node.exe")
    if not os.path.isfile(cli):
        raise RuntimeError(
            "electron-builder nicht gefunden (%s).\n\n"
            "Einmalig die Abhaengigkeiten installieren:\n"
            "  npm install --prefix %s" % (cli, os.path.dirname(NODE_MODULES)))
    return [node if os.path.isfile(node) else "node", cli]


def link_node_modules(stage, log):
    """node_modules im Stage als Junction/Symlink auf den gemeinsamen Ordner."""
    if not os.path.isdir(NODE_MODULES):
        raise RuntimeError("node_modules fehlt (%s).\n\nEinmalig:\n  npm install --prefix %s"
                           % (NODE_MODULES, os.path.dirname(NODE_MODULES)))
    target = os.path.join(stage, "node_modules")
    if os.path.exists(target):
        return
    if os.name == "nt":
        # Ausgabe als Bytes lesen: cmd antwortet in der Konsolen-Codepage.
        r = subprocess.run(["cmd", "/c", "mklink", "/J", target, NODE_MODULES],
                           capture_output=True)
        if r.returncode != 0:
            raise RuntimeError("node_modules konnte nicht verlinkt werden:\n"
                               + (r.stderr or r.stdout).decode("cp850", "replace"))
    else:
        os.symlink(NODE_MODULES, target)
    log("node_modules verlinkt -> " + NODE_MODULES)


# ---------------------------------------------------------------- Patchen
def semver(version):
    """electron-builder verlangt x.y.z - "1.4" waere ein Abbruch."""
    parts = [p for p in str(version).strip().lstrip("vV").split(".") if p != ""]
    nums = []
    for p in parts[:3]:
        digits = "".join(c for c in p if c.isdigit())
        nums.append(int(digits) if digits else 0)
    while len(nums) < 3:
        nums.append(0)
    return "%d.%d.%d" % tuple(nums)


def patch_config_js(src, edition, expiry, devtools=True):
    """EDITION, EXPIRY und DEVTOOLS in electron/config.js setzen.

    expiry: "" = kein Ablaufdatum (EXPIRY = null). Ein Datum tragen nur
    diejenigen ein, die bewusst eine befristete Ausgabe bauen wollen.
    """
    out = []
    for line in src.split("\n"):
        s = line.strip()
        if s.startswith("EDITION:"):
            line = "  EDITION: %s," % json.dumps(edition or "")
        elif s.startswith("EXPIRY:"):
            if expiry:
                y, mo, d = (int(x) for x in expiry.split("-"))
                line = "  EXPIRY: [%d, %d, %d]," % (y, mo, d)
            else:
                line = "  EXPIRY: null,"
        elif s.startswith("DEVTOOLS:"):
            line = "  DEVTOOLS: %s," % ("true" if devtools else "false")
        out.append(line)
    return "\n".join(out)


def patch_package_json(src, name, version, target, stage_files):
    pkg = json.loads(src)
    pkg["version"] = semver(version)
    pkg["productName"] = name
    b = pkg.setdefault("build", {})
    b["productName"] = name
    b["files"] = stage_files
    if target == "linux":
        b["directories"] = {"output": LX_OUT}
        b.setdefault("linux", {})["artifactName"] = "${productName}.${ext}"
        b.setdefault("appImage", {})["artifactName"] = "${productName}.${ext}"
    elif target == "mac":
        # Unsigniert (identity None): signieren kann nur ein Mac mit Apple-
        # Zertifikat. Die Anleitung im zip erklaert "xattr -cr".
        b["directories"] = {"output": LX_OUT}
        b.setdefault("mac", {}).update({
            "target": [{"target": "zip", "arch": ["arm64", "x64"]}],
            "icon": MAC_ICON,
            "category": "public.app-category.graphics-design",
            "artifactName": "${productName}-mac-${arch}.${ext}",
            "identity": None, "hardenedRuntime": False, "gatekeeperAssess": False,
            "minimumSystemVersion": "11.0",
            "extendInfo": {
                "NSDocumentsFolderUsageDescription":
                    "AI Foam Cut speichert Einstellungen und Projekte im Ordner Dokumente.",
                "NSDesktopFolderUsageDescription":
                    "AI Foam Cut oeffnet und speichert Projekte auf dem Schreibtisch.",
                "NSDownloadsFolderUsageDescription":
                    "AI Foam Cut oeffnet Dateien aus dem Ordner Downloads.",
            },
        })
    else:
        b["directories"] = {"output": os.path.join(OUT_BASE, name).replace("\\", "/")}
        b.setdefault("win", {})["artifactName"] = "${productName}.${ext}"
        b.setdefault("portable", {})["artifactName"] = "${productName}.${ext}"
        b["portable"]["unpackDirName"] = "AIFoamCut"
    return json.dumps(pkg, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------- Build
def run_build(cfg, log, cancel=None):
    """cfg: {name, version, edition, expiry, features:[ids], profile, target, devtools}

    Baut dist-electron/<name>/<name>.exe (Windows), <name>.AppImage (Linux)
    bzw. <name>-mac-<arch>.zip (macOS; cfg["mac_arch"] = arm64|x64|beide).
    Linux/Mac laufen unter Windows in WSL (cfg["distro"]).
    Wirft bei Fehlern eine Exception.
    """
    feats = bt.load_manifest()
    html = bt.read_html()
    selected = set(cfg["features"])
    unknown = selected - {ft["id"] for ft in feats}
    if unknown:
        raise RuntimeError("Unbekannte Funktions-IDs: %s" % ", ".join(sorted(unknown)))
    selected, added = bt.resolve_requires(feats, selected)
    cfg["features"] = sorted(selected)
    cfg["expiry"] = bt.normalize_expiry(cfg.get("expiry", ""))
    name = cfg["name"]
    target = cfg.get("target", "win")
    if target not in TARGETS:
        raise RuntimeError("Unbekanntes Ziel: %r" % target)
    if target == "win" and os.name != "nt":
        raise RuntimeError("Die Windows-exe laesst sich nur unter Windows bauen.")
    if target == "mac" and not os.path.isfile(os.path.join(HERE, MAC_ICON)):
        raise RuntimeError("%s fehlt - einmal \"python make_icon.py\" laufen lassen." % MAC_ICON)

    # Dateien zusammenstellen: Kern + gewaehlte Funktionen
    files = list(bt.core_files(feats, html))
    tags = set(bt.html_scripts(html))
    no_tag = [f for ft in feats if ft["id"] in selected for f in ft["files"] if f not in tags]
    if no_tag:
        raise RuntimeError("Kein <script src>-Tag in %s fuer: %s - HTML pruefen."
                           % (bt.HTML, ", ".join(no_tag)))
    for ft in feats:
        if ft["id"] in selected:
            files += ft["files"]
    missing = [f for f in files if not os.path.isfile(os.path.join(HERE, f))]
    if missing:
        raise RuntimeError("Dateien fehlen: %s" % ", ".join(missing))

    log("=" * 60)
    log("Electron-Build: %s   Version %s" % (name, cfg["version"]))
    log("Ziel: %s   Edition: %s   Ablauf: %s"
        % (target, cfg.get("edition") or "-", cfg["expiry"] or "kein Ablaufdatum"))
    log("Funktionen: %s" % (", ".join(sorted(selected)) or "nur Kern"))
    if added:
        log("  mitgenommen, weil vorausgesetzt: %s" % ", ".join(added))
    log("=" * 60)
    log("Module (%d) + %s" % (len(files), bt.HTML))

    build_info = {
        "name": name, "version": cfg["version"], "expiry": cfg["expiry"],
        "date": datetime.date.today().isoformat(), "profile": cfg.get("profile") or "",
        "edition": cfg.get("edition", ""), "features": sorted(selected),
        "demo": [], "variant": "electron",
        "plattform": {"linux": "linux", "mac": "macos"}.get(target, "windows"),
    }

    # --- Stage aufbauen
    stage = os.path.join(STAGE_BASE, "_stage_electron_" + name)
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    for f in files:
        shutil.copy2(os.path.join(HERE, f), stage)
    with open(os.path.join(stage, bt.HTML), "w", encoding="utf-8") as f:
        f.write(bt.patch_html(html, feats, selected, build_info))
    with open(os.path.join(stage, "build_info.json"), "w", encoding="utf-8") as f:
        json.dump(build_info, f, ensure_ascii=False, indent=2)

    shutil.copytree(os.path.join(HERE, "electron"), os.path.join(stage, "electron"))
    shutil.copytree(os.path.join(HERE, "icon"), os.path.join(stage, "icon"))
    for extra in EXTRA:
        src = os.path.join(HERE, extra)
        if os.path.isfile(src):
            shutil.copy2(src, stage)
        else:
            log("HINWEIS: %s fehlt - die GPL verlangt, dass der Lizenztext mitgeht." % extra)

    # config.js: Edition, Ablaufdatum, Entwicklerwerkzeuge
    cpath = os.path.join(stage, "electron", "config.js")
    with open(cpath, encoding="utf-8") as f:
        conf = f.read()
    with open(cpath, "w", encoding="utf-8") as f:
        f.write(patch_config_js(conf, cfg.get("edition", ""), cfg["expiry"],
                                cfg.get("devtools", True)))

    stage_files = ["electron/**/*", "*.js", bt.HTML, "build_info.json",
                   "icon/icon.ico", "icon/icon-256.png"] + EXTRA
    with open(os.path.join(HERE, "package.json"), encoding="utf-8") as f:
        pkg = f.read()
    with open(os.path.join(stage, "package.json"), "w", encoding="utf-8") as f:
        f.write(patch_package_json(pkg, name, cfg["version"], target, stage_files))

    if cancel is not None and cancel():
        raise RuntimeError("Abgebrochen.")

    if target in ("linux", "mac"):
        return _build_unix(cfg, name, target, stage, build_info, log, cancel)

    link_node_modules(stage, log)

    # --- electron-builder
    cmd = builder_cmd() + ["--win"]
    log("Aufruf: " + " ".join(cmd))
    p = subprocess.Popen(cmd, cwd=stage, env=node_env(), stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                         errors="replace", bufsize=1)
    for line in p.stdout:
        log(line.rstrip())
        if cancel is not None and cancel():
            p.terminate()
            raise RuntimeError("Abgebrochen.")
    if p.wait() != 0:
        raise RuntimeError("electron-builder ist mit Fehler %d beendet worden." % p.returncode)

    # --- Ergebnis einsammeln
    out_dir = os.path.join(OUT_BASE, name)
    ext = ".exe"
    built = [os.path.join(out_dir, f) for f in os.listdir(out_dir)
             if f.endswith(ext)] if os.path.isdir(out_dir) else []
    if not built:
        raise RuntimeError("Keine Ausgabedatei in %s gefunden." % out_dir)
    final = built[0]
    with open(final + ".build.json", "w", encoding="utf-8") as f:
        json.dump(build_info, f, ensure_ascii=False, indent=2)
    log("")
    log("Fertig: %s  (%.1f MB)" % (final, os.path.getsize(final) / 1048576.0))
    shutil.rmtree(stage, ignore_errors=True)
    return final


def _build_unix(cfg, name, target, stage, build_info, log, cancel):
    """Linux-AppImage oder Mac-zips: in WSL (unter Windows) bzw. direkt."""
    if target == "mac":
        archs = MAC_ARCHS.get(cfg.get("mac_arch") or "beide", MAC_ARCHS["beide"])
        builder = "--mac zip " + " ".join("--" + a for a in archs)
        outs = ["%s/%s-mac-%s.zip" % (LX_OUT, name, a) for a in archs]
    else:
        builder = "--linux AppImage --x64"
        outs = ["%s/%s.AppImage" % (LX_OUT, name)]
    dest = os.path.join(OUT_BASE, name)
    # Nur die eigenen Zieldateien entfernen - eine Windows- oder Linux-Ausgabe
    # derselben Version liegt im selben Ordner und bleibt stehen.
    for o in outs:
        f = os.path.join(dest, os.path.basename(o))
        if os.path.isfile(f):
            os.remove(f)
    got = WSL.build(cfg.get("distro", ""), stage, dest,
                    "node " + WSL.BUILD_DIR + "/node_modules/electron-builder/cli.js " + builder,
                    outs, log, cancel=cancel, what="Mac" if target == "mac" else "Linux",
                    link_node_modules=True)
    shutil.rmtree(stage, ignore_errors=True)
    if target == "mac":
        import zipfile
        for z in got:
            with zipfile.ZipFile(z, "a", compression=zipfile.ZIP_DEFLATED) as zf:
                if MAC_LIESMICH_NAME not in zf.namelist():
                    zf.writestr(MAC_LIESMICH_NAME, MAC_LIESMICH.format(app=name + ".app"))
        info = os.path.join(dest, name + "-mac.build.json")
    else:
        info = got[0] + ".build.json"
    with open(info, "w", encoding="utf-8") as f:
        json.dump(build_info, f, ensure_ascii=False, indent=2)
    log("")
    for g in got:
        log("Fertig: %s  (%.1f MB)" % (g, os.path.getsize(g) / 1048576.0))
    if target == "mac":
        log("Mac: -arm64 = Apple Silicon (M1 und neuer), -x64 = Intel. Unsigniert - beim ersten "
            "Start einmal  xattr -cr \"/Pfad/zu/%s.app\"  (Anleitung liegt im zip)." % name)
    else:
        log("Linux: chmod +x, starten; noetig sind libfuse2 fuer AppImages und die Gruppe "
            "\"dialout\" fuer die Maschine.")
    return got[0]


# ---------------------------------------------------------------- Fenster
def run_ui():
    import tkinter as tk
    from tkinter import ttk, messagebox, simpledialog

    feats = bt.load_manifest()
    html = bt.read_html()
    core = bt.core_files(feats, html)

    root = tk.Tk()
    root.title("AI Foam Cut - Electron-Ausgabe bauen")
    root.minsize(840, 720)
    pad = {"padx": 8, "pady": 3}

    top = ttk.Frame(root)
    top.pack(fill="x", **pad)

    # --- Profil
    ttk.Label(top, text="Profil:").grid(row=0, column=0, sticky="w")
    prof_var = tk.StringVar()
    prof_cb = ttk.Combobox(top, textvariable=prof_var, values=list_profiles(), width=26)
    prof_cb.grid(row=0, column=1, sticky="w", padx=4)
    ttk.Button(top, text="Laden", command=lambda: do_load_profile()).grid(row=0, column=2, padx=2)
    ttk.Button(top, text="Speichern", command=lambda: do_save_profile()).grid(row=0, column=3, padx=2)
    ttk.Button(top, text="Loeschen", command=lambda: do_del_profile()).grid(row=0, column=4, padx=2)

    # --- Version / Name / Edition / Ablauf / Ziel
    ttk.Label(top, text="Version:").grid(row=1, column=0, sticky="w")
    ver_var = tk.StringVar(value=bt.next_version())
    ttk.Entry(top, textvariable=ver_var, width=10).grid(row=1, column=1, sticky="w", padx=4)

    ttk.Label(top, text="Zusatz im Namen (z. B. Testername):").grid(
        row=2, column=0, sticky="w", columnspan=2)
    suffix_var = tk.StringVar()
    ttk.Entry(top, textvariable=suffix_var, width=30).grid(
        row=2, column=2, columnspan=3, sticky="w", padx=4)

    ttk.Label(top, text="Edition (Zusatz im Fenstertitel, z. B. Design):").grid(
        row=3, column=0, sticky="w", columnspan=2)
    ed_var = tk.StringVar(value="")
    ttk.Entry(top, textvariable=ed_var, width=16).grid(row=3, column=2, sticky="w", padx=4)

    ttk.Label(top, text="Ablaufdatum (JJJJ-MM-TT, leer = kein Ablaufdatum):").grid(
        row=4, column=0, sticky="w", columnspan=2)
    exp_var = tk.StringVar(value="")
    ttk.Entry(top, textvariable=exp_var, width=12).grid(row=4, column=2, sticky="w", padx=4)

    ttk.Label(top, text="Ziel:").grid(row=5, column=0, sticky="w")
    lin_set = WSL.load_settings(PROFILE_DIR)
    target_var = tk.StringVar(value="win" if os.name == "nt" else "linux")
    tf = ttk.Frame(top)
    tf.grid(row=5, column=1, columnspan=4, sticky="w", padx=4)
    ttk.Radiobutton(tf, text="Windows (.exe)", variable=target_var, value="win").pack(side="left")
    ttk.Radiobutton(tf, text="Linux (AppImage)", variable=target_var,
                    value="linux").pack(side="left", padx=(12, 0))
    ttk.Radiobutton(tf, text="macOS (.app im zip)", variable=target_var,
                    value="mac").pack(side="left", padx=(12, 0))
    dev_var = tk.BooleanVar(value=True)
    ttk.Checkbutton(tf, text="Entwicklerwerkzeuge (F12)",
                    variable=dev_var).pack(side="left", padx=(20, 0))

    # Linux/Mac: Bauumgebung (unter Windows WSL) und Mac-Prozessor
    lf = ttk.Frame(top)
    lf.grid(row=6, column=1, columnspan=4, sticky="w", padx=4, pady=(2, 0))
    ttk.Label(lf, text="Mac-Prozessor:").pack(side="left")
    arch_var = tk.StringVar(value=lin_set.get("mac_arch", "beide"))
    ttk.Combobox(lf, textvariable=arch_var, width=7, state="readonly",
                 values=list(MAC_ARCHS)).pack(side="left", padx=(2, 12))
    dist_var = tk.StringVar(value=lin_set.get("distro", ""))
    if os.name == "nt":
        ttk.Label(lf, text="WSL-Distribution:").pack(side="left")
        dist_cb = ttk.Combobox(lf, textvariable=dist_var, width=14, values=WSL.distros())
        dist_cb.pack(side="left", padx=(2, 8))
        if not dist_var.get() and dist_cb.cget("values"):
            dist_var.set(dist_cb.cget("values")[0])
    ttk.Button(lf, text="Umgebung pruefen", command=lambda: do_lin_check()).pack(side="left")
    ttk.Button(lf, text="Linux-Werkzeuge einrichten...",
               command=lambda: do_lin_setup()).pack(side="left", padx=4)
    arch_var.trace_add("write", lambda *a: WSL.save_settings(PROFILE_DIR, {"mac_arch": arch_var.get()}))
    dist_var.trace_add("write", lambda *a: WSL.save_settings(PROFILE_DIR, {"distro": dist_var.get().strip()}))

    name_lbl = ttk.Label(top, text="", foreground="#555")
    name_lbl.grid(row=7, column=0, columnspan=5, sticky="w")

    def out_name():
        v = ver_var.get().strip().lstrip("vV")
        n = "%s v%s" % (BASENAME, v) if v else BASENAME
        s = "".join(c for c in suffix_var.get().strip() if c.isalnum() or c in " -_.").strip()
        return (n + " " + s) if s else n

    def refresh_name(*_):
        t = target_var.get()
        if t == "mac":
            datei = "  ".join("%s-mac-%s.zip" % (out_name(), a)
                              for a in MAC_ARCHS.get(arch_var.get(), ["arm64"]))
        else:
            datei = out_name() + (".AppImage" if t == "linux" else ".exe")
        ed = ed_var.get().strip()
        name_lbl.config(text="Datei: dist-electron%s%s%s%s    Fenstertitel: %s"
                        % (os.sep, out_name(), os.sep, datei,
                           BASENAME + ((" " + ed) if ed else "")))

    for _v in (ver_var, suffix_var, ed_var, target_var, arch_var):
        _v.trace_add("write", refresh_name)
    refresh_name()

    # --- Funktionsauswahl (rollbar, weil es viele sind)
    box = ttk.LabelFrame(root, text="Funktionen in der Ausgabe")
    box.pack(fill="both", expand=True, **pad)
    ttk.Label(box, text="Kern (immer enthalten): " + ", ".join(core), wraplength=780,
              foreground="#555").pack(anchor="w", padx=6, pady=(4, 6))

    canvas = tk.Canvas(box, highlightthickness=0, height=300)
    vsb = ttk.Scrollbar(box, orient="vertical", command=canvas.yview)
    inner = ttk.Frame(canvas)
    win_id = canvas.create_window((0, 0), window=inner, anchor="nw")
    canvas.configure(yscrollcommand=vsb.set)
    inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
    canvas.bind("<Configure>", lambda e: canvas.itemconfigure(win_id, width=e.width))
    canvas.bind_all("<MouseWheel>", lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))
    vsb.pack(side="right", fill="y")
    canvas.pack(side="left", fill="both", expand=True, padx=6)

    vars_ = {}
    for ft in feats:
        v = tk.BooleanVar(value=bool(ft["default"]))
        vars_[ft["id"]] = v
        row = ttk.Frame(inner)
        row.pack(fill="x", pady=2)
        ttk.Checkbutton(row, text=ft["name"], variable=v).pack(anchor="w")
        extra = "Dateien: " + ", ".join(ft["files"])
        if ft["tabs"]:
            extra += "   Reiter: " + ", ".join(ft["tabs"])
        if ft["requires"]:
            extra += "   Braucht: " + ", ".join(ft["requires"])
        ttk.Label(row, text=(ft["description"] + "\n" + extra).strip(), wraplength=720,
                  foreground="#555", justify="left").pack(anchor="w", padx=24)

    # Abhaengigkeiten ("cad" braucht "dxfshapes"): Haken automatisch nachziehen,
    # damit keine Auswahl entsteht, die im Programm Luecken hinterlaesst.
    dep_busy = {"on": False}

    def dep_sync(fid, *_):
        if dep_busy["on"]:
            return
        dep_busy["on"] = True
        try:
            if vars_[fid].get():
                _, added = bt.resolve_requires(feats, {i for i, v in vars_.items() if v.get()})
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
                            vars_[ft["id"]].set(False)
                            changed = True
        finally:
            dep_busy["on"] = False

    for _fid, _fv in vars_.items():
        _fv.trace_add("write", lambda *a, fid=_fid: dep_sync(fid))

    selbar = ttk.Frame(box)
    selbar.pack(fill="x", padx=6, pady=4)
    ttk.Button(selbar, text="Alle",
               command=lambda: [v.set(True) for v in vars_.values()]).pack(side="left")
    ttk.Button(selbar, text="Keine (nur Kern)",
               command=lambda: [v.set(False) for v in vars_.values()]).pack(side="left", padx=4)

    # --- Aktionen + Protokoll
    act = ttk.Frame(root)
    act.pack(fill="x", **pad)
    build_btn = ttk.Button(act, text="Bauen", command=lambda: do_build())
    build_btn.pack(side="left")
    cancel_btn = ttk.Button(act, text="Abbrechen", state="disabled",
                            command=lambda: state.update(cancel=True))
    cancel_btn.pack(side="left", padx=4)
    ttk.Button(act, text="Ordner oeffnen",
               command=lambda: open_dir(OUT_BASE)).pack(side="left", padx=4)
    status = ttk.Label(act, text="")
    status.pack(side="left", padx=12)

    logf = ttk.LabelFrame(root, text="Protokoll")
    logf.pack(fill="both", expand=True, **pad)
    txt = tk.Text(logf, height=12, wrap="none", font=("Consolas", 9))
    lsb = ttk.Scrollbar(logf, command=txt.yview)
    txt.configure(yscrollcommand=lsb.set)
    lsb.pack(side="right", fill="y")
    txt.pack(fill="both", expand=True)

    q = queue.Queue()
    state = {"running": False, "cancel": False}

    def log(s):
        q.put(str(s))

    def pump():
        try:
            while True:
                s = q.get_nowait()
                if isinstance(s, tuple):            # (fertig, ok, Meldung, Pfad)
                    state["running"] = False
                    build_btn.config(state="normal")
                    cancel_btn.config(state="disabled")
                    status.config(text=s[2], foreground="#080" if s[1] else "#b00")
                    if s[1]:
                        prof_cb.config(values=list_profiles())
                        if s[3] and messagebox.askyesno("Fertig", s[2] + "\n\nOrdner oeffnen?"):
                            open_dir(os.path.dirname(s[3]) if s[3] else OUT_BASE)
                    else:
                        messagebox.showerror("Build fehlgeschlagen", s[2])
                else:
                    txt.insert("end", s + "\n")
                    txt.see("end")
        except queue.Empty:
            pass
        root.after(100, pump)

    def current_cfg():
        return {"name": out_name(), "version": ver_var.get().strip().lstrip("vV"),
                "edition": ed_var.get().strip(), "expiry": exp_var.get().strip(),
                "target": target_var.get(), "devtools": bool(dev_var.get()),
                "mac_arch": arch_var.get(), "distro": dist_var.get().strip(),
                "profile": prof_var.get().strip(),
                "features": [i for i, v in vars_.items() if v.get()]}

    def do_build():
        if state["running"]:
            return
        cfg = current_cfg()
        if not cfg["version"]:
            messagebox.showerror("Version", "Bitte eine Version angeben.")
            return
        if not cfg["features"] and not messagebox.askyesno(
                "Nur Kern", "Es ist keine optionale Funktion angehakt - die Ausgabe "
                            "enthaelt nur den Kern. Trotzdem bauen?"):
            return
        try:
            cfg["expiry"] = bt.normalize_expiry(cfg["expiry"])
        except Exception as e:                                       # noqa: BLE001
            messagebox.showerror("Ablaufdatum", str(e))
            return
        # Ein Ablaufdatum macht die Ausgabe unbrauchbar, sobald es erreicht ist.
        # In der quelloffenen Fassung ist das fast immer ein Versehen.
        if cfg["expiry"] and not messagebox.askyesno(
                "Ablaufdatum", "Diese Ausgabe laeuft am %s ab und startet danach nicht "
                               "mehr.\n\nIn der quelloffenen Fassung bleibt das Feld "
                               "normalerweise leer. Wirklich mit Ablaufdatum bauen?"
                               % cfg["expiry"]):
            return
        if cfg["target"] != "win" and os.name == "nt" and not WSL.distros():
            txt.delete("1.0", "end")
            txt.insert("end", WSL.FEHLT + "\n")
            status.config(text="Kein WSL installiert", foreground="#b00")
            return
        state.update(running=True, cancel=False)
        build_btn.config(state="disabled")
        cancel_btn.config(state="normal")
        status.config(text="Build laeuft ...", foreground="#555")
        txt.delete("1.0", "end")

        def work():
            try:
                out = run_build(cfg, log, cancel=lambda: state["cancel"])
                q.put((True, True, "Fertig: " + out, out))
            except Exception as e:                                   # noqa: BLE001
                log("FEHLER: %s" % e)
                q.put((True, False, str(e), ""))

        threading.Thread(target=work, daemon=True).start()

    def bg(what, worker):
        """Pruefen/Einrichten im Hintergrund (worker() gibt die Schlussmeldung)."""
        if state["running"]:
            return
        state.update(running=True, cancel=False)
        build_btn.config(state="disabled")
        cancel_btn.config(state="normal")
        status.config(text=what + " laeuft ...", foreground="#555")
        txt.delete("1.0", "end")

        def work():
            try:
                q.put((True, True, worker(), ""))
            except Exception as e:                                   # noqa: BLE001
                log("FEHLER: %s" % e)
                q.put((True, False, str(e), ""))
        threading.Thread(target=work, daemon=True).start()

    def do_lin_check():
        def work():
            ok, bericht = WSL.check(dist_var.get().strip(), "node")
            for ln in bericht.splitlines():
                log(ln)
            if not ok:
                raise RuntimeError("Die Linux-Bauumgebung ist noch nicht fertig - siehe Protokoll.")
            return "Linux-Umgebung in Ordnung"
        bg("Pruefen", work)

    def do_lin_setup():
        if os.name == "nt" and not WSL.distros():
            txt.delete("1.0", "end")
            txt.insert("end", WSL.FEHLT + "\n")
            return
        if not messagebox.askyesno(
                "Linux-Werkzeuge einrichten",
                "In der Linux-Umgebung werden node/npm (falls noch nicht da) sowie electron "
                "und electron-builder nach ~/afc-build installiert (etwa 500 MB).\n\n"
                "Nur einmal noetig. Jetzt einrichten?"):
            return
        with open(os.path.join(HERE, "package.json"), encoding="utf-8") as f:
            pkg = json.load(f)

        def work():
            WSL.setup(dist_var.get().strip(), "node", log, cancel=lambda: state["cancel"],
                      package_json=pkg)
            return "Linux-Werkzeuge eingerichtet"
        bg("Einrichten", work)

    def do_save_profile():
        name = prof_var.get().strip() or simpledialog.askstring(
            "Profil", "Name des Profils:", parent=root)
        if not name:
            return
        cfg = current_cfg()
        save_profile(name, {"features": cfg["features"], "known": [ft["id"] for ft in feats],
                            "expiry": cfg["expiry"], "suffix": suffix_var.get().strip(),
                            "edition": cfg["edition"], "target": cfg["target"],
                            "mac_arch": cfg["mac_arch"],
                            "devtools": cfg["devtools"]})
        prof_var.set(name)
        prof_cb.config(values=list_profiles())
        status.config(text="Profil gespeichert: " + name, foreground="#555")

    def do_load_profile():
        name = prof_var.get().strip()
        if not name or not os.path.isfile(profile_path(name)):
            messagebox.showinfo("Profil", "Kein gespeichertes Profil mit diesem Namen.")
            return
        p = load_profile(name)
        # profile_features() beruecksichtigt "known": Funktionen, die es beim
        # Speichern noch nicht gab, kommen mit ihrer Standardeinstellung dazu.
        sel = bt.profile_features(p, feats)
        for i, v in vars_.items():
            v.set(i in sel)
        if p.get("expiry"):
            exp_var.set(p["expiry"])
        if "edition" in p:
            ed_var.set(p["edition"])
        suffix_var.set(p.get("suffix", ""))
        target_var.set(p.get("target", "win"))
        if p.get("mac_arch") in MAC_ARCHS:
            arch_var.set(p["mac_arch"])
        dev_var.set(bool(p.get("devtools", True)))
        status.config(text="Profil geladen: " + name, foreground="#555")

    def do_del_profile():
        name = prof_var.get().strip()
        if name and os.path.isfile(profile_path(name)) and messagebox.askyesno(
                "Profil loeschen", "Profil \"%s\" loeschen?" % name):
            os.remove(profile_path(name))
            prof_var.set("")
            prof_cb.config(values=list_profiles())

    if not os.path.isdir(NODE_MODULES):
        log("node_modules fehlt: %s" % NODE_MODULES)
        log("Einmalig installieren:  npm install --prefix %s"
            % os.path.dirname(NODE_MODULES))
    else:
        log("Bereit. node_modules: %s" % NODE_MODULES)
    root.after(100, pump)
    root.eval("tk::PlaceWindow . center")
    root.mainloop()


# ---------------------------------------------------------------- CLI
def run_cli(argv):
    ap = argparse.ArgumentParser(description="Electron-Ausgabe von AI Foam Cut bauen")
    ap.add_argument("--name", default=None, help="Standard: \"AI Foam Cut v<Version>\"")
    ap.add_argument("--version", default=None, help="Standard: zuletzt gebaute Version")
    ap.add_argument("--edition", default="", help="Zusatz im Fenstertitel")
    ap.add_argument("--expiry", default="", help="JJJJ-MM-TT, leer = kein Ablaufdatum")
    ap.add_argument("--target", choices=list(TARGETS), default=None,
                    help="win | linux | mac (Linux/Mac unter Windows ueber WSL)")
    ap.add_argument("--arch", choices=list(MAC_ARCHS), default=None,
                    help="nur mac: arm64 (Apple Silicon), x64 (Intel) oder beide")
    ap.add_argument("--distro", default=None, help="WSL-Distribution (leer = Standard)")
    ap.add_argument("--profile", default="", help="Profil aus build_profiles_electron/")
    ap.add_argument("--features", default="",
                    help="Komma-Liste; leer = alle Standardfunktionen")
    ap.add_argument("--no-devtools", action="store_true")
    a = ap.parse_args(argv)

    feats = bt.load_manifest()
    if a.profile:
        p = load_profile(a.profile)
        cfg = {"features": bt.profile_features(p, feats), "profile": a.profile,
               "edition": p.get("edition", ""), "expiry": p.get("expiry", ""),
               "target": p.get("target", "win"), "devtools": bool(p.get("devtools", True)),
               "mac_arch": p.get("mac_arch", ""),
               "version": p.get("version", "")}
    else:
        cfg = {"features": [ft["id"] for ft in feats if ft.get("default", True)],
               "profile": "", "edition": "", "expiry": "", "target": "win", "devtools": True}
    if a.features:
        cfg["features"] = [s.strip() for s in a.features.split(",") if s.strip()]
    if a.edition:
        cfg["edition"] = a.edition
    if a.expiry:
        cfg["expiry"] = a.expiry
    if a.target:
        cfg["target"] = a.target
    lin = WSL.load_settings(PROFILE_DIR)
    cfg["mac_arch"] = a.arch or cfg.get("mac_arch") or lin.get("mac_arch", "beide")
    cfg["distro"] = a.distro if a.distro is not None else lin.get("distro", "")
    if a.no_devtools:
        cfg["devtools"] = False
    cfg["version"] = (a.version or cfg.get("version") or bt.next_version()).lstrip("vV")
    cfg["name"] = a.name or ("%s v%s" % (BASENAME, cfg["version"]))
    out = run_build(cfg, lambda m: print(m, flush=True))
    print("\n=> " + out)


if __name__ == "__main__":
    if "--cli" in sys.argv:
        run_cli([x for x in sys.argv[1:] if x != "--cli"])
    else:
        run_ui()
