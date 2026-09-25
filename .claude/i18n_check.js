// i18n-Prüfung: T('…')-Literale im Code, die in DICT.en fehlen.
// Aufruf: node i18n_check.js "<Projektordner>"
const fs = require('fs'), path = require('path');
const root = process.argv[2];
global.window = {}; global.localStorage = { getItem() { return null; }, setItem() {} };
global.document = { documentElement: { setAttribute() {} } };
new Function(fs.readFileSync(path.join(root, 'i18n.js'), 'utf8'))();
const dict = window.I18N.dict.en;
const html = fs.readFileSync(path.join(root, 'AI Foam Cut.html'), 'utf8');
const files = [...html.matchAll(/src="([^"?]+\.js)/g)].map(m => m[1]);
const unesc = s => s.replace(/\\(["'\\])/g, '$1').replace(/\\n/g, '\n');
const miss = {}; let total = 0;
for (const f of files) {
  if (f === 'i18n.js') continue;
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const reT = /(?<![\w.$])T\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;
  let m;
  while ((m = reT.exec(src))) {
    total++;
    const k = unesc(m[2]);
    if (!/[A-Za-zÄÖÜäöüß]/.test(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(dict, k)) (miss[f] = miss[f] || []).push(k);
  }
}
let n = 0;
for (const f in miss) {
  const u = [...new Set(miss[f])]; n += u.length;
  console.log('\n== ' + f + ' (' + u.length + ')');
  u.slice(0, 40).forEach(k => console.log('   ' + JSON.stringify(k)));
  if (u.length > 40) console.log('   … +' + (u.length - 40));
}
console.log('\nT()-Literale geprüft: ' + total + ', fehlend (eindeutig): ' + n + ', DICT.en Einträge: ' + Object.keys(dict).length);
