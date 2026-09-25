import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from split_lib import rewrite
src = """  function foo(poly, x) { return poly.length + nav.zoom + state.cfg.a; }
  const bar = arr.map(nav => nav.x + state.b) + arr.map((nav, i) => nav + i) + arr.filter(x => nav.has(x));
  function baz() { const state = 1; return state + hint('a') + obj.hint + { hint: 2 }.hint + { nav } + `t ${nav.x} 'nav'` + /nav/.test(s) + (cond ? nav : 0) + 'nav'; }
  let q = poly([1,2]); render(); x?.nav; if (typeof render === 'function') render(); if (nav) { render(); }
  const o = { m(poly) { return poly; }, get nav() { return 1; }, k: nav, [nav]: 1 };
  try { a(); } catch (e) { render(e); } for (const nav of xs) { nav.a; }  while (nav.x) render();
  function ok(a = 1) { return a + nav; }
  el.addEventListener('click', () => { render(); }); btn.onclick = function () { nav.x = 1; };
"""
out, n = rewrite(src, {'poly', 'nav', 'state', 'hint', 'render'})
print(out); print('count', n)
