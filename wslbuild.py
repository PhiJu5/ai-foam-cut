"""WSL-Hilfen fuer die Build-Tools: Linux- und Mac-Ausgaben unter Windows bauen.

Weder PyInstaller noch electron-builder koennen unter Windows etwas fuer
Linux (oder macOS) packen. Beide laufen deshalb in WSL, dem Linux, das
Windows mitbringt: der fertige Bauordner (Stage) wird ins Linux-Dateisystem
kopiert, dort gebaut und das Ergebnis nach dist\\ zurueckgeholt.

Laeuft das Build-Tool selbst unter Linux oder macOS, braucht es das alles
nicht - dann ruft es die Werkzeuge direkt auf (siehe native()).

Benutzt von build_tool.py (Browser-Ausgabe, PyInstaller) und
build_tool_electron.py der freien Fassung (Electron-Ausgabe).

Zwei Fallen, die schon zugeschlagen haben:
  1. wsl.exe IMMER mit "-e bash -lc": sonst wertet die Standard-Shell der
     Distribution $VAR und $(...) aus, bevor bash sie sieht.
  2. Pruefungen als EIN Wort ausgeben ("[ -f x ] && echo ja || echo nein") -
     "echo X=$(ls x && echo ja)" gaebe zwei Zeilen, und die zweite liefe
     durch die Wortzerlegung als Befehl.
"""
import os
import sys
import json
import subprocess

# Arbeitsordner IN Linux (nicht auf /mnt/c: dort ist alles langsam, und
# node_modules aus Windows enthalten die falschen Binaerteile).
BUILD_DIR = "$HOME/afc-build"
PYVENV = BUILD_DIR + "/pyvenv"               # eigenes Python mit PyInstaller
PY = PYVENV + "/bin/python"
# Pakete fuer die Browser-Ausgabe: venv (Ubuntu liefert pip/ensurepip nicht
# mit), tk (Auswahlfenster der Einstellungsdatei), binutils (PyInstaller
# braucht objdump/objcopy).
APT_PY = ["python3-venv", "python3-tk", "binutils"]
PATH_FIX = ('export PATH="$PATH:/usr/local/bin:/usr/bin"; '
            '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; '
            'export CSC_IDENTITY_AUTO_DISCOVERY=false; export USE_HARD_LINKS=false; ')

FEHLT = (
    "Auf diesem Windows ist keine WSL-Distribution eingerichtet.\n"
    "\n"
    "WSL ist das Linux, das in Windows mitgeliefert wird - darin laeuft der Bau.\n"
    "Einmalig in einer Eingabeaufforderung mit Administratorrechten:\n"
    "\n"
    "    wsl --install -d Ubuntu\n"
    "\n"
    "Danach den Rechner neu starten und Ubuntu einmal oeffnen (Benutzername und\n"
    "Kennwort vergeben). Anschliessend hier \"Linux-Werkzeuge einrichten\".")


def native():
    """True, wenn das Build-Tool selbst unter Linux/macOS laeuft (kein WSL noetig)."""
    return os.name != "nt"


def settings_path(profile_dir):
    return os.path.join(profile_dir, "_linux.json")


def load_settings(profile_dir):
    try:
        with open(settings_path(profile_dir), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_settings(profile_dir, data):
    os.makedirs(profile_dir, exist_ok=True)
    old = load_settings(profile_dir)
    old.update(data)
    with open(settings_path(profile_dir), "w", encoding="utf-8") as f:
        json.dump(old, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------- WSL rufen
def distros():
    """Namen der installierten WSL-Distributionen. Leere Liste = keine da."""
    if native():
        return []
    try:
        r = subprocess.run(["wsl.exe", "--list", "--quiet"], capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return []
    if r.returncode != 0:
        return []
    raw = r.stdout or b""
    # wsl.exe antwortet in UTF-16 (je nach Windows-Fassung auch in UTF-8).
    text = raw.decode("utf-16-le", "ignore") if b"\x00" in raw[:40] else raw.decode("utf-8", "replace")
    text = text.replace("\ufeff", "").replace("\x00", "").replace("\r", "")
    return [ln.strip() for ln in text.split("\n") if ln.strip()]


def cmd(distro, script, root=False):
    """Befehlszeile fuer ein Stueck bash in WSL (Anmelde-Shell, damit node aus
    nvm gefunden wird). root=True laeuft als root - ohne Kennwortabfrage,
    so kann das Build-Tool Pakete einrichten."""
    if native():
        return ["bash", "-lc", PATH_FIX + script]
    c = ["wsl.exe"]
    if distro:
        c += ["-d", distro]
    if root:
        c += ["-u", "root"]
    return c + ["-e", "bash", "-lc", PATH_FIX + script]


def run(distro, script, timeout=600, root=False):
    """(Rueckgabecode, Ausgabe) fuer kurze Abfragen."""
    try:
        r = subprocess.run(cmd(distro, script, root), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
    except FileNotFoundError:
        raise RuntimeError("wsl.exe nicht gefunden - auf diesem Windows gibt es kein WSL.")
    except subprocess.TimeoutExpired:
        raise RuntimeError("WSL hat nicht geantwortet (%d s). Laeuft die Distribution?" % timeout)
    return r.returncode, ((r.stdout or "") + (r.stderr or "")).strip()


def stream(distro, script, log, cancel=None, what="Befehl", root=False):
    """Wie run(), aber Zeile fuer Zeile ins Protokoll. Gibt den Rueckgabecode zurueck."""
    proc = subprocess.Popen(cmd(distro, script, root), stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                            errors="replace")
    for line in proc.stdout:
        log(line.rstrip())
        if cancel and cancel():
            proc.kill()
            log("Abbruch angefordert - der Linux-Teil laeuft dort noch kurz weiter.")
            raise RuntimeError("Abgebrochen.")
    proc.wait()
    if proc.returncode != 0:
        log("%s mit Code %d beendet." % (what, proc.returncode))
    return proc.returncode


def shq(s):
    """Pfad oder Text fuer die Linux-Shell in Hochkommas setzen."""
    return "'" + str(s).replace("'", "'\\''") + "'"


def lpath(distro, win_path):
    """C:\\Users\\... -> /mnt/c/Users/... (unter Linux/macOS unveraendert)."""
    if native():
        return os.path.abspath(win_path)
    code, out = run(distro, "wslpath -a " + shq(win_path), timeout=60)
    line = out.strip().splitlines()[-1] if out.strip() else ""
    if code != 0 or not line.startswith("/"):
        raise RuntimeError("Pfad laesst sich in WSL nicht umrechnen (%s):\n%s" % (win_path, out))
    return line


# ---------------------------------------------------------------- Pruefen
def _da(pfad):
    return '[ -e ' + pfad + ' ] && echo ja || echo nein'


def check(distro, need):
    """need: "python" (Browser-Ausgabe) oder "node" (Electron-Ausgabe).
    Gibt (ok, Bericht) zurueck."""
    if not native() and not distros():
        return False, FEHLT
    script = ('echo "DISTRO=$(. /etc/os-release 2>/dev/null; echo $PRETTY_NAME)"; '
              'echo "GLIBC=$(ldd --version 2>/dev/null | head -n 1 | grep -o "[0-9.]*$")"; '
              'echo "NODE=$(node -v 2>/dev/null)"; '
              'echo "BUILDER=$(' + _da(BUILD_DIR + "/node_modules/electron-builder/package.json") + ')"; '
              'echo "PYI=$(' + _da(PYVENV + "/bin/pyinstaller") + ')"; '
              'echo "TK=$(' + PY + ' -c "import tkinter" >/dev/null 2>&1 && echo ja || echo nein)"')
    code, out = run(distro, script, timeout=120)
    v = {}
    for ln in out.splitlines():
        if "=" in ln and ln.split("=", 1)[0].isupper():
            k, val = ln.split("=", 1)
            v[k] = val.strip()
    lines = ["Distribution: " + (v.get("DISTRO") or distro or "Standard"),
             "glibc: " + (v.get("GLIBC") or "?")]
    if need == "python":
        ok = v.get("PYI") == "ja" and v.get("TK") == "ja"
        lines += ["PyInstaller (%s): %s" % (PYVENV, "vorhanden" if v.get("PYI") == "ja" else "FEHLT"),
                  "tkinter: " + ("vorhanden" if v.get("TK") == "ja" else "FEHLT")]
        lines += ["", "Die Linux-Datei laeuft auf Systemen mit glibc %s oder neuer. Fuer aeltere "
                      "Systeme in einer aelteren Distribution bauen (z. B. wsl --install -d "
                      "Ubuntu-22.04)." % (v.get("GLIBC") or "dieser Fassung")]
    else:
        ok = bool(v.get("NODE")) and v.get("BUILDER") == "ja"
        lines += ["node: " + (v.get("NODE") or "FEHLT"),
                  "electron-builder (%s): %s" % (BUILD_DIR, "vorhanden" if v.get("BUILDER") == "ja"
                                                 else "FEHLT")]
    if code != 0 and not v:
        lines += ["", "Ausgabe:", out[:800]]
    if not ok:
        lines += ["", "Es fehlt noch etwas - Schaltflaeche \"Linux-Werkzeuge einrichten\"."]
    return ok, "\n".join(lines)


# ---------------------------------------------------------------- Einrichten
def setup(distro, need, log, cancel=None, package_json=None):
    """Werkzeuge in der Distribution einrichten (einmalig).
    need="python": apt-Pakete (als root, ohne Kennwort) + venv mit PyInstaller.
    need="node": node/npm per apt, dann electron + electron-builder nach
    ~/afc-build (Fassungen aus package_json["devDependencies"])."""
    if need == "python":
        apt = APT_PY
    else:
        apt = ["nodejs", "npm"]
    if native():
        log("Unter Linux/macOS richtet das Build-Tool keine Systempakete ein. Bitte selbst: "
            + " ".join(apt))
    else:
        log("Systempakete in WSL (als root): " + " ".join(apt))
        # nodejs nur, wenn noch keins da ist (nvm-Installationen nicht ueberschreiben)
        pre = "command -v node >/dev/null && exit 0; " if need == "node" else ""
        code = stream(distro, pre + "set -e; export DEBIAN_FRONTEND=noninteractive; "
                      "apt-get update -q; apt-get install -y -q " + " ".join(apt),
                      log, cancel, what="apt-get", root=True)
        if code != 0:
            raise RuntimeError("apt-get ist fehlgeschlagen (Code %d) - siehe Protokoll." % code)
    if need == "python":
        script = ("set -e; mkdir -p " + BUILD_DIR + "; "
                  "[ -x " + PY + " ] || python3 -m venv " + PYVENV + "; "
                  + PY + " -m pip install -q --upgrade pip pyinstaller; "
                  + PY + " -m PyInstaller --version")
        log("PyInstaller in " + PYVENV + " einrichten ...")
        code = stream(distro, script, log, cancel, what="pip")
    else:
        dev = (package_json or {}).get("devDependencies", {}) or {
            "electron": "^33.0.0", "electron-builder": "^25.0.0"}
        pkgs = " ".join("%s@%s" % (k, val) for k, val in sorted(dev.items()))
        script = ("set -e; mkdir -p " + BUILD_DIR + "; cd " + BUILD_DIR + "; "
                  "[ -f package.json ] || echo '{\"name\":\"afc-build\",\"private\":true}' > package.json; "
                  "npm install --no-audit --no-fund --save-dev " + pkgs)
        log("npm install " + pkgs + "  (etwa 500 MB, einige Minuten)")
        code = stream(distro, script, log, cancel, what="npm install")
    if code != 0:
        raise RuntimeError("Die Einrichtung ist fehlgeschlagen (Code %d) - siehe Protokoll." % code)
    log("Werkzeuge eingerichtet.")


# ---------------------------------------------------------------- Bauen
def build(distro, stage, dest_dir, build_cmd, outputs, log, cancel=None, what="Linux",
          link_node_modules=False, stage_name="stage-oss"):
    """Stage nach Linux kopieren, dort build_cmd ausfuehren (im Stage-Ordner),
    die Dateien outputs (Pfade relativ zum Stage) nach dest_dir holen.
    Gibt die Pfade der geholten Dateien zurueck."""
    ok_need = "node" if link_node_modules else "python"
    ok, bericht = check(distro, ok_need)
    if not ok:
        raise RuntimeError("Die Bauumgebung ist noch nicht fertig:\n\n" + bericht)
    lstage = BUILD_DIR + "/" + stage_name
    src = lpath(distro, stage)
    os.makedirs(dest_dir, exist_ok=True)
    dest = lpath(distro, dest_dir)
    steps = ["set -e", "rm -rf " + lstage, "mkdir -p " + lstage,
             "cp -a " + shq(src) + "/. " + lstage + "/"]
    if link_node_modules:
        steps.append("rm -rf " + lstage + "/node_modules; ln -sfn " + BUILD_DIR
                     + "/node_modules " + lstage + "/node_modules")
    steps += ["cd " + lstage, build_cmd]
    for rel in outputs:
        base = os.path.basename(rel)
        steps += ['[ -e %s ] || { echo "Fehlt: %s"; ls -la %s; exit 3; }'
                  % (shq(rel), rel, shq(os.path.dirname(rel) or ".")),
                  "cp -f %s %s" % (shq(rel), shq(dest + "/" + base))]
    steps += ["cd /", "rm -rf " + lstage, "echo FERTIG-" + what.upper()]
    log("Bauen in %s: %s" % ("Linux" if native() else "WSL", build_cmd))
    code = stream(distro, "; ".join(steps), log, cancel, what=what + "-Bau")
    if code != 0:
        raise RuntimeError("Der %s-Bau ist fehlgeschlagen (Code %d). Der Stage liegt zur "
                           "Fehlersuche noch unter %s." % (what, code, lstage))
    got = [os.path.join(dest_dir, os.path.basename(r)) for r in outputs]
    for g in got:
        if not os.path.isfile(g):
            raise RuntimeError("Bau meldet Erfolg, aber %s ist nicht angekommen." % g)
    return got
