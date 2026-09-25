import sys, os, json, glob, http.server, socketserver, threading, webbrowser, datetime, ctypes, urllib.parse

# --- Ablaufdatum: App funktioniert nach diesem Datum nicht mehr ---
# None = kein Ablaufdatum. Fuer die freie Fassung IMMER None: eine GPL-Fassung
# darf sich nicht selbst abschalten. Das Feld stammt aus der Zeit der befristeten
# Testversionen und bleibt nur bestehen, weil das Build-Tool es setzen kann.
EXPIRY = None

HTML_NAME = "AI Foam Cut.html"
SETTINGS_NAME = "hotwing-settings.json"   # Standard-Dateiname (gleich wie manueller Export in der App)
LAST_CHOICE_FILE = ".hotwing-last-settings.txt"   # merkt sich die zuletzt gewaehlte Datei (nur Vorauswahl)

def base_dir():
    # Verzeichnis der gebundelten App-Dateien (PyInstaller onefile -> temp-Ordner _MEIPASS)
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))

def exe_dir():
    # Echter Ordner, in dem die .exe (bzw. das Skript) liegt
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))

def msgbox(text, title):
    try:
        ctypes.windll.user32.MessageBoxW(0, text, title, 0x10)
    except Exception:
        print(text)

def check_expiry():
    if EXPIRY is None:
        return
    today = datetime.date.today()
    if today > EXPIRY:
        msgbox(
            "Diese Testversion von AI Foam Cut ist am %s abgelaufen.\n"
            "Bitte eine neue Version anfordern." % EXPIRY.strftime("%d.%m.%Y"),
            "AI Foam Cut - Testversion abgelaufen",
        )
        sys.exit(0)

def _label_for(path):
    base = os.path.basename(path)
    if base == SETTINGS_NAME:
        name = "Standard"
    else:
        name = base
        if name.lower().startswith("hotwing-settings-"):
            name = name[len("hotwing-settings-"):]
        if name.lower().endswith(".json"):
            name = name[:-5]
    if not os.path.isfile(path):
        name += "  (neu)"
    return name

def choose_settings_file(folder):
    """Zeigt beim Start eine Auswahl der vorhandenen Einstellungsdateien im
    exe-Ordner (praktisch, wenn mehrere Maschinen an einem PC betrieben
    werden - jede Maschine kann ihre eigene Einstellungsdatei haben)."""
    pattern = os.path.join(folder, "hotwing-settings*.json")
    files = sorted(glob.glob(pattern))
    default_path = os.path.join(folder, SETTINGS_NAME)
    if default_path not in files:
        files.insert(0, default_path)

    last_path = None
    try:
        with open(os.path.join(folder, LAST_CHOICE_FILE), "r", encoding="utf-8") as f:
            last_path = f.read().strip()
    except Exception:
        pass

    try:
        import tkinter as tk
        from tkinter import simpledialog, filedialog
    except Exception:
        # Falls tkinter nicht verfuegbar ist: einfach Standarddatei nehmen.
        return default_path

    result = {"path": None}
    root = tk.Tk()
    root.title("AI Foam Cut")
    root.attributes("-topmost", True)
    root.resizable(False, False)

    tk.Label(root, text="Welche Maschine / Einstellungsdatei soll geladen werden?",
             padx=12, pady=10).pack()

    lb = tk.Listbox(root, width=46, height=8, exportselection=False)
    for p in files:
        lb.insert(tk.END, _label_for(p))
    preselect = files.index(last_path) if (last_path in files) else 0
    lb.selection_set(preselect)
    lb.see(preselect)
    lb.pack(padx=12, pady=4)

    def do_load():
        sel = lb.curselection()
        result["path"] = files[sel[0]] if sel else default_path
        root.destroy()

    def do_new():
        name = simpledialog.askstring(
            "Neue Maschine", "Name der neuen Maschine / Einstellungsdatei:", parent=root)
        if name:
            safe = "".join(c for c in name.strip() if c.isalnum() or c in (" ", "-", "_")).strip()
            if safe:
                p = os.path.join(folder, "hotwing-settings-%s.json" % safe)
                if p not in files:
                    files.append(p)
                    lb.insert(tk.END, _label_for(p))
                idx = files.index(p)
                lb.selection_clear(0, tk.END)
                lb.selection_set(idx)
                lb.see(idx)

    def do_browse():
        p = filedialog.askopenfilename(
            parent=root, title="Einstellungsdatei waehlen",
            filetypes=[("JSON-Einstellungen", "*.json")], initialdir=folder)
        if p:
            result["path"] = p
            root.destroy()

    def do_cancel():
        result["path"] = default_path
        root.destroy()

    btns = tk.Frame(root)
    btns.pack(pady=10)
    tk.Button(btns, text="Laden", width=12, command=do_load).grid(row=0, column=0, padx=4)
    tk.Button(btns, text="Neue Maschine...", width=15, command=do_new).grid(row=0, column=1, padx=4)
    tk.Button(btns, text="Durchsuchen...", width=13, command=do_browse).grid(row=0, column=2, padx=4)

    lb.bind("<Double-Button-1>", lambda e: do_load())
    root.protocol("WM_DELETE_WINDOW", do_cancel)
    root.eval('tk::PlaceWindow . center')
    root.mainloop()

    chosen = result["path"] or default_path
    try:
        with open(os.path.join(folder, LAST_CHOICE_FILE), "w", encoding="utf-8") as f:
            f.write(chosen)
    except Exception:
        pass
    return chosen

def main():
    check_expiry()
    root = base_dir()
    os.chdir(root)

    settings_file = choose_settings_file(exe_dir())

    class Handler(http.server.SimpleHTTPRequestHandler):
        # HTTP/1.1 mit Keep-Alive: der Browser laedt HTML + viele JS-Dateien
        # parallel; ohne Keep-Alive brechen einzelne Anfragen ab
        # (ERR_CONNECTION_RESET) und die App startet unvollstaendig.
        protocol_version = "HTTP/1.1"

        # Feste MIME-Tabelle. SimpleHTTPRequestHandler fragt sonst ueber
        # mimetypes die Windows-Registry (HKCR\.html), und steht dort etwas
        # Falsches - manche Programme tragen text/plain ein -, kommt die
        # Startseite als Quelltext-Wand im Browser an statt als Oberflaeche.
        extensions_map = {
            ".html": "text/html; charset=utf-8",
            ".htm": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".ico": "image/x-icon",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".dat": "text/plain; charset=utf-8",
            ".txt": "text/plain; charset=utf-8",
            "": "application/octet-stream",
        }

        def log_message(self, *a):
            pass

        def end_headers(self):
            # Kein Caching: sonst liefert der Browser bei gleichem festen Port
            # alte, zwischengespeicherte Dateien einer frueheren exe-Version aus
            # (z.B. HTML ohne sweeprot.js -> Werkstueck-Drehung fehlt).
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("X-Content-Type-Options", "nosniff")
            super().end_headers()

        def _send_json_bytes(self, data, status=200):
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
            if path == "/__machine__":
                # Name der beim Start gewaehlten Maschine (Kopfzeile der App).
                name = _label_for(settings_file).replace("  (neu)", "")
                self._send_json_bytes(json.dumps({"name": name}).encode("utf-8"))
                return
            if path == "/__settings__":
                if os.path.isfile(settings_file):
                    try:
                        with open(settings_file, "rb") as f:
                            data = f.read()
                        self._send_json_bytes(data)
                    except Exception:
                        self._send_json_bytes(b"", status=404)
                else:
                    self._send_json_bytes(b"", status=404)
                return
            return super().do_GET()

        def do_POST(self):
            path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
            if path == "/__settings__":
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    data = self.rfile.read(length)
                    with open(settings_file, "wb") as f:
                        f.write(data)
                    self._send_json_bytes(b'{"ok":true}')
                except Exception:
                    self._send_json_bytes(b'{"ok":false}', status=500)
                return
            self.send_error(404)

    # Threaded-Server: der Browser oeffnet mehrere Verbindungen gleichzeitig
    # (HTML + viele JS-Dateien + /__settings__). Ein single-threaded Server
    # bricht diese parallelen Anfragen ab (ERR_CONNECTION_RESET) -> Einstellungen
    # werden nicht geladen/gespeichert. ThreadingTCPServer behebt das.
    class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        daemon_threads = True
        # KEIN SO_REUSEADDR: unter Windows erlaubt es, denselben Port zu binden,
        # obwohl schon eine andere (aeltere) exe darauf horcht. Dann bekommt der
        # Browser die Seite der ALTEN Instanz und neue Funktionen "fehlen".
        # Ohne Reuse schlaegt bind() fehl -> sauberer Fallback auf freien Port.
        # (TIME_WAIT-Verbindungen blockieren das Binden unter Windows nicht.)
        allow_reuse_address = False

    # FESTER Port: unbedingt noetig, damit port-gebundene Browser-Daten erhalten
    # bleiben - "Zuletzt geladen" (localStorage-Liste + Datei-Handles in IndexedDB)
    # und die gemerkten Speicher-/Ladeordner. Bei wechselndem Port waeren die bei
    # jedem Start leer. Gegen alten Browser-Cache (z.B. HTML ohne neue Funktionen)
    # wirken die 'no-store'-Header (end_headers) plus der Zeitstempel in der URL.
    PREFERRED_PORT = 58743
    port_hint = ""
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PREFERRED_PORT), Handler)
    except OSError:
        # Port belegt (andere Instanz laeuft schon) -> Fallback auf freien Port.
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port_hint = ("\n\nHINWEIS: Es laeuft bereits eine andere AI-Foam-Cut-Instanz "
                     "(evtl. eine aeltere Version). Bitte diese ueber ihr Fenster mit OK "
                     "beenden, sonst fehlen dort neue Funktionen und die Liste "
                     "'Zuletzt geladen' ist in dieser Instanz leer.\n")
    port = httpd.server_address[1]
    # Eindeutiger Zeitstempel in der URL erzwingt beim Start eine frische Seite,
    # falls der Browser noch eine alte Version (z.B. ohne sweeprot.js/Rotation)
    # vom selben festen Port gecacht hat. localStorage bleibt erhalten, da der
    # Speicher an den Port gebunden ist, nicht an die Query.
    import time as _t
    url = "http://127.0.0.1:%d/AI%%20Foam%%20Cut.html?_=%d" % (port, int(_t.time()))

    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    webbrowser.open(url)

    msgbox(
        "AI Foam Cut laeuft jetzt im Browser.\n\n"
        "Aktive Einstellungsdatei:\n%s\n\n"
        "Zum Beenden auf OK klicken (schliesst den lokalen Server)."
        % (settings_file,) + port_hint,
        "AI Foam Cut",
    )
    httpd.shutdown()

if __name__ == "__main__":
    main()
