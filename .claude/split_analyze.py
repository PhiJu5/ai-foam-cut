"""Abschnitts-Abhängigkeiten in app.js.
  python .claude/split_analyze.py            Übersicht
  python .claude/split_analyze.py 25 28      Details zu Abschnitten
  python .claude/split_analyze.py --group 25,26,27,28   Abschnitte als EIN Modul betrachten
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(__file__))
from split_lib import *

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
lines = read(os.path.join(HERE, 'app.js')).split('\n')
sections = parse_sections(lines)
defs = top_defs(lines)
owner = {n: next(i for i, s in enumerate(sections) if s['start'] <= d['line'] < s['end']) for n, d in defs.items()}
uses = [used_names('\n'.join(lines[s['start']:s['end']]), defs) for s in sections]

def report(group):
    g = set(group)
    imp = collections.defaultdict(collections.Counter); exp = collections.defaultdict(collections.Counter)
    for si in g:
        for nm, c in uses[si].items():
            if owner[nm] not in g: imp[owner[nm]][nm] += c
    for sj in range(len(sections)):
        if sj in g: continue
        for nm, c in uses[sj].items():
            if owner[nm] in g: exp[sj][nm] += c
    return imp, exp

args = sys.argv[1:]
if args and args[0] == '--group':
    group = resolve_sections(sections, args[1])
    imp, exp = report(group)
    tot = sum(sections[i]['end'] - sections[i]['start'] for i in group)
    print(f"Modul aus Abschnitten {group}: {tot} Zeilen, {sum(1 for n in defs if owner[n] in group)} Definitionen")
    print(f"\nbraucht {sum(len(v) for v in imp.values())} fremde Namen:")
    for k, v in sorted(imp.items(), key=lambda kv: -len(kv[1])):
        print(f"  [{k:2}] {sections[k]['name'][:42]:42} " + ', '.join(f'{n}×{c}' for n, c in v.most_common()))
    print(f"\nstellt {len({n for v in exp.values() for n in v})} Namen für andere bereit:")
    for k, v in sorted(exp.items(), key=lambda kv: -len(kv[1])):
        print(f"  [{k:2}] {sections[k]['name'][:42]:42} " + ', '.join(f'{n}×{c}' for n, c in v.most_common()))
    # Ladezeit-Risiko: Top-Level-Anweisungen im Modul, die Importe benutzen
    impn = {n for v in imp.values() for n in v}
    risky = []
    for si in group:
        for i in top_statements(lines, (sections[si]['start'], sections[si]['end'])):
            u = used_names(lines[i], impn)
            if u: risky.append((i + 1, lines[i].strip()[:70], ', '.join(u)))
    if risky:
        print("\nACHTUNG Ladezeit: Top-Level-Anweisungen, die Importe benutzen (laufen vor app.js!):")
        for ln, txt, u in risky: print(f"  Z.{ln}: {txt}   -> {u}")
    sys.exit()

print(f"{'#':>2} {'Zeilen':>6} {'Defs':>4} {'Imp':>4} {'Exp':>4}  Abschnitt")
for si, s in enumerate(sections):
    imp, exp = report([si])
    ni = sum(len(v) for v in imp.values()); ne = len({n for v in exp.values() for n in v})
    print(f"{si:>2} {s['end']-s['start']:>6} {sum(1 for n in defs if owner[n]==si):>4} {ni:>4} {ne:>4}  {s['name'][:60]}  (ab Z. {s['start']+1})")
print("\nImp = fremde Namen, die der Abschnitt benutzt; Exp = eigene Namen, die andere benutzen.")
for a in args:
    if a.isdigit():
        si = int(a); imp, exp = report([si])
        print(f"\n=== [{si}] {sections[si]['name']} ===\nbraucht:")
        for k, v in sorted(imp.items(), key=lambda kv: -len(kv[1])):
            print(f"  [{k:2}] {sections[k]['name'][:42]:42} " + ', '.join(f'{n}×{c}' for n, c in v.most_common()))
        print("stellt bereit:")
        for k, v in sorted(exp.items(), key=lambda kv: -len(kv[1])):
            print(f"  [{k:2}] {sections[k]['name'][:42]:42} " + ', '.join(f'{n}×{c}' for n, c in v.most_common()))
