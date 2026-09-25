/* overview.js — Reiter „Projektübersicht" (Reiter-Kennung 'material'), seit 2026-09-14.
 *
 * Keine Seitenleiste mehr: alles steht mittig als Akkordeon. Jeder Abschnitt zeigt
 * zugeklappt nur eine Kopfzeile mit Kurzinfo; erst ein Klick öffnet ihn (immer nur
 * einer offen, Zustand in state._ovSel). Abschnitte:
 *   proj      Projekt (nur Projektname)
 *   wing:<id> je Tragfläche: links Einstellungen (App.wingSettingsCard aus wings.js:
 *             Design, Werkstoff, Blockdicke, Gewicht, Aktionen), rechts Segmenttabelle
 *             und Gewichtsschätzung (App.wingWeight)
 *   matx      Werkstoff für DXF-Formen / 3D-Modell
 *   cut       projektweite Schneideinstellungen (Sicherheitshöhe, Vorschub automatisch)
 * Aufbau über renderOverview() (aus render.js renderMaterial → renderProjectOverview).
 * Beim Neuaufbau bleibt das gerade fokussierte Feld fokussiert (data-fid). */
(function () {
  'use strict';
  const { T, state } = App;

  const esc = v => String(v == null ? '' : v).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const mm = v => (v == null || !isFinite(v)) ? '—' : Math.round(v) + ' mm';
  const g = v => (v == null || !isFinite(v)) ? '—' : (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' g';
  const cm3 = v => (v == null || !isFinite(v)) ? '—' : (v / 1000).toFixed(v >= 1e5 ? 0 : 1) + ' cm³';
  const dm2 = v => (v == null || !isFinite(v)) ? '—' : (v / 1e4).toFixed(1) + ' dm²';
  const muted = s => '<span style="color:var(--muted)">' + s + '</span>';
  const cell = (k, v) => '<tr><td style="color:var(--muted)">' + k + '</td><td class="num">' + v + '</td></tr>';
  const matName = id => id ? esc(T(App.matField(id, 'name', id))) : muted(T('kein Werkstoff gewählt'));

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // Übersicht (und bei rebuild auch die Seitenleiste der anderen Reiter) neu aufbauen.
  function refresh(rebuild) {
    if (App.syncAutoFeed) App.syncAutoFeed();
    if (rebuild && App.buildSidebar) App.buildSidebar();
    renderOverview();
    App.render();
  }

  /* Ein Akkordeon-Abschnitt. key = Kennung (state._ovSel), title = Kopf (HTML),
   * info = Kurzinfo rechts vom Titel (HTML), build(body) füllt den Inhalt nur, wenn
   * der Abschnitt offen ist. Optionen: accent (Rahmenfarbe), badge (HTML hinter Titel). */
  function section(host, key, title, info, build, opt) {
    opt = opt || {};
    // opt.fixed = dauerhaft offen, nicht klappbar (kein Pfeil, kein Klick).
    const open = opt.fixed || state._ovSel === key;
    const sec = el('div', 'ov-sec' + (open ? ' open' : '') + (opt.fixed ? ' ov-fixed' : ''));
    if (opt.accent) sec.style.borderColor = opt.accent;
    const head = el('div', 'ov-head');
    head.innerHTML = (opt.fixed ? '' : '<span class="ov-caret">' + (open ? '▾' : '▸') + '</span>')
      + '<span class="ov-title">' + title + '</span>'
      + (opt.badge || '') + '<span class="ov-info">' + info + '</span>';
    if (!opt.fixed)
      head.onclick = ev => {
        if (ev.target.closest('input,select,button,textarea,a')) return;   // Bedienelemente im Kopf durchlassen
        state._ovSel = open ? null : key;
        renderOverview();
      };
    sec.appendChild(head);
    if (open) { const body = el('div', 'ov-body'); build(body); sec.appendChild(body); }
    host.appendChild(sec);
    return sec;
  }

  // ---------- Abschnitt „Projekt" ----------
  function secProject(host) {
    // Dauerhaft offen, nicht klappbar; der Kopf trägt den Namen „Projektname",
    // darum im Körper KEIN zweites Label — nur das Eingabefeld.
    section(host, 'proj', T('Projektname'), '', body => {
      const set = el('div', 'ov-set');
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = state.projectName || '';
      inp.placeholder = T('Projektname'); inp.style.width = '100%'; inp.style.boxSizing = 'border-box';
      inp.oninput = () => { if (App.setProjectName) App.setProjectName(inp.value); else state.projectName = inp.value; };
      set.appendChild(inp);
      App.hint(set, 'Name des Projekts — wird oben in der Kopfzeile angezeigt und beim Speichern als Dateiname vorgeschlagen.');
      body.appendChild(set);
    }, { fixed: true });
  }

  // ---------- Abschnitte je Tragfläche ----------
  function secWing(host, w, i, sums) {
    const act = i === state.activeWing;
    const segs = (act ? state.segments : w.segments) || [], root = act ? state.root : w.root, spars = act ? state.spars : w.spars;
    const c = act ? state.cfg : (w.cfg || {}), neg = c.design === 'neg';
    const idKey = neg ? 'negMatId' : 'matId', hKey = neg ? 'negMatHeight' : 'matHeight';
    const matId = c[idKey] != null ? c[idKey] : (state.material.id || '');
    const h = (c[hKey] != null && isFinite(c[hKey])) ? +c[hKey] : +state.material.height;
    const dens = matId ? +App.matField(matId, 'density', 0) || 0 : 0;
    const name = esc(App.wingName ? App.wingName(i) : (w.name || ''));
    const n = segs.length, span = segs.reduce((a, sg) => a + (+sg.span || 0), 0);
    const wt = App.wingWeight ? App.wingWeight(i) : null;
    const wid = App.wingId ? App.wingId(i) : String(i);
    const count = wt ? wt.count : 1;
    if (wt) { sums.total += wt.total; if (wt.foam == null) sums.known = false; }
    const info = T(neg ? 'Negativschalen' : 'Kern') + ' · ' + matName(matId) + ' · ' + mm(h)
      + ' · ' + n + ' ' + T(n === 1 ? 'Segment' : 'Segmente') + ' · ' + mm(span)
      + (wt ? ' · ' + g(wt.total) + (wt.foam == null ? ' ' + muted(T('ohne Kern')) : '') : '');
    const badge = act ? '<span class="ov-badge">' + T('aktiv') + '</span>' : '';
    section(host, 'wing:' + wid, (i + 1) + '. ' + name, info, body => {
      body.classList.add('ov-two');
      // --- links: Name, Einstellungen (wings.js), Aktivieren
      const set = el('div', 'ov-set');
      {
        const row = el('div', 'row full');
        row.appendChild(el('label', null, T('Name der Tragfläche')));
        const inp = document.createElement('input'); inp.type = 'text'; inp.value = App.wingName ? App.wingName(i) : (w.name || '');
        inp.style.width = '100%'; inp.style.boxSizing = 'border-box';
        inp.onchange = () => { App.renameWing(i, inp.value); renderOverview(); };
        inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } };
        row.appendChild(inp); set.appendChild(row);
      }
      if (!act) {
        const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('Diese Tragfläche aktivieren');
        b.title = T('Diese Tragfläche in allen Reitern bearbeiten.');
        b.onclick = () => App.selectWing(i);
        set.appendChild(b);
      }
      if (App.wingSettingsCard) App.wingSettingsCard(i, set, refresh);
      body.appendChild(set);
      // --- rechts: Segmente + Gewicht
      const inf = el('div', 'ov-inf');
      const th = s => '<th>' + T(s) + '</th>';
      const profName = p => esc((p && p.name) || T('Profil'));
      const kerfTxt = v => (v == null || !isFinite(v)) ? muted('—') : v.toFixed(2) + ' mm';
      const sides = count > 1 ? ' (' + count + ' ' + T('Seiten') + ')' : ' (' + T('eine Seite') + ')';
      let html = muted(n + ' ' + T(n === 1 ? 'Segment' : 'Segmente') + ' · ' + mm(span) + ' · ' + (Array.isArray(spars) ? spars.length : 0) + ' ' + T('Holme'));
      if (!n) html += '<div class="hint">' + T('Keine Segmente.') + '</div>';
      else {
        html += '<div style="overflow-x:auto"><table class="set-table"><thead><tr>' + th('Segment') + th('Spannweite') + th('Sehne innen → außen')
          + th('Profil innen → außen') + th('Abbrand innen → außen') + th('Fläche') + th('Volumen') + th('Oberfläche') + '</tr></thead><tbody>';
        let prev = root ? { prof: root.profile, chord: root.chord } : null;
        segs.forEach((sg, k) => {
          const m = wt && wt.segs[k] ? wt.segs[k] : {};
          html += '<tr><td>' + (k + 1) + '</td><td class="num">' + mm(sg.span) + '</td>'
            + '<td class="num">' + (prev ? mm(prev.chord) : '—') + ' → ' + mm(sg.chord) + '</td>'
            + '<td>' + (prev ? profName(prev.prof) : '—') + ' → ' + profName(sg.profile) + '</td>'
            + '<td class="num">' + kerfTxt(m.kerfRoot) + ' → ' + kerfTxt(m.kerfTip) + '</td>'
            + '<td class="num">' + dm2(m.area) + '</td><td class="num">' + cm3(m.vol) + '</td><td class="num">' + dm2(m.surf) + '</td></tr>';
          prev = { prof: sg.profile, chord: sg.chord };
        });
        html += '<tr><td><b>' + T('Summe') + ' ' + T('eine Seite') + '</b></td><td class="num">' + mm(span) + '</td><td></td><td></td><td></td>'
          + '<td class="num">' + dm2(wt && wt.area) + '</td><td class="num">' + cm3(wt && wt.vol) + '</td><td class="num">' + dm2(wt && wt.surf) + '</td></tr>';
        if (count > 1)
          html += '<tr><td><b>' + T('Gesamt') + sides + '</b></td><td class="num">' + mm(span * count) + '</td><td></td><td></td><td></td>'
            + '<td class="num">' + dm2(wt && wt.area * count) + '</td><td class="num">' + cm3(wt && wt.vol * count) + '</td><td class="num">' + dm2(wt && wt.surf * count) + '</td></tr>';
        html += '</tbody></table></div>'
          + '<div class="hint">' + T('Abbrand je Rippe aus Werkstoff und Vorschub wie beim Kernschnitt: die längere Sehne läuft mit dem Vorschub, die kürzere langsamer (breiterer Spalt).')
          + (wt && wt.feed ? ' ' + T('Vorschub') + ' ' + wt.feed + ' mm/min' + (App.autoFeedOn() ? ' (' + T('automatisch') + ')' : '') + '.' : '')
          + ' ' + T('Fläche = Grundriss (Spannweite × mittlere Sehne), Oberfläche = abgewickelte Profilfläche oben+unten.') + '</div>';
      }
      const htmlSeg = html; html = '';
      if (wt) {
        const rows = [];
        rows.push([T('Schaumkern') + ' (' + cm3(wt.foamVol) + (dens > 0 ? ' × ' + dens + ' kg/m³' : '') + ')',
          wt.foam == null ? muted(T('keine Rohdichte im Werkstoff')) : g(wt.foam)]);
        if (wt.mode !== 'none') rows.push([T('Beplankung') + ' (' + (wt.mode === 'density' ? cm3(wt.sheetVol) : dm2(wt.surf)) + ')', g(wt.sheet)]);
        if (wt.fab > 0) {
          rows.push([T('Gewebe') + ' (' + dm2(wt.surf) + ')', g(wt.fab)]);
          rows.push([T('Harz') + ' (' + T('Faseranteil') + ' ' + wt.fiber + ' %)', g(wt.resin)]);
        }
        if (wt.extra > 0) rows.push([T('Zuschlag'), g(wt.extra)]);
        rows.push(['<b>' + T('Gewicht eine Seite') + '</b>', '<b>' + g(wt.piece) + '</b>' + (wt.foam == null ? ' ' + muted(T('ohne Kern')) : '')]);
        rows.push(['<b>' + T('Gesamtgewicht Tragfläche') + sides + '</b>', '<b>' + g(wt.total) + '</b>']);
        html += '<table class="set-table" style="max-width:560px"><tbody>' + rows.map(r => cell(r[0], r[1])).join('') + '</tbody></table>'
          + '<div class="hint">' + T('Gewichte sind Schätzwerte: Profilvolumen als Kegelstumpf je Segment, Oberfläche aus dem Profilumfang; '
            + 'Randbögen, Holmaussparungen, Ruderausschnitte und Klebstoff sind nicht enthalten. Einstellungen links unter „Gewicht".') + '</div>';
      }
      const htmlWt = html;
      // Kategorie-Schalter: Zusatzinfos sind eingeklappt, je Kategorie per Klick einblendbar
      // (Zustand je Tragfläche in state._ovCat, nochmaliger Klick klappt wieder zu).
      const cat = (state._ovCat || (state._ovCat = {}))[wid] || null;
      const bar = el('div', 'ov-cats');
      const cats = [['seg', T('Segmente'), htmlSeg], ['wt', T('Gewicht'), htmlWt]];
      const box = el('div', 'ov-catbody');
      cats.forEach(([k, label, h]) => {
        if (!h) return;
        const b = document.createElement('button'); b.textContent = (cat === k ? '▾ ' : '▸ ') + label;
        if (cat === k) b.classList.add('active');
        b.onclick = () => { state._ovCat[wid] = cat === k ? null : k; renderOverview(); };
        bar.appendChild(b);
        if (cat === k) box.innerHTML = h;
      });
      inf.appendChild(bar);
      if (cat) inf.appendChild(box);
      body.appendChild(inf);
    }, { accent: act ? 'var(--accent)' : null, badge });
  }

  // ---------- DXF-Formen / 3D-Modell: Segmente + Gewicht ----------
  // Gleicher Aufbau wie bei der Tragfläche (Kategorie-Schalter „Segmente"/„Gewicht").
  // Gewicht = Volumen × Rohdichte des zugewiesenen Werkstoffs × Anzahl + Zuschlag;
  // Einstellungen in state.cfg <pre>WtCount / <pre>WtExtra (pre = dxf | model).
  function loopMetrics(lp) {
    let a = 0, p = 0;
    for (let i = 0; i < lp.length; i++) {
      const q = lp[(i + 1) % lp.length];
      a += lp[i].x * q.y - q.x * lp[i].y; p += Math.hypot(q.x - lp[i].x, q.y - lp[i].y);
    }
    return { area: Math.abs(a) / 2, perim: p };
  }
  function dxfStats() {
    const d = state.dxf; if (!d || !Array.isArray(d.ribs) || d.ribs.length < 2 || !d.layers || !window.Dxf) return null;
    const n = App.dxfSegCount ? App.dxfSegCount() : Math.floor(d.ribs.length / 2), rows = [];
    const met = r => { const lp = r && d.layers[r.layer] && Dxf.pickLoop(d.layers[r.layer]); return lp && lp.length > 2 ? Object.assign(loopMetrics(lp), { name: r.layer }) : null; };
    for (let k = 0; k < n; k++) {
      const sg = d.segs && d.segs[k];
      const span = +(k === d.activeSeg ? d.span : (sg && sg.span)) || 0;
      const a = met(d.ribs[2 * k]), b = met(d.ribs[2 * k + 1]);
      const r = { len: span, from: a ? esc(a.name) : '—', to: b ? esc(b.name) : '—', vol: null, surf: null };
      if (a && b) {
        r.vol = span / 3 * (a.area + b.area + Math.sqrt(a.area * b.area));
        r.surf = span * (a.perim + b.perim) / 2;
      }
      rows.push(r);
    }
    return rows;
  }
  function modelStats() {
    const M3 = window.Model3D; if (!M3 || !M3.state || !M3.state.verts || !M3.segStats) return null;
    return M3.segStats().map(s => ({ len: s.len, vol: s.vol, surf: s.surf,
      size: s.bbox ? s.bbox.max.map((v, i) => Math.round(v - s.bbox.min[i])).join(' × ') + ' mm' : '—' }));
  }
  function secParts(host, key, pre, title, ctx, rows, sums, cols) {
    const matId = App.matIdFor(ctx);
    const dens = matId ? +App.matField(matId, 'density', 0) || 0 : 0;
    const count = Math.max(1, Math.round(+state.cfg[pre + 'WtCount'] || 1));
    const extra = +state.cfg[pre + 'WtExtra'] || 0;
    const n = rows.length;
    const sum = f => rows.reduce((s, r) => s + (r[f] || 0), 0);
    const vol = sum('vol'), surf = sum('surf'), len = sum('len');
    const foam = dens > 0 ? vol * dens * 1e-6 : null;
    const piece = (foam || 0) + extra, total = piece * count;
    if (n) { sums.total += total; if (foam == null) sums.known = false; }
    const info = matName(matId) + ' · ' + n + ' ' + T(n === 1 ? 'Segment' : 'Segmente') + ' · ' + mm(len)
      + ' · ' + g(total) + (foam == null ? ' ' + muted(T('ohne Kern')) : '');
    section(host, key, T(title), info, body => {
      if (!n) { body.appendChild(el('div', 'hint', T('Keine Segmente.'))); return; }
      body.classList.add('ov-two');
      const set = el('div', 'ov-set');
      App.numRow(set, 'Anzahl (Stück)', () => count, v => { state.cfg[pre + 'WtCount'] = Math.max(1, Math.round(v)); renderOverview(); },
        { min: 1, norender: true, enter: true, hint: 'Wie oft das Teil gebaut wird (z. B. 2 für linke und rechte Seite).' });
      App.numRow(set, 'Zuschlag je Stück (g)', () => extra, v => { state.cfg[pre + 'WtExtra'] = Math.max(0, v); renderOverview(); },
        { min: 0, norender: true, enter: true, hint: 'Pauschaler Zuschlag für Beplankung, Gewebe, Harz, Klebstoff usw.' });
      body.appendChild(set);
      const th = s => '<th>' + T(s) + '</th>';
      let hs = '<div style="overflow-x:auto"><table class="set-table"><thead><tr>' + th('Segment') + th('Länge') + cols.map(c => th(c[0])).join('')
        + th('Volumen') + th('Oberfläche') + '</tr></thead><tbody>';
      rows.forEach((r, k) => {
        hs += '<tr><td>' + (k + 1) + '</td><td class="num">' + mm(r.len) + '</td>' + cols.map(c => '<td>' + c[1](r) + '</td>').join('')
          + '<td class="num">' + cm3(r.vol) + '</td><td class="num">' + dm2(r.surf) + '</td></tr>';
      });
      hs += '<tr><td><b>' + T('Summe') + '</b></td><td class="num">' + mm(len) + '</td>' + cols.map(() => '<td></td>').join('')
        + '<td class="num">' + cm3(vol) + '</td><td class="num">' + dm2(surf) + '</td></tr></tbody></table></div>';
      const wr = [[T('Schaumkern') + ' (' + cm3(vol) + (dens > 0 ? ' × ' + dens + ' kg/m³' : '') + ')', foam == null ? muted(T('keine Rohdichte im Werkstoff')) : g(foam)]];
      if (extra > 0) wr.push([T('Zuschlag'), g(extra)]);
      wr.push(['<b>' + T('Gewicht je Stück') + '</b>', '<b>' + g(piece) + '</b>']);
      wr.push(['<b>' + T('Gesamtgewicht') + ' (' + count + ' ' + T('Stück') + ')</b>', '<b>' + g(total) + '</b>']);
      const hw = '<table class="set-table" style="max-width:560px"><tbody>' + wr.map(r => cell(r[0], r[1])).join('') + '</tbody></table>'
        + '<div class="hint">' + T(pre === 'dxf' ? 'Schätzwert: Volumen je Segment als Kegelstumpf aus den beiden Konturflächen, Oberfläche = Mantelfläche.'
          : 'Schätzwert: Volumen je Segment aus dem geschlossenen Netz, Oberfläche inkl. Schnittflächen.')
        + ' ' + T('Werkstoff unter „Werkstoff DXF-Formen / 3D-Modell".') + '</div>';
      const inf = el('div', 'ov-inf');
      const cat = (state._ovCat || (state._ovCat = {}))[key] || null;
      const bar = el('div', 'ov-cats'), box = el('div', 'ov-catbody');
      [['seg', T('Segmente'), hs], ['wt', T('Gewicht'), hw]].forEach(([k, label, h]) => {
        const b = document.createElement('button'); b.textContent = (cat === k ? '▾ ' : '▸ ') + label;
        if (cat === k) { b.classList.add('active'); box.innerHTML = h; }
        b.onclick = () => { state._ovCat[key] = cat === k ? null : k; renderOverview(); };
        bar.appendChild(b);
      });
      inf.appendChild(bar); if (cat) inf.appendChild(box);
      body.appendChild(inf);
    });
  }

  // ---------- Abschnitt „Werkstoff DXF-Formen / 3D-Modell" ----------
  function secMatX(host) {
    const sc = !!window.Schrift;   // Reiter „Schriften" (optionale Funktion) im Build?
    const info = T('DXF-Formen') + ': ' + matName(App.matIdFor('dxf')) + ' · ' + T('3D-Modell') + ': ' + matName(App.matIdFor('model'))
      + (sc ? ' · ' + T('Schriften') + ': ' + matName(App.matIdFor('schrift')) : '');
    section(host, 'matx', T(sc ? 'Werkstoff DXF-Formen / 3D-Modell / Schriften' : 'Werkstoff DXF-Formen / 3D-Modell'), info, body => {
      const set = el('div', 'ov-set'); set.style.maxWidth = '520px';
      App.hint(set, sc
        ? 'Werkstoff für die Quellen „DXF-Formen", „3D-Modell/Platte" und „Schriften" (Abbrand, Heizung, Vorschub automatisch). Eine Dicke ist hier nicht nötig — die Blockmaße kommen aus der Form, dem Modell bzw. der Schrift (Blockdicke im Reiter „Schriften").'
        : 'Werkstoff für die Quellen „DXF-Formen" und „3D-Modell/Platte" (Abbrand, Heizung, Vorschub automatisch). Eine Dicke ist hier nicht nötig — die Blockmaße kommen aus der Form bzw. dem Modell.');
      const matOpts = App.matOptions ? App.matOptions() : [];
      const mo = [['', '— kein Werkstoff —']].concat(matOpts);
      const matSel = (label, key) => App.selectRow(set, label, mo,
        () => (state.cfg[key] != null ? state.cfg[key] : (state.material.id || '')),
        v => { state.cfg[key] = v; refresh(true); });
      matSel('Werkstoff DXF-Formen', 'dxfMatId');
      matSel('Werkstoff 3D-Modell', 'modelMatId');
      if (sc) matSel('Werkstoff Schriften', 'scMatId');   // gleiche Einstellung wie im Reiter „Schriften"
      if (!matOpts.length) App.hint(set, 'Noch kein Werkstoff angelegt — bitte zuerst in der „Werkstoff-Datenbank" (Kopfzeile) einen anlegen.');
      body.appendChild(set);
    });
  }

  // ---------- Abschnitt „Schneideinstellungen" ----------
  function secCut(host) {
    const matOpts = App.matOptions ? App.matOptions() : [];
    const info = T('Sicherheitshöhe') + ' ' + mm(state.material.safeH)
      + (matOpts.length ? ' · ' + T('Vorschub') + ' ' + (App.autoFeedOn() ? T('automatisch') : state.cfg.feed + ' mm/min') : '');
    section(host, 'cut', T('Schneideinstellungen'), info, body => {
      const set = el('div', 'ov-set'); set.style.maxWidth = '520px';
      App.hint(set, 'Projektweite Schneideinstellungen. Werkstoff und Dicke (Blockhöhe) werden oben je Tragfläche bzw. für DXF-Formen und 3D-Modell zugewiesen.');
      App.numRow(set, 'Sicherheitshöhe über Block (mm)', () => state.material.safeH, v => { state.material.safeH = v; refresh(false); },
        { min: 0, norender: true, enter: true, hint: 'Freiraum über der Blockoberkante für Anfahrt, Rückzug und Blockschnitt.' });
      if (matOpts.length) {
        App.subhead(set, 'Vorschub');
        App.boolRow(set, 'Vorschub automatisch (= „Vorschub schnell")', () => App.autoFeedOn(),
          v => { state.cfg.feedAuto = v; refresh(true); },
          'Ein (Standard): In ALLEN G-Codes (Kern, Guillotine, Block, 3D-Modell/Platte) gilt automatisch der „Vorschub schnell" des Werkstoffs — also genau der Vorschub, mit dem der Abbrand kalibriert wurde. Aus: Vorschub je G-Code-Quelle manuell eingeben.');
        if (App.autoFeedOn() && !(App.autoFeedVal() > 0))
          App.hint(set, '⚠ Für diesen Werkstoff ist noch kein „Vorschub schnell" eingetragen (Werkstoff-Datenbank → Kalibrierung). Bis dahin gelten die manuellen Vorschübe.');
        App.hint(set, T('Eingegebener Vorschub ') + state.cfg.feed + T(' mm/min → wirksamer Abbrand ')
          + App.currentKerf().toFixed(2) + T(' mm · Heizung ') + App.currentHeat() + T(' %. (Vorschub im Reiter „G-Code".)'));
      }
      body.appendChild(set);
    });
  }

  // ---------- Gesamtaufbau ----------
  function renderOverview() {
    const host = document.getElementById('projOverview');
    if (!host) return;
    // Fokus über den Neuaufbau retten: Feld per laufender Nummer wiederfinden.
    const ae = document.activeElement;
    const fid = ae && host.contains(ae) ? ae.dataset.fid : null;
    const selPos = fid && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
    host.innerHTML = '';
    const L = App.wingList ? App.wingList() : [];
    // Standard: die aktive Tragfläche ist ausgeklappt (bis der Nutzer etwas anderes
    // wählt). _ovSel === undefined = noch nie berührt; null = bewusst alles zu.
    if (state._ovSel === undefined) {
      const aw = App.wingId ? App.wingId(state.activeWing) : String(state.activeWing);
      state._ovSel = 'wing:' + aw;
    }
    const sums = { total: 0, known: true };
    secProject(host);
    host.appendChild(el('div', 'ov-group', T('Tragflächen und Werkstoffzuweisung') + ' (' + L.length + ')'));
    L.forEach((w, i) => secWing(host, w, i, sums));
    {
      const bar = el('div', 'ov-bar');
      const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('+ Neue Tragfläche');
      b.title = T('Leere Tragfläche mit Programm-Vorgaben anlegen.');
      b.onclick = () => { App.addWing(); const L2 = App.wingList(); state._ovSel = 'wing:' + App.wingId(L2.length - 1); renderOverview(); };
      bar.appendChild(b);
      if (L.length > 1)
        bar.appendChild(el('span', 'ov-sum', '<b>' + T('Gesamtgewicht aller Tragflächen') + '</b> ' + g(sums.total)
          + (sums.known ? '' : ' ' + muted(T('unvollständig: Rohdichte fehlt')))));
      host.appendChild(bar);
    }
    {
      const ps = { total: 0, known: true };
      const dr = dxfStats(), mr = modelStats();
      if (dr || mr) host.appendChild(el('div', 'ov-group', T('Weitere Teile')));
      if (dr) secParts(host, 'dxfparts', 'dxf', 'DXF-Formen', 'dxf', dr, ps, [['Kontur innen → außen', r => r.from + ' → ' + r.to]]);
      if (mr) secParts(host, 'modelparts', 'model', '3D-Modell', 'model', mr, ps, [['Maße', r => r.size]]);
      if (dr || mr) {
        const all = sums.total + ps.total, ok = sums.known && ps.known;
        const bar = el('div', 'ov-bar');
        bar.appendChild(el('span', 'ov-sum', '<b>' + T('Gesamtgewicht Projekt') + '</b> ' + g(all) + (ok ? '' : ' ' + muted(T('unvollständig: Rohdichte fehlt')))));
        host.appendChild(bar);
      }
    }
    secMatX(host);
    secCut(host);
    // Feld-Nummern vergeben und Fokus zurückgeben
    let k = 0;
    host.querySelectorAll('input,select,textarea').forEach(x => { x.dataset.fid = String(k++); });
    if (fid != null) {
      const nx = host.querySelector('[data-fid="' + fid + '"]');
      if (nx) { nx.focus(); if (selPos && nx.setSelectionRange) { try { nx.setSelectionRange(selPos[0], selPos[1]); } catch (e) {} } }
    }
    if (App.decorateHints) { try { App.decorateHints(host); } catch (e) {} }
    applyBackdrop();
  }

  // Hintergrund des gesamten Ansichtfensters: ein festes Simulator-Standbild
  // (App._simBg aus overview_bg.js), unten ausgerichtet und dezent überlagert.
  function applyBackdrop() {
    const view = document.getElementById('materialView');
    if (!view) return;
    const bg = App._simBg;
    if (bg) {
      view.style.backgroundImage = 'url(' + bg + ')';
      view.classList.add('has-sim');
    } else {
      view.style.backgroundImage = '';
      view.classList.remove('has-sim');
    }
  }

  Object.assign(App, { renderOverview });
})();
