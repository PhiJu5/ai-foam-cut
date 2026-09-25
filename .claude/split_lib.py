"""Gemeinsame Helfer für split_analyze.py / split_extract.py.

Modell: app.js ist eine IIFE, alle Top-Level-Definitionen stehen mit genau
2 Leerzeichen Einzug. Abschnitte werden durch Kommentarzeilen
"  // -----" bzw. "  // =====" getrennt. Ausgelagerte Module tragen die
Markierung "@@split-module" im Kopf und exportieren ihre Top-Level-Namen
über das Registry-Objekt window.App.
"""
import re, os, glob

MARK = re.compile(r'^  // (?:-{5,}|={5,})')
TITLE = re.compile(r'^  //\s*(?:-{3,}|={3,})?\s*(.*?)\s*(?:-{3,}|={3,})?\s*$')
KW = {'let', 'const', 'var', 'function', 'async', 'return', 'typeof', 'new', 'in', 'of',
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'true',
      'false', 'null', 'undefined', 'this', 'class', 'await', 'yield', 'delete', 'void',
      'instanceof', 'try', 'catch', 'finally', 'throw', 'default', 'export', 'import'}
IDENT = re.compile(r'[A-Za-z_$][\w$]*')


def read(path):
    return open(path, encoding='utf-8').read()


def parse_sections(lines):
    """-> [{'name', 'start', 'end'}] (0-basierte Zeilenindizes, end exklusiv)."""
    sections = []
    # Kopf = alles nach "'use strict';" bis zum ersten Marker (IIFE-Rahmen bleibt in app.js)
    first = next((k + 1 for k, ln in enumerate(lines) if "'use strict'" in ln), 0)
    cur = {'name': 'Kopf (Helfer/mkSeg)', 'start': first}
    i = first
    while i < len(lines):
        if MARK.match(lines[i]):
            t = TITLE.match(lines[i]).group(1)
            j = i + 1
            while not t and j < len(lines) and lines[j].startswith('  //'):
                t = TITLE.match(lines[j]).group(1); j += 1
            if t and t != cur['name']:
                cur['end'] = i; sections.append(cur); cur = {'name': t, 'start': i}
        i += 1
    cur['end'] = len(lines); sections.append(cur)
    return sections


# ---------------------------------------------------------------- Tokenizer
def chunks(src):
    """Zerlegt JS in Stücke [(kind, text)], kind ∈ code|str|cmt.
    Template-Literale: Textteile = str, ${...}-Teile = code."""
    out = []; i = 0; n = len(src); buf = []
    def flush():
        if buf: out.append(('code', ''.join(buf))); buf.clear()
    last_sig = ''   # letztes signifikantes Zeichen im Code (für Regex-Erkennung)
    last_word = ''
    tpl_depth = []  # Stack: Klammertiefe beim Eintritt in ${
    while i < n:
        c = src[i]
        if c == '/' and src.startswith('//', i):
            flush(); j = src.find('\n', i); j = n if j < 0 else j
            out.append(('cmt', src[i:j])); i = j; continue
        if c == '/' and src.startswith('/*', i):
            flush(); j = src.find('*/', i + 2); j = n if j < 0 else j + 2
            out.append(('cmt', src[i:j])); i = j; continue
        if c in '\'"':
            flush(); j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\': j += 1
                if src[j] == '\n': break
                j += 1
            out.append(('str', src[i:j + 1])); i = j + 1; last_sig = c; continue
        if c == '`':
            flush(); j = i + 1; seg = [src[i]]
            while j < n:
                if src[j] == '\\': seg.append(src[j:j + 2]); j += 2; continue
                if src[j] == '`': seg.append('`'); j += 1; break
                if src.startswith('${', j):
                    seg.append('${'); out.append(('str', ''.join(seg))); seg = []
                    # Code bis zur passenden }
                    d = 0; k = j + 2; sub_start = k
                    while k < n:
                        ch = src[k]
                        if ch in '\'"`':
                            q = ch; k += 1
                            while k < n and src[k] != q:
                                if src[k] == '\\': k += 1
                                k += 1
                        elif ch == '{': d += 1
                        elif ch == '}':
                            if d == 0: break
                            d -= 1
                        k += 1
                    out.extend(chunks(src[sub_start:k]))
                    seg.append('}'); j = k + 1; continue
                seg.append(src[j]); j += 1
            out.append(('str', ''.join(seg))); i = j; last_sig = '`'; continue
        if c == '/':
            # Regex-Literal?  wenn davor ein Operator/Klammer-auf/Keyword steht
            prev = ''.join(buf).rstrip() if buf else ''
            if not prev:
                # letztes Code-Stück ansehen
                for k in range(len(out) - 1, -1, -1):
                    if out[k][0] == 'code' and out[k][1].strip(): prev = out[k][1].rstrip(); break
                    if out[k][0] == 'str': prev = 'x'; break
            m = re.search(r'([\w$]+|.)$', prev)
            pw = m.group(1) if m else ''
            is_re = (not pw) or pw in '(,=:[!&|?{};+-*%<>~^' or pw in ('return', 'typeof', 'case', 'in', 'of')
            if is_re:
                flush(); j = i + 1; in_cls = False
                while j < n:
                    ch = src[j]
                    if ch == '\\': j += 2; continue
                    if ch == '\n': break
                    if in_cls:
                        if ch == ']': in_cls = False
                    elif ch == '[': in_cls = True
                    elif ch == '/': break
                    j += 1
                j += 1
                while j < n and src[j].isalpha(): j += 1
                out.append(('str', src[i:j])); i = j; continue
        buf.append(c); i += 1
    flush()
    return out


def strip_noncode(src):
    return ''.join(t if k == 'code' else '\n' * t.count('\n') for k, t in chunks(src))


# ------------------------------------------------------- Top-Level-Definitionen
def _declarators(rest):
    """Namen aus 'a = 1, b, c = f(x, y => y)' (nur Tiefe 0, kein Arrow-Param)."""
    names = []; depth = 0; i = 0; n = len(rest); cur = []
    parts = []
    while i < n:
        ch = rest[i]
        if ch in '([{': depth += 1
        elif ch in ')]}':
            depth -= 1
            if depth < 0: break
        elif ch == ',' and depth == 0:
            parts.append(''.join(cur)); cur = []; i += 1; continue
        elif ch == ';' and depth == 0: break
        cur.append(ch); i += 1
    parts.append(''.join(cur))
    for p in parts:
        m = re.match(r'\s*([A-Za-z_$][\w$]*)\s*(=(?!>)|$|\s+(?:of|in)\b)', p)
        if m: names.append(m.group(1))
        else:
            # Destrukturierung: const { a, b } = ..., const [a, b] = ...
            m2 = re.match(r'\s*[\[{]([^\]}]*)[\]}]\s*=', p)
            if m2:
                for q in m2.group(1).split(','):
                    q = q.split(':')[-1].split('=')[0].strip()
                    if IDENT.fullmatch(q): names.append(q)
    return names


def top_defs(lines, rng=None):
    """-> {name: {'line': idx, 'kind': 'function'|'const'|'let'}} für Top-Level (2 Spaces)."""
    defs = {}
    lo, hi = (0, len(lines)) if rng is None else rng
    code_lines = strip_noncode('\n'.join(lines[lo:hi])).split('\n')
    for k, ln in enumerate(code_lines):
        idx = lo + k
        m = re.match(r'^  (?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)', ln)
        if m:
            defs.setdefault(m.group(1), {'line': idx, 'kind': 'function'}); continue
        m = re.match(r'^  (let|const|var)\s+(.*)', ln)
        if m:
            # Deklaration kann über mehrere Zeilen gehen: bis Tiefe 0 und ';'
            rest = m.group(2); j = k
            while j + 1 < len(code_lines) and not _complete(rest):
                j += 1; rest += '\n' + code_lines[j]
            for nm in _declarators(rest):
                defs.setdefault(nm, {'line': idx, 'kind': 'let' if m.group(1) == 'var' else m.group(1)})
    return defs


def _complete(s):
    d = 0
    for ch in s:
        if ch in '([{': d += 1
        elif ch in ')]}': d -= 1
        elif ch == ';' and d == 0: return True
    return d <= 0 and s.rstrip().endswith(';')


def top_statements(lines, rng):
    """Zeilenindizes von Top-Level-Anweisungen, die KEINE Funktionsdeklaration sind
    (laufen beim Laden sofort): const/let-Initialisierer und nackte Aufrufe."""
    lo, hi = rng; out = []
    for i in range(lo, hi):
        ln = lines[i]
        if re.match(r'^  (?:async\s+)?function\b', ln) or ln.startswith('  //') or not ln.startswith('  ') or ln.startswith('   '):
            continue
        if re.match(r'^  [\]\)}]', ln): continue
        out.append(i)
    return out


# ------------------------------------------------------- scope-bewusstes Umschreiben
ARROW_AFTER = re.compile(r'\s*=>')
BLOCK_AFTER = re.compile(r'\s*\{')
FN_NAME = re.compile(r'\s*\*?\s*([A-Za-z_$][\w$]*)')
DESTRUCT = re.compile(r'\s*([\[{][^=;]*[\]}])')
KEY_BEFORE = re.compile(r'([{,]|(?<![\w$.])(?:get|set|async|static))\s*$')
FN_BEFORE = re.compile(r'(?<![\w$.])function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*$')
CATCH_BEFORE = re.compile(r'(?<![\w$.])catch\s*$')
METHOD_BEFORE = re.compile(r'(?<![\w$.])(?:get|set|async|static)?\s*[A-Za-z_$][\w$]*\s*$')
CTRL_BEFORE = re.compile(r'(?<![\w$.])(?:if|for|while|switch|with|return)\s*$')
OBJ_BEFORE = re.compile(r'[{,]\s*$')


def rewrite(src, names, prefix='App.', log=None):
    """Ersetzt freie Vorkommen von `names` durch prefix+name. Überspringt Strings,
    Kommentare, Property-Zugriffe (x.name), Objekt-Schlüssel (name:), und Bereiche,
    in denen der Name lokal überschattet ist (Parameter, let/const/var, function).
    Objekt-Kurzschreibweise { name } wird zu { name: App.name }.
    Linear: Rückschau nur über die letzten Zeichen (tail) + inkrementellen Klammerstapel."""
    names = set(names)
    if not names: return src, 0
    parts = chunks(src)
    out = []; count = 0
    scopes = [set()]          # [0] = Modulebene
    arrow_pending = None      # Namen eines Arrow-/Funktions-Params, dessen '{' noch kommt
    for_pending = set()       # let/const im Kopf von for (...)
    expr_scopes = []          # (depth, names) für Arrow-Funktionen ohne Block
    depth = 0
    st = {'tail': '', 'bst': []}   # Rückschau-Puffer + Klammerstapel (nur Code)

    def emit(s):
        res.append(s)
        t = st['tail'] + s
        if len(t) > 400: t = t[-300:]
        st['tail'] = t
        bst = st['bst']
        for ch in s:
            if ch in '([{': bst.append(ch)
            elif ch in ')]}' and bst: bst.pop()

    def before():
        return st['tail'].rstrip()

    def enclosing():
        return st['bst'][-1] if st['bst'] else ''

    for kind, text in parts:
        if kind != 'code':
            out.append(text); continue
        res = []; i = 0; n = len(text)
        while i < n:
            ch = text[i]
            m = IDENT.match(text, i)
            if m and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] in '_$')):
                w = m.group(0); j = m.end()
                after = text[j:j + 40].lstrip()
                if w in ('let', 'const', 'var'):
                    nl = text.find('\n', j); decl = text[j:nl if nl >= 0 else n]
                    dn = _declarators(decl)
                    mm = DESTRUCT.match(text, j)
                    if mm: dn += [x for x in IDENT.findall(mm.group(1)) if x not in KW]
                    if enclosing() == '(': for_pending.update(dn)
                    else: scopes[-1].update(dn)
                elif w == 'function':
                    mm = FN_NAME.match(text, j)
                    if mm: scopes[-1].add(mm.group(1))
                is_arrow_param = ARROW_AFTER.match(text, j) is not None
                shadowed = (w in for_pending or any(w in s for s in scopes) or any(w in s for _, s in expr_scopes)
                            or before().endswith('.') or is_arrow_param)
                if w in names and not shadowed and w not in KW:
                    bf = before(); is_key = False; shorthand = False
                    if after.startswith(':') and not after.startswith('::') and OBJ_BEFORE.search(bf):
                        is_key = True
                    if after.startswith('(') and enclosing() == '{' and KEY_BEFORE.search(bf):
                        kk = _match_paren(text, j + len(text[j:j + 40]) - len(text[j:j + 40].lstrip()))
                        if kk > 0 and text[kk + 1:kk + 4].lstrip().startswith('{'): is_key = True
                    if not is_key and (after.startswith(',') or after.startswith('}')) and OBJ_BEFORE.search(bf) and enclosing() == '{':
                        shorthand = True
                    if is_key: emit(w)
                    elif shorthand: emit(w + ': ' + prefix + w); count += 1
                    else: emit(prefix + w); count += 1
                else:
                    emit(w)
                if is_arrow_param: arrow_pending = {w}
                i = j; continue
            if ch == '(':
                k = _match_paren(text, i)
                if k > 0:
                    inner = text[i + 1:k]; rest = text[k + 1:k + 6].lstrip(); bf = before()
                    is_param = (rest.startswith('=>') or FN_BEFORE.search(bf) or CATCH_BEFORE.search(bf)
                                or (rest.startswith('{') and enclosing() == '{' and METHOD_BEFORE.search(bf)
                                    and not CTRL_BEFORE.search(bf)))
                    if is_param:
                        arrow_pending = {x for x in IDENT.findall(inner) if x not in KW}
                        emit(text[i:k + 1]); i = k + 1
                        if not rest.startswith('=>') and not rest.startswith('{'): arrow_pending = None
                        continue
                depth += 1; emit(ch); i += 1; continue
            if ch == '[': depth += 1; emit(ch); i += 1; continue
            if ch in ')]':
                depth -= 1; emit(ch); i += 1
                expr_scopes = [(d, s) for d, s in expr_scopes if d <= depth]
                if ch == ')' and for_pending: arrow_pending = set(for_pending); for_pending = set()
                continue
            if ch == '{':
                depth += 1
                scopes.append(set(arrow_pending or ())); arrow_pending = None
                emit(ch); i += 1; continue
            if ch == '}':
                depth -= 1
                if len(scopes) > 1: scopes.pop()
                expr_scopes = [(d, s) for d, s in expr_scopes if d <= depth]
                emit(ch); i += 1; continue
            if ch == '=' and text.startswith('=>', i):
                emit('=>'); i += 2
                if not BLOCK_AFTER.match(text, i):
                    if arrow_pending: expr_scopes.append((depth, arrow_pending)); arrow_pending = None
                continue
            if ch in ',;':
                expr_scopes = [(d, s) for d, s in expr_scopes if d < depth]
            emit(ch); i += 1
        out.append(''.join(res))
    return ''.join(out), count


def _match_paren(text, i):
    d = 0
    for k in range(i, len(text)):
        if text[k] == '(': d += 1
        elif text[k] == ')':
            d -= 1
            if d == 0: return k
    return -1


def _looks_like_fn(before):
    """'(...)' gefolgt von '{' – Funktion, wenn davor function/Name (Methode) oder if/for/while/catch."""
    return True   # if/for/while/catch-Klammern enthalten keine Params, die stören – Überschattung harmlos


def _enclosing(before):
    """Letzte noch offene Klammer im Code davor."""
    st = []
    for ch in before:
        if ch in '([{': st.append(ch)
        elif ch in ')]}' and st: st.pop()
    return st[-1] if st else ''


def resolve_sections(sections, spec):
    """spec: 'a,b,c' – jedes Element eine Nummer oder ein Titel-Präfix (eindeutig)."""
    out = []
    for item in spec.split(','):
        item = item.strip()
        if item.isdigit():
            out.append(int(item)); continue
        hits = [i for i, s in enumerate(sections) if s['name'].startswith(item)]
        if len(hits) != 1:
            raise SystemExit(f"Abschnitt '{item}': {len(hits)} Treffer " + str([sections[i]['name'][:40] for i in hits]))
        out.append(hits[0])
    return out


def used_names(src, candidates):
    """Counter der Kandidaten, die im Code (ohne Strings/Kommentare) vorkommen."""
    import collections
    code = strip_noncode(src)
    c = collections.Counter()
    for m in re.finditer(r'(?<![\w$.])([A-Za-z_$][\w$]*)', code):
        w = m.group(1)
        if w in candidates: c[w] += 1
    return c


def module_files(here):
    """Bereits ausgelagerte Module (mit @@split-module) -> {path: defs}."""
    out = {}
    for p in glob.glob(os.path.join(here, '*.js')):
        try: s = read(p)
        except Exception: continue
        if '@@split-module' in s[:2000]:
            out[p] = top_defs(s.split('\n'))
    return out
