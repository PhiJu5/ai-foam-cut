// Browser-Smoke-Test nach jedem Auszug (per javascript_tool ausführen):
// klickt alle Reiter durch, sammelt Fehler, prüft Syntax aller Skripte per new Function.
const errs=[]; const oe=console.error; console.error=(...a)=>{errs.push(a.map(String).join(' ').slice(0,200)); oe(...a)};
window.addEventListener('error', e=>errs.push('ERR '+e.message+' @'+(e.filename||'').split('/').pop()+':'+e.lineno));
window.addEventListener('unhandledrejection', e=>errs.push('REJ '+String(e.reason).slice(0,200)));
const tabs=[...document.querySelectorAll('button[data-view]')];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clicked=[];
for (const b of tabs){ try{ b.click(); clicked.push(b.dataset.view); await sleep(300);}catch(e){errs.push('CLICK '+b.dataset.view+' '+e.message)} }
document.querySelector('button[data-view="wing"]').click(); await sleep(200);
const scripts=[...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src'));
const syn=[]; for(const s of scripts){ const t=await (await fetch(s)).text(); try{ new Function(t);}catch(e){syn.push(s+': '+e.message)} }
({errs, syn, clicked, appKeys:Object.keys(window.App||{}).length})
