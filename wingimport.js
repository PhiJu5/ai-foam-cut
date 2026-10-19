/* wingimport.js — Auswahlfenster für Tragflächen-Importe aus Fremdprogrammen.
 *
 * XFLR5- und FLZ_Vortex-Dateien enthalten in aller Regel MEHRERE Flügel
 * (Tragfläche, Höhen-, Seitenleitwerk), XFLR5-Projekte zusätzlich mehrere
 * Modelle in einer Datei. Der frühere Import hat stillschweigend „den
 * Hauptflügel" gewählt und alles andere verworfen.
 *
 * Dieses Modul zeigt stattdessen alles Gefundene an und lässt je Eintrag
 * entscheiden, OB er übernommen wird und WOHIN — in eine vorhandene
 * Tragfläche des Projekts (deren Geometrie dabei ersetzt wird) oder in eine
 * neu angelegte.
 *
 * Quellen liefern eine einheitliche Liste von Einträgen:
 *   { plane, name, kind, summary, missing:[Profilname], build() -> cfg }
 * cfg ist das Ergebnis von XFLR5.toWingConfig()/FLZ.toWingConfig(), also
 *   { root:{profile,chord}, segments:[…], meta:{…} }.
 */
(function () {
  'use strict';
  const App = window.App, state = App.state;
  const T = App.T;

  // ---------- Einträge aus den Parsern aufbauen ----------------------------

  // Halbspannweite (mm) einer XFLR5-Rippenkette.
  function xflSpan(wing, unit) {
    const s = wing.sections;
    if (!s || s.length < 2) return 0;
    let lo = Infinity, hi = -Infinity;
    s.forEach(p => { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; });
    return (hi - lo) * unit * 1000;
  }

  // Schwerpunkt + Masse eines XFLR5-Flugzeugs (Ergebnis in mm / kg).
  // 1. Aus den Massen des Flugzeugs (.xfl): Punktmassen (Flugzeug absolut,
  //    Flügel relativ zur Wurzel-Nase, Rumpf relativ zur Rumpflage) +
  //    Volumenmassen der Flügel (Schwerpunkt genähert: Gewicht c²·Δy,
  //    x = Nase + 0,42·c). Das ist, was XFLR5 bei „automatischer Trägheit" nimmt.
  // 2. Sind Volumenmassen im Spiel (Näherung) und gibt es gerechnete Polaren,
  //    kommt x aus den Polaren selbst: XFLR5 rechnet Cm um seinen Schwerpunkt,
  //    also x_cg = XCP + Cm·c/CL (Median über die Punkte).
  // 3. Sonst Masse/Schwerpunkt der Flugzeugpolare (WPolar, ohne Auto-Trägheit).
  function planeCg(parsed, pl) {
    const W = (parsed.wpolars || []).filter(x => x.plane === pl.name);
    const wp = W.find(x => x.type === 2 && x.mass > 0) || W.find(x => x.mass > 0) || null;
    let m = 0, mx = 0, mz = 0, approx = false;
    const add = (k, x, z) => { if (!(k > 0)) return; m += k; mx += k * x; mz += k * z; };
    (pl.pointMasses || []).forEach(q => add(q.m, q.x, q.z));
    const bp = pl.bodyPos || { x: 0, z: 0 };
    if (pl.body) {
      (pl.body.pointMasses || []).forEach(q => add(q.m, bp.x + q.x, bp.z + q.z));
      if (pl.body.volumeMass > 0) { add(pl.body.volumeMass, bp.x, bp.z); approx = true; }
    }
    (pl.wings || []).forEach(wg => {
      const le = wg.le || { x: 0, z: 0 }, fin = /FIN/i.test(wg.type || '');
      (wg.pointMasses || []).forEach(q => add(q.m, le.x + q.x, le.z + q.z));
      const sec = (wg.sections || []).slice().sort((a, b) => a.y - b.y);
      if (wg.volumeMass > 0 && sec.length > 1) {
        let g = 0, gx = 0, gz = 0;
        for (let i = 1; i < sec.length; i++) {
          const a = sec[i - 1], b = sec[i], dy = b.y - a.y;
          const c = (a.chord + b.chord) / 2, wt = c * c * Math.abs(dy);
          g += wt;
          gx += wt * ((a.xOffset + b.xOffset) / 2 + 0.42 * c);
          gz += wt * (fin ? (a.y + b.y) / 2 : 0);
        }
        if (g > 0) { add(wg.volumeMass, le.x + gx / g, le.z + gz / g); approx = true; }
      }
    });
    if (m > 0) {
      let x = mx / m;
      if (approx && wp && wp.pts && wp.pts.length && wp.c > 0) {
        const xs = wp.pts.filter(q => Math.abs(q.CL) > 0.1 && isFinite(q.XCP) && isFinite(q.Cm))
          .map(q => q.XCP + q.Cm * wp.c / q.CL).sort((a, b) => a - b);
        if (xs.length >= 3) x = xs[xs.length >> 1];
      }
      return { cgX: x * 1000, cgZ: mz / m * 1000, mass: m };
    }
    return wp && wp.cg ? { cgX: wp.cg.x * 1000, cgZ: wp.cg.z * 1000, mass: wp.mass } : { cgX: 0, cgZ: 0, mass: 0 };
  }

  // XFLR5 (.xfl-Projekt ODER plane-XML) -> Einträge.
  // `foils` ist die Namensbibliothek: aus der Datei selbst (.xfl) und aus
  // bereits geladenen .dat (state.xflrFoils).
  function itemsFromXflr(parsed, foils) {
    const unit = parsed.unit || 1;
    const out = [];
    const planes = parsed.planes || [{ name: '', wings: parsed.wings || [] }];
    planes.forEach(pl => {
      (pl.wings || []).forEach(wg => {
        const names = [];
        (wg.sections || []).forEach(s => {
          if (s.foil && names.indexOf(s.foil) < 0) names.push(s.foil);
        });
        const missing = names.filter(n => !foils[XFLR5.normName(n)]);
        out.push({
          plane: pl.name || '',
          name: wg.name || T('Flügel'),
          kind: wg.type || '',
          nSeg: Math.max(0, (wg.sections || []).length - 1),
          span: xflSpan(wg, unit),
          chord: ((wg.sections && wg.sections.length) ? wg.sections[0].chord : 0) * unit * 1000,
          nProf: names.length,
          missing: missing,
          incidence: wg.tilt || 0,
          // für „Flugzeug im Aerodynamik-Reiter anlegen": Lage (Dateieinheit
          // -> mm), Seitenleitwerk 90° um die Längsachse wie im XFLR5-Vergleich
          // (aero.js xflMakePlane), Doppel-SLW an ±y.
          planeInfo: Object.assign({ name: pl.name || '', tag: 'XFLR5' }, planeCg(parsed, pl)),
          aeroParts: () => {
            const le = wg.le || { x: 0, y: 0, z: 0, tilt: 0 }, k = unit * 1000;
            const b = { x: le.x * k, y: le.y * k, z: le.z * k, rot: 0, inc: +(le.tilt || wg.tilt || 0),
              mirror: wg.symmetric !== false };
            if (/FIN/i.test(wg.type || '') || wg.isFin) {
              b.rot = 90; b.mirror = !!(pl.symFin || wg.isSymFin);
              if ((pl.doubleFin || wg.isDoubleFin) && Math.abs(b.y) > 0.5)
                return [Object.assign({}, b, { y: Math.abs(b.y) }), Object.assign({}, b, { y: -Math.abs(b.y) })];
            }
            return [b];
          },
          build: () => XFLR5.toWingConfig(wg, { unit: unit, foils: foils, mkSeg: App.mkSeg })
        });
      });
    });
    return out;
  }

  // FLZ_Vortex (natives .flz ODER CSV-Export) -> Einträge.
  // FLZ bringt die Profilkoordinaten immer mit; „fehlend" gibt es hier nur,
  // wenn ein Profilblock leer war.
  function itemsFromFlz(parsed) {
    const out = [];
    (parsed.planes || []).forEach(pl => {
      (pl.wings || []).forEach(wg => {
        const half = wg.segments.reduce((a, s) => a + Math.abs(s.width), 0) / 2;
        const missing = [];
        if (!wg.rootProfile) missing.push(wg.rootProfileName || T('Wurzelprofil'));
        wg.segments.forEach(s => {
          if (!s.profile && missing.indexOf(s.profileName) < 0) missing.push(s.profileName || T('Profil'));
        });
        const names = [];
        [wg.rootProfileName].concat(wg.segments.map(s => s.profileName)).forEach(n => {
          if (n && names.indexOf(n) < 0) names.push(n);
        });
        // FLZ beschreibt Spitze zu Spitze; der Designer bekommt eine Hälfte.
        const nHalf = wg.segments.filter(s => s.width > 0).length
          || wg.segments.filter(s => s.width < 0).length
          || wg.segments.length;
        out.push({
          plane: pl.name || '',
          name: wg.name || T('Flügel'),
          kind: '',
          nSeg: nHalf,
          span: half * 1000,
          chord: wg.rootChord * 1000,
          nProf: names.length,
          missing: missing,
          incidence: wg.incidence || 0,
          // für „Flugzeug im Aerodynamik-Reiter anlegen"
          planeInfo: { name: pl.name || '', tag: 'FLZ', cgX: (pl.cgX || 0) * 1000, cgZ: 0, mass: pl.extraMass || 0 },
          aeroParts: cfg => {
            const m = cfg.meta || {}, pos = m.pos || { x: 0, y: 0, z: 0 };
            return [{ x: pos.x, y: pos.y, z: pos.z, rot: m.rot || 0, inc: m.incidence || 0, mirror: m.mirror }];
          },
          aeroMass: cfg => (cfg.meta && cfg.meta.mass) || 0,
          build: () => FLZ.toWingConfig(wg, { side: 'auto', mkSeg: App.mkSeg })
        });
      });
    });
    return out;
  }

  // ---------- Übernahme in die Tragflächen des Projekts --------------------

  // Geometrie in den Datensatz einer Tragfläche schreiben. Arbeitet auf dem
  // DATENSATZ, nicht auf dem Live-Zustand — der Aufrufer sammelt vorher die
  // aktive Tragfläche ein (captureWing) und setzt sie danach wieder (applyWing).
  function writeWing(rec, cfg, name) {
    rec.root = cfg.root;
    rec.segments = cfg.segments;
    rec.spars = [];                   // Holme passen nicht mehr -> leeren
    rec.pathEdit = {};                // manuell bearbeitete Pfade verwerfen
    rec.negEdit = {};
    rec.negBurnEdit = {};
    rec.profBase = {};
    rec.activeSeg = cfg.segments.length ? 0 : 'all';
    rec.activeSpar = null;
    rec.dxfExportSegs = null;
    if (name) rec.name = name;
    rec.cfg = rec.cfg || {};
    // V-Form steckt segmentweise in den mm-Werten -> globale Ausrichtung aus.
    if (rec.cfg.align) rec.cfg.align.enable = false;
    // Glatter Grundriss für den Formenbau (nur .pc2-Import); jeder andere Import verwirft ihn.
    rec.cfg.formPlanSrc = cfg.planSrc || null;
  }

  // Eindeutigen Namen finden (importierte Flügel heißen oft gleich).
  function uniqueName(base, taken) {
    let nm = String(base || T('Tragfläche')).trim() || T('Tragfläche');
    if (!taken.has(nm.toLowerCase())) { taken.add(nm.toLowerCase()); return nm; }
    for (let k = 2; ; k++) {
      const c = nm + ' (' + k + ')';
      if (!taken.has(c.toLowerCase())) { taken.add(c.toLowerCase()); return c; }
    }
  }

  // jobs = [ { item, target } ] mit target = Index einer Tragfläche oder 'new'.
  // Rückgabe { done:[Name], missing:[Profilname], errors:[Text] }.
  function applyJobs(jobs) {
    const L = App.wingList();
    App.captureWing(L[state.activeWing]);           // Live-Zustand sichern
    const taken = new Set(L.map(w => String(w.name || '').trim().toLowerCase()));
    const done = [], errors = [], missing = [], placed = [];
    let focus = null;

    jobs.forEach(j => {
      let cfg;
      try { cfg = j.item.build(); }
      catch (e) { errors.push(j.item.name + ': ' + T(e.message)); return; }
      if (!cfg.segments || !cfg.segments.length) {
        errors.push(j.item.name + ': ' + T('Flügel enthält keine Segmente.'));
        return;
      }
      let rec;
      if (j.target === 'new') {
        rec = { name: uniqueName(j.item.name, taken), cfg: {} };
        L.push(rec);
      } else {
        rec = L[j.target];
        taken.delete(String(rec.name || '').trim().toLowerCase());
        rec.name = uniqueName(j.item.name, taken);
      }
      writeWing(rec, cfg, rec.name);
      if (focus == null) focus = L.indexOf(rec);
      done.push(rec.name);
      placed.push({ item: j.item, cfg: cfg, rec: rec });
      (cfg.missingFoils || j.item.missing || []).forEach(n => {
        if (missing.indexOf(n) < 0) missing.push(n);
      });
    });

    if (focus != null) state.activeWing = focus;
    state.activeWing = Math.max(0, Math.min(L.length - 1, state.activeWing));
    App.applyWing(L[state.activeWing]);
    if (state.cfg.align) state.cfg.align.enable = false;
    App.buildSidebar();
    App.render();
    if (App.switchView) { try { App.switchView(state.activeTab || 'wing'); } catch (e) {} }
    App.wingList();                                 // Kennungen der neuen Tragflächen vergeben
    return { done: done, missing: missing, errors: errors, placed: placed };
  }

  // Übernommene Flächen als Flugzeug in den Aerodynamik-Reiter (FLZ_Vortex
  // und XFLR5): Lage, Drehung um die Längsachse (Seitenleitwerk 90°),
  // Einstellwinkel, Spiegelung, Schwerpunkt und Masse aus der Datei.
  // Je Modell der Datei ein Flugzeug.
  function importAeroPlanes(placed, isMain) {
    if (typeof App.aeroMakePlane !== 'function') return 0;
    const groups = new Map();
    placed.forEach(p => {
      if (!p.item.planeInfo || !p.item.aeroParts) return;
      const k = p.item.plane || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    });
    let n = 0;
    groups.forEach(list => {
      const info = list[0].item.planeInfo;
      let mass = info.mass || 0, main = -1;
      const parts = [];
      list.forEach(p => {
        mass += p.item.aeroMass ? p.item.aeroMass(p.cfg) : 0;
        p.item.aeroParts(p.cfg).forEach(a => {
          if (main < 0 && isMain(p.item) && !a.rot) main = parts.length;
          parts.push(Object.assign({ wing: p.rec.id }, a));
        });
      });
      if (App.aeroMakePlane({ name: (info.name || list[0].item.name) + ' (' + info.tag + ')', parts: parts,
        main: Math.max(0, main), cgX: info.cgX, cgZ: info.cgZ, mass: mass * 1000 })) n++;
    });
    return n;
  }

  // ---------- Fenster ------------------------------------------------------

  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'wimpModal';
    modal.innerHTML =
      '<div class="modal" style="width:min(1150px,96vw);max-width:96vw;max-height:94vh;display:flex;flex-direction:column">' +
      '<div class="head"><h2 id="wimpTitle"></h2><button class="close-x" id="wimpClose" title="' + T('Schließen') + '">×</button></div>' +
      '<div class="body" id="wimpBody" style="flex:1 1 auto;min-height:0;overflow:auto"></div>' +
      '<div class="foot"><div class="mrow"><span class="hint" id="wimpErr" style="color:var(--warn,#e6b450)"></span>' +
      '<div class="sp"></div><button id="wimpCancel"></button>' +
      '<button class="primary" id="wimpOk"></button></div></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('#wimpClose').onclick = close;
    modal.querySelector('#wimpCancel').onclick = close;
    modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
    return modal;
  }
  function close() { if (modal) modal.classList.remove('open'); }

  // Ein Ziel-Auswahlfeld: vorhandene Tragflächen + „neu anlegen".
  function targetSelect(defVal) {
    const sel = document.createElement('select');
    App.wingList().forEach((w, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = T('ersetzen: ') + (w.name || (T('Tragfläche') + ' ' + (i + 1)));
      sel.appendChild(o);
    });
    const o = document.createElement('option');
    o.value = 'new'; o.textContent = T('neue Tragfläche anlegen');
    sel.appendChild(o);
    sel.value = defVal;
    sel.style.minWidth = '190px';
    return sel;
  }

  // items: Liste aus itemsFromXflr()/itemsFromFlz(); title/note für die Kopfzeile.
  function open(items, opts) {
    opts = opts || {};
    if (!items.length) { alert(T('In der Datei wurde keine Tragfläche gefunden.')); return; }
    const m = ensureModal();
    m.querySelector('#wimpTitle').textContent = opts.title || T('Importieren');
    m.querySelector('#wimpCancel').textContent = T('Abbrechen');
    m.querySelector('#wimpOk').textContent = T('Übernehmen');
    const err = m.querySelector('#wimpErr'); err.textContent = '';
    const body = m.querySelector('#wimpBody'); body.textContent = '';

    if (opts.note) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = opts.note;
      body.appendChild(h);
    }

    const tip = document.createElement('div');
    tip.className = 'hint';
    tip.style.margin = '6px 0 10px';
    tip.textContent = T('Angehakte Flügel werden übernommen. „Ersetzen" überschreibt die Geometrie der gewählten Tragfläche vollständig (Segmente, Profile und Holme); „neue Tragfläche anlegen" hängt sie hinten an. Alles andere in der Datei bleibt unberührt.');
    body.appendChild(tip);

    const wrap = document.createElement('div');
    wrap.style.overflowX = 'auto';
    const tbl = document.createElement('table');
    tbl.className = 'set-table';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    [T('Übernehmen'), T('Modell'), T('Flügel'), T('Segmente'), T('Halbspannw.'),
      T('Wurzelsehne'), T('Profile'), T('Ziel im Projekt')].forEach(t => {
      const th = document.createElement('th');
      th.textContent = t;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tbl.appendChild(thead);

    const tb = document.createElement('tbody');
    const rows = [];
    // Vorauswahl: nur der erste Hauptflügel, und der ersetzt die aktive
    // Tragfläche. XFLR5-Projekte enthalten oft ein Dutzend Varianten desselben
    // Modells — die alle anzuhaken würde das Projekt zumüllen. Alles Weitere
    // hakt man selbst an; Vorgabe ist dann „neue Tragfläche", damit nie etwas
    // ungefragt überschrieben wird.
    const isMain = it => /MAINWING/i.test(it.kind) ||
      (!it.kind && !/HLW|SLW|leitwerk|elevator|fin|stab|rudder/i.test(it.name));
    let firstMain = -1;
    items.forEach((it, i) => { if (firstMain < 0 && isMain(it)) firstMain = i; });
    if (firstMain < 0) firstMain = 0;
    // Mit „Flugzeug anlegen": alle Flächen DESSELBEN Modells wie der erste
    // Hauptflügel vorwählen (neu anlegen), damit es im Aerodynamik-Reiter
    // vollständig ankommt. Andere Modelle/Varianten der Datei bleiben aus.
    const allFlz = opts.aeroPlane && typeof App.aeroMakePlane === 'function';
    const mainPlane = items[firstMain] ? items[firstMain].plane : null;

    items.forEach((it, i) => {
      const tr = document.createElement('tr');
      const mk = (txt) => {
        const td = document.createElement('td');
        td.textContent = txt;
        tr.appendChild(td);
        return td;
      };
      const tdC = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = (i === firstMain) || (allFlz && !!it.planeInfo && it.plane === mainPlane);
      tdC.appendChild(cb);
      tr.appendChild(tdC);

      mk(it.plane || '—').style.color = 'var(--muted)';
      const tdN = mk(it.name + (it.kind ? '  [' + it.kind + ']' : ''));
      if (it.incidence) tdN.title = T('Einstellwinkel ') + it.incidence.toFixed(2) + '°';
      mk(String(it.nSeg));
      mk(it.span.toFixed(0) + ' mm');
      mk(it.chord.toFixed(0) + ' mm');
      const tdP = mk(it.missing.length
        ? (it.nProf - it.missing.length) + '/' + it.nProf + ' ' + T('(Rest fehlt)')
        : it.nProf + ' ' + T('vollständig'));
      if (it.missing.length) {
        tdP.style.color = 'var(--warn,#e6b450)';
        tdP.title = T('Ohne Koordinaten: ') + it.missing.join(', ');
      }

      const tdT = document.createElement('td');
      const sel = targetSelect(i === firstMain ? String(state.activeWing) : 'new');
      tdT.appendChild(sel);
      tr.appendChild(tdT);

      tb.appendChild(tr);
      rows.push({ item: it, cb: cb, sel: sel });
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    body.appendChild(wrap);

    let aeroCb = null;
    if (allFlz) {
      const lb = document.createElement('label');
      lb.style.cssText = 'display:flex;gap:6px;align-items:flex-start;margin:10px 0 2px';
      aeroCb = document.createElement('input'); aeroCb.type = 'checkbox'; aeroCb.checked = true;
      const sp = document.createElement('span');
      sp.innerHTML = '<b></b><br><span class="hint"></span>';
      sp.querySelector('b').textContent = T('Flugzeug im Aerodynamik-Reiter anlegen');
      sp.querySelector('.hint').textContent = T('Lage und Abstände der Flächen, Einstellwinkel, Seitenleitwerk senkrecht, Schwerpunkt und Masse werden aus der Datei übernommen (je Modell ein Flugzeug).');
      lb.appendChild(aeroCb); lb.appendChild(sp); body.appendChild(lb);
    }

    m.querySelector('#wimpOk').onclick = () => {
      err.textContent = '';
      const jobs = rows.filter(r => r.cb.checked)
        .map(r => ({ item: r.item, target: r.sel.value === 'new' ? 'new' : +r.sel.value }));
      if (!jobs.length) { err.textContent = T('Nichts ausgewählt.'); return; }
      // Ein Ziel darf nur einmal beschrieben werden, sonst überschreiben sich
      // zwei Flügel gegenseitig und einer geht kommentarlos verloren.
      const used = new Set();
      for (const j of jobs) {
        if (j.target === 'new') continue;
        if (used.has(j.target)) {
          err.textContent = T('Dieselbe Tragfläche ist mehrfach als Ziel gewählt.');
          return;
        }
        used.add(j.target);
      }
      const replaced = jobs.filter(j => j.target !== 'new');
      if (replaced.length && !confirm(
        T('Die Geometrie folgender Tragflächen wird ersetzt (Segmente, Profile und Holme gehen verloren): ')
        + replaced.map(j => App.wingList()[j.target].name).join(', ') + '\n\n' + T('Fortfahren?'))) return;

      let res;
      try { res = applyJobs(jobs); }
      catch (e) { err.textContent = T('Fehler: ') + T(e.message); return; }
      close();

      let nPl = 0;
      if (aeroCb && aeroCb.checked) {
        try { nPl = importAeroPlanes(res.placed, isMain); }
        catch (e) { res.errors.push(T('Aerodynamik-Flugzeug: ') + T(e.message)); }
      }
      const parts = [(opts.title || T('Import')) + ':'];
      parts.push(res.done.length + ' ' + T('Tragfläche(n) übernommen: ') + res.done.join(', '));
      if (nPl) parts.push(T('Flugzeug im Aerodynamik-Reiter angelegt (Lage aus der Datei).'));
      if (res.errors.length) parts.push('\n' + T('Übersprungen: ') + '\n• ' + res.errors.join('\n• '));
      if (res.missing.length)
        parts.push('\n' + T('Ohne Profilkoordinaten (Platzhalter gesetzt — bitte als .dat zuordnen): ')
          + '\n• ' + res.missing.join('\n• '));
      alert(parts.join('\n'));
    };

    m.classList.add('open');
  }

  Object.assign(App, { wingImportOpen: open, wingImportItemsXflr: itemsFromXflr,
    wingImportItemsFlz: itemsFromFlz, wingImportApply: applyJobs, xflPlaneCg: planeCg });
})();
