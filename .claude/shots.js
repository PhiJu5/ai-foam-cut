// Screenshots der App (wie in der Electron-exe gerendert) via Chrome DevTools Protocol.
// Node 24: globales WebSocket. Chrome laeuft headless mit Remote-Debugging.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = 'http://127.0.0.1:58744/AI%20Foam%20Cut.html';
const OUT = path.resolve(ROOT, 'website', 'img_new');
const CDP = 'http://127.0.0.1:9222';
fs.mkdirSync(OUT, { recursive: true });

const AERO = 'C:/Users/manue/OneDrive/Desktop/Aerodynamik/Projekte/Discus 3,3';
const WING_XML = fs.readFileSync(path.join(AERO, 'Main_Wing.xml'), 'utf-8');
const FOILS = ['Discus 140k-v1', 'Discus 48k-v1', 'Discus 75 k-v1'].map(n => ({
  name: n + '.dat', text: fs.readFileSync(path.join(AERO, 'Strak v1', n + '.dat'), 'utf-8')
}));
const DXF_JSON = fs.readFileSync(path.join(ROOT, 'Testformen', '07_Ellipse_Ellipse_gedreht.json'), 'utf-8');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pickTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await fetch(CDP + '/json/list').then(r => r.json());
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Kein Chrome-Target gefunden');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].method === msg.method) { waiters[i].resolve(msg.params); waiters.splice(i, 1); }
      }
    }
  });
  const ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const mid = ++id; pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  }
  function once(method, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const w = { method, resolve }; waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('timeout ' + method)); } }, timeout);
    });
  }
  return { ready, send, once };
}

async function main() {
  const c = connect(await pickTarget());
  await c.ready;
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 940, deviceScaleFactor: 2, mobile: false });
  // Dialoge (alert/confirm) automatisch wegklicken.
  c.once = c.once; // noop
  await c.send('Page.javascriptDialogOpening').catch(() => {});
  // Auto-accept native dialogs:
  const autoDialog = () => {};
  // (wir ueberschreiben window.alert/confirm zusaetzlich per JS)

  async function evalJs(expr) {
    const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
    return r.result.value;
  }
  async function shot(name) {
    const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  -> ' + name + '.png');
  }
  async function view(v, name, wait = 1200) {
    await evalJs(`window.App.switchView(${JSON.stringify(v)}); true`);
    await sleep(wait);
    await shot(name);
  }

  console.log('Lade App ...');
  const loaded = c.once('Page.loadEventFired');
  await c.send('Page.navigate', { url: APP });
  await loaded;
  await sleep(1900);

  // Dialoge lahmlegen + Dev-Badge ausblenden.
  await evalJs(`window.alert=function(){}; window.confirm=function(){return true;};
    (function(){ const el=[...document.querySelectorAll('header *, .topbar *, .appbar *, body *')].find(e=>e.children.length===0 && /^Dev$/i.test((e.textContent||'').trim())); if(el) el.style.display='none'; })(); true`);

  console.log('Lade Discus-Tragflaeche (XFLR5) ...');
  await evalJs(`window.App.addFoilDats(${JSON.stringify(FOILS)}); true`);
  await sleep(400);
  await evalJs(`window.App.processXflr(${JSON.stringify(WING_XML)}); true`);
  await sleep(1500);
  // Badge erneut ausblenden (Sidebar/Render neu aufgebaut).
  await evalJs(`(function(){ const el=[...document.querySelectorAll('body *')].find(e=>e.children.length===0 && /^Dev$/i.test((e.textContent||'').trim())); if(el) el.style.display='none'; })(); true`);

  console.log('Reiter mit Tragflaeche:');
  await view('material', 'material');
  await view('wing', 'tragflaeche');
  await view('core', 'kern');
  await view('neg', 'negativ');

  // G-Code: Simulation starten fuer einen Schnitt-mittendrin-Screenshot.
  await evalJs(`window.App.switchView('gcode'); true`);
  await sleep(1200);
  await evalJs(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>/^[\\s►▶]*Start$/i.test((x.textContent||'').trim())); if(b) b.click(); })(); true`);
  await sleep(2600);
  await shot('gcode');
  await evalJs(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>/Stop|Pause/i.test((x.textContent||'').trim())); if(b) b.click(); })(); true`).catch(() => {});

  await view('rib', 'rippen');

  // Formenbau mit Winglet (Ziel Urmodell -> Form 'winglet').
  console.log('Formenbau: Winglet ...');
  await evalJs(`window.App.switchView('form'); true`);
  await sleep(1200);
  await evalJs(`(function(){
    function setSel(val){ const s=[...document.querySelectorAll('select')].find(se=>[...se.options].some(o=>o.value===val)); if(s){ s.value=val; s.dispatchEvent(new Event('change',{bubbles:true})); return true;} return false; }
    setSel('ur');       // Ziel: Urmodell
    return true;
  })(); true`);
  await sleep(600);
  await evalJs(`(function(){
    const s=[...document.querySelectorAll('select')].find(se=>[...se.options].some(o=>o.value==='winglet')); if(s){ s.value='winglet'; s.dispatchEvent(new Event('change',{bubbles:true})); }
    return !!s;
  })(); true`);
  await sleep(1800);
  await shot('formenbau');

  // 3D-Modell: STL laden.
  console.log('3D-Modell (STL) ...');
  await evalJs(`(async function(){
    const resp = await fetch('/demo_model.stl'); const buf = await resp.arrayBuffer();
    const file = new File([buf], 'Rumpf-Demo.stl', { type: 'model/stl' });
    await window.Model3D.loadFile(file);
    try { window.Model3D.equalSplit(2); } catch(e){}
    return true;
  })()`);
  await sleep(1500);
  await view('model', 'modell', 1200);

  // Reiter ohne Tragflaechenbezug.
  await view('cad', 'cad');
  await view('fraese', 'fraese');
  await view('cut', 'schneiden');
  await view('machine', 'maschine');

  // DXF-Beispiel ZULETZT (loadProject ersetzt die Tragflaeche).
  console.log('DXF-Beispiel ...');
  await evalJs(`window.App.loadProject(${JSON.stringify(DXF_JSON)}); true`);
  await sleep(1500);
  await view('dxf', 'dxf', 1500);

  console.log('Fertig.');
  process.exit(0);
}

main().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
