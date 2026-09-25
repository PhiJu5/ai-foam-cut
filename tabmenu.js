/* tabmenu.js — Reiterleiste frei gliederbar.
 * Jeder Nutzer kann die Reiter (Tragflächendesigner, Kerndesign, …) beliebig zu
 * Aufklappmenüs mit eigenem Namen zusammenfassen und die Reihenfolge ändern.
 * Einstellung: Einstellungen → Reiter „Menüleiste" (buildSettingsTabMenu).
 *
 * Gespeichert in localStorage 'hw_tab_layout' (steht in PREF_KEYS von filesys.js
 * und landet so auch in der Einstellungsdatei). Format: Liste der Einträge der
 * Leiste in Reihenfolge; ein Eintrag ist entweder eine Reiter-Kennung (String,
 * data-view) oder ein Aufklappmenü { g: 'Name', v: ['rib', 'cad', …] }.
 *
 * Die <button data-view>-Elemente aus der HTML werden NICHT neu erzeugt, sondern
 * nur umgehängt: so bleiben Klick-Verdrahtung (app.js wireUp) und die statische
 * Übersetzung (I18N.captureStatic) erhalten, und das Build-Tool kann einzelne
 * Reiter weiterhin aus der HTML entfernen — fehlende Reiter werden übersprungen,
 * Menüs ohne vorhandenen Reiter ausgeblendet. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => window.I18N ? window.I18N.t(s) : s;
  const LS_KEY = 'hw_tab_layout';
  const NEW_NAME = 'Neues Menü';

  let bar = null;         // .tabs
  const BTN = {};         // data-view → <button> (einmal beim Start erfasst)
  let ORDER = [];         // vorhandene Reiter in HTML-Reihenfolge
  let DEFAULT = [];       // Standard-Gliederung aus der HTML (.tab-more = Menü)
  let layout = [];        // aktuelle, bereinigte Gliederung
  let docWired = false;

  const clone = l => l.map(it => typeof it === 'string' ? it : { g: it.g, v: it.v.slice() });
  const label = v => BTN[v] ? BTN[v].textContent.trim() : v;
  const groupName = it => (it.g || '').trim() || T('Menü');

  // ---------- Gliederung lesen/prüfen/speichern ----------------------------
  // Bereinigt eine (evtl. fremde/alte) Gliederung: unbekannte und doppelte
  // Reiter fliegen raus; Reiter, die darin fehlen (neu hinzugekommen oder in
  // einer anderen Ausgabe abgewählt), werden hinter ihrem Vorgänger aus der
  // HTML-Reihenfolge einsortiert — so landen neue Spezial-Reiter in der Regel
  // im selben Menü wie ihre Nachbarn. Leere Menüs bleiben erhalten (frisch
  // angelegt, noch nicht befüllt), erscheinen aber nicht in der Leiste.
  function normalize(raw) {
    if (!Array.isArray(raw)) return clone(DEFAULT);
    const seen = new Set();
    const take = v => (typeof v === 'string' && BTN[v] && !seen.has(v)) ? (seen.add(v), true) : false;
    const out = [];
    raw.forEach(it => {
      if (typeof it === 'string') { if (take(it)) out.push(it); }
      else if (it && typeof it === 'object' && Array.isArray(it.v)) {
        out.push({ g: String(it.g == null ? '' : it.g).slice(0, 60), v: it.v.filter(take) });
      }
    });
    ORDER.forEach((v, i) => {
      if (seen.has(v)) return;
      seen.add(v);
      for (let j = i - 1; j >= 0; j--) {
        const pos = locate(out, ORDER[j]);
        if (!pos) continue;
        if (pos.g < 0) out.splice(pos.i + 1, 0, v); else out[pos.g].v.splice(pos.i + 1, 0, v);
        return;
      }
      out.unshift(v);
    });
    return out;
  }
  // Wo steht Reiter v? → { g: Menü-Index oder -1 (eigener Reiter), i: Position }
  function locate(l, v) {
    for (let k = 0; k < l.length; k++) {
      const it = l[k];
      if (it === v) return { g: -1, i: k };
      if (typeof it !== 'string') { const i = it.v.indexOf(v); if (i >= 0) return { g: k, i }; }
    }
    return null;
  }
  function load() {
    let raw = null;
    try { const s = localStorage.getItem(LS_KEY); if (s) raw = JSON.parse(s); } catch (e) {}
    layout = normalize(raw);
  }
  function save() {
    // Standard-Gliederung nicht speichern: dann greifen spätere Änderungen am
    // Standard (neue Reiter/Menüs) automatisch.
    const same = JSON.stringify(layout) === JSON.stringify(DEFAULT);
    try { if (same) localStorage.removeItem(LS_KEY); else localStorage.setItem(LS_KEY, JSON.stringify(layout)); } catch (e) {}
  }

  // ---------- Leiste aufbauen -----------------------------------------------
  function closeAll(except) {
    if (!bar) return;
    bar.querySelectorAll('.tab-more.open').forEach(w => { if (w !== except) w.classList.remove('open'); });
  }
  function openMenu(wrap) {
    closeAll(wrap);
    wrap.classList.add('open');
    // Menü am rechten Rand: Liste rechtsbündig öffnen statt aus dem Fenster zu ragen.
    const list = wrap.querySelector('.tab-more-list');
    list.classList.remove('right');
    if (list.getBoundingClientRect().right > window.innerWidth - 4) list.classList.add('right');
  }
  function render() {
    if (!bar) return;
    Object.keys(BTN).forEach(v => BTN[v].remove());
    bar.querySelectorAll('.tab-more').forEach(w => w.remove());
    layout.forEach(it => {
      if (typeof it === 'string') { bar.appendChild(BTN[it]); return; }
      if (!it.v.length) return;                 // leeres Menü: nicht in der Leiste
      const wrap = document.createElement('div'); wrap.className = 'tab-more';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'tab-more-btn';
      const nm = document.createElement('span'); nm.className = 'tab-more-name';
      const cur = document.createElement('span'); cur.className = 'tab-more-cur';
      const ch = document.createElement('span'); ch.className = 'tab-more-ch'; ch.textContent = '▾';
      btn.append(nm, cur, ch);
      const list = document.createElement('div'); list.className = 'tab-more-list';
      it.v.forEach(v => list.appendChild(BTN[v]));
      btn.onclick = e => { e.stopPropagation(); if (wrap.classList.contains('open')) wrap.classList.remove('open'); else openMenu(wrap); };
      // Wie in einer Menüleiste: ist schon ein Menü offen, genügt Überfahren.
      btn.onmouseenter = () => { if (bar.querySelector('.tab-more.open') && !wrap.classList.contains('open')) openMenu(wrap); };
      list.addEventListener('click', () => wrap.classList.remove('open'));
      wrap._item = it;
      wrap.append(btn, list);
      bar.appendChild(wrap);
    });
    update();
  }
  // Menü hervorheben, wenn einer seiner Reiter aktiv ist, und dessen Namen
  // anzeigen; Menünamen/Tooltips in der aktuellen Sprache (auch nach Wechsel).
  function update() {
    if (!bar) return;
    bar.querySelectorAll('.tab-more').forEach(wrap => {
      const it = wrap._item; if (!it) return;
      const btn = wrap.querySelector('.tab-more-btn');
      const cur = wrap.querySelector('.tab-more-list button.active');
      wrap.querySelector('.tab-more-name').textContent = T(groupName(it));
      wrap.querySelector('.tab-more-cur').textContent = cur ? cur.textContent.trim() : '';
      btn.classList.toggle('active', !!cur);
      btn.title = it.v.map(label).join(' · ');
    });
  }
  // Einmal beim Start (app.js wireUp, NACH der Klick-Verdrahtung der Reiter).
  function init() {
    bar = document.querySelector('.tabs');
    if (!bar) return;
    ORDER = []; DEFAULT = [];
    bar.querySelectorAll('button[data-view]').forEach(b => { BTN[b.dataset.view] = b; ORDER.push(b.dataset.view); });
    // Standard = Aufbau der HTML: direkte Reiter + Menüs (.tab-more, Name in data-group).
    Array.from(bar.children).forEach(el => {
      if (el.matches('button[data-view]')) DEFAULT.push(el.dataset.view);
      else if (el.classList.contains('tab-more')) {
        const v = Array.from(el.querySelectorAll('button[data-view]')).map(b => b.dataset.view);
        if (v.length) DEFAULT.push({ g: el.dataset.group || 'Spezialfunktionen', v });
      }
    });
    load();
    render();
    if (!docWired) {
      docWired = true;
      document.addEventListener('mousedown', e => { if (bar && !e.target.closest('.tabs .tab-more')) closeAll(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
    }
  }
  // Gliederung von außen geändert (Einstellungsdatei geladen): neu einlesen.
  function reload() { if (!bar) return; load(); render(); }
  function commit() { save(); render(); }

  // ---------- Einstellungen → Reiter „Menüleiste" -------------------------
  function mkBtn(text, title, fn, disabled) {
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = text; if (title) b.title = T(title);
    b.disabled = !!disabled; b.onclick = fn;
    return b;
  }
  function arrows(arr, i, after) {
    const swap = d => { const j = i + d; [arr[i], arr[j]] = [arr[j], arr[i]]; after(); };
    const w = document.createElement('span'); w.className = 'tm-arrows';
    w.append(mkBtn('▲', 'Nach oben (in der Leiste nach links)', () => swap(-1), i === 0),
      mkBtn('▼', 'Nach unten (in der Leiste nach rechts)', () => swap(1), i === arr.length - 1));
    return w;
  }
  // Auswahl rechts je Reiter: eigener Reiter in der Leiste oder in eines der Menüs.
  function placeSelect(v, rebuild) {
    const s = document.createElement('select'); s.className = 'tm-place';
    s.title = T('In welches Aufklappmenü der Reiter gehört');
    const o0 = document.createElement('option'); o0.value = '-1'; o0.textContent = T('Eigener Reiter in der Leiste'); s.appendChild(o0);
    layout.forEach((it, k) => {
      if (typeof it === 'string') return;
      const o = document.createElement('option'); o.value = String(k); o.dataset.gi = String(k);
      o.textContent = T('Menü') + ': ' + groupName(it); s.appendChild(o);
    });
    const pos = locate(layout, v);
    s.value = String(pos ? pos.g : -1);
    s.onchange = () => { moveTo(v, +s.value); commit(); rebuild(); };
    return s;
  }
  // Reiter v verschieben: ins Menü g (ans Ende) oder als eigener Reiter (g < 0)
  // direkt hinter das Menü, aus dem er kommt.
  function moveTo(v, g) {
    const pos = locate(layout, v); if (!pos || pos.g === g) return;
    let at = layout.length;
    if (pos.g < 0) layout.splice(pos.i, 1);
    else { layout[pos.g].v.splice(pos.i, 1); at = pos.g + 1; }
    if (g >= 0) { if (pos.g < 0 && pos.i < g) g--; layout[g].v.push(v); }
    else layout.splice(at, 0, v);
  }
  function tabRow(arr, i, v, rebuild) {
    const r = document.createElement('div'); r.className = 'tm-row';
    const l = document.createElement('span'); l.className = 'tm-label'; l.textContent = label(v);
    r.append(arrows(arr, i, () => { commit(); rebuild(); }), l, placeSelect(v, rebuild));
    return r;
  }
  function buildSettingsTabMenu(body) {
    if (!bar) { App.hint(body, 'Die Reiterleiste ist noch nicht aufgebaut.'); return; }
    const rebuild = () => { if (App.buildSettingsModal) App.buildSettingsModal(); };
    const head = document.createElement('b'); head.className = 'set-h'; head.textContent = T('Reiterleiste gliedern');
    body.appendChild(head);
    App.hint(body, 'Reiter lassen sich zu Aufklappmenüs mit eigenem Namen zusammenfassen: „Neues Aufklappmenü" anlegen, '
      + 'Namen eintragen und bei den gewünschten Reitern rechts in der Auswahl das Menü wählen. Mit ▲/▼ die Reihenfolge ändern. '
      + 'Änderungen wirken sofort in der Leiste und werden mit den Einstellungen gespeichert.');
    const top = document.createElement('div'); top.className = 'mrow'; top.style.cssText = 'gap:6px;margin:8px 0 10px;flex-wrap:wrap';
    top.append(
      mkBtn('+ ' + T('Neues Aufklappmenü'), 'Leeres Aufklappmenü am Ende der Leiste anlegen', () => {
        layout.push({ g: T(NEW_NAME), v: [] }); commit(); rebuild();
        const ins = body.querySelectorAll('.tm-name'); const last = ins[ins.length - 1];
        if (last) { last.focus(); last.select(); }
      }),
      mkBtn(T('Standard wiederherstellen'), 'Standard-Reiterleiste (Menüs „Tragflächen", „Komplexe Formen", „Spezial Module") wiederherstellen', () => {
        if (!confirm(T('Reiterleiste auf die Standard-Gliederung zurücksetzen?'))) return;
        layout = clone(DEFAULT); commit(); rebuild();
      }));
    top.firstChild.className = 'primary';
    body.appendChild(top);

    const list = document.createElement('div'); list.className = 'tm-list';
    layout.forEach((it, i) => {
      if (typeof it === 'string') { list.appendChild(tabRow(layout, i, it, rebuild)); return; }
      const box = document.createElement('div'); box.className = 'tm-group';
      const gh = document.createElement('div'); gh.className = 'tm-row tm-ghead';
      const ic = document.createElement('span'); ic.className = 'tm-ic'; ic.textContent = '▾';
      const inp = document.createElement('input'); inp.className = 'tm-name'; inp.maxLength = 60;
      inp.value = T(it.g); inp.placeholder = T('Name des Menüs');   // Standardname übersetzt, eigene Namen unverändert
      inp.title = T('Name des Aufklappmenüs, wie er in der Reiterleiste erscheint');
      // Beim Tippen nur Leiste + Menü-Namen in den Auswahlfeldern nachziehen —
      // kein Neuaufbau, sonst ginge der Fokus verloren.
      inp.oninput = () => {
        it.g = inp.value; commit();
        body.querySelectorAll('.tm-place option[data-gi="' + i + '"]').forEach(o => { o.textContent = T('Menü') + ': ' + groupName(it); });
      };
      const dis = mkBtn(T('Menü auflösen'), 'Menü entfernen — seine Reiter stehen danach wieder einzeln in der Leiste', () => {
        layout.splice(i, 1, ...it.v); commit(); rebuild();
      });
      gh.append(arrows(layout, i, () => { commit(); rebuild(); }), ic, inp, dis);
      box.appendChild(gh);
      if (!it.v.length) {
        const e = document.createElement('div'); e.className = 'hint tm-empty';
        e.textContent = T('Noch leer — bei einem Reiter rechts in der Auswahl dieses Menü wählen. Leere Menüs erscheinen nicht in der Leiste.');
        box.appendChild(e);
      }
      it.v.forEach((v, j) => box.appendChild(tabRow(it.v, j, v, rebuild)));
      list.appendChild(box);
    });
    body.appendChild(list);
  }

  Object.assign(App, {
    tabMenuInit: init, tabMenuUpdate: update, tabMenuReload: reload, tabMenuClose: closeAll,
    buildSettingsTabMenu,
  });
})();
