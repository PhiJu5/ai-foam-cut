// Screenshots Formenbau (Randbogen, Winglet, Negativform unten) mit der Discus-Tragflaeche.
// Voraussetzung: node .claude/exe_server.js  +  Chrome headless mit --remote-debugging-port=9222.
// Aufruf: node .claude/shots_form.js [port]
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.argv[2] || '58743';
const APP = 'http://127.0.0.1:' + PORT + '/AI%20Foam%20Cut.html';
const OUT = path.resolve(ROOT, 'website', 'img_new');
const CDP = 'http://127.0.0.1:9222';
fs.mkdirSync(OUT, { recursive: true });

const AERO = 'C:/Users/manue/OneDrive/Desktop/Aerodynamik/Projekte/Discus 3,3';
const WING_XML = fs.readFileSync(path.join(AERO, 'Main_Wing.xml'), 'utf-8');
const FOILS = ['Discus 140k-v1', 'Discus 120 k-v1', 'Discus 75 k-v1', 'Discus 48k-v1'].map(n => ({
  name: n + '.dat', text: fs.readFileSync(path.join(AERO, 'Strak v1', n + '.dat'), 'utf-8')
}));

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
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 940, deviceScaleFactor: 2, mobile: false });

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
  // Select-Feld ueber einen Optionswert setzen (erstes Select, das diesen Wert kennt).
  const setSel = val => evalJs(`(function(){ const s=[...document.querySelectorAll('select')].find(se=>[...se.options].some(o=>o.value===${JSON.stringify(val)})); if(!s) return false; s.value=${JSON.stringify(val)}; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  const hideDev = () => evalJs(`(function(){ const el=[...document.querySelectorAll('body *')].find(e=>e.children.length===0 && /^Dev$/i.test((e.textContent||'').trim())); if(el) el.style.display='none'; })(); true`);

  // Kamera: Shift+Ziehen (Pan) um dx/dy CSS-px, dann n Rad-Schritte hinein (1.12^n).
  const camMove = (dx, dy, n) => evalJs(`(function(){
    const cv=document.getElementById('cForm'); const r=cv.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
    for(let i=0;i<${n};i++) cv.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:cx,clientY:cy}));
    cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,shiftKey:true,clientX:cx,clientY:cy}));
    window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,shiftKey:true,clientX:cx+${dx},clientY:cy+${dy}}));
    window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,shiftKey:true,clientX:cx+${dx},clientY:cy+${dy}}));
    return true; })()`);
  const resetCam = () => evalJs(`document.getElementById('formIso').click(); true`);

  console.log('Lade App ...');
  const loaded = c.once('Page.loadEventFired');
  await c.send('Page.navigate', { url: APP });
  await loaded;
  await sleep(1900);
  await evalJs(`window.alert=function(){}; window.confirm=function(){return true;}; true`);
  await hideDev();

  console.log('Lade Discus-Tragflaeche (XFLR5) ...');
  await evalJs(`window.App.addFoilDats(${JSON.stringify(FOILS)}); true`);
  await sleep(400);
  await evalJs(`window.App.processXflr(${JSON.stringify(WING_XML)}); true`);
  await sleep(1500);
  await hideDev();

  await evalJs(`window.App.switchView('form'); true`);
  await sleep(1500);

  // cfg direkt setzen und Reiter neu aufbauen (Selects per Optionswert sind mehrdeutig, z. B. 'neg').
  const setCfg = obj => evalJs(`Object.assign(window.App.state.cfg, ${JSON.stringify(obj)}); window.App.switchView('wing'); window.App.switchView('form'); true`);
  const clickBtn = id => evalJs(`document.getElementById(${JSON.stringify(id)}).click(); true`);

  // 1) Randbogen Sichel (Discus) am Urmodell, Draufsicht.
  console.log('Formenbau: Randbogen Sichel ...');
  await setCfg({ formTarget: 'ur', formTipMode: 'round', formTipPreset: 'sichel', formTipPLE: 2.2, formTipPTE: 1, formTipRef: 100, formTipThk: 100, formTipRise: 0, formTipLen: 48, formTipTwist: 0, formHalf: 'both' });
  await sleep(2500); await hideDev();
  await clickBtn('formTop'); await sleep(800);
  await camMove(-1000, 0, 12); await sleep(1500);
  await shot('randbogen');

  // 2) Winglet am Urmodell.
  console.log('Formenbau: Winglet ...');
  await setCfg({ formTipMode: 'winglet' }); await sleep(2500); await hideDev();
  await camMove(-900, -260, 11); await sleep(1500);
  await shot('winglet');

  // 3) Negativform, nur untere Formhaelfte (Winglet gibt es bei Formhaelften nicht -> Randbogen).
  console.log('Formenbau: Negativform unten ...');
  await setCfg({ formTipMode: 'round', formTarget: 'neg', formHalf: 'bot' }); await sleep(3500); await hideDev();
  await shot('negform');
  await camMove(-700, -200, 8); await sleep(1500);
  await shot('negform_zoom');

  console.log('Fertig.');
  process.exit(0);
}

main().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
