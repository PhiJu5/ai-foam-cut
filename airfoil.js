/* airfoil.js — Profilerzeugung, .dat-Import, Resampling
 * Ein Profil ist ein Array von Punkten {x,y}, normiert auf Sehne 0..1,
 * geordnet von Hinterkante (TE) über die Oberseite zur Vorderkante (LE)
 * und über die Unterseite zurück zur TE (Selig-Format).
 */
(function (global) {
  'use strict';

  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  // ---- NACA 4-stellig -------------------------------------------------
  // z.B. "2412" -> 2% Wölbung bei 40% Sehne, 12% Dicke
  function naca4(code, n) {
    n = n || 120;
    code = String(code).padStart(4, '0');
    const m = parseInt(code[0], 10) / 100;      // max camber
    const p = parseInt(code[1], 10) / 10;       // pos of max camber
    const t = parseInt(code.slice(2), 10) / 100; // thickness
    const pts = [];
    // Kosinus-Verteilung: dicht an LE und TE
    // Dickenverteilung mit GESCHLOSSENER Endleiste: der letzte Koeffizient ist
    // -0.1036 statt -0.1015 (Standard-Variante "closed TE"). Damit ist die
    // Endleistendicke des Standardprofils exakt 0 — offene ELs entstehen nur
    // noch bewusst über den Profil-Editor bzw. die Rippen-Endleistendicke.
    function thick(x) {
      return 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x -
        0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
    }
    function camber(x) {
      if (m === 0 || p === 0) return { yc: 0, dy: 0 };
      let yc, dy;
      if (x < p) {
        yc = (m / (p * p)) * (2 * p * x - x * x);
        dy = (2 * m / (p * p)) * (p - x);
      } else {
        yc = (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x);
        dy = (2 * m / ((1 - p) * (1 - p))) * (p - x);
      }
      return { yc, dy };
    }
    // Oberseite TE->LE
    for (let i = 0; i <= n; i++) {
      const beta = Math.PI * i / n;             // 0..pi
      const x = (1 - Math.cos(beta)) / 2;        // 0..1 kosinusverdichtet
      const yt = thick(x);
      const { yc, dy } = camber(x);
      const th = Math.atan(dy);
      pts.push({ x: x - yt * Math.sin(th), y: yc + yt * Math.cos(th) });
    }
    const upper = pts.slice().reverse();         // LE..TE oben -> reverse -> TE..LE
    // Unterseite LE->TE
    const lower = [];
    for (let i = 0; i <= n; i++) {
      const beta = Math.PI * i / n;
      const x = (1 - Math.cos(beta)) / 2;
      const yt = thick(x);
      const { yc, dy } = camber(x);
      const th = Math.atan(dy);
      lower.push({ x: x + yt * Math.sin(th), y: yc - yt * Math.cos(th) });
    }
    // Zusammensetzen: TE(ob) -> LE -> TE(unt), LE-Duplikat entfernen
    const out = upper.concat(lower.slice(1));
    out.name = 'NACA ' + code;
    return normalize(out);
  }

  // ---- .bez Parser (Bézier-Profil, z. B. aus Profil-Editoren) ---------
  // Format:  Name / "Top Start" / Kontrollpunkte x y / "Top End" /
  //          "Bottom Start" / Kontrollpunkte / "Bottom End".
  // Jede Seite ist EINE Bézier-Kurve vom Grad (n-1) über alle Kontrollpunkte
  // (LE -> TE). Die Kurven werden mit Kosinus-Verteilung abgetastet und als
  // Selig-Kontur (TE oben -> LE -> TE unten) zurückgegeben.
  const BEZ_SAMPLES = 120;
  function isBezText(text) { return /^\s*Top\s+Start\s*$/mi.test(text) && /^\s*Bottom\s+Start\s*$/mi.test(text); }
  function bezierEval(cp, t) {
    // De Casteljau
    const P = cp.map(q => ({ x: q.x, y: q.y }));
    for (let k = P.length - 1; k > 0; k--)
      for (let i = 0; i < k; i++) P[i] = { x: P[i].x + (P[i + 1].x - P[i].x) * t, y: P[i].y + (P[i + 1].y - P[i].y) * t };
    return P[0];
  }
  function parseBez(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let name = 'Profil', side = null; const top = [], bot = [];
    for (const ln of lines) {
      if (/^Top\s+Start$/i.test(ln)) { side = top; continue; }
      if (/^Bottom\s+Start$/i.test(ln)) { side = bot; continue; }
      if (/^(Top|Bottom)\s+End$/i.test(ln)) { side = null; continue; }
      const parts = ln.split(/[\s,;]+/).map(Number).filter(v => !isNaN(v));
      if (side && parts.length >= 2 && /^[-+.\d]/.test(ln)) side.push({ x: parts[0], y: parts[1] });
      else if (!side && !top.length && !bot.length) name = ln;
    }
    if (top.length < 2 || bot.length < 2) throw new Error(T('Keine gültigen Bézier-Kontrollpunkte gefunden.'));
    const sample = cp => { const out = []; for (let i = 0; i <= BEZ_SAMPLES; i++) { const t = 0.5 - 0.5 * Math.cos(Math.PI * i / BEZ_SAMPLES); out.push(bezierEval(cp, t)); } return out; };
    const up = sample(top), lo = sample(bot);   // je LE -> TE
    const pts = up.slice().reverse().concat(lo.slice(1));
    pts.name = name;
    return normalize(pts);
  }

  // ---- .dat Parser (Selig & Lednicer) --------------------------------
  function parseDat(text) {
    if (isBezText(text)) return parseBez(text);
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let name = 'Profil';
    const nums = [];
    for (const ln of lines) {
      const m = ln.match(/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+[-+]?\d*\.?\d+/);
      if (m) {
        const parts = ln.split(/[\s,]+/).map(Number).filter(v => !isNaN(v));
        if (parts.length >= 2) nums.push({ x: parts[0], y: parts[1] });
      } else if (!nums.length) {
        name = ln; // erste Nicht-Zahl-Zeile = Name
      }
    }
    if (nums.length < 5) throw new Error(T('Keine gültigen Profilpunkte gefunden.'));

    // Lednicer-Format erkennen: 2. Zeile enthält zwei Zählwerte (>1, <1 nötig)
    let pts = nums;
    const first = nums[0];
    if (first.x > 1.001 && first.y > 1.001) {
      // Header-Zeile mit Punktzahlen -> Lednicer
      const nu = Math.round(first.x), nl = Math.round(first.y);
      const body = nums.slice(1);
      const up = body.slice(0, nu);        // LE->TE oben
      const lo = body.slice(nu, nu + nl);  // LE->TE unten
      const upperTEtoLE = up.slice().reverse();
      pts = upperTEtoLE.concat(lo.slice(1));
    }
    pts = pts.map(p => ({ x: p.x, y: p.y }));
    pts.name = name;
    return normalize(pts);
  }

  /* ---- Kanonisieren --------------------------------------------------
   * Bringt beliebige Punktlisten in echte Selig-Reihenfolge:
   *   TE(oben) -> Oberseite -> LE -> Unterseite -> TE(unten)
   * Robust gegen: umgekehrte Laufrichtung (Unterseite zuerst), doppelte
   * LE-/TE-Punkte, Listen die an der LE beginnen (statt an der TE),
   * und fehlerhaft erkannte Lednicer-Header.
   * Wird VOR dem Normalisieren angewandt — sonst trifft die LE-Erkennung
   * den falschen Punkt und das Profil wird beim Drehen verzerrt.
   */
  function canonicalize(pts) {
    let P = dedupe(pts, 1e-9);
    const n = P.length;

    // Startet die Liste an der LE statt an der TE? (beide Enden ~gleich weit
    // vorne, Mitte weit hinten) -> um die Hälfte rotieren.
    const distFirstLast = Math.hypot(P[0].x - P[n - 1].x, P[0].y - P[n - 1].y);
    const spanX = Math.max.apply(null, P.map(p => p.x)) - Math.min.apply(null, P.map(p => p.x));
    const midIdx = Math.floor(n / 2);
    const endMeanX = (P[0].x + P[n - 1].x) / 2;
    if (distFirstLast < 0.05 * spanX && P[midIdx].x < endMeanX) {
      // geschlossene Kontur, die an der TE beginnt -> ok. Sonst: an LE begonnen
    } else if (distFirstLast < 0.05 * spanX && P[midIdx].x > endMeanX) {
      const cut = midIdx;
      P = P.slice(cut).concat(P.slice(0, cut + 1));
    }

    // TE = Mittel der beiden Endpunkte; LE = Punkt mit größtem Abstand zur TE
    const te = { x: (P[0].x + P[P.length - 1].x) / 2, y: (P[0].y + P[P.length - 1].y) / 2 };
    let iLE = 0, dmax = -1;
    for (let i = 0; i < P.length; i++) {
      const d = Math.hypot(P[i].x - te.x, P[i].y - te.y);
      if (d > dmax) { dmax = d; iLE = i; }
    }

    // Laufrichtung prüfen: liegt der erste Ast (TE->LE) im Mittel ÜBER der
    // Sehne? Wenn nicht, ist die Liste andersherum -> umdrehen.
    // Normale so wählen, dass sie nach OBEN zeigt: für chordDir = LE-TE = (-1,0)
    // (Standardlage) muss n = (0,+1) herauskommen, sonst dreht der Test jedes
    // korrekte Selig-Profil um und der Schnitt liefe unten zuerst.
    const chordDir = { x: (P[iLE].x - te.x), y: (P[iLE].y - te.y) };
    const cl = Math.hypot(chordDir.x, chordDir.y) || 1;
    const nx = chordDir.y / cl, ny = -chordDir.x / cl;  // Normale zur Sehne, nach oben
    let side = 0;
    for (let i = 0; i <= iLE; i++)
      side += (P[i].x - te.x) * nx + (P[i].y - te.y) * ny;
    if (side < 0) {                       // erster Ast liegt unten -> spiegeln
      P = P.slice().reverse();
      iLE = P.length - 1 - iLE;
    }
    const out = P.map(p => ({ x: p.x, y: p.y }));
    out.name = pts.name;
    return out;
  }

  // ---- Normalisieren: LE bei x=0, TE bei x=1, Sehne = 1 --------------
  function normalize(raw) {
    const pts = canonicalize(raw);
    // TE = Mittel aus erstem und letztem Punkt (nach Kanonisierung sicher)
    const te = { x: (pts[0].x + pts[pts.length - 1].x) / 2,
                 y: (pts[0].y + pts[pts.length - 1].y) / 2 };
    // LE = Punkt mit größtem Abstand zur TE (robuster als min-x)
    let iLE = 0, dmax = -1;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - te.x, pts[i].y - te.y);
      if (d > dmax) { dmax = d; iLE = i; }
    }
    const le = pts[iLE];
    const chord = Math.hypot(te.x - le.x, te.y - le.y) || 1;
    const ang = Math.atan2(te.y - le.y, te.x - le.x); // Sehne horizontal drehen
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    const out = pts.map(p => {
      const dx = p.x - le.x, dy = p.y - le.y;
      return { x: (dx * ca - dy * sa) / chord, y: (dx * sa + dy * ca) / chord };
    });
    out.name = pts.name || 'Profil';
    return out;
  }

  // aufeinanderfolgende (fast) gleiche Punkte entfernen
  function dedupe(pts, eps) {
    eps = eps || 1e-7;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++)
      if (Math.hypot(pts[i].x - out[out.length - 1].x, pts[i].y - out[out.length - 1].y) > eps)
        out.push(pts[i]);
    return out;
  }

  // Nicht-uniforme (chordale) Catmull-Rom-Auswertung (Barry–Goldman).
  function crPoint(P0, P1, P2, P3, t0, t1, t2, t3, t) {
    const lp = (a, b, ta, tb) => { const w = (t - ta) / ((tb - ta) || 1);
      return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w }; };
    const A1 = lp(P0, P1, t0, t1), A2 = lp(P1, P2, t1, t2), A3 = lp(P2, P3, t2, t3);
    const B1 = lp(A1, A2, t0, t2), B2 = lp(A2, A3, t1, t3);
    return lp(B1, B2, t1, t2);
  }

  // ---- Resampling: Spline + Cosinus-Verdichtung an LE/TE -------------
  // Erzeugt exakt n Punkte in Selig-Reihenfolge (TE→Oberseite→LE→Unterseite→TE).
  // - Spline (Catmull-Rom) statt linear -> saubere, runde Nasenleiste auch bei
  //   grob aufgelösten .dat-Dateien.
  // - Cosinus-Verdichtung -> viele Punkte an Nase & Endleiste.
  // - LE-Index ist DETERMINISTISCH (Nu-1) und damit für alle Profile gleich,
  //   sodass Wurzel & Rand punktweise synchron bleiben.
  // - Die oberen/unteren TE-Endpunkte bleiben exakt erhalten -> offene
  //   (stumpfe) Endleisten bleiben offen.
  function resample(pts, n) {
    const P = dedupe(pts);
    const m = P.length;
    const knots = [0];
    for (let i = 1; i < m; i++)
      knots.push(knots[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
    const T = knots[m - 1] || 1;

    // LE = vorderster Punkt (min x)
    let iLE = 0;
    for (let i = 1; i < m; i++) if (P[i].x < P[iLE].x) iLE = i;
    const sLE = knots[iLE];

    const evalAt = (s) => {
      if (s <= 0) return { x: P[0].x, y: P[0].y };
      if (s >= T) return { x: P[m - 1].x, y: P[m - 1].y };
      let i = 0;
      while (i < m - 2 && knots[i + 1] < s) i++;
      const P1 = P[i], P2 = P[i + 1];
      const P0 = i > 0 ? P[i - 1] : P[0];
      const P3 = i + 2 < m ? P[i + 2] : P[m - 1];
      const t1 = knots[i], t2 = knots[i + 1];
      const t0 = i > 0 ? knots[i - 1] : t1 - (t2 - t1 || 1);
      const t3 = i + 2 < m ? knots[i + 2] : t2 + (t2 - t1 || 1);
      return crPoint(P0, P1, P2, P3, t0, t1, t2, t3, s);
    };

    const Nu = Math.ceil(n / 2);       // Punkte TE->LE (inkl. beider Enden)
    const Nl = n - Nu + 1;             // Punkte LE->TE (LE geteilt)
    const out = [];
    for (let i = 0; i < Nu; i++) {     // Oberseite: TE (s=0) .. LE (s=sLE)
      const c = (1 - Math.cos(Math.PI * i / (Nu - 1))) / 2;
      out.push(evalAt(c * sLE));
    }
    for (let j = 1; j < Nl; j++) {     // Unterseite: LE .. TE (s=T)
      const c = (1 - Math.cos(Math.PI * j / (Nl - 1))) / 2;
      out.push(evalAt(sLE + c * (T - sLE)));
    }
    out.name = pts.name;
    return out;                         // out.length === n, LE bei Index Nu-1
  }

  // Dicke in % (max) — Info fürs UI
  function maxThickness(pts) {
    // Ober/Unterseite grob über x-Buckets
    let tmax = 0;
    const half = Math.floor(pts.length / 2);
    for (let i = 0; i < half; i++) {
      const a = pts[i], b = pts[pts.length - 1 - i];
      tmax = Math.max(tmax, Math.abs(a.y - b.y));
    }
    return tmax;
  }

  global.Airfoil = { naca4, parseDat, parseBez, isBezText, normalize, resample, maxThickness };
})(window);
