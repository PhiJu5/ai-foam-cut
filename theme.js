/* theme.js — helle Zeichenflächen (Einstellungen → Farben → Erscheinungsbild).
 *
 * Alle Zeichenfarben im Programm sind für dunklen Grund gewählt — in rund 60
 * Modulen, teils fest eingetragen, teils aus der Palette (PAL) oder den
 * CSS-Variablen von <html>. Statt jede Zeichenroutine doppelt zu pflegen,
 * rechnet dieses Modul im Modus „Zeichenflächen hell" jede Farbe beim SETZEN
 * um (fillStyle/strokeStyle/shadowColor, Verlaufsstopps, WebGL-Hintergrund):
 * Helligkeit gespiegelt in OKLab, Farbton und Sättigung bleiben. Dunkler
 * Hintergrund wird hell, helle Linien/Texte werden dunkel, der Farbton bleibt
 * erkennbar (blau bleibt blau usw.).
 *
 * Unverändert bleiben:
 *  - Bilder (drawImage) und Pixeldaten,
 *  - Zeichenflächen, die nicht im Dokument hängen (Rechen-/Hilfs-Canvas, z. B.
 *    Rasterungen fürs Abstandsfeld — die dürfen nie umgefärbt werden),
 *    außer sie sind mit DrawTheme.mark(canvas) ausdrücklich angemeldet,
 *  - Farben, die als DrawTheme.raw('rgb(…)') gesetzt werden (schattierte
 *    3D-Flächen: Licht bleibt Licht),
 *  - Canvas mit data-theme-raw (z. B. echte Motivfarben).
 * :root behält die dunklen CSS-Variablen — die Zeichenroutinen lesen dort und
 * die Umrechnung macht daraus die hellen Werte. Wird als zweites Skript (nach
 * i18n.js) geladen, damit alle Zeichenkontexte die Hülle bekommen. */
(function () {
  'use strict';
  let on = false;
  try { on = localStorage.getItem('hw_theme') === 'light'; } catch (e) {}

  // ---- Farbumrechnung -------------------------------------------------------
  const P2 = CanvasRenderingContext2D.prototype;
  const dFill = Object.getOwnPropertyDescriptor(P2, 'fillStyle');
  const dStroke = Object.getOwnPropertyDescriptor(P2, 'strokeStyle');
  const dShadow = Object.getOwnPropertyDescriptor(P2, 'shadowColor');
  // Hilfskontext zum Normalisieren beliebiger CSS-Farben (Namen, hsl(), #rgb …)
  // — liefert '#rrggbb' oder 'rgba(r, g, b, a)'.
  let norm = null;
  function normalize(s) {
    if (!norm) norm = document.createElement('canvas').getContext('2d');
    // Ungültige Angaben ignoriert der Canvas — dann bliebe der Merkwert stehen.
    dFill.set.call(norm, '#010203'); dFill.set.call(norm, s);
    const n = dFill.get.call(norm);
    return (n === '#010203' && !/^\s*#010203\s*$/i.test(s)) ? null : n;
  }
  function parse(n) {
    if (n[0] === '#') return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16), 1];
    const m = /rgba?\(([^)]*)\)/.exec(n); if (!m) return null;
    const p = m[1].split(',').map(Number);
    return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
  }
  const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const toSrgb = c => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return c * 255; };
  function oklab(r, g, b) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function linFromLab(L, a, b) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  // Helligkeit spiegeln: Dunkelgrund (L≈0,16–0,18) → fast weiß, helle Linien
  // (L 0,7–0,95) → 0,30–0,51, also kräftig genug auf hellem Grund.
  function flipRGB(r, g, b) {
    const [L, A, B] = oklab(r, g, b);
    const L2 = Math.max(0, Math.min(1, 1.12 - 0.87 * L));
    // Chroma so weit verringern, bis die Farbe im sRGB-Raum liegt.
    let k = 1, rgb = linFromLab(L2, A, B);
    for (let i = 0; i < 12 && rgb.some(v => v < -1e-4 || v > 1.0001); i++) { k *= 0.8; rgb = linFromLab(L2, A * k, B * k); }
    return rgb.map(v => Math.round(Math.max(0, Math.min(255, toSrgb(Math.max(0, Math.min(1, v)))))));
  }
  // Cache: CSS-Farbe → [umgerechnet, normalisiertes Original]
  const cache = new Map();
  function entry(s) {
    let v = cache.get(s); if (v !== undefined) return v;
    const n = normalize(s), c = n && parse(n);
    if (!c) v = [s, null];
    else {
      const [r, g, b] = flipRGB(c[0], c[1], c[2]);
      v = [c[3] >= 1 ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + c[3] + ')', n];
    }
    if (cache.size > 4000) cache.clear();
    cache.set(s, v); return v;
  }
  const map = s => entry(s)[0];
  // Gilt die Umrechnung für diesen Zeichenkontext?
  function active(ctx) {
    if (!on) return false;
    const cv = ctx && ctx.canvas; if (!cv) return false;
    if (cv.__themeMark) return true;
    if (!cv.isConnected) return false;
    return !(cv.dataset && cv.dataset.themeRaw != null);
  }
  // Beim Auslesen bekommt der Code die Farbe zurück, die er gesetzt hat (nicht
  // die umgerechnete) — mehrere Module normalisieren Farben über
  // ctx.fillStyle = x; y = ctx.fillStyle (z. B. für den WebGL-Hintergrund).
  function wrap(desc, name) {
    if (!desc || !desc.set) return;
    const key = '__th_' + name;
    Object.defineProperty(P2, name, {
      configurable: true, enumerable: desc.enumerable,
      get() {
        const g = desc.get.call(this), o = this[key];
        return (o && g === o[0]) ? o[1] : g;
      },
      set(v) {
        if (v instanceof String) { desc.set.call(this, String(v)); this[key] = null; return; }   // DrawTheme.raw(...)
        if (typeof v === 'string' && active(this)) {
          const e = entry(v);
          desc.set.call(this, e[0]);
          this[key] = e[1] ? [desc.get.call(this), e[1]] : null;
        } else { desc.set.call(this, v); this[key] = null; }
      }
    });
  }
  wrap(dFill, 'fillStyle'); wrap(dStroke, 'strokeStyle'); wrap(dShadow, 'shadowColor');
  // Verläufe kennen ihren Canvas nicht — der Kontext merkt ihn sich beim Erzeugen.
  const GP = CanvasGradient.prototype, addStop = GP.addColorStop;
  GP.addColorStop = function (o, c) {
    if (c instanceof String) return addStop.call(this, o, String(c));
    return addStop.call(this, o, (this.__theme && on && typeof c === 'string') ? map(c) : c);
  };
  ['createLinearGradient', 'createRadialGradient', 'createConicGradient'].forEach(fn => {
    const orig = P2[fn]; if (!orig) return;
    P2[fn] = function () { const g = orig.apply(this, arguments); if (active(this)) g.__theme = true; return g; };
  });

  // ---- WebGL: nur der Hintergrund (clear auf den Bildschirm) ----------------
  // Nicht beim Zeichnen in Framebuffer (Picking/Offscreen) und nicht bei
  // durchsichtigem Löschen (alpha 0 — dort scheint die Seite durch).
  function wrapGL(proto) {
    if (!proto) return;
    const cc = proto.clearColor, cl = proto.clear;
    proto.clearColor = function (r, g, b, a) { this.__cc = [r, g, b, a]; return cc.call(this, r, g, b, a); };
    proto.clear = function (mask) {
      const c = this.__cc;
      if (on && c && c[3] > 0 && (mask & 0x4000) && this.canvas && this.canvas.isConnected &&
          !(this.canvas.dataset && this.canvas.dataset.themeRaw != null) &&
          !this.getParameter(0x8CA6 /* FRAMEBUFFER_BINDING */)) {
        const f = flipRGB(c[0] * 255, c[1] * 255, c[2] * 255);
        cc.call(this, f[0] / 255, f[1] / 255, f[2] / 255, c[3]);
        const res = cl.call(this, mask);
        cc.call(this, c[0], c[1], c[2], c[3]);
        return res;
      }
      return cl.call(this, mask);
    };
  }
  wrapGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  wrapGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);

  window.DrawTheme = {
    // Umrechnung an/aus (Einstellungen). Danach neu zeichnen lassen.
    setOn(v) { on = !!v; },
    isOn() { return on; },
    // Farbe unverändert setzen: ctx.fillStyle = DrawTheme.raw('rgb(…)')
    raw(s) { return new String(s); },   // eslint-disable-line no-new-wrappers
    // Farbe so umrechnen, wie sie im hellen Modus erscheint (z. B. für WebGL-
    // Uniforms oder HTML-Legenden). Bei dunklem Modus unverändert.
    map(s) { return on && typeof s === 'string' ? map(s) : s; },
    // [r,g,b] 0..1 umrechnen (WebGL-Farben).
    map01(c) { if (!on || !c) return c; const f = flipRGB(c[0] * 255, c[1] * 255, c[2] * 255); return [f[0] / 255, f[1] / 255, f[2] / 255].concat(c.length > 3 ? [c[3]] : []); },
    // Hilfs-Canvas, der später ins Bild kopiert wird, anmelden.
    mark(canvas) { if (canvas) canvas.__themeMark = true; return canvas; }
  };
})();
