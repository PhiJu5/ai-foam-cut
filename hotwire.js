/* hotwire.js — Projektion der Blockprofile auf die beiden Turmebenen
 * eines 4-Achs-Heißdrahtschneiders und G-Code-Erzeugung.
 *
 * Maschine (Draufsicht auf Z-Achse = Spannweite):
 *   Linker Turm  bei Z = 0            -> Achsen (X, Y)
 *   Rechter Turm bei Z = machineWidth -> Achsen (A, V)  (Namen konfigurierbar)
 *
 * Der Draht ist die gerade Verbindung zwischen einem Punkt am linken und
 * einem am rechten Turm. Für jeden synchronen Punktindex i verlängern wir
 * die Linie Wurzel_i -> Rand_i bis auf beide Turmebenen (lineare Extra-/
 * Interpolation über Z). So schneidet der Draht exakt durch beide Profile.
 */
(function (global) {
  'use strict';

  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  // Lineare Projektion eines Wertepaars (bei zRoot, zTip) auf Zielebene zPlane
  function proj(vRoot, vTip, zRoot, zTip, zPlane) {
    const t = (zPlane - zRoot) / ((zTip - zRoot) || 1);
    return vRoot + t * (vTip - vRoot);
  }

  function edgeNormal(a, b, dir) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    // Außennormale (nach außen zeigend) = (dy,-dx)*dir/L
    return { x: (dy) * dir / L, y: (-dx) * dir / L };
  }
  function uvec(x, y) { const L = Math.hypot(x, y) || 1; return { x: x / L, y: y / L }; }

  // Umlaufrichtung einer geschlossenen Punktfolge (+1 = CCW)
  function winding(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return area > 0 ? 1 : -1;
  }

  /* Nachbarindizes OHNE Nulllängen-Kanten.
   * Zusammenfallende aufeinanderfolgende Punkte kommen regulär vor: bei einer
   * SCHARFEN Endleiste führt trimTE die Kontur nach dem Beplankungsabzug exakt
   * am Schnittpunkt zusammen, und Airfoil.resample erhält beide Endpunkte —
   * Anfangs- und Endpunkt liegen dann aufeinander. Die Kantennormale einer
   * solchen Kante ist undefiniert (dx,dy ~ 0); ein naiver Offset verstärkt das
   * Rauschen zu einem Ausreißer ("Haken") an der Endleiste. Deshalb wird für
   * Normale/Winkel immer der nächste Nachbar mit ECHTEM Abstand benutzt.
   * Die Punktzahl bleibt unverändert -> Wurzel- und Randpfad bleiben synchron. */
  const DEGEN_EPS = 1e-9;
  function neighborIdx(pts, i, step) {
    const n = pts.length, b = pts[i];
    let k = (i + step + n) % n;
    for (let s = 0; s < n - 1; s++) {
      if (Math.hypot(pts[k].x - b.x, pts[k].y - b.y) > DEGEN_EPS) return k;
      k = (k + step + n) % n;
    }
    return k;   // alle Punkte identisch (entartet) -> Fallback
  }

  /* Findet "Stegspitzen": Ecken, an denen der Pfad um ~180° umkehrt (Spitze der
   * Nasen-X-Schlaufe). Dort ist die Winkelhalbierende undefiniert — ein naiver
   * Miter-Offset erzeugt hier einen Ausreißer; stattdessen wird eine flache Kappe
   * (kerf-breiter Schlitz) erzeugt. Die Erkennung läuft EINMAL auf der Wurzel-
   * kontur; das Ergebnis gilt für beide Türme, damit sie synchron bleiben.
   * `frontMaxX` = optionale Grenze: nur im NASENBEREICH (x < Grenze) kappen. An
   * der EL brauchen die waagrechten Stege KEINE Kappe — der reine Offset trennt
   * sie um kerf. Würde man die (bei scharfer EL koinzidente) Steg-Spitze kappen,
   * entstünde eine senkrechte Rückkante, die der Draht hoch UND zurück fährt
   * (Retrace -> Draht schmilzt ins Styropor). */
  /* Entfernt zusammenfallende Punkte SYNCHRON aus zwei gleich langen Pfaden.
   * Ein Punkt (gleicher Index in A und B) fällt, wenn er auf MINDESTENS EINEM der
   * beiden ein Segment < eps zum Vorgänger bildet. Der erste und letzte Punkt
   * bleiben immer erhalten. Rückgabe: [A', B'] mit identischer (reduzierter) Länge. */
  function dedupSync(A, B, eps) {
    const rA = [A[0]], rB = [B[0]];
    for (let i = 1; i < A.length; i++) {
      const last = A.length - 1;
      const dA = Math.hypot(A[i].x - rA[rA.length - 1].x, A[i].y - rA[rA.length - 1].y);
      const dB = Math.hypot(B[i].x - rB[rB.length - 1].x, B[i].y - rB[rB.length - 1].y);
      if (i === last || (dA >= eps && dB >= eps)) { rA.push(A[i]); rB.push(B[i]); }
      else if (A[i].seam || B[i].seam) {
        // Entfallender Nahtpunkt („von vorne"): Markierung an den behaltenen Vorgänger.
        const k = rA.length - 1;
        rA[k] = Object.assign({}, rA[k], { seam: true }); rB[k] = Object.assign({}, rB[k], { seam: true });
      }
    }
    return [rA, rB];
  }

  /* Richtungsumkehr KURZER Segmente auf den Turmbahnen auflösen. A/B = Wurzel-/
   * Randbahn (synchron), zR/zT = Rippenebenen, mw = Maschinenbreite. Geprüft
   * werden beide Türme (z=0 und z=mw): kehrt die Bahn an einem Punkt um mehr als
   * ~120° um und ist mindestens eines der beiden Segmente kürzer als maxLen, wird
   * der Endpunkt des kurzen Segments entfernt, dessen ANDERES Nachbarsegment das
   * kürzere ist (so bleibt die eigentliche Ecke, z. B. die Kern-Endleiste,
   * erhalten und nur der gehäufte Zwischenpunkt fällt). Wiederholung, bis kein
   * Zickzack mehr übrig ist. Punkte aus `protect` (Kappen-Flanken) bleiben. */
  function dezigzagTowers(A, B, zR, zT, mw, protect, maxLen) {
    maxLen = maxLen || 2.0;
    const den = (zT - zR) || 1;
    const fs = [(0 - zR) / den, (mw - zR) / den];
    const tow = (i, f) => ({ x: A[i].x + f * (B[i].x - A[i].x), y: A[i].y + f * (B[i].y - A[i].y) });
    const keep = new Set(protect || []);
    let guard = 0, changed = true;
    while (changed && guard++ < 200) {
      changed = false;
      const n = A.length;
      for (let i = 1; i < n - 1 && !changed; i++) {
        for (const f of fs) {
          const p = tow(i - 1, f), q = tow(i, f), r = tow(i + 1, f);
          const d1x = q.x - p.x, d1y = q.y - p.y, d2x = r.x - q.x, d2y = r.y - q.y;
          const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
          if (l1 < 1e-9 || l2 < 1e-9 || Math.min(l1, l2) > maxLen) continue;
          if ((d1x * d2x + d1y * d2y) / (l1 * l2) > -0.5) continue;   // keine echte Umkehr
          // Kurzes Segment: (i-1,i) wenn l1 <= l2, sonst (i,i+1). Von dessen zwei
          // Endpunkten fällt der mit dem kürzeren weiteren Nachbarsegment.
          const segLen = (a, b) => { const u = tow(a, f), v = tow(b, f); return Math.hypot(v.x - u.x, v.y - u.y); };
          let cand;
          if (l1 <= l2) cand = (i - 2 >= 0 && segLen(i - 2, i - 1) < l2) ? i - 1 : i;
          else cand = (i + 2 < n && segLen(i + 1, i + 2) < l1) ? i + 1 : i;
          if (keep.has(cand)) cand = (cand === i) ? (l1 <= l2 ? i - 1 : i + 1) : i;
          if (keep.has(cand) || cand <= 0 || cand >= n - 1) continue;
          // NUR entfernen, wenn der Punkt auf BEIDEN Rippen (praktisch) auf der
          // Sehne seiner Nachbarn liegt — die Rippenkontur also unverändert bleibt.
          // Bei starker Zuspitzung kehrt der extrapolierte FERNE Turm an der Nase
          // real um (der Draht schwenkt); das ist kein Rauschen. Ohne diese Prüfung
          // fielen dort kaskadierend alle Unterseitenpunkte hinter der Nase weg und
          // der Draht liefe von der Nasenspitze gerade in den Kern (kleine Rippen).
          const devOK = P => {
            const p = P[cand - 1], q = P[cand], r = P[cand + 1];
            const dx = r.x - p.x, dy = r.y - p.y, L = Math.hypot(dx, dy);
            if (L < 1e-9) return Math.hypot(q.x - p.x, q.y - p.y) < 0.02;
            return Math.abs((q.x - p.x) * dy - (q.y - p.y) * dx) / L < 0.02;
          };
          if (!devOK(A) || !devOK(B)) continue;
          if (A[cand].seam || B[cand].seam) {   // Nahtmarkierung („von vorne") an den Vorgänger
            A[cand - 1] = Object.assign({}, A[cand - 1], { seam: true });
            B[cand - 1] = Object.assign({}, B[cand - 1], { seam: true });
          }
          A.splice(cand, 1); B.splice(cand, 1);
          // Schutzindizes nachziehen
          const nk = new Set(); keep.forEach(k => { if (k !== cand) nk.add(k > cand ? k - 1 : k); });
          keep.clear(); nk.forEach(k => keep.add(k));
          changed = true; break;
        }
      }
    }
    A.capFlanks = keep;
    return [A, B];
  }

  function detectCaps(pts, frontMaxX) {
    const n = pts.length, caps = {};
    for (let i = 0; i < n; i++) {
      if (frontMaxX != null && pts[i].x >= frontMaxX) continue;
      const a = pts[neighborIdx(pts, i, -1)], b = pts[i], c = pts[neighborIdx(pts, i, +1)];
      const d1 = uvec(b.x - a.x, b.y - a.y), d2 = uvec(c.x - b.x, c.y - b.y);
      if (d1.x * d2.x + d1.y * d2.y < -0.985) caps[i] = true; // > ~170° Umkehr
    }
    return caps;
  }

  /* Schnittspalt-/Drahtkompensation auf den GESAMTEN Schnittpfad
   * (Kontur inkl. Verlängerungen) — der Draht schmilzt beidseitig kerf/2 weg.
   * An Stegspitzen (caps) wird statt eines Miters eine flache Kappe erzeugt:
   * der Punkt wird zu ZWEI Punkten (je eine Stegflanke), zusätzlich um `gap`
   * in Stegrichtung verlängert. Aus dem nullbreiten Steg wird so ein
   * kerf-breiter Schlitz — genau das, was der Draht real schneidet.
   */
  /* `gap` ist entweder eine Zahl (konstanter Versatz) ODER ein Array je Punkt
   * (variabler Versatz — für die geschwindigkeitsabhängige, lokal veränderliche
   * kerf-Kompensation). Die Punktzahl bleibt in beiden Fällen identisch, damit
   * Wurzel- und Randpfad synchron bleiben. */
  /* `gap` ist Zahl ODER Array je Punkt (auch mit VORZEICHEN: negativ = nach
   * innen, für die Bezugsseiten-Kompensation). Der Betrag ist der Versatz je
   * Punkt (kerf/2); die Punktzahl bleibt identisch, damit Wurzel-/Randpfad
   * synchron bleiben. */
  /* opt.deloop: lokale Schlaufen am Versatz konkaver Ecken auflösen (siehe
   * collapseLocalLoops) — die Punktzahl bleibt erhalten. */
  function offsetPath(pts, gap, caps, opt) {
    const n = pts.length;
    const arr = Array.isArray(gap);
    const gAt = i => arr ? (gap[i] || 0) : gap;
    // Konstant 0 -> reine Kopie (kein Offset). Bei einem Array wird NICHT
    // abgekürzt, damit Kappen-/Punktstruktur identisch zum Partnerpfad bleibt.
    if (!arr && !gap) { const c = pts.map(p => (p.seam ? { x: p.x, y: p.y, seam: true } : { x: p.x, y: p.y })); c.name = pts.name; return c; }
    // opt.dir: Umlaufrichtung von außen vorgeben (±1). Der komplette Schnittpfad
    // enthält die Nasen-X-Schlaufe, die im GEGENSINN umlaufen wird; bei kleinen
    // Rippen (Sehne ≲ 55 mm bei 8/12 mm Schlaufe) ist ihre Fläche größer als das
    // Profil, winding(pts) kippt und der Abbrand ginge nach INNEN. Der Aufrufer
    // gibt daher die Richtung der reinen Kernkontur vor.
    const dir = (opt && opt.dir) ? opt.dir : winding(pts);
    const out = [];
    const capFlanks = new Set();   // Ausgabe-Indizes der Kappen-Flanken (Stegschlitz)
    // Nahtmarkierung (seam, Schnittrichtung „von vorne") an die versetzten Punkte
    // weitergeben — bei einer Kappe an beide Flanken. oStart[i] = erster
    // Ausgabeindex von Punkt i (die Schleife verlässt jeden Fall per continue).
    const oStart = new Array(n + 1);
    for (let i = 0; i < n; i++) {
      oStart[i] = out.length;
      const g = gAt(i);
      // Nachbarn ohne Nulllängen-Kanten (siehe neighborIdx) — sonst liefert
      // edgeNormal an zusammenfallenden Punkten eine undefinierte Normale.
      const a = pts[neighborIdx(pts, i, -1)], b = pts[i], c = pts[neighborIdx(pts, i, +1)];
      const n1 = edgeNormal(a, b, dir), n2 = edgeNormal(b, c, dir);
      // k = lokaler Schnittspalt (kerf = 2·|gap|) am Punkt — Schlitzbreite für
      // die farbige Verteilung im Profil (vorzeichen-unabhängig).
      const kk = Math.abs(g) * 2;
      if (caps && caps[i]) {
        const d1 = uvec(b.x - a.x, b.y - a.y);      // nach außen entlang des Stegs
        capFlanks.add(out.length);
        out.push({ x: b.x + n1.x * g + d1.x * g, y: b.y + n1.y * g + d1.y * g, k: kk });
        capFlanks.add(out.length);
        out.push({ x: b.x + n2.x * g + d1.x * g, y: b.y + n2.y * g + d1.y * g, k: kk });
        continue;
      }
      let nx = n1.x + n2.x, ny = n1.y + n2.y;
      const L = Math.hypot(nx, ny);
      if (L < 1e-9) {           // entartet, aber nicht als Kappe markiert
        out.push({ x: b.x + n1.x * g, y: b.y + n1.y * g, k: kk });
        continue;
      }
      nx /= L; ny /= L;
      const cosHalf = Math.max(0.35, n1.x * nx + n1.y * ny); // Miter begrenzen
      // Variabler Versatz mit Kanten-Werten (gIn/gOut aus speedGaps): an einer
      // echten Ecke jede Kante um IHREN Abbrand versetzen und die beiden
      // versetzten Geraden schneiden. Mit einem Mischwert läge der Eckpunkt
      // sonst auf keiner der beiden Kantenparallelen (Haken in der Spur).
      if (arr && gap.gIn && gap.gOut) {
        const g1 = gap.gIn[i] || 0, g2 = gap.gOut[i] || 0;
        const dx1 = b.x - a.x, dy1 = b.y - a.y, dx2 = c.x - b.x, dy2 = c.y - b.y;
        const cr = dx1 * dy2 - dy1 * dx2;
        const sinA = Math.abs(cr) / ((Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2)) || 1e-12);
        // Nur an einer ECHTEN Ecke (> ~12°, wie CORNER_COS): bei fast parallelen
        // Kanten (glatte Kontur, z. B. Kreis, während die Gegenseite eine Ecke hat)
        // läge der Schnittpunkt weit entlang der Kante (Sprung ≈ |g1-g2|/sinA)
        // -> Zacken. Dann stattdessen Normalenversatz mit dem Mittelwert (kurze
        // Rampe über ein Segment).
        if (sinA > 0.2 && Math.abs(g1 - g2) > 1e-9) {
          const p1x = b.x + n1.x * g1, p1y = b.y + n1.y * g1;   // Punkt auf Kante-1-Parallele
          const p2x = b.x + n2.x * g2, p2y = b.y + n2.y * g2;   // Punkt auf Kante-2-Parallele
          const t = ((p2x - p1x) * dy2 - (p2y - p1y) * dx2) / cr;
          let ox = p1x + dx1 * t - b.x, oy = p1y + dy1 * t - b.y;
          const lim = Math.max(Math.abs(g1), Math.abs(g2)) / 0.35, ol = Math.hypot(ox, oy);
          if (ol > lim) { ox *= lim / ol; oy *= lim / ol; }
          out.push({ x: b.x + ox, y: b.y + oy, k: kk });
          continue;
        }
      }
      const s = g / cosHalf;
      out.push({ x: b.x + nx * s, y: b.y + ny * s, k: kk });
    }
    oStart[n] = out.length;
    for (let i = 0; i < n; i++) if (pts[i].seam) for (let k = oStart[i]; k < oStart[i + 1]; k++) out[k].seam = true;
    out.name = pts.name;
    out.capFlanks = capFlanks;   // welche Ausgabepunkte sind Kappen-Flanken
    if (opt && opt.deloop) collapseLocalLoops(out, 8);
    return out;
  }
  /* Lokale Schlaufen entfernen, die der Versatz an KONKAVEN Ecken erzeugt: dort
   * kreuzen sich die versetzten Punkte der beiden Kanten, wenn der Versatz größer
   * als der Punktabstand ist (Draht führe eine Mini-Schleife). Kreuzen sich
   * Segment i und j (j-i <= win), werden die Punkte i+1..j auf den Kreuzungspunkt
   * gelegt. Die Punktzahl bleibt erhalten (zusammenfallende Punkte werden im
   * G-Code als Nullbewegung entfernt), Wurzel-/Randpfad bleiben synchron. */
  function collapseLocalLoops(P, win) {
    const n = P.length;
    const inter = (a, b, c, d) => {
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(den) < 1e-12) return null;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
      if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };
    for (let i = 0; i < n - 1; i++) {
      for (let j = Math.min(n - 2, i + win); j >= i + 2; j--) {   // größte Schlaufe zuerst
        const X = inter(P[i], P[i + 1], P[j], P[j + 1]);
        if (!X) continue;
        for (let k = i + 1; k <= j; k++) { P[k].x = X.x; P[k].y = X.y; }
        break;
      }
    }
    return P;
  }
  // Rückwärtskompatibler Name (Offset ohne Kappen)
  function offsetOutward(pts, gap) { return offsetPath(pts, gap, null); }

  /* Beplankungs-Offset mit UNTERSCHIEDLICHER Ober-/Unterschalendicke.
   * Jeder Punkt wird nach INNEN versetzt: die Oberschale um topGap, die
   * Unterschale um botGap. Im Nasen- und Endleistenbereich (wo Ober- und
   * Unterseite zusammenlaufen) wird der Betrag stetig überblendet, damit an
   * LE/TE kein Sprung entsteht. Sind beide Werte gleich, ist das Ergebnis
   * identisch zum einfachen offsetPath(pts, -gap). Rückgabe: Kontur (offen),
   * anschließend wie beim einfachen Offset per trimTE zu bereinigen. */
  function offsetPathTB(pts, topGap, botGap) {
    topGap = topGap || 0; botGap = botGap || 0;
    if (topGap === botGap) return offsetPath(pts, -topGap, null);
    const n = pts.length;
    // Sehnenlinie über die Extrempunkte in x (Nase = min x, Endleiste = max x).
    let iLE = 0, iTE = 0;
    for (let i = 1; i < n; i++) { if (pts[i].x < pts[iLE].x) iLE = i; if (pts[i].x > pts[iTE].x) iTE = i; }
    const LE = pts[iLE], TE = pts[iTE];
    let cx = TE.x - LE.x, cy = TE.y - LE.y; const cl = Math.hypot(cx, cy) || 1; cx /= cl; cy /= cl;
    // vorzeichenbehafteter Normalabstand zur Sehne (links der Sehnenrichtung positiv)
    const perp = p => (-cy) * (p.x - LE.x) + cx * (p.y - LE.y);
    let maxD = 1e-6; const d = new Array(n);
    for (let i = 0; i < n; i++) { d[i] = perp(pts[i]); if (Math.abs(d[i]) > maxD) maxD = Math.abs(d[i]); }
    // Welche Seite ist „oben" (höheres mittleres y)?
    let sPos = 0, nPos = 0, sNeg = 0, nNeg = 0;
    for (let i = 0; i < n; i++) { if (d[i] >= 0) { sPos += pts[i].y; nPos++; } else { sNeg += pts[i].y; nNeg++; } }
    const posIsTop = (nPos ? sPos / nPos : 0) >= (nNeg ? sNeg / nNeg : 0);
    const band = 0.25 * maxD;   // Überblendzone um die Sehne (nur Nase/Endleiste sind so dünn)
    const gap = new Array(n);
    for (let i = 0; i < n; i++) {
      let sd = posIsTop ? d[i] : -d[i];       // sd>0 -> oben
      let w = 0.5 + sd / (2 * band); w = w < 0 ? 0 : w > 1 ? 1 : w;
      gap[i] = -(botGap + (topGap - botGap) * w);   // nach innen
    }
    return offsetPath(pts, gap, null);
  }

  // Schnittpunkt zweier Strecken (echt innerhalb beider), sonst null
  function segX(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;              // parallel
    const rx = p3.x - p1.x, ry = p3.y - p1.y;
    const t = (rx * d2y - ry * d2x) / den;
    const u = (rx * d1y - ry * d1x) / den;
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }

  function signedArea(P) {
    let a = 0;
    for (let i = 0; i < P.length; i++) {
      const j = (i + 1) % P.length;
      a += P[i].x * P[j].y - P[j].x * P[i].y;
    }
    return a / 2;
  }

  /* Selbstüberschneidungen entfernen ("trimmen").
   * Beim Offset nach INNEN (Beplankungsabzug) wandert die Oberseite nach
   * unten und die Unterseite nach oben. An der dünnen Endleiste laufen beide
   * übereinander hinweg — es entsteht ein „Fischschwanz" aus sich kreuzenden
   * Linien. Bei dicker Beplankung können mehrere solcher Schlaufen entstehen.
   *
   * Verfahren: Überschneidung suchen, die Kontur dort in zwei Bögen teilen
   * und den flächengrößeren behalten (der kleine ist die Schlaufe). Das wird
   * wiederholt, bis keine Kreuzung mehr übrig ist.
   */
  function trimTE(pts, maxIter) {
    let P = pts;
    let iter = 0;
    const cap = maxIter || 25;
    while (iter++ < cap) {
      const n = P.length;
      if (n < 8) break;
      let found = null;
      for (let i = 0; i < n - 1 && !found; i++) {
        for (let j = i + 2; j < n - 1; j++) {
          const X = segX(P[i], P[i + 1], P[j], P[j + 1]);
          if (X) { found = { i: i, j: j, X: X }; break; }
        }
      }
      if (!found) break;
      // Bogen A = innerer Teil (i+1..j), am Schnittpunkt geschlossen
      const A = [found.X].concat(P.slice(found.i + 1, found.j + 1), [{ x: found.X.x, y: found.X.y }]);
      // Bogen B = äußerer Teil (Anfang + Ende), über den Schnittpunkt verbunden
      const B = P.slice(0, found.i + 1).concat([found.X], P.slice(found.j + 1));
      const keep = Math.abs(signedArea(A)) >= Math.abs(signedArea(B)) ? A : B;
      if (keep.length < 8) break;      // würde die Kontur zerstören
      P = keep;
    }
    const out = P.map(p => ({ x: p.x, y: p.y }));
    out.name = pts.name;
    return out;
  }

  /* Löst Selbstüberschneidungen zweier synchroner Pfade (Wurzel A, Rand B) auf.
   * An einer Kreuzung (Kanten i und j von A schneiden sich in X) wird der Pfad
   * zu:  [0..i-1] + X + [i+1..j] + X + [j+2..]
   * d.h. die beiden „Nasen"-Punkte A[i] und A[j+1] (der doppelt besuchte,
   * kerf-versetzte Nasenpunkt) entfallen, die Kreuzung wird zum sauberen
   * Berührpunkt — die eingeschlossene Schlaufe (i+1..j) bleibt erhalten.
   * Kanten-Indizes werden auf A bestimmt und identisch auf B angewandt; die
   * Länge bleibt gleich (2 Punkte raus, 2 Schnittpunkte rein) -> Türme synchron.
   */
  /* `tiny` (mm, optional): Kreuzungen, deren eingeschlossene Schleife auf BEIDEN
   * Rippen kürzer als `tiny` ist, werden ZUSAMMENGEZOGEN (alle Punkte i+1..j auf
   * den Kreuzungspunkt) statt als Figur-8 erhalten. Das sind die parasitären
   * Mini-Schleifen des Abbrand-Versatzes an KONKAVEN Ecken (zweiter Nasenbesuch:
   * Schlaufen-Diagonale -> Unterseite), wenn der Punktabstand der Rippe kleiner
   * ist als kerf/2 (kleine Außenrippen). Bliebe die Mini-Schleife stehen, würde
   * sie vom Zickzack-Filter samt den folgenden Unterseitenpunkten entfernt und
   * der Draht liefe von der Nasenspitze gerade IN den Kern. Die echte Nasen-
   * X-Schlaufe ist um Größenordnungen länger und bleibt erhalten. */
  function uncrossSync(A, B, protect, frontMaxX, tiny) {
    // `protect` = Menge von Indizes, die zu Kappen-Schlitzen (Nasenspitze/
    // EL-Steg) gehören. Kreuzungen, die eine solche Kappe betreffen, werden
    // NICHT aufgelöst — der kerf-Schlitz bleibt erhalten (sonst läuft der Steg
    // fälschlich spitz zusammen). Die reine Nasen-X-Schlaufe (kein Kappenpunkt)
    // wird weiterhin sauber entkreuzt.
    // `frontMaxX` = optionale Grenze: nur Kreuzungen im NASENBEREICH (x < Grenze)
    // werden aufgelöst. Sonst würde eine Kreuzung an der Endleiste (z. B. bei
    // kleiner Außenrippe) einen Ausreißer auf den Wurzelpfad übertragen.
    const guarded = i => protect && (protect.has(i) || protect.has(i + 1));
    const front = frontMaxX == null ? () => true
      : (i, j) => A[i].x < frontMaxX && A[i + 1].x < frontMaxX
               && A[j].x < frontMaxX && A[j + 1].x < frontMaxX;
    for (let pass = 0; pass < 24; pass++) {
      let hit = null;
      // Kreuzung auf WURZEL ODER RAND erkennen: durch unterschiedliche Sehnen/
      // Beplankung kann eine Rippe eine Selbstüberschneidung (Haken) haben, die die
      // andere nicht hat. Nur die Wurzel zu prüfen ließ solche Rand-Haken stehen —
      // und die Rand-Rippe wird real geschnitten.
      for (let i = 1; i < A.length - 2 && !hit; i++)
        for (let j = i + 2; j < A.length - 1; j++) {
          if (guarded(i) || guarded(j) || !front(i, j)) continue;
          if (segX(A[i], A[i + 1], A[j], A[j + 1]) || segX(B[i], B[i + 1], B[j], B[j + 1])) { hit = { i, j }; break; }
        }
      if (!hit) break;
      const { i, j } = hit;
      // Fallback-Schnittpunkt (Mitte), falls nur die jeweils ANDERE Rippe kreuzt und
      // segX hier null liefert — sonst käme ein null-Punkt in den Pfad.
      const XA = segX(A[i], A[i + 1], A[j], A[j + 1]) ||
                 { x: (A[i].x + A[j + 1].x) / 2, y: (A[i].y + A[j + 1].y) / 2 };
      const XB = segX(B[i], B[i + 1], B[j], B[j + 1]) ||
                 { x: (B[i].x + B[j + 1].x) / 2, y: (B[i].y + B[j + 1].y) / 2 };
      // kerf-Kennwert der Kreuzung von den benachbarten Punkten erben.
      if (XA) XA.k = A[i].k != null ? A[i].k : (A[j + 1] && A[j + 1].k);
      XB.k = B[i].k != null ? B[i].k : (B[j + 1] && B[j + 1].k);
      if (tiny > 0) {
        const loopLen = P => { let L = 0; for (let k = i; k < j; k++) L += Math.hypot(P[k + 1].x - P[k].x, P[k + 1].y - P[k].y); return L; };
        if (loopLen(A) < tiny && loopLen(B) < tiny) {
          // Punktzahl bleibt erhalten (Nullbewegungen fallen im G-Code weg).
          for (let k = i + 1; k <= j; k++) {
            const sm = A[k].seam || B[k].seam;   // Nahtmarkierung („von vorne") erhalten
            A[k] = { x: XA.x, y: XA.y, k: XA.k }; B[k] = { x: XB.x, y: XB.y, k: XB.k };
            if (sm) { A[k].seam = true; B[k].seam = true; }
          }
          continue;
        }
      }
      A = A.slice(0, i).concat([XA], A.slice(i + 1, j + 1), [XA], A.slice(j + 2));
      B = B.slice(0, i).concat([XB], B.slice(i + 1, j + 1), [XB], B.slice(j + 2));
    }
    A.name = undefined; B.name = undefined;
    return [A, B];
  }

  /* Projektion. cfg:
   *  wing            : {root,tip,span,N}
   *  machineWidth    : Abstand der Türme (mm)
   *  blockZ          : Abstand der Wurzelebene vom Portal auf der Wurzelseite
   *                    (mm; ab linkem Turm, bei mirror=true ab rechtem Turm)
   *  mirror          : true -> Wurzel am rechten Turm (z=machineWidth), sonst am
   *                    linken (z=0). Die Zuordnung Fläche->Seite macht die App.
   *  kerf            : Schnittspalt (mm) -> halber Wert je Seite? Nein: Versatz = kerf/2
   *  Rückgabe: { left:[{x,y}], right:[{x,y}] } in Turmkoordinaten
   */
  function unit(x, y) { const L = Math.hypot(x, y) || 1; return { x: x / L, y: y / L }; }

  /* Baut aus dem ROHEN Selig-Konturarray (noch OHNE kerf!)
   *   O = [TE_o, ...Oberseite..., LE, ...Unterseite..., TE_u]
   * den vollständigen Schnittpfad als GESCHLOSSENES Polygon:
   *   (Q) -> TE_o -> Oberseite -> LE -> (P) -> Unterseite -> TE_u -> (Q)
   * mit optionaler Nasenleisten-Verlängerung P (X-Schlaufe / horizontal) und
   * Endleisten-Verlängerung Q (Steg, siehe unten).
   *
   * Wichtig: Der Pfad wird VOR der kerf-Kompensation gebaut, damit der
   * Versatz über Kontur UND Verlängerungen zusammenhängend läuft (sonst
   * bleiben die Stege unkompensiert und es entstehen Knicke am Ansatz).
   * Es wird kein Punkt doppelt abgelegt — eine nulllange Schließkante
   * würde beim Offset eine entartete Normale erzeugen.
   *
   * iLE (LE-Index) wird von Wurzel & Rand GEMEINSAM verwendet, damit die
   * Pfade beider Türme punktweise synchron bleiben.
   */
  const TE_EXT_PTS = 6;   // Punkte je Flanke der EL-Verlängerung (FEST -> Wurzel/Rand synchron)

  /* Skelettlinie (Profilmittellinie) einer Selig-Kontur.
   * Punkt i = Mitte(P[i], P[N-1-i]); i=0 liegt AN der Endleiste, wachsendes i
   * Richtung Nase. Für den EL-Steg wird die Skelettlinie des KERNS benutzt: ihre
   * Tangente an der Kern-EL halbiert den Keil, den Kern-Ober-/Unterseite dort
   * bilden — der Steg schließt damit knickfrei an. */
  function camberSkeleton(P, iLE) {
    const N = P.length, skl = [];
    for (let i = 0; i <= iLE; i++)
      skl.push({ x: (P[i].x + P[N - 1 - i].x) / 2, y: (P[i].y + P[N - 1 - i].y) / 2 });
    return skl;
  }

  /* Nach AUSSEN zeigende Tangente einer Bezugslinie L an der Endleiste.
   * L[0] liegt AN der EL, wachsender Index Richtung Nase.
   * Die Richtung kommt aus der ABLEITUNG f'(0) einer quadratischen LSQ-Anpassung
   * f(t) = a + b·t + c·t² durch die nächsten M Punkte (t = Bogenlänge ab EL).
   * Eine reine Zwei-Punkt-Differenz reißt bei S-Schlag/Reflex-Profilen (z. B.
   * FX 60-126) aus, weil die letzten Skelettpunkte dort stark gekrümmt liegen —
   * die LSQ-Anpassung mittelt das weg. */
  function outwardTangent(L) {
    const M = Math.min(6, L.length);
    if (M < 2) return { x: 1, y: 0 };
    const t = [0];
    for (let i = 1; i < M; i++)
      t.push(t[i - 1] + Math.hypot(L[i].x - L[i - 1].x, L[i].y - L[i - 1].y));
    const deriv0 = sel => {
      if (M < 3) return sel(L[0]) - sel(L[1]);   // Fallback: lineare Differenz
      let S0 = M, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
      for (let i = 0; i < M; i++) {
        const ti = t[i], t2 = ti * ti, v = sel(L[i]);
        S1 += ti; S2 += t2; S3 += t2 * ti; S4 += t2 * t2;
        T0 += v; T1 += ti * v; T2 += t2 * v;
      }
      const detM  = S0 * (S2 * S4 - S3 * S3) - S1 * (S1 * S4 - S3 * S2) + S2 * (S1 * S3 - S2 * S2);
      const detMb = S0 * (T1 * S4 - S3 * T2) - T0 * (S1 * S4 - S3 * S2) + S2 * (S1 * T2 - T1 * S2);
      return Math.abs(detM) > 1e-12 ? detMb / detM : sel(L[0]) - sel(L[1]);
    };
    // f'(0) zeigt Richtung wachsendem t (EL -> Nase) -> nach AUSSEN umkehren.
    let dir = unit(-deriv0(p => p.x), -deriv0(p => p.y));
    // Vorzeichen absichern: die Tangente muss von einem inneren Punkt WEG
    // Richtung EL zeigen (bei entarteten Anpassungen sonst umgekehrt).
    const ref = L[Math.min(2, M - 1)];
    if (dir.x * (L[0].x - ref.x) + dir.y * (L[0].y - ref.y) < 0) dir = { x: -dir.x, y: -dir.y };
    return dir;
  }

  /* y(x) entlang der Skelettlinie des Ausgangsprofils für die EL-Verlängerung.
   * INNERHALB des Profils (x <= Profil-EL) folgt die Funktion der ECHTEN Skelett-
   * linie (ihre Krümmung, lineare Interpolation der Skelettpunkte). AUSSERHALB
   * (hinter der Profil-EL) läuft sie GERADE weiter — als tangential anschließende
   * Verlängerung der Skelettlinie (Steigung = Skelett-Tangente an der EL), damit
   * sich die Verlängerung nicht weiter krümmt, sondern gerade ausläuft.
   * skl[0] liegt AN der EL (größtes x), wachsender Index Richtung Nase. */
  /* Steigung dy/dx der nach hinten zeigenden Skelettlinien-Tangente an der EL
   * eines Selig-Profils P (iLE = Nasenindex) — für die gerade, tangentiale
   * Verlängerung der Skelettlinie hinter der Endleiste (Negativschale). */
  function skelTeSlope(P, iLE) {
    const dir = outwardTangent(camberSkeleton(P, iLE));
    return Math.abs(dir.x) > 1e-9 ? dir.y / dir.x : 0;
  }
  function skelExtendYX(skl) {
    if (!skl || skl.length < 2) { const y0 = skl && skl.length ? skl[0].y : 0; return () => y0; }
    const xTE = skl[0].x, yTE = skl[0].y;
    const asc = skl.slice().reverse();               // x aufsteigend (Nase -> EL)
    const dir = outwardTangent(skl);                 // Einheits-Tangente an der EL, nach hinten
    const slope = Math.abs(dir.x) > 1e-9 ? dir.y / dir.x : 0;
    return x => {
      if (x >= xTE) return yTE + slope * (x - xTE);  // hinter der EL: gerade Tangente
      if (x <= asc[0].x) return asc[0].y;
      for (let i = 1; i < asc.length; i++) {
        if (x <= asc[i].x) {
          const t = (x - asc[i - 1].x) / ((asc[i].x - asc[i - 1].x) || 1);
          return asc[i - 1].y + t * (asc[i].y - asc[i - 1].y);
        }
      }
      return asc[asc.length - 1].y;
    };
  }

  function buildPath(O, iLE, plan) {
    const N = O.length;
    const LE = O[iLE];
    const head = O.slice(0, iLE + 1);   // TE_o -> Oberseite -> LE
    const tail = O.slice(iLE + 1);      // Unterseite -> TE_u

    // --- Nasenleiste: X-Schlaufe -------------------------------------
    // Bezugsrichtungen an der Nase: Mittellinie (Sehne) LE->TE, "vorne" =
    // davon weg, "oben" = senkrecht dazu (Richtung Oberseite).
    const teMid0 = { x: (O[0].x + O[N - 1].x) / 2, y: (O[0].y + O[N - 1].y) / 2 };
    const chordDir = unit(teMid0.x - LE.x, teMid0.y - LE.y);   // LE -> TE (nach hinten)
    const fwd = { x: -chordDir.x, y: -chordDir.y };            // nach vorne
    let   up  = { x: -chordDir.y, y:  chordDir.x };            // senkrecht, Oberseite
    // „oben" = Seite des ZUERST geschnittenen Profilzugs (head). Bei „Kopfüber"
    // (flipY) liegt head unten — dann „oben" umkehren, damit die ganze Bahn ein
    // exaktes Spiegelbild der normalen ist. Sonst liefe die Nasen-Schlaufe nach
    // dem Umdrehen auf „Einlauf oben" von der Nase aus nach OBEN statt nach unten.
    {
      const side = arr => { let s = 0; for (const p of arr) s += up.x * (p.x - LE.x) + up.y * (p.y - LE.y); return arr.length ? s / arr.length : 0; };
      if (side(head) < side(tail)) up = { x: -up.x, y: -up.y };
    }

    // Formflags (plan.shape) werden für WURZEL & RAND gemeinsam gesetzt und
    // bestimmen die Punktzahl des Pfades — nur die LÄNGEN (plan.leExt/leExt2)
    // unterscheiden sich je Turm. So bleiben beide Pfade synchron, auch
    // wenn Wurzel- und Außenverlängerung unterschiedlich lang sind.
    const sh = plan.shape || { nose: (plan.leStyle === 'x' ? 'x' : plan.leStyle === 'horizontal' ? 'horizontal' : 'none'), emitB: plan.leExt2 > 0, emitTE: plan.teExt > 0 };
    let nose = [];
    const th = (plan.leAngle || 45) * Math.PI / 180;   // Winkel ZUR Mittellinie
    const ca = Math.cos(th), sa = Math.sin(th);
    if (sh.nose === 'x') {
      // X-Schlaufe: 1) schräg vorn-unten (A), 2) parallel vor (B), 3) senkrecht
      // hoch, 4) parallel zurück, 5) schräg zurück zur Nase. Ohne B (emitB=false)
      // entfallen 2)/4) — es bleibt die reine V-Spitze [P1, P3, LE].
      // Der VERTIKALE Abstand der beiden waagrechten Linien ist 2·A·sin. Über
      // plan.leGap lässt er sich fest vorgeben — dabei bleibt der WINKEL erhalten
      // und die Diagonale A (und damit der Vorlauf A·cos) wächst/schrumpft mit dem
      // Abstand: A = leGap/(2·sin). leGap=0 -> A = plan.leExt (Abstand aus Winkel).
      const A = plan.leGap > 0 ? (plan.leGap / (2 * Math.max(sa, 1e-3))) : Math.max(plan.leExt, 1e-3);
      const d1x = ca * fwd.x - sa * up.x, d1y = ca * fwd.y - sa * up.y;   // schräg vorn-unten (Winkel θ)
      const P1 = { x: LE.x + d1x * A, y: LE.y + d1y * A };
      // Nahtstelle (seam) für die Schnittrichtung „von vorne": die vordere senk-
      // rechte Kante der Schlaufe (P2→P3 bzw. P1→P3) wird dort NICHT geschnitten —
      // die Schleife zerfällt in zwei Einläufe (P2→P1→Nase für die Oberseite,
      // P3→P4→Nase für die Unterseite), siehe frontPasses().
      if (sh.emitB) {
        const B = Math.max(plan.leExt2, 1e-3);
        const P2 = { x: P1.x + fwd.x * B,        y: P1.y + fwd.y * B, seam: true };
        const P3 = { x: P2.x + up.x * 2 * A * sa, y: P2.y + up.y * 2 * A * sa, seam: true };
        const P4 = { x: P3.x - fwd.x * B,        y: P3.y - fwd.y * B };
        nose = [P1, P2, P3, P4, { x: LE.x, y: LE.y }];
      } else {
        const P3 = { x: P1.x + up.x * 2 * A * sa, y: P1.y + up.y * 2 * A * sa, seam: true };
        P1.seam = true;
        nose = [P1, P3, { x: LE.x, y: LE.y }];
      }
    } else if (sh.nose === 'horizontal') {
      const A = Math.max(plan.leExt, 1e-3);
      nose = [{ x: LE.x + fwd.x * A, y: LE.y + fwd.y * A, seam: true }, { x: LE.x, y: LE.y }];
    } else if (sh.nose === 'eight') {
      // Liegende Acht (∞) an der Nase: die Profil-OBERSEITE geht TANGENTIAL in die
      // Acht über (der Draht läuft an der Nase senkrecht weiter), die Acht liegt in
      // Sehnenrichtung VOR der Nase (Selbstkreuzung mittig) und trifft TANGENTIAL
      // wieder auf die Profil-UNTERSEITE, wo der Schnitt weitergeht.
      // Lemniskate von Gerono, lokal u=fwd (nach vorne), v=up (Oberseite):
      //   u(t) = (1−cos t)·W/2   (0 an der Nase … W an der vordersten Spitze)
      //   v(t) = sin t·cos t·H   (±H/2, die beiden Keulen)
      // Rückwärts durchlaufen (t: 2π→0), damit der Draht die Nase nach UNTEN
      // verlässt und so knickfrei/tangential an Ober- bzw. Unterseite anschließt.
      // W = Länge (Sehnenrichtung), H = Höhe. Feste Punktzahl -> Türme synchron.
      const W = Math.max(plan.eightW || 0, 1e-3), H = Math.max(plan.eightH || 0, 1e-3);
      // Selbstkreuzung standardmäßig mittig (W/2). plan.eightCross > 0 verschiebt
      // sie HORIZONTAL nach vorne (Abstand von der Nase) — damit sie z. B. vor der
      // Blockkante liegt. Umskalierung nur der Vorwärts-Koordinate u (stückweise
      // linear, monoton), Nasen- und Vorderspitze bleiben bei 0 bzw. W; der senk-
      // rechte Nasen-Tangens bleibt erhalten (bei u=0 ist du/dt=0).
      const uc = (plan.eightCross || 0) > 0
        ? Math.max(0.05 * W, Math.min(0.95 * W, plan.eightCross)) : W / 2;
      const remap = (u) => u <= W / 2
        ? u * (uc / (W / 2))
        : uc + (u - W / 2) * ((W - uc) / (W / 2));
      const M = 44;
      for (let k = 1; k <= M; k++) {
        const t = 2 * Math.PI * (1 - k / M);
        const u = remap((1 - Math.cos(t)) * (W / 2));
        const vv = Math.sin(t) * Math.cos(t) * H;
        const q = { x: LE.x + fwd.x * u + up.x * vv, y: LE.y + fwd.y * u + up.y * vv };
        if (k === M / 2) q.seam = true;   // vorderste Spitze (t = π): Nahtstelle „von vorne"
        nose.push(q);
      }
      // k=M (t=0) liegt exakt auf der Nase -> sauberer Anschluss an die Unterseite.
    }

    // --- Endleiste: Steg hinter der Endleiste --------------------------
    // Der Konturschnitt endet an den ZWEI Kern-Endleisten-Ecken TE_o (O[0]) und
    // TE_u (O[N-1]). Der Steg läuft ausschließlich HINTER der Kern-EL — er taucht
    // NICHT nach vorne in den Bereich Kern-EL..Profil-EL (wo der Kern kleiner ist
    // als das Profil). teExt bemisst die Länge ab der PROFIL-Endleiste, damit der
    // Steg beplankungsunabhängig gleich weit heraussteht (Blockfreigang).
    let mid = [], teUpper = [];
    if (sh.emitTE) {
      const TE = Math.max(plan.teExt, 1e-3);
      const B = (plan.base && plan.base.length === N) ? plan.base : O;
      const TEo = O[0], TEu = O[N - 1];        // Kern-Endleisten-Ecken (oben/unten)
      const upper = [], lower = [];

      // ZWEI-STEG-Logik aus dem Negativschalendesign (schneidet den Kern mit
      // Beplankungsabzug beplankungsunabhängig sauber): zwei Stege, jeder auf
      // der Höhe SEINER Kern-EL-Ecke (oben TE_o.y, unten TE_u.y). Sie laufen
      // NICHT zusammen; hinten schließt eine (senkrechte) Kante. Bei scharfer
      // Kern-EL fallen beide Höhen zusammen -> Steg = Linie.
      //
      //   'horizontal' — beide Stege exakt waagrecht.
      //   'skeleton'   — beide Stege folgen der KRÜMMUNG der Skelettlinie des
      //                  AUSGANGSprofils, über die Endleiste hinaus fortgesetzt.
      //                  Der waagrechte Verlauf wird dazu um die y-Abweichung
      //                  der Skelettlinie gebogen (Anschluss bleibt bei TE_o/TE_u).
      const xTip = Math.max(B[0].x, B[N - 1].x) + TE;   // teExt hinter der Profil-EL
      let devU = () => 0, devL = () => 0;
      // Skelett-Stege bekommen die DREIFACHE Punktzahl, damit die Krümmung bei
      // S-Schlag-Profilen sauber rund aufgelöst wird (horizontal = Gerade -> Basis
      // reicht). Wurzel & Rand teilen den Stil -> gleiche Punktzahl, synchron.
      const curved = plan.teStyle === 'skeleton' || plan.teStyle === 'surface'
                  || plan.teStyle === 'surfaceUpper' || plan.teStyle === 'surfaceLower';
      const Ks = (curved ? 3 * TE_EXT_PTS : TE_EXT_PTS) + 1;
      if (plan.teStyle === 'skeleton') {
        // y(x) entlang der ECHTEN Skelettlinie des Ausgangsprofils; hinter der
        // Profil-EL gerade (tangential) fortgesetzt statt weiter gekrümmt.
        const yAt = skelExtendYX(camberSkeleton(B, iLE));
        const yu0 = yAt(TEo.x), yl0 = yAt(TEu.x);
        devU = x => yAt(x) - yu0;   // Abweichung ab der oberen EL-Ecke
        devL = x => yAt(x) - yl0;   // Abweichung ab der unteren EL-Ecke
      } else if (plan.teStyle === 'surface' || plan.teStyle === 'surfaceUpper' || plan.teStyle === 'surfaceLower') {
        // Wie 'skeleton', aber entlang der PROFILKONTUR: innerhalb des Profils der
        // echten Kontur, hinter der Profil-EL gerade (tangential) fortgesetzt.
        // Bezugslinien mit Index 0 AN der EL (größtes x), wachsender Index Richtung
        // Nase — genau die Form, die skelExtendYX erwartet.
        //   'surface'      — jeder Steg entlang SEINER eigenen Fläche (oben Ober-,
        //                    unten Unterseite).
        //   'surfaceUpper' — beide Stege parallel zur OBERSEITE (der untere folgt
        //                    der Krümmung der Oberseite, versetzt auf seine EL-Ecke).
        //   'surfaceLower' — beide Stege parallel zur UNTERSEITE.
        const upLine = B.slice(0, iLE + 1);              // TE_o -> Oberseite -> LE
        const loLine = B.slice(iLE).reverse();           // TE_u -> Unterseite -> LE
        const yUp = skelExtendYX(upLine), yLo = skelExtendYX(loLine);
        // Bezugsverlauf je Steg: eigene Fläche, oder für beide dieselbe Fläche.
        const refU = plan.teStyle === 'surfaceLower' ? yLo : yUp;
        const refL = plan.teStyle === 'surfaceUpper' ? yUp : yLo;
        const yu0 = refU(TEo.x), yl0 = refL(TEu.x);
        devU = x => refU(x) - yu0;   // Abweichung ab der oberen EL-Ecke
        devL = x => refL(x) - yl0;   // Abweichung ab der unteren EL-Ecke
      }
      for (let k = 0; k < Ks; k++) {
        const f = k / (Ks - 1);
        const xu = TEo.x + f * (xTip - TEo.x), xl = TEu.x + f * (xTip - TEu.x);
        upper.push({ x: xu, y: TEo.y + devU(xu) });
        lower.push({ x: xl, y: TEu.y + devL(xl) });
      }
      // Beide Spitzen (unterschiedliche Höhe!) bleiben erhalten — die senkrechte
      // Schließkante zwischen ihnen entsteht als Schließzug des Polygons.
      teUpper = upper.slice(1).reverse();   // obere Spitze ... vor TE_o
      mid = lower.slice(1);                  // nach TE_u ... untere Spitze
    }

    // Draht kommt hinten über den Steg an, schneidet die Oberseite zur Nase,
    // macht dort die Schlaufe und die Unterseite zurück zur Endleiste und
    // verlässt das Werkstück wieder über den Steg. teUpper steht VOR head: die
    // Schließkante Spitze->teUpper schließt den Steg, ohne die Spitze doppelt
    // abzulegen (sonst entstünde eine nulllange Kante).
    // Ohne Nasen-Schlaufe ist die Nase selbst die Nahtstelle für „von vorne".
    // Frische Punktobjekte: head/tail sind sonst dieselben Objekte wie die (Kern-)
    // Kontur des Schnitts — Markierungen dürfen nie in die Profildaten wandern.
    const out = teUpper.concat(head, nose, tail, mid)
      .map(p => (p.seam ? { x: p.x, y: p.y, seam: true } : { x: p.x, y: p.y }));
    if (!nose.length) out[teUpper.length + iLE].seam = true;
    return out;
  }

  /* Schnittrichtung „von vorne" (Nase zum Nullpunkt): die klassische Schleife
   * (obere Stegspitze → Oberseite → Nase/Schlaufe → Unterseite → untere Steg-
   * spitze) wird an der Nahtstelle VORNE an der Nase in zwei Züge geteilt, die
   * beide an der Nase beginnen und an der Endleiste enden:
   *   Zug 1 = erster Teil RÜCKWÄRTS (Einlauf → Nase → Oberseite → oberer Steg)
   *   Zug 2 = zweiter Teil vorwärts (Einlauf → Nase → Unterseite → unterer Steg)
   * Die vordere Kante der Schlaufe (zwischen den beiden Nahtpunkten) wird nicht
   * geschnitten, die Schließkante an der Endleiste wie bisher auch nicht.
   * P = Wurzelbahn (Punkte mit .seam aus buildPath; Schließpunkt wird erkannt),
   * copies = Anzahl gestapelter Kopien (je Kopie zwei Züge).
   * Rückgabe: [{ idx:[Punktindizes in Fahrtrichtung], top:bool, copy, rev }] —
   * je Kopie erst der obere, dann der untere Zug (höheres mittleres y = oben);
   * rev = idx ist der rückwärts gelesene erste Teil (für „nur Ober-/Unterseite" von
   * hinten wird er wieder umgedreht: Stegspitze → … → Nase).
   * Fehlt die Markierung (z. B. alter Punkte-Override), wird die vorderste Stelle
   * (kleinstes x) als Naht genommen; eine fast senkrechte Kante dort = Schlaufenfront. */
  function frontPasses(P, copies) {
    if (!P || P.length < 3) return [];
    let n = P.length;
    if (Math.abs(P[0].x - P[n - 1].x) < 1e-6 && Math.abs(P[0].y - P[n - 1].y) < 1e-6) n--;   // Schließpunkt
    const cnt = Math.max(1, copies | 0), per = cnt > 1 ? Math.round(n / cnt) : n;
    const res = [];
    for (let c = 0; c < cnt; c++) {
      const a = c * per, b = c === cnt - 1 ? n - 1 : (c + 1) * per - 1;
      if (b - a < 2) continue;
      const tagged = [];
      for (let k = a; k <= b; k++) if (P[k].seam) tagged.push(k);
      let s1, s2;
      if (tagged.length) { s1 = tagged[0]; s2 = tagged[tagged.length - 1]; }
      else {
        let k0 = a;
        for (let k = a + 1; k <= b; k++) if (P[k].x < P[k0].x) k0 = k;
        s1 = s2 = k0;
        for (const j of [k0 - 1, k0 + 1]) {
          if (j < a || j > b) continue;
          const dx = Math.abs(P[j].x - P[k0].x), dy = Math.abs(P[j].y - P[k0].y);
          if (dy > 0.05 && dx < 0.1 * dy) { s1 = Math.min(j, k0); s2 = Math.max(j, k0); break; }
        }
      }
      const p1 = [], p2 = [];
      for (let k = s1; k >= a; k--) p1.push(k);
      for (let k = s2; k <= b; k++) p2.push(k);
      const meanY = idx => { let s = 0; idx.forEach(k => { s += P[k].y; }); return idx.length ? s / idx.length : 0; };
      const t1 = meanY(p1) >= meanY(p2);
      // rev = Zug ist der RÜCKWÄRTS gelesene erste Teil (von hinten fährt er vorwärts).
      const A = { idx: t1 ? p1 : p2, top: true, copy: c, rev: t1 }, B = { idx: t1 ? p2 : p1, top: false, copy: c, rev: !t1 };
      if (A.idx.length >= 2) res.push(A);
      if (B.idx.length >= 2) res.push(B);
    }
    return res;
  }

  function project(cfg) {
    const w = cfg.wing;
    // mirror=true: Wurzel- und Randebene werden am RECHTEN Turm gemessen
    // (Z = machineWidth), blockZ ist der Abstand ab dem rechten Portal, der Kern
    // liegt End-für-End getauscht. Ohne mirror: Wurzel am linken Turm (z=0).
    // Welche Fläche (rechts/links) auf welche Seite kommt, entscheidet die App.
    const zRoot = cfg.mirror ? (cfg.machineWidth - cfg.blockZ) : cfg.blockZ;
    const zTip = cfg.mirror ? (cfg.machineWidth - cfg.blockZ - w.span) : (cfg.blockZ + w.span);
    // Schnittspalt (kerf): bei Trapez-/komplexen Flächen läuft der Draht auf der
    // längeren Seite schneller (schmaler Spalt) und auf der kürzeren langsamer
    // (breiterer Abbrand). Zwei Modi (cfg.kerfMode):
    //   'ratio' : ein kerf je Rippe aus dem Profillängen-Verhältnis
    //             (kerfRoot/kerfTip, in app.js vorberechnet).
    //   'speed' : lokal je Schnittsegment aus der absoluten Bahngeschwindigkeit
    //             (zwischen zwei Stützpunkten) interpoliert -> variabler Versatz.
    // gapR/gapT sind dann Zahl ODER Array je Punkt (siehe offsetPath).
    const kScalarR = ((cfg.kerfRoot != null ? cfg.kerfRoot : cfg.kerf) || 0) / 2;
    const kScalarT = ((cfg.kerfTip != null ? cfg.kerfTip : cfg.kerf) || 0) / 2;

    // Gemeinsamer LE-Index. Airfoil.resample legt den LE deterministisch auf
    // ceil(n/2)-1 — damit splitten Wurzel & Rand garantiert an derselben Stelle.
    const iLE = Math.ceil(w.root.pts.length / 2) - 1;

    // Verlängerungslängen getrennt für Wurzel und Rand. Die Formflags (shape)
    // stammen aus der WURZEL und gelten für beide Türme, damit die Pfade
    // synchron (gleiche Punktzahl) bleiben — nur die Längen unterscheiden sich.
    const leStyle = cfg.leStyle || 'none', teStyle = cfg.teStyle || 'horizontal';
    const rA = cfg.leExt || 0, rB = cfg.leExt2 || 0, rTE = cfg.teExt || 0;
    const tA = cfg.leExtTip != null ? cfg.leExtTip : rA;
    const tB = cfg.leExt2Tip != null ? cfg.leExt2Tip : rB;
    const tTE = cfg.teExtTip != null ? cfg.teExtTip : rTE;
    const eightW = cfg.eightW || 0, eightH = cfg.eightH || 0, eightCross = cfg.eightCross || 0;
    const shape = {
      nose: (leStyle === 'eight' && eightW > 0 && eightH > 0) ? 'eight'
          : (leStyle === 'x' && rA > 0) ? 'x'
          : (leStyle === 'horizontal' && rA > 0) ? 'horizontal' : 'none',
      emitB: (leStyle === 'x' && rA > 0 && rB > 0),
      emitTE: (rTE > 0)
    };
    const leAngle = cfg.leAngle || 0;
    const leGap = cfg.leGap || 0;   // fester vertikaler Abstand der horizontalen X-Linien (0 = aus Winkel)
    // base = Basisprofil OHNE Beplankungsabzug. Der EL-Steg folgt der
    // Skelettlinie des ECHTEN Profils (siehe buildPath) — sie ist an der
    // Endleiste nicht durch das Trimmen abgeschnitten.
    const rootPlan = { leAngle, leGap, teStyle, leExt: rA, leExt2: rB, teExt: rTE, shape, base: w.root.pts, eightW, eightH, eightCross };
    const tipPlan  = { leAngle, leGap, teStyle, leExt: tA, leExt2: tB, teExt: tTE, shape, base: w.tip.pts, eightW, eightH, eightCross };

    // 0) Beplankung abziehen: der Schaumkern muss um die Beplankungsdicke
    //    kleiner sein als das fertige Profil (Offset nach INNEN).
    //    An der Endleiste entstehende Überschneidungen werden getrimmt.
    //    Danach zurück auf N Punkte: das Trimmen entfernt bei Wurzel und Rand
    //    unterschiedlich viele Punkte — ohne Resampling würden die beiden
    //    Turmbahnen entkoppeln und der LE-Index nicht mehr stimmen.
    // Beplankung: entweder ein Skalar (gleichmäßig) ODER ein Objekt
    // { root:{top,bot}, tip:{top,bot} } für unterschiedliche Ober-/Unterschalen-
    // und Wurzel-/Randdicken (aus dem Tragflächendesigner).
    const sh = cfg.sheeting || 0;
    const NP = w.root.pts.length;
    let rootCore = w.root.pts, tipCore = w.tip.pts;
    if (sh && typeof sh === 'object') {
      const r = sh.root || {}, t = sh.tip || {};
      const any = (r.top || r.bot || t.top || t.bot);
      if (any) {
        rootCore = Airfoil.resample(trimTE(offsetPathTB(w.root.pts, r.top || 0, r.bot || 0)), NP);
        tipCore  = Airfoil.resample(trimTE(offsetPathTB(w.tip.pts,  t.top || 0, t.bot || 0)), NP);
      }
    } else if (sh > 0) {
      rootCore = Airfoil.resample(trimTE(offsetPath(w.root.pts, -sh, null)), NP);
      tipCore  = Airfoil.resample(trimTE(offsetPath(w.tip.pts, -sh, null)), NP);
    }

    // 1) Vollständigen Schnittpfad bauen (Kern + Verlängerungen), roh.
    let rootRaw = buildPath(rootCore, iLE, rootPlan);
    let tipRaw = buildPath(tipCore, iLE, tipPlan);

    // 1b) Zusammenfallende Punkte (< 0,05 mm) SYNCHRON entfernen. Die Cosinus-
    //     Verdichtung legt an der (scharfen) Endleiste extrem dichte Punkte ab;
    //     nach dem kerf-Offset entstünde dort ein Mini-Zacken (Draht zuckt und
    //     schmilzt). Ein Punkt fällt, wenn er auf MINDESTENS EINEM Turm ein
    //     Nulllängen-Segment bildet — auf beiden Türmen am gleichen Index -> die
    //     Pfade bleiben punktgleich und synchron.
    [rootRaw, tipRaw] = dedupSync(rootRaw, tipRaw, 0.05);

    // Nasenbereichs-Grenze = Mitte zwischen Nase (min x) und Kern-Endleiste
    // (max x). NUR vor dieser Grenze wird gekappt/entkreuzt (Nasen-X-Schlaufe);
    // an der Endleiste trennt der reine Offset die waagrechten Stege sauber.
    const xLE = Math.min(rootCore[iLE].x, tipCore[iLE].x);
    const xTEc = Math.max(rootCore[0].x, rootCore[NP - 1].x, tipCore[0].x, tipCore[NP - 1].x);
    const frontMaxX = xLE + 0.55 * (xTEc - xLE);

    // 2) Kappen an ~180°-Umkehrungen NUR im Nasenbereich (X-Schlaufe). EINMAL auf
    //    der Wurzel bestimmt, für beide Türme verwendet -> synchron.
    const caps = detectCaps(rootRaw, frontMaxX);

    // 3) kerf auf den GESAMTEN Pfad anwenden (Wurzel/Rand getrennt).
    let gapR = kScalarR, gapT = kScalarT;
    let kerfInfo = { mode: 'ratio', root: kScalarR * 2, tip: kScalarT * 2 };
    if (cfg.kerfMode === 'speed' && cfg.kerfCal) {
      const sg = speedGaps(rootRaw, tipRaw, cfg.kerfCal);
      gapR = sg.gapR; gapT = sg.gapT; kerfInfo = sg.info;
    }
    // Versatz IMMER symmetrisch nach außen -> der Kern bleibt beidseitig auf
    // Nennmaß (der kerf geht nie zulasten des Kerns, nur der Schalen).
    // Umlaufrichtung aus der KERNKONTUR (nicht aus dem Pfad mit Schlaufe, s. offsetPath).
    let rootC = offsetPath(rootRaw, gapR, caps, { dir: winding(rootCore) });
    let tipC = offsetPath(tipRaw, gapT, caps, { dir: winding(tipCore) });
    // Bezugsseite (Schalen-Passung): reine VERTIKALE Verschiebung des Schnitts um
    // den kerf, so dass die gewählte Schale exakt auf der Nennkontur liegt (an den
    // Fügestellen kerf-unabhängig). Der Kern (Form) bleibt unverändert, er wandert
    // nur um den kerf im Block; die Gegenschale trägt den Verlust. Verschiebung je
    // Rippe (Wurzel/Rand) mit dem jeweiligen kerf; Verlängerungen wandern mit ->
    // saubere Spur ohne Haken/schiefe Stege.
    const datum = cfg.kerfDatum === 'top' ? 1 : cfg.kerfDatum === 'bottom' ? -1 : 0;
    kerfInfo.datum = cfg.kerfDatum || 'sym';
    let dyR = 0, dyT = 0;
    if (datum) {
      const kR = (cfg.kerfRoot != null ? cfg.kerfRoot : (cfg.kerf || 0));
      const kT = (cfg.kerfTip  != null ? cfg.kerfTip  : (cfg.kerf || 0));
      dyR = -datum * kR; dyT = -datum * kT;   // top -> nach unten, bottom -> nach oben
      rootC.forEach(p => { p.y += dyR; }); tipC.forEach(p => { p.y += dyT; });
      kerfInfo.shift = { root: dyR, tip: dyT };
    }

    // 3b) Nasen-X-Schlaufe: an der doppelt besuchten Nasenspitze erzeugt der
    //     kerf-Versatz eine kleine Selbstüberschneidung („Haken"). Sie wird
    //     sauber aufgelöst — die Kreuzung wird zum Berührpunkt, die beiden
    //     Nasen-Versatzpunkte entfallen. Die Kreuzungsindizes werden EINMAL auf
    //     der Wurzel bestimmt und identisch auf Wurzel & Rand angewandt, damit
    //     beide Turmbahnen exakt gleich viele Punkte behalten.
    //     Die Kappen-Schlitze (Nasenspitze/EL-Steg) werden dabei geschützt,
    //     damit die Stege nicht spitz zusammenlaufen.
    // NUR wenn eine Nasen-X-Schlaufe existiert (deren doppelt besuchte Spitze den
    // Haken erzeugt), und NUR im Nasenbereich (vor der Kern-Endleiste). Ohne diese
    // Begrenzung überträgt eine Rand-Kreuzung an der Endleiste (kleinere Außen-
    // rippe) einen Ausreißer auf den Wurzelpfad („vor auf einen Punkt und zurück").
    if (shape.nose === 'x') {
      // Mini-Schleifen (< ~2,5·kerf) zusammenziehen — aber nie die echte
      // X-Schlaufe: Schwelle auf die halbe Schlaufenlänge (Wurzel/Rand) begrenzen.
      const loopLen = (A, B) => { const a = Math.max(A, 1e-3); return 2 * a + 2 * (B || 0) + 2 * a * Math.sin((leAngle || 45) * Math.PI / 180); };
      const tiny = Math.min(2.5 * Math.max(kScalarR, kScalarT) * 2 + 0.5,
                            0.5 * Math.min(loopLen(rA, shape.emitB ? rB : 0), loopLen(tA, shape.emitB ? tB : 0)));
      [rootC, tipC] = uncrossSync(rootC, tipC, rootC.capFlanks, frontMaxX, tiny);
    }

    // 3b2) Nasen-X-Schlaufe: den doppelt besuchten Nasenpunkt (Anfang UND Ende der
    //     Schlaufe) auf GENAU EINEN Punkt zusammenführen. Der kerf-Versatz legt die
    //     beiden Besuche sonst mit unterschiedlichen Normalen leicht auseinander
    //     (bei flachem Winkel/langer Verlängerung KREUZEN sie sich nicht ->
    //     uncrossSync greift nicht, es bleibt eine kleine Lücke). Der Zielpunkt ist
    //     die Nasenspitze der OFFSET-Kontur (Kernkontur um kerf/2 nach außen, an der
    //     Nase über die Winkelhalbierende der beiden Oberflächenkanten) — so liegt
    //     der Punkt in x UND y exakt AUF dem Profiloffset, nicht davor. Wirkt für
    //     alle Beplankungsstärken.
    if (shape.nose === 'x') {
      // Nasenspitze der Offset-Kontur = Offset des Kern-LE über die
      // Winkelhalbierende der beiden Kern-Oberflächenkanten (wie in offsetPath).
      const offLE = (core, gap, dy) => {
        const dir = winding(core);
        const a = core[neighborIdx(core, iLE, -1)], b = core[iLE], c = core[neighborIdx(core, iLE, +1)];
        const n1 = edgeNormal(a, b, dir), n2 = edgeNormal(b, c, dir);
        let nx = n1.x + n2.x, ny = n1.y + n2.y; const L = Math.hypot(nx, ny);
        if (L < 1e-9) return { x: b.x + n1.x * gap, y: b.y + n1.y * gap + dy };
        nx /= L; ny /= L;
        const cosHalf = Math.max(0.35, n1.x * nx + n1.y * ny);
        const s = gap / cosHalf;
        return { x: b.x + nx * s, y: b.y + ny * s + dy };
      };
      const xLEr = Math.min.apply(null, rootCore.map(p => p.x));
      const xLEt = Math.min.apply(null, tipCore.map(p => p.x));
      // Schlaufenlauf = zusammenhängende Punkte deutlich VOR der Nase (x < LE − 2).
      const inLoop = i => (rootC[i] && rootC[i].x < xLEr - 2) || (tipC[i] && tipC[i].x < xLEt - 2);
      let a = -1, b = -1;
      for (let i = 0; i < rootC.length; i++) if (inLoop(i)) { if (a < 0) a = i; b = i; }
      if (a > 0 && b < rootC.length - 1) {
        const before = a - 1, after = b + 1;   // die beiden Nasen-Besuche (Apex)
        const snap = (P, sp) => {
          const k = P[before].k != null ? P[before].k : P[after].k;
          P[before] = { x: sp.x, y: sp.y, k }; P[after] = { x: sp.x, y: sp.y, k };
        };
        const apR = offLE(rootCore, kScalarR, dyR), apT = offLE(tipCore, kScalarT, dyT);
        snap(rootC, apR);
        snap(tipC,  apT);
        // Kreuzungspunkt-Reste neben dem Apex einsammeln: uncrossSync legt den
        // Berührpunkt der beiden Schlaufen-Diagonalen je nach Rundung (die Suche
        // ist an der Nase fast entartet) mal auf den Nasenbesuch selbst (wird vom
        // Snap überschrieben), mal auf den Index davor/danach — dann bliebe VOR
        // dem Apex ein 0,2–0,6 mm langes Häkchen stehen. Alle Nachbarpunkte, die
        // auf Wurzel ODER Rand noch vor ihrer Nasenspitze liegen, ebenfalls auf den
        // Apex ziehen (beide Rippen am gleichen Index -> synchron).
        const inFront = k => k > 0 && k < rootC.length - 1
          && (rootC[k].x < apR.x - 1e-6 || tipC[k].x < apT.x - 1e-6);
        for (let k = before - 1, m = 0; m < 6 && inFront(k); k--, m++) { rootC[k] = { x: apR.x, y: apR.y, k: rootC[k].k }; tipC[k] = { x: apT.x, y: apT.y, k: tipC[k].k }; }
        for (let k = after + 1, m = 0; m < 6 && inFront(k); k++, m++) { rootC[k] = { x: apR.x, y: apR.y, k: rootC[k].k }; tipC[k] = { x: apT.x, y: apT.y, k: tipC[k].k }; }
      }
    }

    // 3b3) Turm-Zickzack an Übergängen entfernen (universell). Nach Beplankungs-
    //     abzug + trimTE + Resampling liegen die eng gehäuften Punkte an der
    //     Endleiste bei Wurzel und Rand nicht mehr im gleichen Sehnenverhältnis
    //     (das Trimmen nimmt außen relativ mehr weg). Die Rippenbahnen sind noch
    //     monoton, aber auf den TÜRMEN (Extrapolation über die Rippenebenen
    //     hinaus) kippt ein winziger Schritt um: der Draht fährt am Steg-
    //     Anschluss einen Punkt zurück und dann wieder vor. Solche Umkehrungen
    //     kurzer Segmente werden synchron (gleicher Index auf beiden Rippen)
    //     entfernt; Kappen-Flanken (Stegschlitze) bleiben geschützt.
    [rootC, tipC] = dezigzagTowers(rootC, tipC, zRoot, zTip, cfg.machineWidth, rootC.capFlanks);

    // 3c) KEINE Rotation mehr: buildPath legt den Pfadanfang bereits an die OBERE
    //     Steg-Spitze (hinten) und das -ende an die UNTERE Steg-Spitze. Der Draht
    //     fährt also hinten oben an, schneidet die Kontur und verlässt das
    //     Werkstück hinten unten; der Schließzug (senkrechte Steg-Rückkante)
    //     entfällt im gcode. Das ist die Draht-Führung des Negativschalendesigns.

    // 4) Schleife schließen (letzter Punkt zurück zum ersten).
    const rootPath = rootC.concat([{ x: rootC[0].x, y: rootC[0].y }]);
    const tipPath = tipC.concat([{ x: tipC[0].x, y: tipC[0].y }]);

    const n = Math.min(rootPath.length, tipPath.length);
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const r = rootPath[i], t = tipPath[i];
      left.push({ x: proj(r.x, t.x, zRoot, zTip, 0), y: proj(r.y, t.y, zRoot, zTip, 0) });
      right.push({ x: proj(r.x, t.x, zRoot, zTip, cfg.machineWidth), y: proj(r.y, t.y, zRoot, zTip, cfg.machineWidth) });
    }
    return { left, right, rootC, tipC, rootPath, tipPath, zRoot, zTip,
             rootProf: w.root.pts, tipProf: w.tip.pts,   // Originalkontur
             rootCore, tipCore, kerfInfo };              // nach Beplankungsabzug + kerf-Kennwerte
  }

  /* Geschwindigkeitsabhängiger kerf je Schnittsegment (zwischen zwei Stütz-
   * punkten). Beide Türme fahren jedes Segment in derselben Zeit -> das
   * lokale Geschwindigkeitsverhältnis ist das Verhältnis der Segmentlängen.
   * Die LÄNGERE Seite läuft mit dem kommandierten Vorschub cal.feed, die kürzere
   * entsprechend langsamer. Der kerf wird über die Gerade (feedSlow,kerfSlow)-
   * (feedFast,kerfFast) interpoliert und leicht geglättet (Resampling-Rauschen).
   * Rückgabe: gapR/gapT = Versatz-Arrays je Punkt (kerf/2), info = Kennwerte. */
  function kerfAtSpeed(cal, v) {
    const dv = cal.feedFast - cal.feedSlow;
    if (Math.abs(dv) < 1e-6) return Math.max(0, (cal.kerfSlow + cal.kerfFast) / 2);
    return Math.max(0, cal.kerfSlow + (cal.kerfFast - cal.kerfSlow) * (v - cal.feedSlow) / dv);
  }
  /* Isolierte Vorschub-Spitzen (Einzel-Segment-Ausreißer) im G-Code entfernen —
   * 3-Punkt-Median. Solche Spitzen entstehen an Nase/Endleiste: dort schiebt der
   * kerf-Miter einen Eckpunkt bei Wurzel und Rand unterschiedlich weit, und die
   * Projektion auf die (extrapolierten) Portalebenen macht daraus für EIN Segment
   * einen längeren Portalweg -> F = feed·dMax/dRoot springt kurz hoch.
   * Der Median erhält Rampen und Stufen (>=2 Segmente) und glättet NUR einzelne
   * Zacken. `closed` = geschlossene Kontur (Nachbarn per Wrap-around). Reine
   * Vorschub-Korrektur — die Geometrie (Bahnpunkte) bleibt unverändert. */
  function medianDespike(F, closed) {
    const n = F.length; if (n < 3) return F.slice();
    const med3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    const out = F.slice();
    for (let i = 0; i < n; i++) {
      const p = i > 0 ? F[i - 1] : (closed ? F[n - 1] : F[i]);
      const q = i < n - 1 ? F[i + 1] : (closed ? F[0] : F[i]);
      out[i] = med3(p, F[i], q);
    }
    return out;
  }
  /* Gleitendes Mittel über Segmente. `breaks[i]` = true: am Anfang von Segment i
   * (Punkt i) liegt eine ECHTE Ecke — das Fenster läuft nicht darüber hinweg
   * (sonst würde der Abbrand der einen Kante in die andere hineinverschmiert:
   * schräge Rampe statt paralleler Spur). `closed`: Segmente wrap-around
   * (geschlossene Kontur). */
  function smoothOpen(a, w, breaks, closed) {
    const n = a.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = a[i], c = 1;
      for (const step of [-1, 1]) {
        let j = i;
        for (let k = 0; k < w; k++) {
          let nj = j + step;
          if (closed) nj = (nj + n) % n;
          else if (nj < 0 || nj >= n) break;
          // Grenze zwischen Segment j und nj = Punkt max(j,nj) (bzw. Punkt 0 beim Wrap)
          const bnd = step > 0 ? nj : j;
          if (breaks && breaks[bnd]) break;
          j = nj;
          s += a[j]; c++;
        }
      }
      out[i] = s / c;
    }
    return out;
  }
  // Echte Ecke an Punkt b (Richtungswechsel der angrenzenden Segmente > ~12°)?
  const CORNER_COS = Math.cos(12 * Math.PI / 180);
  function isCorner(a, b, c) {
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    const L = (Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1e-12;
    return (ux * vx + uy * vy) / L < CORNER_COS;
  }
  function speedGaps(rp, tp, cal) {
    const n = rp.length;
    const F = cal.feed || cal.feedFast || 1;
    // Geschlossene Kontur (erster = letzter Punkt, z. B. DXF-Formen): der
    // Anfangs-/Endpunkt ist EINE Ecke und muss auf beiden Seiten denselben
    // Versatz bekommen — sonst schließt die Spur mit einem Absatz. Dann werden
    // die Segmente wrap-around betrachtet (der Schließzug n-1 -> 0 ist nulllang
    // und entfällt).
    const closed = n > 3 && Math.hypot(rp[0].x - rp[n - 1].x, rp[0].y - rp[n - 1].y) < 1e-6
                        && Math.hypot(tp[0].x - tp[n - 1].x, tp[0].y - tp[n - 1].y) < 1e-6;
    const nSeg = Math.max(1, n - 1);
    // kerf je Segment.
    const kR = new Array(nSeg), kT = new Array(nSeg);
    const zero = [];   // Nulllängen-Segmente (beide Seiten): kein Schnitt, kein eigener Abbrand
    for (let i = 0; i < nSeg; i++) {
      const dR = Math.hypot(rp[i + 1].x - rp[i].x, rp[i + 1].y - rp[i].y);
      const dT = Math.hypot(tp[i + 1].x - tp[i].x, tp[i + 1].y - tp[i].y);
      const md = Math.max(dR, dT);                       // längere Seite = Referenz (voller Vorschub)
      if (md < 1e-6) { zero.push(i); kR[i] = kT[i] = NaN; continue; }
      kR[i] = kerfAtSpeed(cal, F * dR / md);
      kT[i] = kerfAtSpeed(cal, F * dT / md);
    }
    // Nulllängen-Segmente übernehmen den Abbrand des nächsten echten Nachbarn
    // (sonst: Geschwindigkeit 0 -> extrapolierter Ausreißer -> Schlaufe).
    for (const i of zero) {
      let j = -1;
      for (let d = 1; d < nSeg && j < 0; d++) {
        const a = i - d, b = i + d;
        if (a >= 0 && !isNaN(kR[a])) j = a; else if (b < nSeg && !isNaN(kR[b])) j = b;
      }
      if (j >= 0) { kR[i] = kR[j]; kT[i] = kT[j]; } else { kR[i] = kT[i] = kerfAtSpeed(cal, F); }
    }
    // Ecken (auf EINER der beiden Seiten) begrenzen das Glättungsfenster.
    // breaks[i] = Ecke am Punkt i (Anfang von Segment i).
    const breaks = new Array(nSeg).fill(false);
    for (let i = 0; i < nSeg; i++) {
      if (!closed && i === 0) continue;
      const a = rp[neighborIdx(rp, i, -1)], b = rp[i], c = rp[neighborIdx(rp, i, +1)];
      const a2 = tp[neighborIdx(tp, i, -1)], b2 = tp[i], c2 = tp[neighborIdx(tp, i, +1)];
      breaks[i] = isCorner(a, b, c) || isCorner(a2, b2, c2);
    }
    const sR = smoothOpen(kR, 2, breaks, closed), sT = smoothOpen(kT, 2, breaks, closed);
    // Punkt-Versatz = halber (gemittelter) Segment-kerf der angrenzenden Segmente.
    // Zusätzlich je Punkt der Versatz der EIN- und AUSLAUFENDEN Kante (gIn/gOut):
    // offsetPath versetzt damit jede Kante um ihren eigenen Abbrand und schneidet
    // die versetzten Kanten an Ecken exakt — saubere, kantenparallele Spur.
    const gapR = new Array(n), gapT = new Array(n);
    const gInR = new Array(n), gOutR = new Array(n), gInT = new Array(n), gOutT = new Array(n);
    let rMin = Infinity, rMax = -Infinity, tMin = Infinity, tMax = -Infinity;
    for (let i = 0; i < n; i++) {
      let a, b;
      if (closed) { a = (i - 1 + nSeg) % nSeg; b = i % nSeg; }
      else { a = Math.max(0, i - 1); b = Math.min(nSeg - 1, i); }
      const kr = (sR[a] + sR[b]) / 2, kt = (sT[a] + sT[b]) / 2;
      gapR[i] = kr / 2; gapT[i] = kt / 2;
      gInR[i] = sR[a] / 2; gOutR[i] = sR[b] / 2; gInT[i] = sT[a] / 2; gOutT[i] = sT[b] / 2;
      rMin = Math.min(rMin, kr); rMax = Math.max(rMax, kr);
      tMin = Math.min(tMin, kt); tMax = Math.max(tMax, kt);
    }
    gapR.gIn = gInR; gapR.gOut = gOutR; gapT.gIn = gInT; gapT.gOut = gOutT;
    return { gapR, gapT, info: { mode: 'speed', rootMin: rMin, rootMax: rMax, tipMin: tMin, tipMax: tMax } };
  }

  /* Züge in Fahrtreihenfolge für den Zug-Ablauf (G-Code, Bahnvorschau, Zeichnung):
   *   o.front    — Schnittrichtung „von vorne": jeder Zug Nase → Endleiste.
   *                Sonst (von hinten) läuft die Oberseite wie im klassischen Umlauf
   *                Stegspitze → Nase → Einlaufast, die Unterseite umgekehrt.
   *   o.sides    — 'top' | 'bottom' = nur diese Profilseite, sonst beide.
   *   o.profileDir — 'bottom' = Unterseite zuerst (nur bei beiden Seiten). */
  function cutPasses(P, copies, o) {
    o = o || {};
    const single = o.sides === 'top' || o.sides === 'bottom';
    const all = frontPasses(P, copies), res = [];
    for (let c = 0; c < Math.max(1, copies | 0); c++) {
      let pc = all.filter(q => q.copy === c);
      if (single) pc = pc.filter(q => q.top === (o.sides === 'top'));
      else if (o.profileDir === 'bottom') pc.reverse();
      pc.forEach(q => res.push(o.front || !q.rev ? q : Object.assign({}, q, { idx: q.idx.slice().reverse() })));
    }
    return res;
  }

  global.HotWire = { project, offsetOutward, offsetPath, offsetPathTB, trimTE, segX, speedGaps, medianDespike, skelTeSlope, frontPasses, cutPasses };
})(window);
