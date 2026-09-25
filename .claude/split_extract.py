"""Lagert Abschnitte aus app.js in ein eigenes Modul aus.

  python .claude/split_extract.py <ziel.js> "<Modultitel>" <Abschnitte> [--dry]
  <Abschnitte>: Nummern oder eindeutige Titel-Präfixe, kommagetrennt
  z. B.  python .claude/split_extract.py cad.js "CAD-Bearbeitung" "Reiter „CAD,Erweiterte 2D,Befehlsführung,Koordinaten-Modus"

Konzept (Registry window.App, Ladereihenfolge core.js → Module → app.js):
  * Jede Datei registriert ALLE eigenen Top-Level-Namen in App
    (function/const per Object.assign, let per Getter/Setter).
  * Namen aus FRÜHER geladenen Dateien werden einmal am Dateianfang gebunden:
        const { T, state, PAL } = App;          (function/const)
    let-Variablen und Namen aus der SPÄTER geladenen app.js werden im Code
    zu App.<name> umgeschrieben (scope-bewusst, siehe split_lib.rewrite).
  * app.js bekommt den Block @@app-imports (Bindungen) und @@app-exports
    (Registrierung der Namen, die Module aus app.js brauchen).
  * Backup von app.js + HTML nach .claude/split_backup/<zeit>/;
    HTML: <script src="ziel.js"> vor app.js, ?v= angehoben.
Vorher: python .claude/split_analyze.py --group <Abschnitte>  (Ladezeit-Warnungen)
"""
import sys, os, re, shutil, datetime
sys.path.insert(0, os.path.dirname(__file__))
from split_lib import *

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(HERE, 'app.js'); HTML = os.path.join(HERE, 'AI Foam Cut.html')
IB, IE = '  // @@app-imports-begin (automatisch, split_extract.py)', '  // @@app-imports-end'
EB, EE = '  // @@app-exports-begin (automatisch, split_extract.py)', '  // @@app-exports-end'


def cut_block(lines, b, e):
    """Entfernt Block b..e aus lines, gibt die enthaltenen Bezeichner zurück."""
    names = set()
    if b in lines:
        i, j = lines.index(b), lines.index(e)
        for ln in lines[i:j + 1]:
            if ln.strip().startswith('//') or 'window.App' in ln: continue
            ln = re.sub(r"get: \(\) => \w+, set: v => \{ \w+ = v; \}", '', ln)
            names.update(re.findall(r"(?<![\w$.])([A-Za-z_$][\w$]*)(?=\s*[,}']|\s*$)", ln))
        del lines[i:j + 1]
    return names - {'App', 'Object', 'const', 'enumerable', 'true', 'configurable', 'assign', 'defineProperty'}


def registry_lines(defs, names, at_top=False):
    """at_top=True (app.js, Block steht VOR den Deklarationen): const per Getter (TDZ!), nur function direkt."""
    fn = sorted(n for n in names if defs[n]['kind'] == 'function' or (defs[n]['kind'] == 'const' and not at_top))
    ro = sorted(n for n in names if defs[n]['kind'] == 'const' and at_top)
    lt = sorted(n for n in names if defs[n]['kind'] == 'let')
    out = []
    for i in range(0, len(fn), 8): out.append('  Object.assign(App, { ' + ', '.join(fn[i:i + 8]) + ' });')
    for n in ro: out.append(f"  Object.defineProperty(App, '{n}', {{ get: () => {n}, enumerable: true, configurable: true }});")
    for n in lt: out.append(f"  Object.defineProperty(App, '{n}', {{ get: () => {n}, set: v => {{ {n} = v; }}, enumerable: true, configurable: true }});")
    return out


def bind_lines(names):
    names = sorted(names); out = []
    for i in range(0, len(names), 10): out.append('  const { ' + ', '.join(names[i:i + 10]) + ' } = App;')
    return out


def reblock():
    """Import-/Export-Blöcke in app.js neu erzeugen (ohne Auszug)."""
    lines = read(APP).split('\n')
    old_imports = cut_block(lines, IB, IE); old_exports = cut_block(lines, EB, EE)
    defs = top_defs(lines)
    mods = module_files(HERE); ext = {}
    for d in mods.values(): ext.update(d)
    ext.pop('App', None)
    src = '\n'.join(lines)
    used = used_names(src, set(ext))
    app_bind = {n for n in used if ext[n]['kind'] != 'let'}
    app_rw = {n for n in used if ext[n]['kind'] == 'let'}
    if app_rw: print("  WARNUNG: let-Namen aus Modulen frei benutzt (müssten App.x sein):", ', '.join(sorted(app_rw)))
    app_exports = old_exports & set(defs)
    # + alles, was Module als App.x aus app.js brauchen
    for p, d in mods.items():
        acc = set(re.findall(r'(?<![\w$.])App\.([A-Za-z_$][\w$]*)', strip_noncode(read(p))))
        app_exports |= {n for n in acc if n in defs}
    k = next(i for i, ln in enumerate(lines) if "'use strict'" in ln)
    blk = [IB, '  const App = (window.App = window.App || {});'] + bind_lines(app_bind) + [IE,
           EB] + registry_lines(defs, app_exports, at_top=True) + [EE]
    lines[k + 1:k + 1] = blk
    open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    print(f"app.js: bindet {len(app_bind)}, registriert {len(app_exports)} Namen")


def main():
    if '--reblock' in sys.argv: return reblock()
    a = [x for x in sys.argv[1:] if not x.startswith('--')]; dry = '--dry' in sys.argv
    if len(a) < 3: print(__doc__); sys.exit(1)
    target, title = a[0], a[1]
    tpath = os.path.join(HERE, target)
    if os.path.exists(tpath): sys.exit(f"{target} existiert schon.")

    lines = read(APP).split('\n')
    old_imports = cut_block(lines, IB, IE); old_exports = cut_block(lines, EB, EE)
    sections = parse_sections(lines)
    group = resolve_sections(sections, a[2])
    print("Abschnitte:", [f"[{i}] {sections[i]['name'][:40]}" for i in group])
    app_defs = top_defs(lines)
    old_exports &= set(app_defs)
    mods = module_files(HERE)                       # früher geladene Dateien
    ext_defs = {}
    for d in mods.values(): ext_defs.update(d)
    ext_defs.pop('App', None)

    moved_rngs = [(sections[i]['start'], sections[i]['end']) for i in group]
    moved_set = set(); [moved_set.update(range(s, e)) for s, e in moved_rngs]
    moved_src = '\n'.join(lines[i] for i in sorted(moved_set))
    stay_src = '\n'.join(ln for i, ln in enumerate(lines) if i not in moved_set)

    moved_defs = {n: d for n, d in app_defs.items() if d['line'] in moved_set}
    stay_defs = {n: d for n, d in app_defs.items() if d['line'] not in moved_set}

    # --- Modul: was braucht es?
    need = used_names(moved_src, (set(stay_defs) | set(ext_defs)) - set(moved_defs))
    mod_bind = {n for n in need if n in ext_defs and ext_defs[n]['kind'] != 'let'}
    mod_rw = {n for n in need if n not in mod_bind}          # let aus Modulen + alles aus app.js
    # --- app.js: was braucht es aus dem neuen Modul (+ alte Bindungen weiter gültig?)
    used_stay = used_names(stay_src, set(moved_defs) | old_imports)
    app_bind = {n for n in used_stay if n in moved_defs and moved_defs[n]['kind'] != 'let'} | \
               {n for n in old_imports if n in used_stay and n in ext_defs and ext_defs[n]['kind'] != 'let'}
    app_rw = {n for n in used_stay if n in moved_defs and moved_defs[n]['kind'] == 'let'}
    # --- app.js registriert: alte Exporte (die noch in app.js liegen) + neue Bedarfe des Moduls
    app_exports = (old_exports | {n for n in need if n in stay_defs}) - set(moved_defs)

    # Ladezeit-Prüfung: Top-Level-Anweisungen im Modul, die app.js-Namen nutzen
    risky = []
    for s, e in moved_rngs:
        for i in top_statements(lines, (s, e)):
            u = used_names(lines[i], {n for n in need if n in stay_defs})
            if u: risky.append((i + 1, lines[i].strip()[:80], ', '.join(u)))

    print(f"Modul {target}: {len(moved_set)} Zeilen, {len(moved_defs)} Definitionen")
    print(f"  bindet {len(mod_bind)} Namen aus früheren Dateien: " + ', '.join(sorted(mod_bind)))
    print(f"  schreibt {len(mod_rw)} Namen als App.x um: " + ', '.join(f'{n}×{need[n]}' for n in sorted(mod_rw, key=lambda n: -need[n])))
    print(f"  app.js bindet {len(app_bind)} Namen, schreibt {len(app_rw)} um ({', '.join(sorted(app_rw))}), registriert {len(app_exports)}")
    if risky:
        print("\nACHTUNG Ladezeit (Top-Level-Anweisung nutzt app.js-Namen, die beim Laden noch fehlen):")
        for ln, t, u in risky: print(f"  Z.{ln}: {t}  -> {u}")
    if dry: print("\n--dry: nichts geschrieben."); return

    new_mod, c1 = rewrite(moved_src, mod_rw)
    new_app, c2 = rewrite(stay_src, app_rw)
    print(f"  ersetzt: {c1} im Modul, {c2} in app.js")

    head = [f"/* {target} — {title}  (@@split-module, ausgelagert aus app.js)",
            " * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;",
            " * Namen aus app.js (lädt später) laufen als App.<name>. */",
            "(function () {", "  'use strict';", "  const App = (window.App = window.App || {});"] + bind_lines(mod_bind)
    tail = ['', '  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----'] + \
           registry_lines(moved_defs, set(moved_defs)) + ['})();', '']
    mod_text = '\n'.join(head) + '\n' + new_mod + '\n' + '\n'.join(tail)

    app_lines = new_app.split('\n')
    k = next(i for i, ln in enumerate(app_lines) if "'use strict'" in ln)
    stay_defs2 = top_defs(app_lines)
    missing = sorted(n for n in app_exports if n not in stay_defs2)
    if missing: print("  WARNUNG: nicht mehr in app.js definiert (Export entfällt):", ', '.join(missing))
    app_exports = {n for n in app_exports if n in stay_defs2}
    blk = [IB, '  const App = (window.App = window.App || {});'] + bind_lines(app_bind) + [IE,
           EB] + registry_lines(stay_defs2, app_exports, at_top=True) + [EE]
    app_lines[k + 1:k + 1] = blk
    new_app = '\n'.join(app_lines)

    html = read(HTML)
    m = re.search(r'<script src="app\.js\?v=([^"]+)"></script>', html)
    if not m: sys.exit('app.js-Script-Tag nicht gefunden')
    today = datetime.date.today().strftime('%Y%m%d')
    mm = re.match(today + r's(\d+)$', m.group(1))
    ver = today + 's' + (str(int(mm.group(1)) + 1) if mm else '1')
    html = html.replace(m.group(0), f'<script src="{target}?v={ver}"></script>\n<script src="app.js?v={ver}"></script>')

    bdir = os.path.join(HERE, '.claude', 'split_backup', datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    os.makedirs(bdir, exist_ok=True); shutil.copy(APP, bdir); shutil.copy(HTML, bdir)
    open(tpath, 'w', encoding='utf-8', newline='\n').write(mod_text)
    open(APP, 'w', encoding='utf-8', newline='\n').write(new_app)
    open(HTML, 'w', encoding='utf-8', newline='\n').write(html)
    print(f"\nGeschrieben: {target} ({mod_text.count(chr(10))} Z.), app.js ({new_app.count(chr(10))} Z.), HTML (v={ver}). Backup: {bdir}")


main()
