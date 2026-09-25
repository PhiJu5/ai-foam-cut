"""Heuristik: Aufrufe name( in jeder Datei, die weder lokal deklariert noch global bekannt sind."""
import re, os, sys
sys.path.insert(0, '.claude'); from split_lib import read, strip_noncode
html = read('AI Foam Cut.html'); order = re.findall(r'<script src="([^"?]+)', html)
BUILT = set('''Math JSON Object Array String Number Boolean Date RegExp Map Set WeakMap Promise Error TypeError RangeError Float32Array Float64Array Uint8Array Uint16Array Uint32Array Int32Array Int16Array Int8Array ArrayBuffer DataView Blob File FileReader URL TextEncoder TextDecoder DOMParser XMLSerializer Image Path2D Worker Symbol Proxy Reflect BigInt Intl Uint8ClampedArray
parseInt parseFloat isFinite isNaN Number String Boolean encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame fetch alert confirm prompt open close print structuredClone atob btoa queueMicrotask getComputedStyle matchMedia Function eval
require define'''.split())
# globale Namen: window.X=, function X (top-level in nicht-IIFE), App-Registry
glob = set()
for f in order:
    src = read(f); code = strip_noncode(src)
    glob.update(re.findall(r'window\.([A-Za-z_$][\w$]*)\s*=', code))
    for m in re.finditer(r'Object\.assign\(App, \{ ([^}]*) \}\)', code): glob.update(x.strip() for x in m.group(1).split(','))
    glob.update(re.findall(r"Object\.defineProperty\(App, '(\w+)'", src))
    glob.update(re.findall(r'(?<![\w$.])App\.([A-Za-z_$][\w$]*)\s*=(?!=)', code))
    # top-level (Spalte 0) Deklarationen
    glob.update(re.findall(r'^(?:function|async function)\s+([A-Za-z_$][\w$]*)', code, re.M))
    glob.update(re.findall(r'^(?:var|let|const|class)\s+([A-Za-z_$][\w$]*)', code, re.M))
glob.update(re.findall(r'id="([A-Za-z_$][\w$]*)"', html))  # id-Globals
for f in order:
    src = read(f); code = strip_noncode(src)
    decl = set(re.findall(r'\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)', code))
    decl.update(re.findall(r'\b(?:var|let|const|class)\s+([A-Za-z_$][\w$]*)', code))
    for m in re.finditer(r'\b(?:var|let|const)\s*[\{\[]([^=]*?)[\}\]]\s*=', code):
        decl.update(re.findall(r'(?:^|[,{\[:\s])([A-Za-z_$][\w$]*)\s*(?=[,}\]]|=|$)', m.group(1)))
    for m in re.finditer(r'\bfunction\s*\*?\s*[A-Za-z_$]*[\w$]*\s*\(([^)]*)\)', code): decl.update(re.findall(r'[A-Za-z_$][\w$]*', m.group(1)))
    for m in re.finditer(r'\(([^()]*)\)\s*=>', code): decl.update(re.findall(r'[A-Za-z_$][\w$]*', m.group(1)))
    decl.update(re.findall(r'([A-Za-z_$][\w$]*)\s*=>', code))
    decl.update(re.findall(r'catch\s*\(\s*([A-Za-z_$][\w$]*)', code))
    decl.update(re.findall(r'\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function|\()', code))  # obj-Methoden / Zuweisungen
    calls = set(re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(', code))
    kw = {'if','for','while','switch','catch','return','function','typeof','new','await','async','delete','void','in','of','else','do','throw','yield','instanceof','super','this'}
    miss = sorted(calls - decl - glob - BUILT - kw)
    if miss: print(f'{f}: {", ".join(miss)}')
