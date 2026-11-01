// XFOIL-Anbindung fuer den Reiter „Aerodynamik“ (Endpunkt /__xfoil__) —
// Node-Fassung von xfoilrun.py (launcher.py / dev_server); gleiche Anfrage,
// gleiche Antwort. Startet das echte xfoil.exe als Unterprozess je Lauf
// (Temp-Ordner, Befehle ueber stdin, Polar-/Dump-Dateien zuruecklesen),
// hoechstens `cores` Prozesse gleichzeitig, mit Wachhund gegen Haenger.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TIMEOUT = 120000;   // ms je XFOIL-Prozess hoechstens
const STALL = 8000;       // ms ohne neue Ausgabe → Prozess beenden (Haenger am Abriss)

function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

function findExe(dirs, wanted) {
  if (wanted) {
    let w = path.resolve(String(wanted));
    try { if (fs.statSync(w).isDirectory()) w = path.join(w, process.platform === 'win32' ? 'xfoil.exe' : 'xfoil'); } catch (e) { /* */ }
    if (/^xfoil[\w.-]*?(\.exe)?$/i.test(path.basename(w)) && isFile(w)) return w;
  }
  const names = process.platform === 'win32' ? ['xfoil.exe', 'xfoil'] : ['xfoil', 'xfoil.exe'];
  for (const d of dirs) {
    if (!d) continue;
    for (const sub of ['XFOIL', 'xfoil', '']) for (const nm of names) {
      const p = path.join(d, sub, nm);
      if (isFile(p)) return p;
    }
  }
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    for (const nm of names) { const p = path.join(d, nm); if (d && isFile(p)) return p; }
  }
  return null;
}

function prepPoints(pts) {
  const P = [];
  for (const q of pts || []) {
    const x = +q[0], y = +q[1];
    if (!isFinite(x) || !isFinite(y)) continue;
    if (P.length && Math.abs(P[P.length - 1][0] - x) < 1e-9 && Math.abs(P[P.length - 1][1] - y) < 1e-9) continue;
    P.push([x, y]);
  }
  if (P.length < 10) return null;
  let a = 0;
  for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; a += P[i][0] * P[j][1] - P[j][0] * P[i][1]; }
  if (a < 0) P.reverse();
  const te = [(P[0][0] + P[P.length - 1][0]) / 2, (P[0][1] + P[P.length - 1][1]) / 2];
  let le = P[0], dm = -1;
  for (const q of P) { const d = (q[0] - te[0]) ** 2 + (q[1] - te[1]) ** 2; if (d > dm) { dm = d; le = q; } }
  const c = Math.hypot(te[0] - le[0], te[1] - le[1]) || 1;
  return P.map(([x, y]) => [(x - le[0]) / c, (y - le[1]) / c]);
}

const num = (v, d, lo, hi) => { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

function dirSize(d) {
  try { return fs.readdirSync(d).reduce((s, f) => s + fs.statSync(path.join(d, f)).size, 0); } catch (e) { return -1; }
}

function readPolar(file) {
  const pts = [];
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf-8'); } catch (e) { return pts; }
  let body = false;
  for (const ln of txt.split(/\r?\n/)) {
    if (ln.trim().startsWith('------')) { body = true; continue; }
    if (!body) continue;
    const v = ln.trim().split(/\s+/).map(Number);
    if (v.length < 7 || v.slice(0, 7).some(x => !isFinite(x))) continue;
    pts.push({ alpha: v[0], cl: v[1], cd: v[2], cdp: v[3], cm: v[4], xtrU: v[5], xtrL: v[6] });
  }
  return pts;
}

// Ein XFOIL-Prozess mit Wachhund (siehe xfoilrun.py _sweep)
function sweep(exe, d, head, seq, polname) {
  return new Promise(resolve => {
    const cmd = head.concat(['PACC', polname, ''], seq, ['', 'QUIT', '']).join('\n');
    let pr;
    try { pr = spawn(exe, [], { cwd: d, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] }); }
    catch (e) { resolve([]); return; }
    let done = false, size = -1, last = Date.now();
    const t0 = Date.now();
    const finish = () => { if (done) return; done = true; clearInterval(iv); resolve(readPolar(path.join(d, polname))); };
    const iv = setInterval(() => {
      const sz = dirSize(d), now = Date.now();
      if (sz !== size) { size = sz; last = now; }
      if (now - last > STALL || now - t0 > TIMEOUT) { try { pr.kill(); } catch (e) { /* */ } }
    }, 100);
    pr.on('exit', finish);
    pr.on('error', finish);
    try { pr.stdin.on('error', () => {}); pr.stdin.end(cmd); } catch (e) { /* */ }
  });
}

function readDump(file) {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf-8'); } catch (e) { return null; }
  const rows = []; let s0 = -1;
  for (const ln of txt.split(/\r?\n/)) {
    if (ln.startsWith('#')) continue;
    const v = ln.trim().split(/\s+/).map(Number);
    if (v.length < 7 || v.slice(0, 7).some(x => !isFinite(x))) continue;
    if (rows.length && v[0] <= s0) break;            // Nachlauf beginnt
    s0 = v[0];
    rows.push([+v[1].toFixed(6), +v[2].toFixed(6), +v[3].toFixed(5), +v[6].toFixed(6)]);
  }
  return rows.length > 20 ? rows : null;
}

async function runDump(exe, d, head, job, visc, Re, ncrit) {
  const al = [...new Set((job.alphas || []).slice(0, 200).map(a => Math.round(num(a, 0, -30, 30) * 1000) / 1000))].sort((a, b) => a - b);
  if (!al.length) return null;
  const up = al.filter(a => a >= 0), dn = al.filter(a => a < 0).reverse();
  const names = {};
  const seq = (lst, tag) => [].concat(...lst.map((a, i) => { const fn = tag + String(i).padStart(3, '0') + '.txt'; names[a] = fn; return ['ALFA ' + a.toFixed(4), 'DUMP ' + fn]; }));
  let pts = [];
  if (up.length) pts = pts.concat(await sweep(exe, d, head, seq(up, 'u'), 'pu.txt'));
  if (dn.length) pts = pts.concat(await sweep(exe, d, head, seq(dn, 'd'), 'pd.txt'));
  const conv = new Map(pts.map(q => [Math.round(q.alpha * 1000) / 1000, q]));
  const res = [];
  for (const a of al) {
    const rows = readDump(path.join(d, names[a])); if (!rows) continue;
    const q = conv.get(a);
    res.push({ alpha: a, conv: !!q || !visc, rows, cl: q ? q.cl : null, cd: q ? q.cd : null, cm: q ? q.cm : null,
      xtrU: q ? q.xtrU : null, xtrL: q ? q.xtrL : null });
  }
  return res.length ? { dump: true, visc, Re, ncrit, alphas: res } : null;
}

async function runOne(exe, name, P, job) {
  const Re = num(job.Re, 1e5, 1e3, 1e8);
  const typ = Math.round(num(job.type, 1, 1, 2)) === 2 ? 2 : 1;
  const ncrit = num(job.ncrit, 9, 0.5, 20);
  let a0 = num(job.a0, -6, -30, 30), a1 = num(job.a1, 18, -30, 30);
  const da = Math.abs(num(job.da, 0.5, 0.05, 5)), mach = num(job.mach, 0, 0, 0.8);
  const it = Math.round(num(job.iter, 100, 10, 500));
  [a0, a1] = [Math.min(a0, a1), Math.max(a0, a1)];
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'xfoil_'));
  try {
    const nm = (String(name || 'Profil').replace(/[^\w .,()+-]/g, '_').slice(0, 60)) || 'Profil';
    fs.writeFileSync(path.join(d, 'foil.dat'), nm + '\n' + P.map(([x, y]) => x.toFixed(7) + ' ' + y.toFixed(7)).join('\n') + '\n');
    const visc = job.visc !== false;
    const head = ['PLOP', 'G F', '', 'LOAD foil.dat', 'PANE', 'OPER', 'TYPE ' + typ];
    if (visc) head.push('VISC ' + Re);
    head.push('MACH ' + mach.toFixed(4), 'VPAR', 'N ' + ncrit.toFixed(3), '', 'ITER ' + it);
    if (job.dump) return await runDump(exe, d, head, job, visc, Re, ncrit);
    if (job.points) {                    // Einzelpunkte (Profiloptimierung), je Liste ein Prozess
      const pq = job.points || {};
      const al = [...new Set((pq.alphas || []).slice(0, 100).map(a => Math.round(num(a, 0, -30, 30) * 1e4) / 1e4))].sort((a, b) => a - b);
      const cl = [...new Set((pq.cls || []).slice(0, 100).map(c => Math.round(num(c, 0, -3, 4) * 1e4) / 1e4))].sort((a, b) => a - b);
      let pts = [];
      if (al.length) pts = pts.concat(await sweep(exe, d, head, al.map(a => 'ALFA ' + a.toFixed(4)), 'pa.txt'));
      if (cl.length) {                   // Anlauf-Zwischenpunkte (kalter cl-Start konvergiert oft nicht, v. a. Typ 2)
        const warm = []; for (let k = 0; k < 20 && 0.1 + 0.15 * k < cl[0] - 0.05; k++) warm.push(+(0.1 + 0.15 * k).toFixed(4));
        pts = pts.concat(await sweep(exe, d, head, warm.concat(cl).map(c => 'CL ' + c.toFixed(4)), 'pc.txt'));
      }
      return { points: true, Re, type: typ, ncrit, pts };
    }
    const s = Math.max(a0, Math.min(a1, 0));
    let pts = [];
    if (a1 >= s) pts = pts.concat(await sweep(exe, d, head, ['ASEQ ' + [s, a1, da].map(v => v.toFixed(4)).join(' ')], 'pu.txt'));
    if (a0 < s - 1e-9) pts = pts.concat(await sweep(exe, d, head, ['ASEQ ' + [s - da, a0, -da].map(v => v.toFixed(4)).join(' ')], 'pd.txt'));
    pts.sort((p, q) => p.alpha - q.alpha);
    const out = [];
    for (const q of pts) if (!out.length || Math.abs(out[out.length - 1].alpha - q.alpha) > 1e-6) out.push(q);
    return out.length > 2 ? { Re, type: typ, ncrit, pts: out } : null;
  } catch (e) {
    return null;
  } finally {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* */ }
  }
}

async function handle(body, dirs) {
  let req;
  try { req = JSON.parse(String(body || '{}')); } catch (e) { return { ok: false, err: 'bad json' }; }
  const exe = findExe(dirs, req.exe);
  if (!exe) return { ok: false, err: 'xfoil.exe nicht gefunden' };
  const P0 = req.pts ? prepPoints(req.pts) : null;
  const jobs = (Array.isArray(req.jobs) ? req.jobs : []).slice(0, 400).filter(j => j && typeof j === 'object');
  const work = jobs.map(j => ({ name: j.name || req.name, P: j.pts ? prepPoints(j.pts) : P0, j }));
  const ncpu = (os.cpus() || []).length || 4;
  const want = Math.round(+req.cores || 0);
  const n = Math.max(1, Math.min(work.length || 1, want > 0 ? want : ncpu, ncpu));
  const results = new Array(work.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < work.length) {
      const i = next++, w = work[i];
      results[i] = w.P ? await runOne(exe, w.name, w.P, w.j) : null;
    }
  }));
  return { ok: true, exe, cores: n, results };
}

function info(dirs, wanted) {
  return { ok: true, exe: findExe(dirs, wanted), cpus: (os.cpus() || []).length || 1 };
}

// Nur Anfragen der App selbst (fremde Webseiten koennten sonst XFOIL-Laeufe anstossen)
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  return o.replace(/^https?:\/\//, '').replace(/\/$/, '') === String(req.headers.host || '');
}

module.exports = { handle, info, sameOrigin, findExe };
