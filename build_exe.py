"""Baut die AI-Foam-Cut-exe und buendelt AUTOMATISCH alle .js-Dateien
plus die HTML ein - neue Module werden ohne Aenderung am Build-Skript
mitgenommen.

Aufruf:
    python build_exe.py            -> Version des letzten Builds (z.B. v1.2)
    python build_exe.py v1.30      -> feste Versionsnummer
    python build_exe.py --name "AI Foam Cut"   -> beliebiger exe-Name ohne Version

Am einfachsten: BUILD_EXE.bat doppelklicken.
"""
import os, re, sys, glob, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = "AI Foam Cut.html"
ENTRY = "launcher.py"
BASENAME = "AI Foam Cut"


def next_version():
    """Version des zuletzt gebauten Stands - also die AKTUELLE. Dieselbe
    Regel wie in build_tool.py (dort steht die Begruendung); "old" bleibt
    aussen vor, dort liegt noch die alte Zaehlweise v1.25 ... v1.27."""
    try:
        import build_tool as BT
        return "v" + BT.next_version()
    except Exception:
        pass
    best = (1, 0)
    pat = re.compile(r"AI Foam Cut v(\d+)\.(\d+)", re.I)
    for folder in ("dist", "build"):
        for p in glob.glob(os.path.join(HERE, folder, "*")):
            m = pat.search(os.path.basename(p))
            if m:
                v = (int(m.group(1)), int(m.group(2)))
                if v > best:
                    best = v
    return "v%d.%d" % best


def collect_data_files():
    files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(HERE, "*.js")))
    if not os.path.isfile(os.path.join(HERE, HTML)):
        sys.exit("FEHLER: %s nicht gefunden." % HTML)
    files.append(HTML)
    return files


def check_html_references(js_files):
    """Warnt, wenn die HTML ein Skript laedt, das nicht existiert, oder wenn eine
    .js-Datei im Ordner liegt, die die HTML gar nicht einbindet."""
    with open(os.path.join(HERE, HTML), encoding="utf-8", errors="replace") as f:
        html = f.read()
    referenced = set(re.findall(r'src="([^"?]+\.js)', html))
    present = set(js_files)
    missing = sorted(referenced - present)
    unused = sorted(present - referenced)
    ok = True
    if missing:
        print("FEHLER: HTML verweist auf fehlende Dateien:")
        for f in missing:
            print("   ", f)
        ok = False
    if unused:
        print("Hinweis: diese .js-Dateien werden von der HTML NICHT eingebunden")
        print("         (werden trotzdem mitgebuendelt):")
        for f in unused:
            print("   ", f)
    return ok


def ensure_pyinstaller():
    try:
        import PyInstaller  # noqa: F401
        return
    except ImportError:
        pass
    print("PyInstaller fehlt - wird installiert ...")
    subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], check=True)


def main():
    args = sys.argv[1:]
    name = None
    if "--name" in args:
        i = args.index("--name")
        name = args[i + 1]
        del args[i:i + 2]
    version = args[0].strip() if args else ""
    if version and not version.lower().startswith("v"):
        version = "v" + version
    if name is None:
        if not version:
            version = next_version()
        name = "%s %s" % (BASENAME, version)

    ensure_pyinstaller()

    data_files = collect_data_files()
    js_files = [f for f in data_files if f.endswith(".js")]

    print("=" * 60)
    print("Build:", name)
    print("=" * 60)
    print("Buendle folgende Dateien ein (%d):" % len(data_files))
    for f in data_files:
        print("   ", f)
    print()
    if not check_html_references(js_files):
        sys.exit(1)
    print()

    # Alte Reste dieses Namens entfernen, damit nichts Veraltetes drin bleibt.
    shutil.rmtree(os.path.join(HERE, "build", name), ignore_errors=True)
    old_exe = os.path.join(HERE, "dist", name + ".exe")
    if os.path.isfile(old_exe):
        try:
            os.remove(old_exe)
        except OSError:
            sys.exit("FEHLER: %s ist in Benutzung - bitte schliessen." % old_exe)

    cmd = [sys.executable, "-m", "PyInstaller", "--onefile", "--noconsole",
           "--clean", "--noconfirm", "--name", name]
    # Programmsymbol (gemeinsam mit der Electron-Variante, siehe make_icon.py)
    ico = os.path.join(HERE, "icon", "icon.ico")
    if os.path.isfile(ico):
        cmd += ["--icon", ico]
    for f in data_files:
        cmd += ["--add-data", "%s;." % f]
    cmd.append(ENTRY)

    subprocess.run(cmd, cwd=HERE, check=True)

    # .spec-Datei ins old/-Archiv verschieben (Hauptordner bleibt sauber).
    spec = os.path.join(HERE, name + ".spec")
    if os.path.isfile(spec):
        os.makedirs(os.path.join(HERE, "old"), exist_ok=True)
        shutil.move(spec, os.path.join(HERE, "old", name + ".spec"))

    if os.path.isfile(old_exe):
        size = os.path.getsize(old_exe) / 1e6
        print("\nFERTIG: %s  (%.1f MB)" % (old_exe, size))
    else:
        sys.exit("\nBuild fehlgeschlagen - keine exe erzeugt.")


if __name__ == "__main__":
    main()
