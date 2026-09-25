# Screenshots fuer BENUTZERHANDBUCH.md (Playwright, headless Chromium).
# Aufruf: python .claude/shots_handbuch.py <port> [nur_name ...]
import sys, base64, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'handbuch_bilder'
PORT = sys.argv[1]
ONLY = set(sys.argv[2:])
APP = f'http://127.0.0.1:{PORT}/AI%20Foam%20Cut.html'
DESK = pathlib.Path('C:/Users/manue/OneDrive/Desktop')
AERO = DESK / 'Aerodynamik/Projekte/Discus 3,3'
WING_XML = (AERO / 'Main_Wing.xml').read_text('utf-8')
FOILS = [{'name': n + '.dat', 'text': (AERO / 'Strak v1' / (n + '.dat')).read_text('utf-8')}
         for n in ['Discus 140k-v1', 'Discus 48k-v1', 'Discus 75 k-v1', 'Discus 120 k-v1']]
RUMPF_CNC = pathlib.Path('C:/Users/manue/Downloads/Rumpf V2.cnc')
STL = DESK / '3d Konstruktion/01_Flugzeuge/Hornet H-206/Hornet 1000 mm.stl'

def b64(p): return base64.b64encode(p.read_bytes()).decode()

with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    pg = br.new_page(viewport={'width': 1440, 'height': 880}, device_scale_factor=1)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(APP); pg.wait_for_timeout(2500)
    pg.evaluate("window.alert=()=>{}; window.confirm=()=>true;")
    pg.add_style_tag(content='#machName,[data-view=rumpf],[data-view=fraese]{display:none!important}')
    pg.evaluate("[...document.querySelectorAll('header *')].filter(e=>!e.children.length&&/^Dev$/.test(e.textContent.trim())).forEach(e=>e.style.display='none')")

    def shot(name, clip=None, el=None):
        if ONLY and name not in ONLY: return
        f = OUT / (name + '.png')
        if el: pg.locator(el).first.screenshot(path=str(f))
        else: pg.screenshot(path=str(f), clip=clip)
        print('  ->', f.name)
    def view(v, wait=1300):
        pg.evaluate(f"App.switchView('{v}')"); pg.wait_for_timeout(wait)
    def grpshot(title, name, prep=None, toggle=0):
        # Gruppe in der Seitenleiste aufklappen (andere zu), Hinweise ausblenden, Element fotografieren.
        if ONLY and name not in ONLY: return
        mark = lambda: (pg.evaluate('''t => { document.body.classList.add('hints-collapsed');
          document.querySelectorAll('.grp').forEach(g=>g.removeAttribute('data-shot')); document.querySelectorAll('.grp').forEach(g => { const h=g.querySelector(':scope>h3'), b=g.querySelector(':scope>.body');
            if(!h||!b) return; const hit=h.textContent.replace(/[▾▸]/g,'').trim().startsWith(t);
            const open=b.style.display!=='none'; if(hit!==open && g.offsetParent) h.click(); if(hit && g.offsetParent && !document.querySelector('.grp[data-shot]')) g.setAttribute('data-shot','1'); }); }''', title), pg.wait_for_timeout(500))
        mark()
        tog = lambda: [pg.evaluate("i => { const c=[...document.querySelectorAll('.grp[data-shot] input[type=checkbox]')][i]; if(c) c.click(); }", k) or pg.wait_for_timeout(700) or mark() for k in range(toggle)]
        tog()
        if prep: prep(); pg.wait_for_timeout(600); mark()
        pg.set_viewport_size({'width': 1440, 'height': 3200}); pg.wait_for_timeout(500)
        shot(name, el='.grp[data-shot]')
        pg.set_viewport_size({'width': 1440, 'height': 880}); pg.wait_for_timeout(300)
        tog()
        pg.evaluate("document.body.classList.remove('hints-collapsed')")
    def setsel(val):
        pg.evaluate('''v => { const s=[...document.querySelectorAll('select')].find(se=>se.offsetParent&&[...se.options].some(o=>o.value===v)); if(s){ s.value=v; s.dispatchEvent(new Event('change',{bubbles:true})); } }''', val)
        pg.wait_for_timeout(1500)
    def clickbtn(rx):
        pg.evaluate("r => { const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&new RegExp(r).test(x.textContent.trim())); if(b) b.click(); }", rx)
        pg.wait_for_timeout(800)
    def setrow(label, val):
        pg.evaluate('''([l, v]) => { const lab=[...document.querySelectorAll('label')].find(x=>x.offsetParent&&x.textContent.trim().startsWith(l)); if(!lab) return;
          let r=lab.parentElement, i=null; for(let k=0;k<3&&r&&!(i=r.querySelector('input'));k++) r=r.parentElement; if(!i) return;
          if(i.type==='checkbox'){ if(i.checked!==v) i.click(); } else { i.value=v; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); } }''', [label, val])
        pg.wait_for_timeout(1500)
    def zoom(x, y, n):
        pg.mouse.move(x, y)
        for _ in range(n): pg.mouse.wheel(0, -120); pg.wait_for_timeout(60)
        pg.wait_for_timeout(700)
    def esc():
        pg.mouse.click(1400, 870); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    pg.evaluate("document.getElementById('projName').value='Discus 3,3'; document.getElementById('projName').dispatchEvent(new Event('input'))")
    shot('hb_start')
    pg.evaluate(f"App.addFoilDats({FOILS!r})"); pg.wait_for_timeout(400)
    pg.evaluate("x => App.processXflr(x)", WING_XML); pg.wait_for_timeout(1800)

    pg.evaluate("App.addMaterial('XPS 30 blau'); App.addMaterial('EPS 20 weiß'); App.setFeed('fast',300); App.setFeed('slow',150); App.setKerf('fast',0.8); App.setKerf('slow',1.2); App.setHeat(45); App.setHeatSlow(35)")
    view('matdb', 500); view('material'); shot('hb_uebersicht')
    shot('hb_kopfzeile', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 80})
    pg.click('#btnLoad'); pg.wait_for_timeout(500); shot('hb_menue_laden'); esc()
    pg.click('#btnSave'); pg.wait_for_timeout(500); shot('hb_menue_speichern'); esc()
    pg.click('#btnSettings'); pg.wait_for_timeout(700); shot('hb_einstellungen'); pg.keyboard.press('Escape'); esc()
    view('material', 600)
    for grp in ['Tragflächen', 'Komplexe Formen', 'Spezial Module']:
        pg.locator('.tab-more-btn', has_text=grp).first.click(); pg.wait_for_timeout(400)
        shot('hb_reiter_' + grp.split()[0].lower().replace('ä', 'ae')); esc()
    view('matdb'); shot('hb_werkstoffdb')
    view('wing'); shot('hb_tragflaeche')
    grpshot('Segmente', 'hb_tf_segment')
    clickbtn('^Profil bearbeiten'); pg.wait_for_timeout(1200); shot('hb_tf_profileditor'); pg.keyboard.press('Escape'); view('wing', 800)
    grpshot('Beplankung', 'hb_tf_beplankung')
    grpshot('Profilhöhenausrichtung', 'hb_tf_hoehe')
    grpshot('Globale Pfeilung', 'hb_tf_pfeilung')
    grpshot('Holmausschnitte', 'hb_tf_holme', prep=lambda: clickbtn('Holm hinzufügen'))
    view('wing', 1000); shot('hb_tragflaeche_holm')
    grpshot('Anzeige', 'hb_tf_anzeige')
    view('core'); shot('hb_kern')
    for t, n in [('Blockgeometrie', 'blockgeometrie'), ('Abbrand', 'abbrand'), ('Schalenschnitte', 'schalen'), ('Kern zerteilen', 'stege'),
                 ('Spiegeln', 'spiegeln'), ('Punkte bearbeiten', 'punkte'), ('Holmausschnitte', 'holme'), ('Werkstück drehen', 'drehen')]:
        grpshot(t, 'hb_kern_' + n, toggle=1 if n in ('schalen', 'stege', 'drehen') else 0,
                prep=(lambda: (pg.wait_for_timeout(800), shot('hb_kern_stege_ansicht'))) if n == 'stege' else None)
    view('neg'); shot('hb_negativ')
    for t, n in [('Negativschale', 'parameter'), ('Abbrand', 'abbrand'), ('Kern & Stützstoff', 'kern'), ('Punkte bearbeiten', 'punkte')]:
        grpshot(t, 'hb_neg_' + n, toggle=1 if n == 'kern' else 0,
                prep=(lambda: (pg.wait_for_timeout(800), shot('hb_neg_mit_kern'))) if n == 'kern' else None)
    view('rib'); shot('hb_rippen')
    view('gcode', 1500)
    pg.evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^[\\s►▶]*Start$/i.test(x.textContent.trim())); if(b) b.click();})()")
    pg.wait_for_timeout(3000); shot('hb_gcode')
    view('cut'); shot('hb_schneiden')
    view('cut', 600); pg.mouse.click(170, 335); pg.wait_for_timeout(600)
    pg.evaluate("(()=>{const t=[...document.querySelectorAll('body *')].find(e=>!e.children.length&&/^Punkt 1: schnell/.test(e.textContent.trim())); if(t) t.scrollIntoView({block:'start'});})()")
    pg.wait_for_timeout(400); shot('hb_kalibrierung')
    view('machine'); shot('hb_maschine')
    view('form', 2500); setsel('ur'); setsel('all'); shot('hb_formenbau')
    setsel('tip'); setsel('round'); clickbtn('Draufsicht$')
    for p in ['ellipse', 'sichel', 'raked', 'hoch']:
        setsel(p); pg.wait_for_timeout(800); shot('hb_form_rb_' + p, clip={'x':340,'y':92,'width':1100,'height':718})
    grpshot('Randbogen', 'hb_form_rb_menue')
    view('form', 800); setsel('winglet'); pg.wait_for_timeout(1500); clickbtn('Iso$'); shot('hb_form_winglet', clip={'x':340,'y':92,'width':1100,'height':718})
    clickbtn('Vorderansicht$'); pg.wait_for_timeout(800); shot('hb_form_winglet_vorne', clip={'x':340,'y':92,'width':1100,'height':718})
    grpshot('Randbogen', 'hb_form_winglet_menue')
    view('form', 800); setsel('wldraw'); clickbtn('^Zeichnung öffnen'); pg.wait_for_timeout(1500); shot('hb_form_wldraw')
    clickbtn('^3D-Ansicht$'); setsel('all'); pg.wait_for_timeout(1500); shot('hb_form_wldraw_3d', clip={'x':340,'y':92,'width':1100,'height':718})
    # Negativform, untere Hälfte, Wurzelverlängerung, Steckung, Passbohrungen
    view('form', 800); setsel('neg'); setsel('wing')
    openall = lambda: (pg.evaluate("document.querySelectorAll('.grp').forEach(g=>{const h=g.querySelector(':scope>h3'),b=g.querySelector(':scope>.body'); if(g.offsetParent&&h&&b&&b.style.display==='none') h.click();})"), pg.wait_for_timeout(500))
    openall(); setrow('Überstand Wurzel', 60); openall(); setrow('Passbohrungen', True); openall(); setrow('Ausnehmungen für die Steckung', True); openall()
    clickbtn('Iso$'); pg.wait_for_timeout(2000); pg.mouse.click(1376, 264); pg.wait_for_timeout(1500)
    pg.mouse.move(890, 600); pg.mouse.down(); pg.mouse.move(890, 700, steps=10); pg.mouse.up(); pg.wait_for_timeout(800)
    shot('hb_form_neg_unten', clip={'x':340,'y':92,'width':1100,'height':718})
    pg.keyboard.down('Shift'); pg.mouse.move(620, 600); pg.mouse.down(); pg.mouse.move(890, 450, steps=12); pg.mouse.up(); pg.keyboard.up('Shift'); pg.wait_for_timeout(500)
    zoom(890, 450, 4)
    pg.keyboard.down('Shift'); pg.mouse.move(770, 525); pg.mouse.down(); pg.mouse.move(890, 450, steps=12); pg.mouse.up(); pg.keyboard.up('Shift'); pg.wait_for_timeout(400)
    zoom(890, 450, 6)
    pg.keyboard.down('Shift'); pg.mouse.move(480, 615); pg.mouse.down(); pg.mouse.move(820, 430, steps=12); pg.mouse.up(); pg.keyboard.up('Shift'); pg.wait_for_timeout(600)
    zoom(890, 450, 3); shot('hb_form_neg_wurzel', clip={'x':340,'y':92,'width':1100,'height':718})
    grpshot('Negativform', 'hb_form_neg_menue')
    view('form', 800); setsel('ur'); setsel('both')
    view('cad'); shot('hb_cad')
    view('schrift', 1800); shot('hb_schriften')
    # 3D-Modell
    pg.evaluate("""async (d) => { const bin=Uint8Array.from(atob(d),c=>c.charCodeAt(0));
        await Model3D.loadFile(new File([bin],'Hornet H-206.stl')); try{Model3D.equalSplit(3);}catch(e){} }""", b64(STL))
    view('model', 2000); shot('hb_modell')
    pg.evaluate("document.querySelectorAll('.grp').forEach(g=>{const h=g.querySelector(':scope>h3'),b=g.querySelector(':scope>.body'); if(g.offsetParent&&h&&b&&/Platte/.test(h.textContent)&&b.style.display==='none') h.click();})")
    pg.wait_for_timeout(800); pg.evaluate("Model3D.equalSplit(3); App.buildSidebar()"); pg.wait_for_timeout(1200); clickbtn('Alle gleich dicken wählen'); pg.wait_for_timeout(1500)
    clickbtn('^. Platte$'); pg.wait_for_timeout(2500); shot('hb_modell_platte')
    for b2, n in [('Schnittprofile', 'schnittprofile'), ('Segmentpaar', 'segmentpaar')]:
        clickbtn(b2 + '$'); pg.wait_for_timeout(2000); shot('hb_modell_' + n)
    grpshot('Heißdraht-G-Code', 'hb_modell_gcode_menue')
    grpshot('Platte / Stapeln', 'hb_modell_platte_menue')
    clickbtn('3D-Ansicht$')
    # GMFC-Rumpf in DXF-Formen (ersetzt Formen, deshalb zuletzt)
    view('dxf', 800)
    pg.evaluate("""(d) => { const bin=Uint8Array.from(atob(d),c=>c.charCodeAt(0));
        App.gmfcImportFromBuffer(bin.buffer,'Rumpf V2.cnc',{preview:false}); }""", b64(RUMPF_CNC))
    pg.wait_for_timeout(1500); pg.evaluate("App.dxfSetActive(2); App.buildSidebar(); App.render()"); view('dxf', 1500); shot('hb_dxf')
    br.close()
