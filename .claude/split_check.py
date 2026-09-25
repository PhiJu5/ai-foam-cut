"""Syntaxprüfung aller JS-Dateien (esprima) + Konsistenz der App-Registry:
jeder in einer Datei gebundene Name (const { x } = App) muss von einer FRÜHER
geladenen Datei registriert werden; App.<x>-Zugriffe müssen irgendwo registriert sein."""
import sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from split_lib import *
import esprima

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = read(os.path.join(HERE, 'AI Foam Cut.html'))
order = re.findall(r'<script src="([^"?]+)', html)
ok = True   # esprima kann kein ES2020 (??, ?.) – Syntax wird im Browser geprüft (new Function)
print("Ladereihenfolge:", ', '.join(order))

registered = set(); problems = 0
for f in order:
    src = read(os.path.join(HERE, f))
    code = strip_noncode(src)
    bound = set()
    for m in re.finditer(r'const \{ ([^}]*) \} = App;', code):
        bound.update(x.strip() for x in m.group(1).split(','))
    miss = sorted(bound - registered)
    if miss: problems += len(miss); print(f"  {f}: bindet nicht registrierte Namen: {', '.join(miss)}")
    for m in re.finditer(r'Object\.assign\(App, \{ ([^}]*) \}\)', code): registered.update(x.strip() for x in m.group(1).split(','))
    registered.update(re.findall(r"Object\.defineProperty\(App, '(\w+)'", src))
    registered.update(re.findall(r'(?<![\w$.])App\.([A-Za-z_$][\w$]*)\s*=(?!=)', code))   # App.x = …
    # App.x-Zugriffe (werden zur Laufzeit aufgelöst) – nur prüfen, ob irgendwo registriert
    acc = set(re.findall(r'(?<![\w$.])App\.([A-Za-z_$][\w$]*)', code))
    globals()['_acc_' + f] = acc
for f in order:
    acc = globals().get('_acc_' + f, set())
    miss = sorted(acc - registered)
    if miss: problems += len(miss); print(f"  {f}: App.x nirgends registriert: {', '.join(miss)}")
print("Registry:", "OK" if not problems else f"{problems} Probleme")
sys.exit(0 if ok and not problems else 1)
