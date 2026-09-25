/* schrift_fonts.js — Schriftquellen für den Reiter „Schriften" (Funktion „schrift").
 *
 *  1) Eingebaute LINIEN-Schriften: je Zeichen nur das Skelett (Mittellinien der
 *     Striche). Strichstärke, Strichenden, Ecken, Bogenform (rund … eckig),
 *     Serifen, Breite, Neigung und x-Höhe wendet erst schrift.js beim Aufbau an —
 *     so ist jede Schriftart in Höhe UND Stärke frei einstellbar.
 *  2) TrueType-/OpenType-Leser (glyf + CFF, auch .ttc) für geladene Schrift-
 *     dateien bzw. Systemschriften. Liefert Umrisse in Font-Einheiten.
 *
 * Keine Abhängigkeit von App — die Datei kann an beliebiger Stelle geladen werden.
 */
(function () {
  'use strict';

  // ======================================================================
  //  1) Linien-Schrift „Grotesk" (Skelett)
  // ======================================================================
  // Entwurfseinheiten: Versalhöhe 100, Grundlinie 0, x-Höhe 70, Oberlänge 100,
  // Unterlänge −28. Das Skelett liegt um die halbe Strichstärke eingerückt (siehe
  // schrift.js), damit die Tinte genau von 0 bis zur Versalhöhe reicht.
  // Befehle (Striche mit „|" getrennt):
  //   Mx,y            neuer Strich ab Punkt
  //   Lx,y            Linie
  //   Acx,cy,rx,ry,a0,a1   Ellipsenbogen (Grad; a1>a0 gegen, a1<a0 im Uhrzeigersinn)
  //   Dx,y            Punkt (i-Punkt, Satzzeichen)
  // Eintrag: [Skelettbreite, Befehle]
  const XH = 70;          // x-Höhe im Entwurf (Kleinbuchstaben werden darauf abgebildet)
  const G = {
    // ---------------- Großbuchstaben ----------------
    'A': [80, 'M0,0 L40,100 L80,0|M14,35 L66,35'],
    'B': [66, 'M0,0 L0,100 L36,100 A36,76,24,24,90,-90 L0,52|M0,52 L40,52 A40,26,26,26,90,-90 L0,0'],
    'C': [80, 'A46,50,46,50,42,318'],
    'D': [80, 'M0,0 L0,100 L30,100 A30,50,50,50,90,-90 L0,0'],
    'E': [60, 'M60,100 L0,100 L0,0 L60,0|M0,52 L52,52'],
    'F': [56, 'M56,100 L0,100 L0,0|M0,52 L50,52'],
    'G': [92, 'A46,50,46,50,42,360 L54,50'],
    'H': [72, 'M0,0 L0,100|M72,0 L72,100|M0,52 L72,52'],
    'I': [0, 'M0,0 L0,100'],
    'J': [50, 'M50,100 L50,28 A25,28,25,28,0,-180'],
    'K': [68, 'M0,0 L0,100|M66,100 L0,36|M22,57 L68,0'],
    'L': [56, 'M0,100 L0,0 L56,0'],
    'M': [88, 'M0,0 L0,100 L44,15 L88,100 L88,0'],
    'N': [72, 'M0,0 L0,100 L72,0 L72,100'],
    'O': [92, 'A46,50,46,50,0,360'],
    'P': [62, 'M0,0 L0,100 L36,100 A36,73,26,27,90,-90 L0,46'],
    'Q': [94, 'A46,50,46,50,0,360|M56,26 L94,-4'],
    'R': [64, 'M0,0 L0,100 L36,100 A36,73,26,27,90,-90 L0,46|M30,46 L64,0'],
    'S': [64, 'A33,75,29,25,35,270 A32,25,32,25,90,-145'],
    'T': [70, 'M0,100 L70,100|M35,100 L35,0'],
    'U': [70, 'M0,100 L0,35 A35,35,35,35,180,360 L70,100'],
    'V': [76, 'M0,100 L38,0 L76,100'],
    'W': [110, 'M0,100 L26,0 L55,100 L84,0 L110,100'],
    'X': [72, 'M0,0 L72,100|M0,100 L72,0'],
    'Y': [74, 'M0,100 L37,48 L74,100|M37,48 L37,0'],
    'Z': [66, 'M0,100 L66,100 L0,0 L66,0'],
    // ---------------- Kleinbuchstaben ----------------
    'a': [66, 'A33,35,33,35,0,360|M66,70 L66,0'],
    'b': [66, 'M0,100 L0,0|A33,35,33,35,0,360'],
    'c': [60, 'A35,35,35,35,45,315'],
    'd': [66, 'M66,100 L66,0|A33,35,33,35,0,360'],
    'e': [70, 'M0,35 L70,35 A35,35,35,35,0,318'],
    'f': [50, 'M18,0 L18,82 A36,82,18,18,180,40|M0,70 L42,70'],
    'g': [66, 'A33,35,33,35,0,360|M66,70 L66,-6 A33,-6,33,22,0,-160'],
    'h': [66, 'M0,100 L0,0|M0,40 A33,40,33,30,180,0 L66,0'],
    'i': [0, 'M0,0 L0,70|D0,90'],
    'j': [24, 'M24,70 L24,-10 A8,-10,16,18,0,-135|D24,90'],
    'k': [56, 'M0,100 L0,0|M52,70 L0,24|M18,40 L56,0'],
    'l': [0, 'M0,0 L0,100'],
    'm': [96, 'M0,0 L0,70|M0,44 A24,44,24,26,180,0 L48,0|M48,44 A72,44,24,26,180,0 L96,0'],
    'n': [66, 'M0,0 L0,70|M0,40 A33,40,33,30,180,0 L66,0'],
    'o': [70, 'A35,35,35,35,0,360'],
    'p': [66, 'M0,70 L0,-28|A33,35,33,35,0,360'],
    'q': [66, 'M66,70 L66,-28|A33,35,33,35,0,360'],
    'r': [45, 'M0,0 L0,70|M0,44 A30,44,30,26,180,60'],
    's': [58, 'A30,52.5,26,17.5,30,270 A29,17.5,29,17.5,90,-145'],
    't': [38, 'M18,92 L18,0|M0,70 L38,70'],
    'u': [66, 'M0,70 L0,30 A33,30,33,30,180,360|M66,70 L66,0'],
    'v': [64, 'M0,70 L32,0 L64,70'],
    'w': [92, 'M0,70 L22,0 L46,70 L70,0 L92,70'],
    'x': [60, 'M0,0 L60,70|M0,70 L60,0'],
    'y': [64, 'M0,70 L32.6,0|M64,70 L20,-28'],
    'z': [56, 'M0,70 L56,70 L0,0 L56,0'],
    'ß': [62, 'M0,0 L0,78 A25,78,25,22,180,-75 L24,50 A28,25,32,25,90,-125'],
    'ı': [0, 'M0,0 L0,70'],
    // ---------------- Ziffern ----------------
    '0': [64, 'A32,50,32,50,0,360'],
    '1': [34, 'M4,78 L32,100 L32,0'],
    '2': [64, 'A31,68,31,32,155,-38 L0,0 L64,0'],
    '3': [62, 'A30,77,28,23,150,-90 A30,27,32,27,90,-150'],
    '4': [68, 'M50,0 L50,100 L0,30 L68,30'],
    '5': [63, 'M60,100 L8,100 L6,56 A31,32,32,33,135,-150'],
    '6': [64, 'M52,100 L3,45|A32,32,32,32,0,360'],
    '7': [64, 'M0,100 L64,100 L22,0'],
    '8': [62, 'A31,76,26,24,0,360|A31,27,31,27,0,360'],
    '9': [64, 'M12,0 L61,55|A32,68,32,32,0,360'],
    // ---------------- Satz- und Sonderzeichen ----------------
    '.': [0, 'D0,0'],
    ',': [6, 'D6,0|M6,0 L0,-16'],
    ':': [0, 'D0,0|D0,52'],
    ';': [6, 'D6,52|D6,0|M6,0 L0,-16'],
    '!': [0, 'M0,100 L0,28|D0,0'],
    '?': [58, 'A28,74,28,26,160,-80 L32,30|D32,0'],
    '-': [36, 'M0,40 L36,40'],
    '–': [60, 'M0,40 L60,40'],
    '—': [96, 'M0,40 L96,40'],
    '_': [70, 'M0,-20 L70,-20'],
    '+': [60, 'M0,44 L60,44|M30,14 L30,74'],
    '=': [56, 'M0,30 L56,30|M0,58 L56,58'],
    '/': [50, 'M0,0 L50,100'],
    '\\': [50, 'M0,100 L50,0'],
    '|': [0, 'M0,-12 L0,108'],
    '(': [18, 'A42,40,42,72,125,235'],
    ')': [18, 'A-24,40,42,72,55,-55'],
    '[': [18, 'M18,106 L0,106 L0,-12 L18,-12'],
    ']': [18, 'M0,106 L18,106 L18,-12 L0,-12'],
    '<': [56, 'M56,82 L0,50 L56,18'],
    '>': [56, 'M0,82 L56,50 L0,18'],
    '^': [44, 'M0,62 L22,100 L44,62'],
    '"': [20, 'M0,100 L0,72|M20,100 L20,72'],
    "'": [0, 'M0,100 L0,72'],
    '“': [20, 'M0,100 L0,72|M20,100 L20,72'],
    '”': [20, 'M0,100 L0,72|M20,100 L20,72'],
    '„': [26, 'D6,0|M6,0 L0,-16|D26,0|M26,0 L20,-16'],
    '‘': [0, 'M0,100 L0,72'],
    '’': [0, 'M0,100 L0,72'],
    '‚': [6, 'D6,0|M6,0 L0,-16'],
    '·': [0, 'D0,48'],
    '•': [0, 'D0,48'],
    '*': [44, 'M22,100 L22,60|M4,90 L40,70|M4,70 L40,90'],
    '#': [76, 'M22,0 L32,100|M50,0 L60,100|M6,34 L72,34|M10,66 L76,66'],
    '%': [72, 'A14,82,14,18,0,360|A58,18,14,18,0,360|M8,0 L64,100'],
    '&': [66, 'M66,0 L18.7,63.9 A30,78,16,20,225,-45 L9.6,41 A28,24,26,24,135,380 L66,46'],
    '@': [80, 'A40,44,15,15,0,360|M55,59 L55,36 A64,36,9,9,180,360 L73,44 A40,44,33,40,0,320'],
    '€': [70, 'A50,50,44,50,45,315|M0,60 L60,60|M0,40 L54,40'],
    '$': [64, 'A33,75,29,25,35,270 A32,25,32,25,90,-145|M33,-12 L33,112'],
    '°': [24, 'A12,88,12,12,0,360'],
    '×': [44, 'M0,20 L44,64|M0,64 L44,20'],
    '§': [52, 'A26,82,22,16,20,250 L30,48 A26,34,24,14,90,-90 A26,34,24,14,90,270|M26,20 A26,18,22,16,90,-160'],
    '~': [56, 'A14,46,14,10,180,0 A42,46,14,10,180,360']
  };
  // Akzente (Mittelpunkt x=0), getrennt für Klein- (lc) und Großbuchstaben (uc).
  const ACC = {
    acute: { lc: 'M-6,82 L8,98', uc: 'M-6,110 L8,126' },
    grave: { lc: 'M-8,98 L6,82', uc: 'M-8,126 L6,110' },
    circ: { lc: 'M-14,82 L0,98 L14,82', uc: 'M-14,110 L0,126 L14,110' },
    diaer: { lc: 'D-13,90|D13,90', uc: 'D-14,118|D14,118' },
    tilde: { lc: 'M-16,86 L-6,94 L6,86 L16,94', uc: 'M-16,114 L-6,122 L6,114 L16,122' },
    ring: { lc: 'A0,92,8,8,0,360', uc: 'A0,120,8,8,0,360' },
    cedil: { lc: 'M2,0 L-4,-22', uc: 'M2,0 L-4,-22' }
  };
  // Zusammengesetzte Zeichen: Grundzeichen + Akzent (auf die Skelettmitte gesetzt).
  const COMP = {
    'Ä': ['A', 'diaer'], 'Ö': ['O', 'diaer'], 'Ü': ['U', 'diaer'], 'ä': ['a', 'diaer'], 'ö': ['o', 'diaer'], 'ü': ['u', 'diaer'],
    'Á': ['A', 'acute'], 'À': ['A', 'grave'], 'Â': ['A', 'circ'], 'Ã': ['A', 'tilde'], 'Å': ['A', 'ring'],
    'á': ['a', 'acute'], 'à': ['a', 'grave'], 'â': ['a', 'circ'], 'ã': ['a', 'tilde'], 'å': ['a', 'ring'],
    'É': ['E', 'acute'], 'È': ['E', 'grave'], 'Ê': ['E', 'circ'], 'Ë': ['E', 'diaer'],
    'é': ['e', 'acute'], 'è': ['e', 'grave'], 'ê': ['e', 'circ'], 'ë': ['e', 'diaer'],
    'Í': ['I', 'acute'], 'Ì': ['I', 'grave'], 'Î': ['I', 'circ'], 'Ï': ['I', 'diaer'],
    'í': ['ı', 'acute'], 'ì': ['ı', 'grave'], 'î': ['ı', 'circ'], 'ï': ['ı', 'diaer'],
    'Ó': ['O', 'acute'], 'Ò': ['O', 'grave'], 'Ô': ['O', 'circ'], 'Õ': ['O', 'tilde'],
    'ó': ['o', 'acute'], 'ò': ['o', 'grave'], 'ô': ['o', 'circ'], 'õ': ['o', 'tilde'],
    'Ú': ['U', 'acute'], 'Ù': ['U', 'grave'], 'Û': ['U', 'circ'],
    'ú': ['u', 'acute'], 'ù': ['u', 'grave'], 'û': ['u', 'circ'],
    'Ñ': ['N', 'tilde'], 'ñ': ['n', 'tilde'], 'Ç': ['C', 'cedil'], 'ç': ['c', 'cedil'], 'ẞ': ['S', null]
  };
  const LOWER = /[a-zäöüßıáàâãåéèêëíìîïóòôõúùûñç]/;

  // Befehlsfolge eines Strichs zerlegen -> [{t:'L',x,y} | {t:'A',…} | {t:'D',x,y}]
  function parseCmds(s, dx) {
    dx = dx || 0;
    const strokes = [];
    String(s).split('|').forEach(part => {
      const items = [];
      part.trim().split(/\s+/).forEach(tok => {
        if (!tok) return;
        const c = tok[0], v = tok.slice(1).split(',').map(Number);
        if (c === 'M' || c === 'L') items.push({ t: c === 'M' && !items.length ? 'M' : 'L', x: v[0] + dx, y: v[1] });
        else if (c === 'A') items.push({ t: 'A', cx: v[0] + dx, cy: v[1], rx: v[2], ry: v[3], a0: v[4], a1: v[5] });
        else if (c === 'D') items.push({ t: 'D', x: v[0] + dx, y: v[1] });
      });
      if (items.length) strokes.push(items);
    });
    return strokes;
  }
  // Skelett eines Zeichens: { w, lc, strokes } oder null (Zeichen fehlt).
  const skelCache = {};
  function skeleton(ch) {
    if (ch in skelCache) return skelCache[ch];
    let r = null;
    if (G[ch]) r = { w: G[ch][0], lc: LOWER.test(ch), strokes: parseCmds(G[ch][1]) };
    else if (COMP[ch] && G[COMP[ch][0]]) {
      const base = G[COMP[ch][0]], lc = LOWER.test(ch), acc = COMP[ch][1] && ACC[COMP[ch][1]];
      const strokes = parseCmds(base[1]);
      if (acc) parseCmds(lc ? acc.lc : acc.uc, base[0] / 2).forEach(s => strokes.push(s));
      r = { w: base[0], lc, strokes };
    }
    skelCache[ch] = r;
    return r;
  }
  function hasSkeleton(ch) { return !!skeleton(ch); }

  // Eingebaute Schriftarten = Skelett + Stilwerte. Stärke/Serifen in % der Höhe,
  // damit die Schriftart bei jeder Höhe gleich aussieht. Alle Werte bleiben im
  // Reiter danach frei einstellbar.
  const PRESETS = [
    { id: 'grotesk', name: 'Grotesk', p: { weightPct: 12, caps: 'flat', join: 'miter', square: 0, width: 100, slant: 0, xh: 70, serif: false } },
    { id: 'grotesk_fett', name: 'Grotesk fett', p: { weightPct: 20, caps: 'flat', join: 'miter', square: 0, width: 104, slant: 0, xh: 70, serif: false } },
    { id: 'rund', name: 'Rund (abgerundete Enden)', p: { weightPct: 15, caps: 'round', join: 'round', square: 0, width: 100, slant: 0, xh: 70, serif: false } },
    { id: 'block', name: 'Block (eckig)', p: { weightPct: 16, caps: 'flat', join: 'miter', square: 80, width: 100, slant: 0, xh: 72, serif: false } },
    { id: 'schmal', name: 'Schmal', p: { weightPct: 12, caps: 'flat', join: 'miter', square: 20, width: 72, slant: 0, xh: 72, serif: false } },
    { id: 'breit', name: 'Breit', p: { weightPct: 16, caps: 'flat', join: 'miter', square: 40, width: 130, slant: 0, xh: 68, serif: false } },
    { id: 'slab', name: 'Serifen (Slab)', p: { weightPct: 13, caps: 'flat', join: 'miter', square: 0, width: 100, slant: 0, xh: 68, serif: true, serifLenPct: 7, serifThkPct: 9 } },
    { id: 'kursiv', name: 'Kursiv', p: { weightPct: 12, caps: 'flat', join: 'miter', square: 0, width: 96, slant: 12, xh: 70, serif: false } },
    { id: 'schablone', name: 'Schablone (offene Innenformen)', p: { weightPct: 17, caps: 'flat', join: 'miter', square: 30, width: 100, slant: 0, xh: 70, serif: false, holes: 'gap' } }
  ];

  // ======================================================================
  //  2) TrueType / OpenType (glyf, CFF, TTC)
  // ======================================================================
  // Umrisse als Befehlsliste je Kontur (flaches Array):
  //   0,x,y  Start · 1,x,y  Linie · 2,cx,cy,x,y  quadratisch · 3,c1x,c1y,c2x,c2y,x,y  kubisch
  const tagAt = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  function fontCount(buf) {
    const dv = new DataView(buf);
    return dv.byteLength > 12 && tagAt(dv, 0) === 'ttcf' ? dv.getUint32(8) : 1;
  }
  function parseFont(buf, index) {
    const dv = new DataView(buf);
    let base = 0;
    if (tagAt(dv, 0) === 'ttcf') {
      const n = dv.getUint32(8), i = Math.max(0, Math.min(n - 1, index || 0));
      base = dv.getUint32(12 + 4 * i);
    }
    const sig = tagAt(dv, base);
    if (dv.getUint32(base) !== 0x00010000 && sig !== 'OTTO' && sig !== 'true')
      throw new Error('Keine TrueType-/OpenType-Schrift (WOFF bitte vorher entpacken).');
    const nt = dv.getUint16(base + 4), tb = {};
    for (let i = 0; i < nt; i++) { const r = base + 12 + 16 * i; tb[tagAt(dv, r)] = { o: dv.getUint32(r + 8), l: dv.getUint32(r + 12) }; }
    if (!tb.head || !tb.hhea || !tb.maxp || !tb.cmap || !tb.hmtx) throw new Error('Schriftdatei unvollständig (Tabellen fehlen).');
    const u8 = o => dv.getUint8(o), u16 = o => dv.getUint16(o), i16 = o => dv.getInt16(o), u32 = o => dv.getUint32(o);
    const upm = u16(tb.head.o + 18), locFmt = i16(tb.head.o + 50);
    const asc = i16(tb.hhea.o + 4), desc = i16(tb.hhea.o + 6), nHM = u16(tb.hhea.o + 34);
    const nGlyphs = u16(tb.maxp.o + 4);
    // --- Name ---
    let name = '', family = '', style = '';
    if (tb.name) {
      const t = tb.name.o, cnt = u16(t + 2), so = t + u16(t + 4);
      const read = (pid, off, len) => {
        let s = '';
        if (pid === 3 || pid === 0) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(u16(so + off + k));
        else for (let k = 0; k < len; k++) s += String.fromCharCode(u8(so + off + k));
        return s;
      };
      const pick = id => {
        let best = '', bestScore = -1;
        for (let i = 0; i < cnt; i++) {
          const r = t + 6 + 12 * i, pid = u16(r), lang = u16(r + 4), nid = u16(r + 6);
          if (nid !== id) continue;
          const sc = (pid === 3 ? 4 : pid === 0 ? 3 : 1) + ((pid === 3 && (lang === 0x409 || lang === 0x407)) ? 2 : 0);
          if (sc > bestScore) { bestScore = sc; best = read(pid, u16(r + 10), u16(r + 8)); }
        }
        return best;
      };
      family = pick(16) || pick(1); style = pick(17) || pick(2); name = pick(4) || (family + (style ? ' ' + style : ''));
    }
    // --- Metriken ---
    let capH = 0, xH = 0;
    if (tb['OS/2'] && tb['OS/2'].l >= 90 && u16(tb['OS/2'].o) >= 2) { xH = i16(tb['OS/2'].o + 86); capH = i16(tb['OS/2'].o + 88); }
    // --- Vorschub ---
    const advOf = g => u16(tb.hmtx.o + 4 * Math.min(g, nHM - 1));
    // --- cmap ---
    const cm = tb.cmap.o, ncm = u16(cm + 2);
    let sub4 = -1, sub12 = -1, symbol = false;
    for (let i = 0; i < ncm; i++) {
      const r = cm + 4 + 8 * i, pid = u16(r), eid = u16(r + 2), so = cm + u32(r + 4), fmt = u16(so);
      if (fmt === 12 && (pid === 3 && eid === 10 || pid === 0)) sub12 = so;
      if (fmt === 4 && (pid === 3 && (eid === 1 || eid === 0) || pid === 0)) { if (sub4 < 0 || (pid === 3 && eid === 1)) { sub4 = so; symbol = pid === 3 && eid === 0; } }
    }
    function gidOf(c) {
      if (sub12 >= 0) {
        const n = u32(sub12 + 12);
        let lo = 0, hi = n - 1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1, r = sub12 + 16 + 12 * m, s = u32(r), e = u32(r + 4);
          if (c < s) hi = m - 1; else if (c > e) lo = m + 1; else return u32(r + 8) + (c - s);
        }
        if (sub4 < 0) return 0;
      }
      if (sub4 < 0) return 0;
      if (symbol && c < 0x100) c += 0xF000;
      const segX2 = u16(sub4 + 6), ends = sub4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        if (c > u16(ends + s)) continue;
        const st = u16(starts + s); if (c < st) return 0;
        const ro = u16(ros + s), dl = i16(deltas + s);
        if (!ro) return (c + dl) & 0xFFFF;
        const g = u16(ros + s + ro + 2 * (c - st));
        return g ? (g + dl) & 0xFFFF : 0;
      }
      return 0;
    }
    // --- Kerning (alte kern-Tabelle, Format 0) ---
    const kernMap = new Map();
    if (tb.kern) {
      const k = tb.kern.o;
      if (u16(k) === 0) {
        let p = k + 4; const n = u16(k + 2);
        for (let t = 0; t < n && p < k + tb.kern.l; t++) {
          const len = u16(p + 2), cov = u16(p + 4);
          if ((cov >> 8) === 0 && (cov & 1)) {
            const np = u16(p + 6);
            for (let i = 0; i < np; i++) { const r = p + 14 + 6 * i; kernMap.set(u16(r) * 65536 + u16(r + 2), i16(r + 4)); }
          }
          p += len || 6;
        }
      }
    }
    // --- Umrisse ---
    let outline;
    if (tb.glyf && tb.loca) {
      const locaOff = g => locFmt ? u32(tb.loca.o + 4 * g) : u16(tb.loca.o + 2 * g) * 2;
      outline = function glyf(gid, depth) {
        if (gid < 0 || gid >= nGlyphs || (depth || 0) > 6) return [];
        const o0 = locaOff(gid), o1 = locaOff(gid + 1);
        if (o1 <= o0) return [];
        const p = tb.glyf.o + o0, nc = i16(p);
        if (nc >= 0) {
          const ends = []; for (let i = 0; i < nc; i++) ends.push(u16(p + 10 + 2 * i));
          const nPts = nc ? ends[nc - 1] + 1 : 0;
          let q = p + 10 + 2 * nc; q += 2 + u16(q);
          const fl = new Uint8Array(nPts);
          for (let i = 0; i < nPts;) { const f = u8(q++); fl[i++] = f; if (f & 8) { let r = u8(q++); while (r-- > 0 && i < nPts) fl[i++] = f; } }
          const xs = new Array(nPts), ys = new Array(nPts);
          let v = 0;
          for (let i = 0; i < nPts; i++) { const f = fl[i]; if (f & 2) { const d = u8(q++); v += (f & 16) ? d : -d; } else if (!(f & 16)) { v += i16(q); q += 2; } xs[i] = v; }
          v = 0;
          for (let i = 0; i < nPts; i++) { const f = fl[i]; if (f & 4) { const d = u8(q++); v += (f & 32) ? d : -d; } else if (!(f & 32)) { v += i16(q); q += 2; } ys[i] = v; }
          const out = []; let s = 0;
          for (let c = 0; c < nc; c++) {
            const pts = [];
            for (let i = s; i <= ends[c]; i++) pts.push({ x: xs[i], y: ys[i], on: !!(fl[i] & 1) });
            s = ends[c] + 1;
            const cc = quadContour(pts); if (cc) out.push(cc);
          }
          return out;
        }
        // Zusammengesetztes Zeichen
        const out = []; let q = p + 10, more = true;
        while (more) {
          const f = u16(q), g = u16(q + 2); q += 4;
          let dx = 0, dy = 0;
          if (f & 1) { if (f & 2) { dx = i16(q); dy = i16(q + 2); } q += 4; }
          else { if (f & 2) { dx = dv.getInt8(q); dy = dv.getInt8(q + 1); } q += 2; }
          let a = 1, b = 0, c = 0, d = 1;
          const f2 = o => dv.getInt16(o) / 16384;
          if (f & 8) { a = d = f2(q); q += 2; }
          else if (f & 0x40) { a = f2(q); d = f2(q + 2); q += 4; }
          else if (f & 0x80) { a = f2(q); b = f2(q + 2); c = f2(q + 4); d = f2(q + 6); q += 8; }
          glyf(g, (depth || 0) + 1).forEach(cn => out.push(xformContour(cn, a, b, c, d, dx, dy)));
          more = !!(f & 0x20);
        }
        return out;
      };
    } else if (tb['CFF ']) {
      outline = cffReader(dv, tb['CFF '].o, nGlyphs);
    } else throw new Error('Schrift ohne unterstützte Umrisse (glyf/CFF). CFF2-/Farb-Schriften werden nicht unterstützt.');
    // Ersatz-Metriken aus den Umrissen (H bzw. x), falls OS/2 sie nicht liefert.
    const yMaxOf = ch => {
      const g = gidOf(ch.charCodeAt(0)); let m = 0;
      if (g > 0) outline(g).forEach(cn => {
        for (let i = 0; i < cn.length;) { const n = cn[i] === 3 ? 3 : cn[i] === 2 ? 2 : 1; for (let k = 0; k < n; k++) m = Math.max(m, cn[i + 2 + 2 * k]); i += 1 + 2 * n; }
      });
      return m;
    };
    if (!(capH > 0)) capH = yMaxOf('H') || Math.round(upm * 0.7);
    if (!(xH > 0)) xH = yMaxOf('x') || Math.round(capH * 0.7);
    const cache = new Map();
    return {
      kind: 'ttf', name: (name || 'Schrift').trim(), family: (family || name || 'Schrift').trim(), style: (style || '').trim(),
      upm, asc, desc, capH, xH,
      has(ch) { const c = ch.codePointAt(0); return c === 32 || gidOf(c) > 0; },
      glyph(ch) {
        if (cache.has(ch)) return cache.get(ch);
        const g = gidOf(ch.codePointAt(0));
        const r = (g > 0 || ch === ' ') ? { adv: advOf(g), contours: g > 0 ? outline(g) : [], gid: g } : null;
        cache.set(ch, r); return r;
      },
      kern(a, b) {
        if (!kernMap.size) return 0;
        const ga = gidOf(a.codePointAt(0)), gb = gidOf(b.codePointAt(0));
        return kernMap.get(ga * 65536 + gb) || 0;
      }
    };
  }
  function xformContour(cn, a, b, c, d, dx, dy) {
    const o = [];
    for (let i = 0; i < cn.length;) {
      const op = cn[i]; o.push(op);
      const n = op === 3 ? 3 : op === 2 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const x = cn[i + 1 + 2 * k], y = cn[i + 2 + 2 * k];
        o.push(a * x + c * y + dx, b * x + d * y + dy);
      }
      i += 1 + 2 * n;
    }
    return o;
  }
  // TrueType-Kontur (on/off-Punkte, quadratisch) -> Befehlsliste.
  function quadContour(pts) {
    const n = pts.length; if (n < 2) return null;
    let s = -1; for (let i = 0; i < n; i++) if (pts[i].on) { s = i; break; }
    let seq, start;
    if (s < 0) { start = { x: (pts[n - 1].x + pts[0].x) / 2, y: (pts[n - 1].y + pts[0].y) / 2 }; seq = pts.slice(); }
    else { start = pts[s]; seq = pts.slice(s + 1).concat(pts.slice(0, s)); }
    const out = [0, start.x, start.y];
    let ctrl = null;
    seq.concat([{ x: start.x, y: start.y, on: true }]).forEach(p => {
      if (p.on) { if (ctrl) { out.push(2, ctrl.x, ctrl.y, p.x, p.y); ctrl = null; } else out.push(1, p.x, p.y); }
      else { if (ctrl) { const mx = (ctrl.x + p.x) / 2, my = (ctrl.y + p.y) / 2; out.push(2, ctrl.x, ctrl.y, mx, my); } ctrl = p; }
    });
    return out;
  }

  // ---------- CFF (Type-2-Charstrings) ----------
  function cffReader(dv, o0, nGlyphs) {
    const u8 = o => dv.getUint8(o), u16 = o => dv.getUint16(o);
    const offN = (o, sz) => { let v = 0; for (let i = 0; i < sz; i++) v = v * 256 + u8(o + i); return v; };
    // INDEX lesen -> { items: [[start,end]], end }
    function index(o) {
      const cnt = u16(o);
      if (!cnt) return { items: [], end: o + 2 };
      const osz = u8(o + 2), base = o + 3 + (cnt + 1) * osz - 1, items = [];
      for (let i = 0; i < cnt; i++) items.push([base + offN(o + 3 + i * osz, osz), base + offN(o + 3 + (i + 1) * osz, osz)]);
      return { items, end: base + offN(o + 3 + cnt * osz, osz) };
    }
    function dict(s, e) {
      const d = {}; let ops = [];
      let p = s;
      while (p < e) {
        const b = u8(p);
        if (b <= 21) {
          let key = b; p++;
          if (b === 12) { key = 1200 + u8(p); p++; }
          d[key] = ops; ops = [];
        } else if (b === 28) { ops.push(dv.getInt16(p + 1)); p += 3; }
        else if (b === 29) { ops.push(dv.getInt32(p + 1)); p += 5; }
        else if (b === 30) {
          let str = ''; p++;
          const nib = '0123456789.EE?-';
          for (;;) {
            const v = u8(p++), hi = v >> 4, lo = v & 15;
            if (hi === 15) break; str += hi === 12 ? 'E-' : nib[hi];
            if (lo === 15) break; str += lo === 12 ? 'E-' : nib[lo];
          }
          ops.push(parseFloat(str) || 0);
        } else if (b >= 32 && b <= 246) { ops.push(b - 139); p++; }
        else if (b >= 247 && b <= 250) { ops.push((b - 247) * 256 + u8(p + 1) + 108); p += 2; }
        else if (b >= 251 && b <= 254) { ops.push(-(b - 251) * 256 - u8(p + 1) - 108); p += 2; }
        else p++;
      }
      return d;
    }
    const hdrSize = u8(o0 + 2);
    const nameIdx = index(o0 + hdrSize);
    const topIdx = index(nameIdx.end);
    const strIdx = index(topIdx.end);
    const gsubrIdx = index(strIdx.end);
    if (!topIdx.items.length) throw new Error('CFF: kein Top-DICT');
    const top = dict(topIdx.items[0][0], topIdx.items[0][1]);
    const csIdx = index(o0 + (top[17] ? top[17][0] : 0));
    const bias = n => n < 1240 ? 107 : n < 33900 ? 1131 : 32768;
    const bytes = it => new Uint8Array(dv.buffer, dv.byteOffset + it[0], it[1] - it[0]);
    const gsubrs = gsubrIdx.items.map(bytes), gBias = bias(gsubrs.length);
    function privSubrs(pr) {
      if (!pr || pr.length < 2) return [];
      const po = o0 + pr[1], pd = dict(po, po + pr[0]);
      return pd[19] ? index(po + pd[19][0]).items.map(bytes) : [];
    }
    let fdSubrs = null, fdSel = null;
    if (top[1236] && top[1237]) {        // CID-Schrift: FDArray + FDSelect
      const fda = index(o0 + top[1236][0]);
      fdSubrs = fda.items.map(it => privSubrs(dict(it[0], it[1])[18]));
      const fo = o0 + top[1237][0], fmt = u8(fo);
      fdSel = new Uint8Array(nGlyphs);
      if (fmt === 0) for (let g = 0; g < nGlyphs; g++) fdSel[g] = u8(fo + 1 + g);
      else if (fmt === 3) {
        const nr = u16(fo + 1);
        for (let r = 0; r < nr; r++) {
          const a = u16(fo + 3 + 3 * r), fd = u8(fo + 5 + 3 * r), b = u16(fo + 6 + 3 * r);
          for (let g = a; g < b && g < nGlyphs; g++) fdSel[g] = fd;
        }
      }
    }
    const lsubrsDefault = privSubrs(top[18]);
    const csBytes = csIdx.items.map(bytes);
    return function cff(gid) {
      if (gid < 0 || gid >= csBytes.length) return [];
      const lsubrs = fdSubrs ? (fdSubrs[fdSel[gid]] || []) : lsubrsDefault, lBias = bias(lsubrs.length);
      const contours = []; let cur = null;
      let x = 0, y = 0, nStems = 0, haveWidth = false, st = [];
      const moveTo = (nx, ny) => { if (cur && cur.length > 3) contours.push(cur); cur = [0, nx, ny]; x = nx; y = ny; };
      const lineTo = (nx, ny) => { if (!cur) moveTo(x, y); cur.push(1, nx, ny); x = nx; y = ny; };
      const curveTo = (a, b, c, d, nx, ny) => { if (!cur) moveTo(x, y); cur.push(3, a, b, c, d, nx, ny); x = nx; y = ny; };
      const stems = () => { if (st.length % 2 && !haveWidth) st.shift(); nStems += st.length >> 1; st = []; haveWidth = true; };
      const width = n => { if (st.length > n && !haveWidth) st.shift(); haveWidth = true; };
      let done = false, depth = 0;
      function run(code) {
        if (++depth > 20) return;
        let i = 0;
        while (i < code.length && !done) {
          const v = code[i++];
          if (v >= 32) {
            if (v <= 246) st.push(v - 139);
            else if (v <= 250) st.push((v - 247) * 256 + code[i++] + 108);
            else if (v <= 254) st.push(-(v - 251) * 256 - code[i++] - 108);
            else { const n = (code[i] << 24) | (code[i + 1] << 16) | (code[i + 2] << 8) | code[i + 3]; i += 4; st.push(n / 65536); }
            continue;
          }
          let c1x, c1y, c2x, c2y;
          switch (v) {
            case 1: case 3: case 18: case 23: stems(); break;
            case 19: case 20: stems(); i += (nStems + 7) >> 3; break;
            case 4: width(1); moveTo(x, y + st.pop()); st = []; break;
            case 22: width(1); moveTo(x + st.pop(), y); st = []; break;
            case 21: width(2); { const dy = st.pop(), dx = st.pop(); moveTo(x + dx, y + dy); } st = []; break;
            case 5: for (let k = 0; k + 1 < st.length; k += 2) lineTo(x + st[k], y + st[k + 1]); st = []; break;
            case 6: case 7: {
              let h = v === 6;
              for (let k = 0; k < st.length; k++) { if (h) lineTo(x + st[k], y); else lineTo(x, y + st[k]); h = !h; }
              st = []; break;
            }
            case 8: for (let k = 0; k + 5 < st.length; k += 6) { c1x = x + st[k]; c1y = y + st[k + 1]; c2x = c1x + st[k + 2]; c2y = c1y + st[k + 3]; curveTo(c1x, c1y, c2x, c2y, c2x + st[k + 4], c2y + st[k + 5]); } st = []; break;
            case 24: {
              let k = 0;
              for (; k + 7 < st.length; k += 6) { c1x = x + st[k]; c1y = y + st[k + 1]; c2x = c1x + st[k + 2]; c2y = c1y + st[k + 3]; curveTo(c1x, c1y, c2x, c2y, c2x + st[k + 4], c2y + st[k + 5]); }
              lineTo(x + st[k], y + st[k + 1]); st = []; break;
            }
            case 25: {
              let k = 0;
              for (; k + 7 < st.length; k += 2) lineTo(x + st[k], y + st[k + 1]);
              c1x = x + st[k]; c1y = y + st[k + 1]; c2x = c1x + st[k + 2]; c2y = c1y + st[k + 3]; curveTo(c1x, c1y, c2x, c2y, c2x + st[k + 4], c2y + st[k + 5]);
              st = []; break;
            }
            case 26: {
              let k = 0; if (st.length % 2) x += st[k++];
              for (; k + 3 < st.length; k += 4) { c1x = x; c1y = y + st[k]; c2x = c1x + st[k + 1]; c2y = c1y + st[k + 2]; curveTo(c1x, c1y, c2x, c2y, c2x, c2y + st[k + 3]); }
              st = []; break;
            }
            case 27: {
              let k = 0; if (st.length % 2) y += st[k++];
              for (; k + 3 < st.length; k += 4) { c1x = x + st[k]; c1y = y; c2x = c1x + st[k + 1]; c2y = c1y + st[k + 2]; curveTo(c1x, c1y, c2x, c2y, c2x + st[k + 3], c2y); }
              st = []; break;
            }
            case 30: case 31: {
              let h = v === 31, k = 0;
              while (k + 3 < st.length) {
                const last = (st.length - k) === 5;
                if (h) { c1x = x + st[k]; c1y = y; c2x = c1x + st[k + 1]; c2y = c1y + st[k + 2]; curveTo(c1x, c1y, c2x, c2y, c2x + (last ? st[k + 4] : 0), c2y + st[k + 3]); }
                else { c1x = x; c1y = y + st[k]; c2x = c1x + st[k + 1]; c2y = c1y + st[k + 2]; curveTo(c1x, c1y, c2x, c2y, c2x + st[k + 3], c2y + (last ? st[k + 4] : 0)); }
                k += last ? 5 : 4; h = !h;
              }
              st = []; break;
            }
            case 10: { const idx = st.pop() + lBias; if (lsubrs[idx]) run(lsubrs[idx]); break; }
            case 29: { const idx = st.pop() + gBias; if (gsubrs[idx]) run(gsubrs[idx]); break; }
            case 11: depth--; return;
            case 14: width(0); if (cur && cur.length > 3) contours.push(cur); cur = null; done = true; break;
            case 28: st.push(((code[i] << 24) >> 16) | code[i + 1]); i += 2; break;
            case 12: {
              const e = code[i++];
              if (e === 35) {                          // flex
                const a = st; curveTo(x + a[0], y + a[1], x + a[0] + a[2], y + a[1] + a[3], x + a[0] + a[2] + a[4], y + a[1] + a[3] + a[5]);
                curveTo(x + a[6], y + a[7], x + a[6] + a[8], y + a[7] + a[9], x + a[6] + a[8] + a[10], y + a[7] + a[9] + a[11]);
              } else if (e === 34) {                   // hflex
                const a = st, y0 = y;
                c1x = x + a[0]; c1y = y; c2x = c1x + a[1]; c2y = c1y + a[2]; curveTo(c1x, c1y, c2x, c2y, c2x + a[3], c2y);
                c1x = x + a[4]; c1y = c2y; c2x = c1x + a[5]; c2y = y0; curveTo(c1x, c1y, c2x, c2y, c2x + a[6], y0);
              } else if (e === 36) {                   // hflex1
                const a = st, y0 = y;
                c1x = x + a[0]; c1y = y + a[1]; c2x = c1x + a[2]; c2y = c1y + a[3]; curveTo(c1x, c1y, c2x, c2y, c2x + a[4], c2y);
                c1x = x + a[5]; c1y = c2y; c2x = c1x + a[6]; c2y = c1y + a[7]; curveTo(c1x, c1y, c2x, c2y, c2x + a[8], y0);
              } else if (e === 37) {                   // flex1
                const a = st, x0 = x, y0 = y;
                let sx = 0, sy = 0; for (let k = 0; k < 10; k += 2) { sx += a[k]; sy += a[k + 1]; }
                c1x = x + a[0]; c1y = y + a[1]; c2x = c1x + a[2]; c2y = c1y + a[3]; curveTo(c1x, c1y, c2x, c2y, c2x + a[4], c2y + a[5]);
                c1x = x + a[6]; c1y = y + a[7]; c2x = c1x + a[8]; c2y = c1y + a[9];
                if (Math.abs(sx) > Math.abs(sy)) curveTo(c1x, c1y, c2x, c2y, c2x + a[10], y0);
                else curveTo(c1x, c1y, c2x, c2y, x0, c2y + a[10]);
              }
              st = []; break;
            }
            default: st = [];
          }
        }
        depth--;
      }
      run(csBytes[gid]);
      if (cur && cur.length > 3) contours.push(cur);
      return contours;
    };
  }

  // ---------- Gespeicherte Schrift (Teilmenge, im Projekt / in der Bibliothek) ----------
  // { name, upm, asc, desc, capH, xH, glyphs:{ch:{a, p:[kontur…]}}, kern:{'AV':-80} }
  const CHARSET = (() => {
    let s = '';
    for (let c = 32; c < 127; c++) s += String.fromCharCode(c);
    for (let c = 160; c < 256; c++) s += String.fromCharCode(c);
    return s + '€–—‘’‚“”„•…™ẞ';
  })();
  const round1 = v => Math.round(v * 10) / 10;
  function storeFont(f, chars) {
    const glyphs = {}, list = Array.from(new Set(Array.from(chars || CHARSET)));
    list.forEach(ch => {
      const g = f.glyph(ch); if (!g) return;
      glyphs[ch] = { a: g.adv, p: g.contours.map(cn => cn.map(round1)) };
    });
    const kern = {};
    if (f.kern) {
      const ks = list.filter(ch => glyphs[ch] && ch !== ' ');
      if (ks.length <= 260) ks.forEach(a => ks.forEach(b => { const v = f.kern(a, b); if (v) kern[a + b] = v; }));
    }
    return { name: f.name, family: f.family, style: f.style, upm: f.upm, asc: f.asc, desc: f.desc, capH: f.capH, xH: f.xH, glyphs, kern };
  }
  function fromStored(s) {
    if (!s || !s.glyphs) return null;
    return {
      kind: 'ttf', stored: true, name: s.name || 'Schrift', family: s.family || s.name, style: s.style || '',
      upm: s.upm || 1000, asc: s.asc || 800, desc: s.desc || -200, capH: s.capH || 700, xH: s.xH || 500,
      has(ch) { return !!s.glyphs[ch]; },
      glyph(ch) { const g = s.glyphs[ch]; return g ? { adv: g.a, contours: g.p } : null; },
      kern(a, b) { return (s.kern && s.kern[a + b]) || 0; },
      data: s
    };
  }

  window.SchriftFonts = { XH, skeleton, hasSkeleton, PRESETS, parseFont, fontCount, storeFont, fromStored, CHARSET };
})();
