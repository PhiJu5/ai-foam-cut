// Fingerprint je Reiter (per javascript_tool auf Original und neuem Stand ausführen, dann vergleichen).
// Reiter klicken -> resize -> (G-Code: „Neu erzeugen") -> Hash sichtbarer Canvas-Bilder + Text des Hauptbereichs + Sidebar.
const h=s=>{let x=5381;for(let i=0;i<s.length;i++)x=((x*33)^s.charCodeAt(i))>>>0;return x.toString(16)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const errs=[]; window.addEventListener('error', e=>errs.push('ERR '+e.message+' @'+(e.filename||'').split('/').pop()+':'+e.lineno));
const vis=e=>e.offsetParent!==null;
const out={};
for (const b of document.querySelectorAll('button[data-view]')){
  b.click(); window.dispatchEvent(new Event('resize')); await sleep(500);
  if (b.dataset.view==='gcode'){ const g=[...document.querySelectorAll('button')].find(x=>vis(x)&&/Neu erzeugen/.test(x.textContent)); if(g){g.click(); await sleep(800);} }
  const cv=[...document.querySelectorAll('canvas')].filter(c=>vis(c)&&c.width>1);
  const main=([...document.querySelectorAll('main, .main, #main, .content, #content')].filter(vis).map(e=>e.innerText).join('\n') || document.body.innerText).replace(/; erzeugt: [^\n]*/g, '');
  out[b.dataset.view]={canvas: cv.map(c=>{try{return c.id+':'+c.width+'x'+c.height+':'+h(c.toDataURL())}catch(e){return c.id+':x'}}),
    main: h(main), mainLen: main.length, sidebar: h((document.querySelector('#sidebar, .sidebar, aside')||{}).innerText||'')};
}
document.querySelector('button[data-view="wing"]').click();
// Original-Seite (Pfad enthält split_orig): Ergebnis merken. Neue Seite: mit Original vergleichen, nur Abweichungen melden.
if (location.pathname.includes('split_orig')) { sessionStorage.fpOrig = JSON.stringify(out); return JSON.stringify({stored:true, inner:[innerWidth,innerHeight], tabs:Object.keys(out), errs}); }
const ref = JSON.parse(sessionStorage.fpOrig||'{}'); const diff={};
for (const k of Object.keys(out)) { const a=JSON.stringify(ref[k]), b=JSON.stringify(out[k]); if (a!==b) diff[k]={orig:ref[k], neu:out[k]}; }
return JSON.stringify({inner:[innerWidth,innerHeight], same:Object.keys(diff).length===0, diff, errs});
// Aufruf per javascript_tool:
// const src=await (await fetch('/.claude/split_fingerprint.js?'+Date.now())).text(); await (new (Object.getPrototypeOf(async function(){}).constructor)(src))()
