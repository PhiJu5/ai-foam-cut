/* servorahmen.js — Reiter „Servorahmen" (Menü Tragflächen, nach Flächenservos; id srvr, Feature „servorahmen").
 *
 *   Servorahmen für Flächenservos zum 3D-Druck (STL / 3MF), für alle KST- und Chaservo-Servos
 *   (dazu MKS und eigene Maße). Der Rahmen wird auf die Innenseite der Beplankung geklebt, der Servo
 *   liegt flach darin (Breitseite auf der Beplankung, Abtriebswelle parallel zur Beplankung).
 *     Bauart „Laschen"   : Servo an seinen eigenen Laschen verschraubt —
 *                          flache Laschen (parallel zur Breitseite, z. B. KST X10, HS08A): Stützen unter den
 *                          Laschen, Schrauben senkrecht zur Beplankung;
 *                          Flansch-Laschen (quer zur Welle wie beim Standardservo, z. B. KST X12-508, X06,
 *                          HS08B): Laschenböcke hinter dem Flansch, Schrauben parallel zur Welle.
 *     Bauart „Klemmen"   : laschenloser Servo (oder Laschen abgeschnitten) — Wanne mit verschraubtem Deckel,
 *                          der den Servo auf die Beplankung drückt (Klemmung = Wand etwas niedriger als der Servo).
 *     Gegenlager         : optional ein Lagerbock mit Kugellager in der Flucht der Abtriebswelle hinter dem
 *                          Hebel (die Hebelschraube wird durch einen Stift ersetzt) — spielfreie Anlenkung.
 *     Dazu Klebeflansch, offener oder geschlossener Boden, Kabelschlitz, Anschläge an der Wellenseite.
 *   Koordinaten: x quer (Breite des Servos, Welle bei x = Abstand Kante − a/2), y längs der Welle
 *   (0 = Wellenseite des Gehäuses, Gehäuse bis y = b), z senkrecht zur Beplankung (0 = Beplankung).
 *   Netz: eigener Raster-Netzbauer — Quader addieren/abziehen auf einem gemeinsamen Raster (wasserdicht,
 *   ohne T-Stöße), runde Bohrungen entlang x, y oder z werden nachträglich „gebohrt" (Säule um die Bohrung,
 *   Rand mit allen Rasterpunkten, Ringfläche/Deckel/Mantel).
 *   Daten: state.cfg.servoFrame (je Projekt, Ansicht in .view → kein Strg+Z-Schritt).
 *   Servomaße: KST = Herstellerangaben (kstservos.com, Datenblätter mit Laschenmaßen für X06, X10,
 *   X12-508, HS08A/B), Chaservo = Katalog „Sortiment 2024/25". Laschen anderer Servos: selbst eintragen.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const TAB = 'srvr', KEY = 'servoFrame';
  const num = (v, d) => { v = +v; return isFinite(v) ? v : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R6 = z => Math.round(z * 1e6) / 1e6;
  const fmt = v => String(Math.round(v * 100) / 100).replace('.', ',');
  const fmt1 = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const ST = () => App.state;

  // =====================================================================================
  //  Servo-Datenbank
  // =====================================================================================
  // Laschen-/Wellenfamilien. sx = Abstand Wellenmitte von der Gehäusekante (mm), lug = Laschen, cab = Kabelaustritt.
  //  face  : flache Laschen parallel zur Breitseite; lz = Unterkante über der Gehäuseunterseite, L = Spannweite
  //          über die Laschen, hs = Lochabstand, lh = Laschenhöhe ab Wellenseite, hy = Lochlage ab Wellenseite,
  //          bot = zusätzliche Lasche an der Unterseite (bw breit, be Überstand, by Lochlage ab Gehäuseende).
  //  flange: Flansch quer zur Welle; yf = Abstand Wellenseite → Flansch, L, hs, nz Löcher je Seite, hz Abstand.
  const FAM = {
    x06: { sx: 5, lug: { k: 'flange', lt: 1, yf: 3.7, L: 28, hs: 24, nz: 1, hz: 0, d: 2 }, cab: ['end', 0, 3], src: 'KST-Datenblatt X06' },
    x08: { sx: 6.11, cab: ['far', 2, 4] },
    x08n: { sx: 6.11, none: true, cab: ['far', 2, 4] },
    hs08a: { sx: 6.11, lug: { k: 'face', lt: 1, lz: 3.5, L: 29.5, hs: 26.5, lh: 7, hy: 4, bot: false, d: 1.6 }, cab: ['end', -4, 3], src: 'KST-Datenblatt HS08' },
    hs08b: { sx: 6.11, lug: { k: 'flange', lt: 1, yf: 5.25, L: 29.5, hs: 26.5, nz: 2, hz: 5, d: 2 }, cab: ['end', -4, 3], src: 'KST-Datenblatt HS08' },
    x10: { sx: 6.6, lug: { k: 'face', lt: 1.8, lz: 4.1, L: 42, hs: 36, lh: 8, hy: 4, bot: true, bw: 10.1, be: 6.4, by: 3.7, d: 3 }, cab: ['far', 8, 4], src: 'KST-Datenblatt X10' },
    x10s: { sx: 6.6, lug: { k: 'face', lt: 1.8, lz: 4.1, L: 42, hs: 36, lh: 8, hy: 4, bot: true, bw: 10.1, be: 6.4, by: 3.7, d: 3 }, cab: ['far', 8, 4], src: 'wie KST X10 (gleiche Gehäusefamilie, nachmessen)' },
    x10n: { sx: 6.6, cab: ['far', 8, 4] },
    x12: { sx: 5.8, lug: { k: 'flange', lt: 1.2, yf: 6.4, L: 32, hs: 28, nz: 2, hz: 7, d: 2.2 }, cab: ['far', 13, 4], src: 'KST-Datenblatt X12-508' },
    x12s: { sx: 5.8, lug: { k: 'flange', lt: 1.2, yf: 6.4, L: 32, hs: 28, nz: 2, hz: 7, d: 2.2 }, cab: ['far', 13, 4], src: 'wie KST X12-508 (gleiche Gehäusefamilie, nachmessen)' },
    g12: { sx: 5.8, cab: ['far', 13, 4] }
  };
  // [id, Name, Breite a, Dicke t, Länge b (längs der Welle), Gewicht g, Moment kg·cm (max.), Familie]
  const KST = [
    ['x06', 'X06', 20, 7, 16.6, 6, 1.8, 'x06'], ['x06h', 'X06H', 20, 7, 16.6, 6, 1.8, ''], ['x06n', 'X06N', 20, 7, 16.6, 6, 1.8, 'n'],
    ['a06', 'A06 / A06H / A06N', 20.5, 7, 18.8, 7, 2.4, ''], ['a06lv', 'A06 LV', 20.5, 7, 18.8, 7, 1.4, ''], ['cm07', 'CM07', 20.5, 7.5, 19, 7, 2.4, ''],
    ['x08', 'X08', 23.5, 8, 16.8, 8, 2.8, 'x08'], ['x08h', 'X08H', 23.5, 8, 16.8, 8, 2.8, 'x08'], ['x08n', 'X08N', 23.5, 8, 16.8, 8, 2.8, 'x08n'],
    ['x08p', 'X08 Plus', 23.5, 8, 16.8, 9, 5.3, 'x08'], ['x08hp', 'X08H Plus', 23.5, 8, 16.8, 9, 5.3, 'x08'],
    ['a08', 'A08 / A08H', 23.5, 8, 19, 7, 3.2, 'x08'], ['a08n', 'A08N', 23.5, 8, 19, 7, 3.2, 'x08n'], ['a08lv', 'A08 LV', 23.5, 8, 19, 7, 2, 'x08'],
    ['hs08a', 'HS08A', 23.5, 8, 25.25, 11, 6, 'hs08a'], ['hs08b', 'HS08B', 23.5, 8, 25.25, 11, 6, 'hs08b'], ['sv0812', 'SV08-12', 23.5, 8, 25.25, 11, 8, 'x08'],
    ['x10', 'X10', 30, 10, 35.5, 28, 10.8, 'x10'], ['x10mini', 'X10 Mini', 30, 10, 29.6, 23, 7.5, 'x10s'], ['x10pro', 'X10 Pro (A / B)', 30, 10, 33.5, 25, 11.5, 'x10n'],
    ['x10minipro', 'X10 Mini Pro', 30, 10, 28, 20, 8, 'x10n'], ['x10710', 'X10-710', 30, 10, 29.6, 23, 7.5, 'x10n'], ['fz10', 'FZ10', 30, 10, 35.5, 28, 10.8, 'x10s'],
    ['ds125', 'DS125MG', 30, 10, 35.5, 28, 7, 'x10s'], ['ds135', 'DS135MG', 30, 10, 29.6, 23, 5.2, 'x10s'], ['ds145', 'DS145MG', 30, 10, 29.6, 23, 5.2, 'x10s'],
    ['sv1012', 'SV10-12A / B', 30, 10, 33.5, 25, 14, 'x10n'], ['sv10m12', 'SV10M-12A / B', 30, 10, 28, 20, 9, 'x10n'],
    ['cm509', 'CM509MG', 23, 11, 24, 15, 6, ''], ['ds113', 'DS113MG', 24, 12, 26.3, 12, 3.5, ''],
    ['x12508', 'X12-508', 23, 12, 27.5, 20, 6.2, 'x12'], ['x12708', 'X12-708', 23, 12, 27.5, 20, 9.3, 'x12s'], ['ds215', 'DS215MG', 23, 12, 27.5, 20, 4, 'x12s'],
    ['ds315', 'DS315MG', 23, 12, 27.5, 20, 4.8, 'x12s'], ['ms325', 'MS325', 23, 12, 27.5, 20, 5.2, 'x12s'],
    ['a12610', 'A12-610', 23, 12, 27, 20, 9, 'g12'], ['fz320', 'FZ320', 23, 12, 27, 20, 5.5, 'g12'], ['sv1212', 'SV12-12', 23, 12, 27, 20, 9, 'g12'],
    ['cm12', 'CM12', 27, 12.1, 29.5, 22, 7.5, ''], ['a12s', 'A12-S', 30, 12, 35.5, 32, 13.8, ''], ['a12t', 'A12-T', 30, 12, 35.5, 32, 20.4, ''],
    ['sv12t', 'SV12T-12 / SV12S-12', 30, 12, 35.5, 32, 0, ''], ['bls88', 'BLS88WP', 24, 13, 30, 21, 8.5, ''], ['a13610', 'A13-610', 28.2, 13, 27, 24, 9, ''],
    ['x15908', 'X15-908', 35.5, 15, 32.5, 40, 9.2, ''], ['x151208', 'X15-1208', 35.5, 15, 32.5, 40, 13.5, ''], ['x151809a', 'X15-1809A', 35.5, 15, 36.5, 45, 24, ''],
    ['x15755', 'X15-755X', 35.5, 15, 32.5, 40, 10.2, ''], ['ds589', 'DS589MG', 35.5, 15, 32.5, 40, 9.2, ''], ['fz589', 'FZ589', 35, 15, 32.5, 40, 8, ''],
    ['ms589', 'MS589', 35.5, 15, 32.5, 38, 9.2, ''], ['ms565', 'MS565', 35.5, 15, 32.5, 38, 6.5, ''], ['ds565', 'DS565X', 35.5, 15, 32.5, 40, 6, ''],
    ['bls505', 'BLS505', 35.5, 15, 32.5, 40, 7, ''], ['a151810', 'A15-1810', 35.5, 15, 32.5, 42, 20, ''], ['a151812', 'A15-1812', 35.5, 15, 32.5, 42, 18, ''],
    ['a152212', 'A15-2212', 40.5, 15, 34.1, 50, 25, ''], ['sv1512', 'SV15-12', 33, 15, 30, 35, 20, ''], ['sv15x', 'SV15X-12', 35.5, 15, 36.5, 40, 13, ''],
    ['cm633', 'CM633', 33, 15, 30, 35, 15, ''], ['cm712', 'CM712', 32.2, 16.8, 33, 32, 8, ''],
    ['x201806', 'X20-1806 (flach)', 40.5, 20, 23.1, 50, 18, ''], ['sv4012', 'SV4012-12 (flach)', 40.5, 20, 25.5, 50, 42, ''],
    ['ds1509', 'DS1509MG (flach)', 40.5, 20, 26.5, 55, 12.8, ''], ['bls159', 'BLS159 (flach)', 40, 20, 26.5, 55, 15, ''],
    ['ds725', 'DS725MG', 40.5, 20, 38, 70, 18, ''], ['ms725', 'MS725', 40.5, 20, 38, 70, 20, ''], ['bls815', 'BLS815', 40.5, 20, 38, 70, 20, ''],
    ['bls915', 'BLS915', 40.5, 20, 38, 70, 25, ''], ['ms825', 'MS825', 40.5, 20, 38, 70, 35, ''], ['bls835', 'BLS835', 40.5, 20, 38, 70, 45, ''],
    ['fz825', 'FZ825', 40, 20, 38, 70, 30, ''], ['cm1610', 'CM1610', 40, 20, 38.8, 60, 18, ''], ['a203813', 'A20-3813', 40.5, 20, 38, 72, 43, ''],
    ['a204515', 'A20-4515', 40.5, 20, 42, 80, 50, ''], ['x203005', 'X20-3005', 40.5, 20, 38, 70, 32, ''], ['x202208', 'X20-2208', 40, 20, 40, 72, 25, ''],
    ['x204208', 'X20-4208', 40, 20, 40, 80, 46, ''], ['x207512', 'X20-7512', 40.5, 20, 38, 70, 82, ''], ['ha204515', 'HA20-4515', 40.5, 20, 42, 72, 50, ''],
    ['ha207512', 'HA20-7512', 40.5, 20, 38, 70, 82, ''], ['ha208016', 'HA20-8016', 40.5, 20, 38, 70, 85, ''], ['ha209015', 'HA20-9015', 40, 20, 45, 90, 90, ''],
    ['sv3312', 'SV3312-12', 40.5, 20, 38, 70, 38, ''], ['sv5006', 'SV5006-12', 40, 20, 40, 75, 55, ''], ['sv6010', 'SV6010-12', 40, 20, 40, 75, 70, ''],
    ['sv7012', 'SV7012-12', 40, 20, 40, 75, 75, ''], ['hls6513', 'HLS6513', 40, 20, 40, 75, 70, '']
  ];
  // Chaservo (Katalog 2024/25; H-Ausführungen = gleiches Gehäuse): [id, Name, a, t, b, g, kg·cm, Abtrieb]
  const CHA = [
    ['lv06', 'LV06 / LV06H', 19, 6, 18.5, 6.1, 1.9, 4], ['hv06', 'HV06 / HV06H', 19, 6, 18.5, 6.1, 2.65, 4], ['ds06', 'DS06', 20, 7.4, 18.7, 6.1, 2, 4],
    ['hv75', 'HV75 / HV75H', 23, 7.5, 27.5, 11, 6.5, 4], ['hv85', 'HV85 / HV85H', 24, 8.5, 26.5, 14, 9.8, 5], ['ds09', 'DS09', 23.5, 9, 27.5, 12, 9, 5],
    ['hv95', 'HV95 / HV95H', 30, 9.5, 33.5, 21.7, 11.5, 6], ['ds115', 'DS115', 23, 11.5, 24.5, 15, 6, 5], ['hv120', 'HV120 / HV120H', 30, 12, 30, 37, 28, 6],
    ['hv150', 'HV150 / HV150H', 35.5, 15, 35.5, 51, 33, 6], ['hv150s', 'HV150S', 35.5, 15, 35.5, 45, 16.5, 6], ['ds165', 'DS165', 32, 16.5, 26.5, 36, 9, 6],
    ['hv5013', 'HV5013', 40.5, 17, 40, 74, 60, 6], ['sv7511', 'SV7511 (24 V)', 40.5, 17, 40, 74, 80, 6], ['ds20', 'DS20', 40, 20, 38, 64, 26, 6],
    ['hv3512', 'HV3512 (flach)', 40.5, 20, 23.1, 56, 40, 6], ['hv4613', 'HV4613', 40.5, 20, 40, 78, 50, 6], ['hv7010', 'HV7010', 40, 20, 40, 87, 70, 8]
  ];
  const MKS = [['hv6130', 'HV6130', 30, 10, 29.8, 0, 8.1], ['ds6100', 'DS6100', 22.5, 10, 23.8, 0, 3.19]];
  const BRANDS = [['KST', 'KST'], ['Chaservo', 'Chaservo'], ['MKS', 'MKS'], ['own', 'Eigene Maße']];
  // Freiraum um die Abtriebswelle (Radius der Hebelnabe + Luft) nach Dicke bzw. Abtriebsdurchmesser
  const hubOf = (t, spl) => spl ? (spl <= 4 ? 3.5 : spl <= 5 ? 4.5 : spl <= 6 ? 5 : 6) : (t <= 7.5 ? 3.5 : t <= 9 ? 4 : t <= 13 ? 4.5 : t <= 16 ? 5 : 6);
  const DB = [];
  KST.forEach(r => { const f = FAM[r[7]] || {}; DB.push({ id: 'kst_' + r[0], brand: 'KST', name: r[1], a: r[2], t: r[3], b: r[4], g: r[5], tq: r[6], sx: f.sx != null ? f.sx : r[2] / 4, lug: f.lug || null, none: r[7] === 'n' || !!f.none, cab: f.cab || ['far', 2, 4], src: f.src || '', hub: hubOf(r[3]) }); });
  CHA.forEach(r => DB.push({ id: 'cha_' + r[0], brand: 'Chaservo', name: r[1], a: r[2], t: r[3], b: r[4], g: r[5], tq: r[6], sx: r[2] / 4, lug: null, none: false, cab: ['far', 2, 4], src: '', hub: hubOf(r[3], r[7]), spl: r[7] }));
  MKS.forEach(r => DB.push({ id: 'mks_' + r[0], brand: 'MKS', name: r[1], a: r[2], t: r[3], b: r[4], g: r[5], tq: r[6], sx: r[2] / 4, lug: null, none: false, cab: ['far', 2, 4], src: '', hub: hubOf(r[3]) }));
  const dbFind = id => DB.find(s => s.id === id) || null;
  // Typen aus dem Reiter „Flächenservos" (servos.js)
  const SRV_MAP = { x10: 'kst_x10', x10mini: 'kst_x10mini', x10minipro: 'kst_x10minipro', x10proa: 'kst_x10pro', hv95: 'cha_hv95', ds09: 'cha_ds09', ds06: 'cha_ds06', hv06: 'cha_hv06', hv6130: 'mks_hv6130', ds6100: 'mks_ds6100' };

  // Miniatur-Kugellager: [Bezeichnung, Außen-Ø D, Innen-Ø d, Breite B]
  const BRG = {
    mr52: ['MR52 (2 × 5 × 2,5)', 5, 2, 2.5], mr62: ['MR62 (2 × 6 × 2,5)', 6, 2, 2.5], mr63: ['MR63 (3 × 6 × 2,5)', 6, 3, 2.5],
    mr73: ['MR73 (3 × 7 × 3)', 7, 3, 3], mr74: ['MR74 (4 × 7 × 2,5)', 7, 4, 2.5], b683: ['683 (3 × 7 × 3)', 7, 3, 3],
    mr83: ['MR83 (3 × 8 × 3)', 8, 3, 3], mr84: ['MR84 (4 × 8 × 3)', 8, 4, 3], mr85: ['MR85 (5 × 8 × 2,5)', 8, 5, 2.5],
    b693: ['693 (3 × 8 × 4)', 8, 3, 4], b684: ['684 (4 × 9 × 4)', 9, 4, 4], own: ['Eigene Maße', 0, 0, 0]
  };
  // Schrauben: [Bezeichnung, Kernloch-Ø im Rahmen, Durchgangsloch-Ø]
  const SCREWS = { m2: ['M2 (selbstschneidend)', 1.6, 2.3], bs22: ['Blechschraube 2,2 mm', 1.7, 2.5], m25: ['M2,5', 2.0, 2.8], m3: ['M3', 2.5, 3.3], own: ['Eigene Lochmaße', 0, 0] };

  const DEF = {
    brand: 'KST', sid: 'kst_x10', custom: false,
    a: 30, t: 10, b: 35.5, sxe: 6.6, hubR: 4.5,
    lugK: 'face', lugT: 1.8, lugZ: 4.1, lugL: 42, lugHs: 36, lugH: 8, lugHy: 4, lugBot: true, lugBw: 10.1, lugBe: 6.4, lugBy: 3.7,
    lugYf: 6.4, lugNz: 2, lugHz: 7, lugD: 3,
    cabSide: 'far', cabPos: 8, cabW: 4,
    type: 'lugs', clr: 0.15, wall: 1.2, press: 0.2, floor: false, flW: 3, flT: 0.8, stops: true, stopH: 1.5,
    screw: 'm2', dk: 1.6, dc: 2.3, scrDepth: 6, supM: 1.2, blkT: 5,
    lidT: 1.2, lidForm: 'full', lidRim: 3, nScr: 2, ear: 5.5,
    brg: false, brgType: 'mr63', brgD: 6, brgDi: 3, brgB: 2.5, armGap: 7, brgWall: 3.7, brgClr: 0.05, armDir: 'down',
    variant: 'pair', count: 1, rhoP: 1.27, pick: ''
  };
  const VIEW0 = { explode: 8, servo: true, lid: true };
  function C() {
    const cfg = ST().cfg; let c = cfg[KEY];
    if (!c || typeof c !== 'object') c = cfg[KEY] = {};
    for (const k in DEF) if (!(k in c)) c[k] = DEF[k];
    if (!c.view || typeof c.view !== 'object') c.view = {};
    for (const k in VIEW0) if (!(k in c.view)) c.view[k] = VIEW0[k];
    return c;
  }
  // Datenblattwerte eines Servos in die eigenen Werte übernehmen (danach frei änderbar)
  function applyServo(c, s) {
    if (!s) return;
    c.sid = s.id; c.brand = s.brand; c.custom = false;
    c.a = s.a; c.t = s.t; c.b = s.b; c.sxe = s.sx; c.hubR = s.hub;
    const L = s.lug;
    c.lugK = L ? L.k : 'none';
    if (L && L.k === 'face') Object.assign(c, { lugT: L.lt, lugZ: L.lz, lugL: L.L, lugHs: L.hs, lugH: L.lh, lugHy: L.hy, lugBot: !!L.bot, lugBw: L.bw || 10, lugBe: L.be || 6, lugBy: L.by || 3.5, lugD: L.d });
    if (L && L.k === 'flange') Object.assign(c, { lugT: L.lt, lugYf: L.yf, lugL: L.L, lugHs: L.hs, lugNz: L.nz, lugHz: L.hz, lugD: L.d });
    c.cabSide = s.cab[0]; c.cabPos = s.cab[1]; c.cabW = s.cab[2];
    c.type = L ? 'lugs' : 'clamp';
  }

  function params(c) {
    const p = {};
    const s = dbFind(c.sid);
    p.servo = c.brand === 'own' || !s ? null : s;
    p.a = clamp(num(c.a, 30), 5, 80); p.t = clamp(num(c.t, 10), 3, 40); p.b = clamp(num(c.b, 35.5), 5, 90);
    p.sxe = clamp(num(c.sxe, p.a / 4), 0, p.a); p.xs = p.sxe - p.a / 2;
    p.hubR = clamp(num(c.hubR, 4.5), 1, 20);
    const k = c.lugK === 'face' || c.lugK === 'flange' ? c.lugK : 'none';
    p.lug = null;
    if (k === 'face') p.lug = { k, lt: clamp(num(c.lugT, 1.8), 0.3, 10), lz: clamp(num(c.lugZ, 4.1), 0, p.t), L: clamp(num(c.lugL, 42), p.a + 1, 200), hs: clamp(num(c.lugHs, 36), 0, 200),
      lh: clamp(num(c.lugH, 8), 1, p.b), hy: clamp(num(c.lugHy, 4), 0, p.b), bot: !!c.lugBot, bw: clamp(num(c.lugBw, 10), 1, p.a), be: clamp(num(c.lugBe, 6), 1, 40), by: clamp(num(c.lugBy, 3.5), 0, 40), d: clamp(num(c.lugD, 2), 0.5, 10) };
    if (k === 'flange') p.lug = { k, lt: clamp(num(c.lugT, 1.2), 0.3, 10), yf: clamp(num(c.lugYf, 6), 0, p.b - 1), L: clamp(num(c.lugL, 32), p.a + 1, 200), hs: clamp(num(c.lugHs, 28), 0, 200),
      nz: Math.round(num(c.lugNz, 2)) === 1 ? 1 : 2, hz: clamp(num(c.lugHz, 7), 0, p.t), d: clamp(num(c.lugD, 2), 0.5, 10) };
    p.type = c.type === 'clamp' ? 'clamp' : 'lugs';
    p.clr = clamp(num(c.clr, 0.15), 0, 2); p.wall = clamp(num(c.wall, 1.2), 0.4, 10); p.press = clamp(num(c.press, 0.2), 0, 2);
    p.floor = !!c.floor; p.flW = clamp(num(c.flW, 3), 0, 30); p.flT = clamp(num(c.flT, 0.8), 0.3, 5);
    p.stops = c.stops !== false; p.stopH = clamp(num(c.stopH, 1.5), 0.4, 20);
    p.screw = SCREWS[c.screw] ? c.screw : 'm2';
    p.dk = p.screw === 'own' ? clamp(num(c.dk, 1.6), 0.5, 8) : SCREWS[p.screw][1];
    p.dc = p.screw === 'own' ? clamp(num(c.dc, 2.3), 0.5, 9) : SCREWS[p.screw][2];
    p.scrDepth = clamp(num(c.scrDepth, 6), 1, 40); p.supM = clamp(num(c.supM, 1.2), 0.4, 10); p.blkT = clamp(num(c.blkT, 5), 1.5, 30);
    p.lidT = clamp(num(c.lidT, 1.2), 0.4, 10); p.lidForm = c.lidForm === 'rim' ? 'rim' : 'full'; p.lidRim = clamp(num(c.lidRim, 3), 1, 30);
    p.nScr = Math.round(num(c.nScr, 2)) === 4 ? 4 : 2; p.ear = clamp(num(c.ear, 5.5), p.dk + 2, 20);
    p.cabSide = ['far', 'near', 'end', 'none'].indexOf(c.cabSide) >= 0 ? c.cabSide : 'far';
    p.cabPos = num(c.cabPos, 2); p.cabW = clamp(num(c.cabW, 4), 1, 30);
    p.brg = !!c.brg; p.brgType = BRG[c.brgType] ? c.brgType : 'mr63';
    const B = BRG[p.brgType];
    p.brgD = p.brgType === 'own' ? clamp(num(c.brgD, 6), 1, 40) : B[1]; p.brgDi = p.brgType === 'own' ? clamp(num(c.brgDi, 3), 0.5, p.brgD - 0.5) : B[2];
    p.brgB = p.brgType === 'own' ? clamp(num(c.brgB, 2.5), 0.5, 20) : B[3];
    p.armGap = clamp(num(c.armGap, 7), 1, 50); p.brgWall = clamp(num(c.brgWall, 3.7), p.brgB + 0.4, 30); p.brgClr = clamp(num(c.brgClr, 0.05), -0.2, 1);
    p.armDir = ['down', 'up', 'near', 'far'].indexOf(c.armDir) >= 0 ? c.armDir : 'down';
    p.variant = ['normal', 'mirror', 'pair'].indexOf(c.variant) >= 0 ? c.variant : 'pair';
    p.count = clamp(Math.round(num(c.count, 1)), 1, 20); p.rhoP = clamp(num(c.rhoP, 1.27), 0.1, 20);
    return p;
  }

  // =====================================================================================
  //  Raster-Netzbauer: Quader addieren/abziehen, danach runde Bohrungen entlang einer Achse
  // =====================================================================================
  /* Ring zwischen einem konvexen Außenpolygon O und einem Kreis I (beide gegen den Uhrzeigersinn, um c).
   * Winkel-Durchlauf (Reißverschluss): je Schritt das nächste Außen- oder Innenstück mit dem kleineren Winkel,
   * aber nur, wenn das Dreieck den Kreis nicht schneidet (Außenpunkte jenseits der Tangente im Kreispunkt). */
  function annulus(O, I, c) {
    const nO = O.length, nI = I.length, tris = [], TAU = 2 * Math.PI;
    const rx = q => q[0] - c[0], ry = q => q[1] - c[1];
    const r = Math.hypot(rx(I[0]), ry(I[0]));
    const dot = (o, q) => (rx(o) * rx(q) + ry(o) * ry(q)) / (Math.hypot(rx(q), ry(q)) || 1);   // Lage von o zur Tangente in q
    const a0 = Math.atan2(ry(I[0]), rx(I[0]));
    let k0 = 0, best = -Infinity;
    O.forEach((o, k) => { const d = dot(o, I[0]); if (d > best) { best = d; k0 = k; } });
    // Außenwinkel ab k0 abgewickelt (steigend), Innenwinkel gleichmäßig ab I[0]
    const th = [];
    for (let i = 0; i <= nO; i++) {
      const o = O[(k0 + i) % nO]; let t = Math.atan2(ry(o), rx(o)) - a0;
      while (t <= -Math.PI) t += TAU; while (t > Math.PI) t -= TAU;
      if (i) { while (t < th[i - 1] - 1e-9) t += TAU; }
      th.push(t);
    }
    th[nO] = th[0] + TAU;
    const ph = j => TAU * j / nI;
    let i = 0, j = 0, guard = 0;
    while ((i < nO || j < nI) && guard++ < 4 * (nO + nI) + 8) {
      const o0 = O[(k0 + i) % nO], o1 = O[(k0 + i + 1) % nO], q0 = I[j % nI], q1 = I[(j + 1) % nI];
      const canO = i < nO && dot(o1, q0) >= r - 1e-9, canI = j < nI && dot(o0, q1) >= r - 1e-9;
      let advO;
      if (canO && canI) advO = th[i + 1] <= ph(j + 1) + 1e-12;
      else if (canO || canI) advO = canO;
      else advO = i < nO && (j >= nI || th[i + 1] <= ph(j + 1));
      if (advO) { tris.push([o0, o1, q0]); i++; } else { tris.push([o0, q1, q0]); j++; }
    }
    return tris;
  }
  const UV = [[1, 2], [0, 2], [0, 1]];   // Querachsen zu Achse 0 (x), 1 (y), 2 (z)
  function idxOf(arr, v) {
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (Math.abs(arr[m] - v) < 1e-7) return m; if (arr[m] < v) lo = m + 1; else hi = m - 1; }
    return -1;
  }
  /* adds/subs: Quader [x0, x1, y0, y1, z0, z1]; erst alle addiert, dann alle abgezogen.
   * drills: { ax, c: [u, v] (Mitte in den Querachsen), segs: [[a0, a1, r], …] (stufenweise Radien längs der Achse),
   *           name } — Enden werden selbst erkannt: frei (Ringfläche) oder im Vollen (Deckelfläche). */
  function boxMesh(adds, subs, drills, warn) {
    const empty = { pos: new Float32Array(0), vol: 0, drilled: 0 };
    if (!adds.length) return empty;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    adds.forEach(q => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[2 * k]); hi[k] = Math.max(hi[k], q[2 * k + 1]); } });
    const clip = q => { const r = q.slice(); for (let k = 0; k < 3; k++) { r[2 * k] = Math.max(r[2 * k], lo[k] - 1); r[2 * k + 1] = Math.min(r[2 * k + 1], hi[k] + 1); } return r; };
    const S = subs.map(clip).filter(q => q[1] - q[0] > 1e-6 && q[3] - q[2] > 1e-6 && q[5] - q[4] > 1e-6);
    const L = [new Set(), new Set(), new Set()];
    adds.concat(S).forEach(q => { for (let k = 0; k < 3; k++) { L[k].add(R6(q[2 * k])); L[k].add(R6(q[2 * k + 1])); } });
    const D = (drills || []).map(d => {
      const r = Math.max.apply(null, d.segs.map(s => s[2])), h = R6(r + 0.4), ku = UV[d.ax][0], kv = UV[d.ax][1];
      const q = { ax: d.ax, ku, kv, cu: R6(d.c[0]), cv: R6(d.c[1]), h, r, name: d.name || '', segs: d.segs.map(s => [R6(Math.min(s[0], s[1])), R6(Math.max(s[0], s[1])), s[2]]).sort((p, q) => p[0] - q[0]) };
      L[ku].add(R6(q.cu - h)); L[ku].add(R6(q.cu + h)); L[kv].add(R6(q.cv - h)); L[kv].add(R6(q.cv + h));
      return q;
    });
    const G = L.map(s => Array.from(s).sort((a, b) => a - b));
    const n = G.map(g => Math.max(0, g.length - 1)), nx = n[0], ny = n[1], nz = n[2];
    if (!nx || !ny || !nz) return empty;
    const cell = new Uint8Array(nx * ny * nz), id = (i, j, k) => (k * ny + j) * nx + i;
    const rng = (k, a, b) => {
      let i0 = 0; while (i0 < n[k] && (G[k][i0] + G[k][i0 + 1]) / 2 < a) i0++;
      let i1 = n[k] - 1; while (i1 >= 0 && (G[k][i1] + G[k][i1 + 1]) / 2 > b) i1--;
      return [i0, i1];
    };
    const paint = (q, v) => {
      const X = rng(0, q[0], q[1]), Y = rng(1, q[2], q[3]), Z = rng(2, q[4], q[5]);
      for (let k = Z[0]; k <= Z[1]; k++) for (let j = Y[0]; j <= Y[1]; j++) for (let i = X[0]; i <= X[1]; i++) cell[id(i, j, k)] = v;
    };
    adds.forEach(q => paint(q, 1)); S.forEach(q => paint(q, 0));
    const full3 = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && cell[id(i, j, k)] === 1;
    const fullK = (k, ia, iu, iv) => { const r = [0, 0, 0]; r[k] = ia; r[UV[k][0]] = iu; r[UV[k][1]] = iv; return full3(r[0], r[1], r[2]); };

    // Bohrungen prüfen: Säule [cu ± h] × [cv ± h] muss zwischen den Enden voll sein, Enden frei oder voll
    const skip = new Set(), ok = [];
    D.forEach(d => {
      const ga = G[d.ax], gu = G[d.ku], gv = G[d.kv];
      const U = [idxOf(gu, R6(d.cu - d.h)), idxOf(gu, R6(d.cu + d.h))], V = [idxOf(gv, R6(d.cv - d.h)), idxOf(gv, R6(d.cv + d.h))];
      const A0 = d.segs[0][0], A1 = d.segs[d.segs.length - 1][1];
      const allCol = (ia, want) => { for (let iu = U[0]; iu < U[1]; iu++) for (let iv = V[0]; iv < V[1]; iv++) if (fullK(d.ax, ia, iu, iv) !== want) return false; return true; };
      let bad = U[0] < 0 || U[1] < 0 || V[0] < 0 || V[1] < 0;
      for (let ia = 0; !bad && ia < n[d.ax]; ia++) if (ga[ia + 1] > A0 + 1e-7 && ga[ia] < A1 - 1e-7 && !allCol(ia, true)) bad = true;
      const end = (A, dir) => {
        const ia = idxOf(ga, A);
        if (ia < 0) return 'cap';
        const out = dir < 0 ? ia - 1 : ia;
        if (out < 0 || out >= n[d.ax] || allCol(out, false)) return 'open';
        if (allCol(out, true)) return 'cap';
        return null;
      };
      const e0 = bad ? null : end(A0, -1), e1 = bad ? null : end(A1, 1);
      if (!e0 || !e1) { if (warn) warn.push(T('Bohrung ausgelassen (liegt nicht ganz im Material):') + ' ' + T(d.name)); return; }
      [[e0, A0], [e1, A1]].forEach(([e, A]) => {
        if (e !== 'open') return;
        const ia = idxOf(ga, A);
        for (let iu = U[0]; iu < U[1]; iu++) for (let iv = V[0]; iv < V[1]; iv++) skip.add(d.ax + ',' + ia + ',' + iu + ',' + iv);
      });
      ok.push(Object.assign(d, { e0, e1 }));
    });

    const pos = [];
    function tri(P, Q, S2, nn) {
      const ux = Q[0] - P[0], uy = Q[1] - P[1], uz = Q[2] - P[2], wx = S2[0] - P[0], wy = S2[1] - P[1], wz = S2[2] - P[2];
      const d = (uy * wz - uz * wy) * nn[0] + (uz * wx - ux * wz) * nn[1] + (ux * wy - uy * wx) * nn[2];
      if (Math.abs(d) < 1e-14) return;
      if (d > 0) pos.push(P[0], P[1], P[2], Q[0], Q[1], Q[2], S2[0], S2[1], S2[2]);
      else pos.push(P[0], P[1], P[2], S2[0], S2[1], S2[2], Q[0], Q[1], Q[2]);
    }
    const pt = (k, a, u, v) => { const r = [0, 0, 0]; r[k] = a; r[UV[k][0]] = u; r[UV[k][1]] = v; return r; };
    // Rasterflächen
    for (let k = 0; k < 3; k++) {
      const ku = UV[k][0], kv = UV[k][1];
      for (let ia = 0; ia <= n[k]; ia++) for (let iv = 0; iv < n[kv]; iv++) for (let iu = 0; iu < n[ku]; iu++) {
        const fa = fullK(k, ia - 1, iu, iv), fb = fullK(k, ia, iu, iv);
        if (fa === fb || skip.has(k + ',' + ia + ',' + iu + ',' + iv)) continue;
        const a = G[k][ia], u0 = G[ku][iu], u1 = G[ku][iu + 1], v0 = G[kv][iv], v1 = G[kv][iv + 1];
        const nn = [0, 0, 0]; nn[k] = fa ? 1 : -1;
        const P0 = pt(k, a, u0, v0), P1 = pt(k, a, u1, v0), P2 = pt(k, a, u1, v1), P3 = pt(k, a, u0, v1);
        tri(P0, P1, P2, nn); tri(P0, P2, P3, nn);
      }
    }
    // Bohrungen
    ok.forEach(d => {
      const k = d.ax, N = Math.max(20, Math.min(64, Math.round(2 * Math.PI * d.r / 0.3)));
      const circ = r => { const Lc = []; for (let i = 0; i < N; i++) { const t = 2 * Math.PI * (i + 0.5) / N; Lc.push([d.cu + r * Math.cos(t), d.cv + r * Math.sin(t)]); } return Lc; };
      const P = (a, q) => pt(k, a, q[0], q[1]);
      const nA = s => { const r = [0, 0, 0]; r[k] = s; return r; };
      const gu = G[d.ku].filter(x => x >= d.cu - d.h - 1e-7 && x <= d.cu + d.h + 1e-7), gv = G[d.kv].filter(x => x >= d.cv - d.h - 1e-7 && x <= d.cv + d.h + 1e-7);
      const u0 = gu[0], u1 = gu[gu.length - 1], v0 = gv[0], v1 = gv[gv.length - 1], O = [];
      gu.forEach(x => O.push([x, v0])); gv.slice(1).forEach(y => O.push([u1, y]));
      gu.slice(0, -1).reverse().forEach(x => O.push([x, v1])); gv.slice(1, -1).reverse().forEach(y => O.push([u0, y]));
      const ringO = (a, r, s) => annulus(O, circ(r), [d.cu, d.cv]).forEach(q => tri(P(a, q[0]), P(a, q[1]), P(a, q[2]), nA(s)));
      const disk = (a, r, s) => { const Cc = circ(r), m = [d.cu, d.cv]; for (let i = 0; i < N; i++) tri(P(a, m), P(a, Cc[i]), P(a, Cc[(i + 1) % N]), nA(s)); };
      const ringC = (a, r1, r2, s) => { const I1 = circ(r1), I2 = circ(r2); for (let i = 0; i < N; i++) { const j = (i + 1) % N; tri(P(a, I1[i]), P(a, I2[i]), P(a, I2[j]), nA(s)); tri(P(a, I1[i]), P(a, I2[j]), P(a, I1[j]), nA(s)); } };
      const sg = d.segs, A0 = sg[0][0], A1 = sg[sg.length - 1][1], rA = sg[0][2], rB = sg[sg.length - 1][2];
      if (d.e0 === 'open') ringO(A0, rA, -1); else disk(A0, rA, 1);
      if (d.e1 === 'open') ringO(A1, rB, 1); else disk(A1, rB, -1);
      for (let s = 0; s + 1 < sg.length; s++) {
        const r1 = sg[s][2], r2 = sg[s + 1][2];
        if (Math.abs(r1 - r2) > 1e-9) ringC(sg[s][1], Math.min(r1, r2), Math.max(r1, r2), r1 > r2 ? -1 : 1);
      }
      sg.forEach(s => {
        const Cc = circ(s[2]);
        for (let i = 0; i < N; i++) {
          const p = Cc[i], q = Cc[(i + 1) % N], nn = pt(k, 0, d.cu - (p[0] + q[0]) / 2, d.cv - (p[1] + q[1]) / 2);
          tri(P(s[0], p), P(s[0], q), P(s[1], q), nn); tri(P(s[0], p), P(s[1], q), P(s[1], p), nn);
        }
      });
    });
    const v = new Float32Array(pos);
    return { pos: v, vol: signedVolume(v), drilled: ok.length, lines: G };
  }
  function signedVolume(v) {
    let s = 0;
    for (let i = 0; i + 8 < v.length; i += 9) s += v[i] * (v[i + 4] * v[i + 8] - v[i + 5] * v[i + 7]) - v[i + 1] * (v[i + 3] * v[i + 8] - v[i + 5] * v[i + 6]) + v[i + 2] * (v[i + 3] * v[i + 7] - v[i + 4] * v[i + 6]);
    return s / 6;
  }
  function bbox(v) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { const x = v[i + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
    return { lo, hi };
  }
  // Kantenprüfung: jede gerichtete Kante braucht genau eine Gegenkante
  function checkMesh(v) {
    const key = i => Math.round(v[i] * 1e4) + ',' + Math.round(v[i + 1] * 1e4) + ',' + Math.round(v[i + 2] * 1e4);
    const E = new Map();
    for (let i = 0; i < v.length; i += 9) {
      const k = [key(i), key(i + 3), key(i + 6)];
      for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3], s = a + '|' + b; E.set(s, (E.get(s) || 0) + 1); }
    }
    let open = 0, multi = 0;
    E.forEach((n, s) => { const q = s.split('|'), r = E.get(q[1] + '|' + q[0]) || 0; if (r !== n) open++; if (n > 1) multi++; });
    return { open, multi, tris: v.length / 9 };
  }

  // =====================================================================================
  //  Geometrie des Rahmens
  // =====================================================================================
  function geometry(p) {
    const warn = [], A = [], S = [], Dr = [], LA = [], LS = [], LD = [];
    const box = (Lst, x0, x1, y0, y1, z0, z1) => { if (x1 - x0 > 1e-6 && y1 - y0 > 1e-6 && z1 - z0 > 1e-6) Lst.push([x0, x1, y0, y1, z0, z1]); };
    const BIG = 1000;
    const a = p.a, t = p.t, b = p.b, c = p.clr, w = p.wall, f = p.flT, e = p.flW;
    let lug = p.lug, type = p.type;
    if (type === 'lugs' && !lug) {
      type = 'clamp';
      warn.push(T('Für diesen Servo sind keine Laschenmaße hinterlegt — Klemmrahmen mit Deckel. Für einen Laschenrahmen die Laschen unter „Laschen" eintragen.'));
    }
    const clampT = type === 'clamp';
    const z0 = p.floor ? f : 0, Hs = z0 + t, Hw = clampT ? Math.max(z0 + 0.6, Hs - p.press) : Hs;
    const xs = p.xs, zs = z0 + t / 2, sSh = xs < 0 ? -1 : 1;
    const xi = a / 2 + c, xo = xi + w, yE0 = b + c, yE1 = yE0 + w;
    // belegte y-Bereiche je Seite (Laschenböcke, Augen) → Kabelschlitz weicht aus; [y0, y1, true] = Wand dort schon
    // offen (Wellenende, Laschenaussparung) → Schlitz schließt direkt an, statt einen Wandrest < 2,5 mm stehen zu lassen
    const busy = { '-1': [[-1, 0, true]], '1': [[-1, 0, true]] };
    const lugY = [];                       // y-Bereiche der Laschen (Augen weichen aus)
    let scrN = 0, scrMax = 0, scrKind = '';

    // Grundkörper: Wanne mit Wänden, Klebeflansch, Schacht (Wellenseite offen)
    box(A, -xo, xo, 0, yE1, 0, Hw);
    if (e > 0) box(A, -xo - e, xo + e, 0, yE1 + e, 0, f);
    box(S, -xi, xi, -c, yE0, z0, BIG);

    // ---- Laschen ----
    if (lug && lug.k === 'face') {
      const zl = z0 + lug.lz, pads = [];
      if (lug.L / 2 <= a / 2 + 0.05) warn.push(T('Laschen ragen nicht über das Gehäuse hinaus.'));
      [-1, 1].forEach(s => pads.push({ s, x0: s < 0 ? -lug.L / 2 : a / 2, x1: s < 0 ? -a / 2 : lug.L / 2, y0: 0, y1: lug.lh, hx: s * lug.hs / 2, hy: lug.hy }));
      if (lug.bot) pads.push({ s: 0, x0: -lug.bw / 2, x1: lug.bw / 2, y0: b, y1: b + lug.be, hx: 0, hy: b + lug.by });
      lugY.push([-c, lug.lh + c]);
      pads.forEach(q => {
        box(S, q.x0 - c, q.x1 + c, q.y0 - c, q.y1 + c, zl, BIG);   // Platz für Lasche und Schraubenkopf
        // Wand ist über der Lasche schon weg: Kabelschlitz darf direkt anschließen (sonst bliebe ein dünner Wandsplitter)
        if (q.s) busy[q.s].push([q.y0 - c, q.y1 + c, true]);
        if (clampT) return;
        const m = p.supM;
        const sx0 = q.s < 0 ? q.x0 - m : q.s > 0 ? xi : q.x0 - m, sx1 = q.s < 0 ? -xi : q.x1 + m;
        const sy0 = q.s ? 0 : yE0, sy1 = q.y1 + m;
        if (zl < 1.2) { warn.push(T('Laschen liegen zu tief für Stützen darunter (Laschenhöhe über der Unterseite < 1,2 mm).')); return; }
        box(A, sx0, sx1, sy0, sy1, 0, zl);
        const zb = Math.max(0.6, zl - p.scrDepth);
        Dr.push({ ax: 2, c: [q.hx, q.hy], segs: [[zb, zl, p.dk / 2]], name: 'Laschenschraube' });
        scrN++; scrMax = Math.max(scrMax, lug.lt + zl - zb); scrKind = 'lug';
      });
    } else if (lug && lug.k === 'flange') {
      const yf = lug.yf, yb = yf + lug.lt;
      lugY.push([yf - c, yb + (clampT ? c : p.blkT)]);
      box(S, -lug.L / 2 - c, lug.L / 2 + c, yf - c, yb, z0, BIG);   // Flansch des Servos
      if (!clampT) {
        const hr = p.dc * 0.85 + 0.4, zh = lug.nz === 1 ? [zs] : [zs - lug.hz / 2, zs + lug.hz / 2];
        [-1, 1].forEach(s => {
          box(S, s < 0 ? -BIG : xi, s < 0 ? -xi : BIG, 0, yf, f, BIG);   // vor dem Flansch keine Seitenwand (Schraubenköpfe)
          zh.forEach(z => box(S, s * lug.hs / 2 - hr, s * lug.hs / 2 + hr, 0, yf, z - hr, z + hr));
          const m = p.supM;
          box(A, s < 0 ? -lug.L / 2 - m : xi, s < 0 ? -xi : lug.L / 2 + m, yb, yb + p.blkT, 0, Hw);   // Laschenbock
          const dep = Math.min(p.scrDepth, p.blkT - 0.8);
          zh.forEach(z => {
            if (z - p.dk / 2 - 0.4 < 0.2) { warn.push(T('Laschenschraube liegt zu tief.')); return; }
            Dr.push({ ax: 1, c: [s * lug.hs / 2, z], segs: [[yb, yb + dep, p.dk / 2]], name: 'Laschenschraube' });
            scrN++; scrMax = Math.max(scrMax, lug.lt + dep); scrKind = 'lug';
          });
          busy[s].push([yf - c, yb + p.blkT]);
        });
        if (lug.hs / 2 - p.dk / 2 - 0.4 < xi - 1e-6) warn.push(T('Laschenlöcher liegen zu nah am Gehäuse für die Laschenböcke.'));
      }
    }

    // ---- Anschläge an der Wellenseite (nur Klemmrahmen) ----
    if (clampT && p.stops) {
      const sL = Math.min(3, a / 4), sT = 1.2, sH = Math.min(p.stopH, t * 0.6);
      [-1, 1].forEach(s => {
        const x0 = s < 0 ? -xo : xi - sL, x1 = s < 0 ? -xi + sL : xo;
        const dx = Math.max(0, x0 - xs, xs - x1), dz = Math.max(0, zs - (z0 + sH));
        if (Math.hypot(dx, dz) < p.hubR + 0.3) return;   // zu nah an der Hebelnabe
        box(A, x0, x1, -c - sT, 0, 0, z0 + sH);
      });
    }

    // ---- Klemmrahmen: Schraubaugen + Deckel ----
    const E = p.ear, ears = [];
    if (clampT) {
      const want = p.nScr === 4 ? [b * 0.22, b * 0.78] : [b / 2];
      // seitlicher Kabelschlitz: Augen weichen ihm aus (wenn möglich), sonst weicht der Schlitz
      let cabR = null;
      if (p.cabSide === 'far' || p.cabSide === 'near') {
        let q = clamp(p.cabPos, 0, Math.max(0, yE0 - p.cabW));
        busy[p.cabSide === 'far' ? -sSh : sSh].forEach(r => { if (r[2] && q + p.cabW > r[0] && q < r[1] + 2.5) q = Math.max(q, r[1]); });
        cabR = [q, q + p.cabW];
      }
      const place = (y0, avoid) => {
        let y = clamp(y0, E / 2, yE1 - E / 2);
        for (let it = 0; it < 6; it++) {
          const hit = avoid.find(r => y + E / 2 > r[0] - 0.3 && y - E / 2 < r[1] + 0.3);
          if (!hit) break;
          y = hit[1] + 0.3 + E / 2;
        }
        return y + E / 2 > yE1 + 1e-6 ? null : y;
      };
      want.forEach(y0 => {
        let y = place(y0, cabR ? lugY.concat([cabR]) : lugY);
        if (y == null) y = place(y0, lugY);
        if (y == null) { warn.push(T('Kein Platz für ein Schraubauge neben den Laschen.')); return; }
        if (!ears.some(q => Math.abs(q - y) < E)) ears.push(y);
      });
      ears.forEach(y => [-1, 1].forEach(s => {
        box(A, s < 0 ? -xo - E : xo, s < 0 ? -xo : xo + E, y - E / 2, y + E / 2, 0, Hw);
        Dr.push({ ax: 2, c: [s * (xo + E / 2), y], segs: [[Math.max(0.6, Hw - p.scrDepth), Hw, p.dk / 2]], name: 'Deckelschraube' });
        busy[s].push([y - E / 2, y + E / 2]);
        scrN++; scrMax = Math.max(scrMax, p.lidT + Math.min(p.scrDepth, Hw - 0.6)); scrKind = 'lid';
      }));
      const zl0 = Hs, zl1 = Hs + p.lidT;
      box(LA, -xo, xo, 0, yE1, zl0, zl1);
      ears.forEach(y => [-1, 1].forEach(s => {
        box(LA, s < 0 ? -xo - E : xo, s < 0 ? -xo : xo + E, y - E / 2, y + E / 2, zl0, zl1);
        LD.push({ ax: 2, c: [s * (xo + E / 2), y], segs: [[zl0, zl1, p.dc / 2]], name: 'Deckelschraube' });
      }));
      if (p.lidForm === 'rim') {
        const r = p.lidRim;
        if (xi - r > 1 && yE0 - 2 * r > 1) box(LS, -xi + r, xi - r, r, yE0 - r, zl0 - 1, zl1 + 1);
        else warn.push(T('Deckelrand zu breit für ein Fenster — Deckel geschlossen.'));
      }
    }

    // ---- Kabelschlitz ----
    let cab = null;
    if (p.cabSide === 'end') {
      const W = p.cabW, xc = clamp(p.cabPos, -xi + W / 2, xi - W / 2);
      box(S, xc - W / 2, xc + W / 2, yE0 - 0.5, yE1 + e + 1, f, BIG);
      cab = { side: 0, x0: xc - W / 2, x1: xc + W / 2, y0: yE0, y1: yE0 + 1 };
    } else if (p.cabSide !== 'none') {
      const s = p.cabSide === 'far' ? -sSh : sSh, W = p.cabW;
      const yReq = clamp(p.cabPos, 0, Math.max(0, yE0 - W));
      let y0 = yReq;
      for (let it = 0; it < 6; it++) {
        // join-Bereiche (Laschenaussparung): direkt anschließen, auch wenn sonst ein Wandrest < 2,5 mm bliebe
        const hit = busy[s].find(r => r[2] ? (y0 + W > r[0] && y0 < r[1] + 2.5 && y0 !== r[1]) : (y0 + W > r[0] - 0.2 && y0 < r[1] + 0.2));
        if (!hit) break;
        y0 = hit[2] ? hit[1] : hit[1] + 0.3;
      }
      if (Math.abs(y0 - yReq) > 2.6) warn.push(T('Kabelschlitz verschoben auf') + ' ' + fmt1(y0) + ' mm ' + T('(Laschenbock bzw. Schraubauge im Weg).'));
      if (y0 + W > yE1 + 1e-6) warn.push(T('Kabelschlitz liegt außerhalb der Seitenwand.'));
      else box(S, s < 0 ? -xo - e - 1 : xi, s < 0 ? -xi : xo + e + 1, y0, y0 + W, f, BIG);
      cab = { side: s, y0, y1: y0 + W };
    }

    // ---- Gegenlager ----
    let brg = null;
    if (p.brg) {
      const Rb = p.brgD / 2 + p.brgClr, rsh = Math.min(Rb - 0.5, p.brgDi / 2 + 0.75), wB = Math.max(p.brgB + 0.8, p.brgWall);
      const yB1 = -p.armGap, yB0 = yB1 - wB, hB = Rb + 0.4, zTop = zs + Rb + 1.2;
      if (zs - hB < 0.3) warn.push(T('Kugellager zu groß für die Servodicke — Gegenlager weggelassen.'));
      else {
        if (zTop > Math.max(Hw, Hs) + 0.01) warn.push(T('Lagerbock ragt') + ' ' + fmt(zTop - Hs) + ' mm ' + T('über den Servo.'));
        if (p.armGap < 4) warn.push(T('Hebelfreiraum sehr klein — Hebelnabe und Gestängeanschluss brauchen meist 6–8 mm.'));
        box(A, -xo, xo, yB0, yB1, 0, zTop);
        const sides = [-1, 1].filter(s => !(p.armDir === 'near' && s === sSh) && !(p.armDir === 'far' && s === -sSh));
        sides.forEach(s => box(A, s < 0 ? -xo : xi, s < 0 ? -xi : xo, yB1, 0, 0, Hw));
        const plate = (ya, yb) => {
          if (p.armDir === 'down') { sides.forEach(s => box(A, s < 0 ? -xo - e : xi, s < 0 ? -xi : xo + e, ya, yb, 0, f)); return; }
          if (zs - hB >= f) box(A, -xo - e, xo + e, ya, yb, 0, f);
          else { box(A, -xo - e, xs - hB, ya, yb, 0, f); box(A, xs + hB, xo + e, ya, yb, 0, f); }
        };
        if (e > 0) { plate(yB1, 0); plate(yB0 - e, yB0); box(A, -xo - e, -xo, yB0, yB1, 0, f); box(A, xo, xo + e, yB0, yB1, 0, f); }
        Dr.push({ ax: 1, c: [xs, zs], segs: [[yB0, yB1 - p.brgB, rsh], [yB1 - p.brgB, yB1, Rb]], name: 'Lagersitz' });
        brg = { yB0, yB1, Rb, rsh, zTop, D: p.brgD, B: p.brgB, d: p.brgDi };
      }
    }

    const frame = boxMesh(A, S, Dr, warn);
    const lid = clampT ? boxMesh(LA, LS, LD, warn) : null;
    const fb = bbox(frame.pos);
    let zMax = fb.hi[2];
    if (lid && lid.pos.length) zMax = Math.max(zMax, Hs + p.lidT);
    return {
      ok: frame.pos.length > 0, warn, p, type, lug, frame, lid, z0, Hs, Hw, xs, zs, sSh, xi, xo, yE0, yE1, ears, E, cab, brg,
      bb: fb, zMax, scrN, scrMax, scrKind
    };
  }

  // =====================================================================================
  //  Anzeige-Körper (Servo-Attrappe, Hebel, Lager)
  // =====================================================================================
  function hexTris(out, P) {
    const F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
    F.forEach(f => { const a = P[f[0]], b = P[f[1]], c = P[f[2]], d = P[f[3]]; out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]); });
  }
  function cuboid(out, x0, x1, y0, y1, z0, z1) { hexTris(out, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]); }
  function cylY(out, y0, y1, xc, zc, r, ri) {   // Zylinder bzw. Rohr (ri) längs y
    const N = 28;
    for (let k = 0; k < N; k++) {
      const a0 = 2 * Math.PI * k / N, a1 = 2 * Math.PI * (k + 1) / N;
      const P = (rr, a, y) => [xc + rr * Math.cos(a), y, zc + rr * Math.sin(a)];
      const q = [P(r, a0, y0), P(r, a1, y0), P(r, a1, y1), P(r, a0, y1)];
      out.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
      if (ri > 0) { const s = [P(ri, a0, y0), P(ri, a1, y0), P(ri, a1, y1), P(ri, a0, y1)]; out.push(...s[0], ...s[2], ...s[1], ...s[0], ...s[3], ...s[2]);
        [y0, y1].forEach(y => { const o0 = P(r, a0, y), o1 = P(r, a1, y), i0 = P(ri, a0, y), i1 = P(ri, a1, y); out.push(...o0, ...o1, ...i1, ...o0, ...i1, ...i0); }); }
      else [y0, y1].forEach(y => out.push(xc, y, zc, ...P(r, a0, y), ...P(r, a1, y)));
    }
  }
  function servoTris(g) {
    const p = g.p, out = [], z0 = g.z0, L = g.lug;
    cuboid(out, -p.a / 2, p.a / 2, 0, p.b, z0, z0 + p.t);
    if (L && L.k === 'face') {
      const zl = z0 + L.lz;
      cuboid(out, -L.L / 2, -p.a / 2, 0, L.lh, zl, zl + L.lt); cuboid(out, p.a / 2, L.L / 2, 0, L.lh, zl, zl + L.lt);
      if (L.bot) cuboid(out, -L.bw / 2, L.bw / 2, p.b, p.b + L.be, zl, zl + L.lt);
    } else if (L && L.k === 'flange') cuboid(out, -L.L / 2, L.L / 2, L.yf, L.yf + L.lt, z0, z0 + p.t);
    cylY(out, -3.3, 0, g.xs, g.zs, Math.max(1.5, p.hubR * 0.5), 0);   // Abtriebswelle
    if (g.cab) {
      if (g.cab.side) { const xa = g.cab.side < 0 ? -g.xo - 4 : p.a / 2, xb = g.cab.side < 0 ? -p.a / 2 : g.xo + 4; cuboid(out, xa, xb, g.cab.y0 + 0.4, g.cab.y1 - 0.4, z0 + 0.3, z0 + 2.3); }
      else cuboid(out, g.cab.x0 + 0.4, g.cab.x1 - 0.4, p.b, g.yE1 + 4, z0 + 0.3, z0 + 2.3);
    }
    return out;
  }
  function armTris(g) {   // Hebel in Neutrallage (Anzeige)
    const p = g.p, out = [], len = 12 + p.hubR, hw = Math.max(2, p.hubR * 0.55), y0 = -3.4, y1 = -1.4;
    cylY(out, y0, y1, g.xs, g.zs, p.hubR - 0.4, 0);
    const d = p.armDir === 'up' ? [0, 1] : p.armDir === 'down' ? [0, -1] : p.armDir === 'near' ? [g.sSh, 0] : [-g.sSh, 0];
    const ex = g.xs + d[0] * len, ez = g.zs + d[1] * len;
    if (d[0]) cuboid(out, Math.min(g.xs, ex), Math.max(g.xs, ex), y0, y1, g.zs - hw / 2, g.zs + hw / 2);
    else cuboid(out, g.xs - hw / 2, g.xs + hw / 2, y0, y1, Math.min(g.zs, ez), Math.max(g.zs, ez));
    return out;
  }
  function bearingTris(g) {
    const out = [], B = g.brg; if (!B) return out;
    cylY(out, B.yB1 - B.B, B.yB1, g.xs, g.zs, B.D / 2 - 0.02, B.d / 2);
    return out;
  }

  // =====================================================================================
  //  Ansicht (WebGL2, Rückfall Canvas 2D)
  // =====================================================================================
  let cv = null, ctx = null, glc = null, gl = null, glP = null, glL = null, glBuf = null, glTried = false, glN = 0, glDirty = true;
  let G = null, scene = null, wired = false, pivot = null;
  const CAM0 = { yaw: -2.35, pitch: 0.55, zoom: 1, px: 0, py: 0 };
  const cam = Object.assign({}, CAM0);
  const ROT = (v, yaw, pitch) => {   // wie ViewCube.ROT_STD (Welt: y oben)
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
    return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
  };
  // Rahmenkoordinaten → Welt der Ansicht: x → Welt x, y → Welt z, z (Beplankung → oben) → Welt y
  function rotM() { return [ROT([1, 0, 0], cam.yaw, cam.pitch), ROT([0, 0, 1], cam.yaw, cam.pitch), ROT([0, 1, 0], cam.yaw, cam.pitch)]; }
  function cssVar(n, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb; } catch (e) { return fb; } }
  function bgRGB() {
    try {
      ctx.fillStyle = cssVar('--bg', '#0f1216'); const s = String(ctx.fillStyle);
      let m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16) / 255);
      m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    } catch (e) { /* Rückfall */ }
    return [0.06, 0.07, 0.09];
  }
  const COL_FRAME = [118, 166, 212], COL_LID = [92, 186, 150], COL_SERVO = [74, 78, 88], COL_ARM = [205, 85, 85], COL_BRG = [212, 190, 96];
  function makeScene() {
    const c = C(), vw = c.view, ex = Math.max(0, num(vw.explode, 8));
    const items = [];
    if (G && G.ok) {
      items.push({ v: G.frame.pos, col: COL_FRAME, d: [0, 0, 0], main: true });
      if (G.lid && G.lid.pos.length && vw.lid) items.push({ v: G.lid.pos, col: COL_LID, d: [0, 0, ex], main: true });
      if (vw.servo) {
        items.push({ v: servoTris(G), col: COL_SERVO, d: [0, 0, 0] });
        items.push({ v: armTris(G), col: COL_ARM, d: [0, 0, 0] });
        if (G.brg) items.push({ v: bearingTris(G), col: COL_BRG, d: [0, 0, 0] });
      }
    }
    const mir = G && G.ok && G.p.variant === 'mirror';
    let n = 0; items.forEach(it => n += Math.floor(it.v.length / 9));
    const data = new Float32Array(n * 27), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const mlo = [Infinity, Infinity, Infinity], mhi = [-Infinity, -Infinity, -Infinity];
    let o = 0;
    items.forEach(it => {
      const v = it.v, cl = it.col.map(x => x / 255);
      for (let i = 0; i + 8 < v.length; i += 9) {
        const P = [0, 1, 2].map(k => [(mir ? -1 : 1) * v[i + 3 * k] + it.d[0], v[i + 3 * k + 1] + it.d[1], v[i + 3 * k + 2] + it.d[2]]);
        const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2], wx = P[2][0] - P[0][0], wy = P[2][1] - P[0][1], wz = P[2][2] - P[0][2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
        P.forEach(q => {
          data[o++] = q[0]; data[o++] = q[1]; data[o++] = q[2]; data[o++] = nx; data[o++] = ny; data[o++] = nz; data[o++] = cl[0]; data[o++] = cl[1]; data[o++] = cl[2];
          for (let k = 0; k < 3; k++) { if (q[k] < lo[k]) lo[k] = q[k]; if (q[k] > hi[k]) hi[k] = q[k]; if (it.main) { if (q[k] < mlo[k]) mlo[k] = q[k]; if (q[k] > mhi[k]) mhi[k] = q[k]; } }
        });
      }
    });
    const ok = n > 0, blo = isFinite(mlo[0]) ? mlo : lo, bhi = isFinite(mhi[0]) ? mhi : hi;
    scene = { data, n: n * 3, lo, hi, c: ok ? blo.map((x, k) => (x + bhi[k]) / 2) : [0, 0, 0], R: ok ? Math.max(1, Math.hypot(bhi[0] - blo[0], bhi[1] - blo[1], bhi[2] - blo[2]) / 2 * 1.1) : 1,
      Rz: ok ? Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) : 1 };
    glDirty = true;
  }
  function glInit() {
    if (glTried || !cv) return; glTried = true;
    try {
      glc = document.createElement('canvas'); glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      cv.parentNode.insertBefore(glc, cv);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true }); if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aP; in vec3 aN; in vec3 aC; uniform mat3 uR; uniform vec3 uC; uniform vec4 uS; uniform float uZ;
        out vec3 vN; out vec3 vC;
        void main() { vec3 p = uR * (aP - uC); vN = uR * aN; vC = aC; gl_Position = vec4(p.x * uS.x + uS.z, p.y * uS.y + uS.w, -p.z * uZ, 1.0); }`;
      const FS = `#version 300 es
        precision mediump float; in vec3 vN; in vec3 vC; out vec4 o;
        void main() { vec3 n = normalize(vN); vec3 L = normalize(vec3(-0.35, 0.55, 0.75)); float k = 0.30 + 0.62 * abs(dot(n, L)) + 0.10 * abs(n.y); o = vec4(vC * min(k, 1.08), 1.0); }`;
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      glP = gl.createProgram(); gl.attachShader(glP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glP, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glP);
      if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP));
      glL = { aP: gl.getAttribLocation(glP, 'aP'), aN: gl.getAttribLocation(glP, 'aN'), aC: gl.getAttribLocation(glP, 'aC'), uR: gl.getUniformLocation(glP, 'uR'), uC: gl.getUniformLocation(glP, 'uC'), uS: gl.getUniformLocation(glP, 'uS'), uZ: gl.getUniformLocation(glP, 'uZ') };
      glBuf = gl.createBuffer();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; }, false);
    } catch (e) {
      console.warn('Servorahmen: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function viewParams(w, h) {
    const c = pivot || scene.c, s = 0.38 * Math.min(w, h) / scene.R * cam.zoom;
    return { c, s, M: rotM() };
  }
  function project(q, vp, w, h) {
    const d = [q[0] - vp.c[0], q[1] - vp.c[1], q[2] - vp.c[2]], M = vp.M;
    const x = M[0][0] * d[0] + M[1][0] * d[1] + M[2][0] * d[2], y = M[0][1] * d[0] + M[1][1] * d[1] + M[2][1] * d[2], z = M[0][2] * d[0] + M[1][2] * d[1] + M[2][2] * d[2];
    return [w / 2 + cam.px + x * vp.s, h / 2 + cam.py - y * vp.s, z];
  }
  function draw() {
    if (!cv || ST().activeTab !== TAB) return;
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    glInit();
    if (!scene) makeScene();
    const bg = bgRGB();
    if (!scene.n) {
      if (gl) { gl.viewport(0, 0, glc.width, glc.height); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      else { ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fillRect(0, 0, w, h); }
      ctx.fillStyle = '#8a97a6'; ctx.font = '13px Segoe UI, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(G && G.msg ? G.msg : T('Kein Rahmen.'), w / 2, h / 2); ctx.textAlign = 'left';
      return;
    }
    const vp = viewParams(w, h);
    if (gl) {
      const Wd = Math.round(w * dpr), Hd = Math.round(h * dpr);
      if (glc.width !== Wd || glc.height !== Hd) { glc.width = Wd; glc.height = Hd; }
      gl.viewport(0, 0, Wd, Hd); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(glP); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      if (glDirty) { gl.bufferData(gl.ARRAY_BUFFER, scene.data, gl.STATIC_DRAW); glN = scene.n; glDirty = false; }
      const st = 36;
      gl.enableVertexAttribArray(glL.aP); gl.vertexAttribPointer(glL.aP, 3, gl.FLOAT, false, st, 0);
      gl.enableVertexAttribArray(glL.aN); gl.vertexAttribPointer(glL.aN, 3, gl.FLOAT, false, st, 12);
      gl.enableVertexAttribArray(glL.aC); gl.vertexAttribPointer(glL.aC, 3, gl.FLOAT, false, st, 24);
      gl.uniformMatrix3fv(glL.uR, false, [].concat(vp.M[0], vp.M[1], vp.M[2]));
      gl.uniform3f(glL.uC, vp.c[0], vp.c[1], vp.c[2]);
      gl.uniform4f(glL.uS, 2 * vp.s / w, 2 * vp.s / h, 2 * cam.px / w, -2 * cam.py / h);
      gl.uniform1f(glL.uZ, 1 / (scene.Rz * 3.2 + 1));
      gl.drawArrays(gl.TRIANGLES, 0, glN);
    } else {
      ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fillRect(0, 0, w, h);
      const Dd = scene.data, list = [];
      const Lv = [-0.35, 0.55, 0.75], Ln = Math.hypot(Lv[0], Lv[1], Lv[2]);
      for (let i = 0; i < scene.n; i += 3) {
        const o = i * 9, q = [0, 1, 2].map(k => project([Dd[o + 9 * k], Dd[o + 9 * k + 1], Dd[o + 9 * k + 2]], vp, w, h));
        const M = vp.M, nn = [Dd[o + 3], Dd[o + 4], Dd[o + 5]];
        const ny = M[0][1] * nn[0] + M[1][1] * nn[1] + M[2][1] * nn[2], nz = M[0][2] * nn[0] + M[1][2] * nn[1] + M[2][2] * nn[2], nx = M[0][0] * nn[0] + M[1][0] * nn[1] + M[2][0] * nn[2];
        const k = Math.min(1.08, 0.30 + 0.62 * Math.abs((nx * Lv[0] + ny * Lv[1] + nz * Lv[2]) / Ln) + 0.10 * Math.abs(ny));
        list.push({ q, d: (q[0][2] + q[1][2] + q[2][2]) / 3, c: [Dd[o + 6], Dd[o + 7], Dd[o + 8]].map(x => Math.round(x * 255 * k)) });
      }
      list.sort((a, b) => a.d - b.d);
      list.forEach(f => {
        const s = 'rgb(' + f.c.join(',') + ')';
        ctx.fillStyle = ctx.strokeStyle = window.DrawTheme ? DrawTheme.raw(s) : s;
        ctx.beginPath(); ctx.moveTo(f.q[0][0], f.q[0][1]); ctx.lineTo(f.q[1][0], f.q[1][1]); ctx.lineTo(f.q[2][0], f.q[2][1]); ctx.closePath(); ctx.fill(); ctx.lineWidth = 0.5; ctx.stroke();
      });
    }
    if (pivot && window.ViewCube) { const q = project(pivot, vp, w, h); ViewCube.drawPivot(ctx, q[0], q[1]); }
  }
  function wire() {
    if (wired) return;
    cv = document.getElementById('cSrvr'); if (!cv) return;
    wired = true;
    ctx = cv.getContext('2d');
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      if (!scene || !scene.n) return;
      const x0 = e.clientX, y0 = e.clientY, c0 = Object.assign({}, cam), pan = e.button !== 0 || e.shiftKey;
      const mv = ev => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (pan) { cam.px = c0.px + dx; cam.py = c0.py + dy; }
        else { cam.yaw = c0.yaw + dx * 0.008; cam.pitch = clamp(c0.pitch + dy * 0.008, -1.57, 1.57); }
        draw();
      };
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); if (!scene || !scene.n) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - cv.clientWidth / 2, my = e.clientY - r.top - cv.clientHeight / 2;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      cam.px = mx - (mx - cam.px) * f; cam.py = my - (my - cam.py) * f; cam.zoom *= f; draw();
    }, { passive: false });
    cv.addEventListener('dblclick', () => home());
    if (window.ViewCube) {
      ViewCube.midDbl(cv, (x, y) => {
        if (!scene || !scene.n) return false;
        const w = cv.clientWidth, h = cv.clientHeight, vp = viewParams(w, h), pt = pickSurface(x, y, vp, w, h);
        if (!pt) return false;
        const old = vp.c, M = vp.M, d = [pt[0] - old[0], pt[1] - old[1], pt[2] - old[2]];
        cam.px += (M[0][0] * d[0] + M[1][0] * d[1] + M[2][0] * d[2]) * vp.s;
        cam.py -= (M[0][1] * d[0] + M[1][1] * d[1] + M[2][1] * d[2]) * vp.s;
        pivot = pt; draw(); return true;
      });
      ViewCube.attach({
        canvas: () => cv, get: () => ({ yaw: cam.yaw, pitch: cam.pitch }), set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: draw,
        rot: ROT, k: [0.008, 0.008], active: () => ST().activeTab === TAB && !!(scene && scene.n),
        labels: { '+x': T('Seite 2'), '-x': T('Seite 1'), '+y': T('Oben'), '-y': T('Unten'), '+z': T('Hinten'), '-z': T('Welle') },
        reset: () => resetCam()
      });
    }
    const btn = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    btn('srvrIso', () => setCam(CAM0.yaw, CAM0.pitch));
    btn('srvrTop', () => setCam(0, Math.PI / 2));            // Draufsicht (Blick auf den Rahmen von oben)
    btn('srvrShaft', () => setCam(Math.PI, 0));              // Blick auf die Wellenseite
    btn('srvrSide', () => setCam(-Math.PI / 2, 0));          // Seitenansicht
    btn('srvrExport', () => exportAll());
  }
  function pickSurface(x, y, vp, w, h) {
    const D = scene.data; let best = null, bd = Infinity;
    for (let i = 0; i < scene.n; i += 3) {
      const o = i * 9, q = [0, 1, 2].map(k => project([D[o + 9 * k], D[o + 9 * k + 1], D[o + 9 * k + 2]], vp, w, h));
      const d0 = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (Math.abs(d0) < 1e-9) continue;
      const l1 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / d0, l2 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / d0, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const z = l1 * q[0][2] + l2 * q[1][2] + l3 * q[2][2];
      if (-z < bd) { bd = -z; best = [0, 1, 2].map(k => l1 * D[o + k] + l2 * D[o + 9 + k] + l3 * D[o + 18 + k]); }
    }
    return best;
  }
  function resetCam() { Object.assign(cam, CAM0); pivot = null; }
  function home() { resetCam(); draw(); }
  function setCam(y, p) { cam.yaw = y; cam.pitch = p; cam.px = 0; cam.py = 0; cam.zoom = 1; pivot = null; draw(); }

  // =====================================================================================
  //  Info, Export
  // =====================================================================================
  function servoLabel(p) {
    if (!p.servo) return T('Eigene Maße');
    return p.servo.brand + ' ' + p.servo.name;
  }
  function infoHTML() {
    const el = document.getElementById('srvrInfo'); if (!el) return;
    if (!G || !G.ok) { el.innerHTML = '<b>' + T('Servorahmen') + '</b><br>' + (G && G.msg ? G.msg : T('Kein Rahmen.')); return; }
    const g = G, p = g.p, bb = g.bb;
    const vF = g.frame.vol / 1000, vL = g.lid ? g.lid.vol / 1000 : 0;
    const lugTxt = !g.lug ? T('ohne Laschen') : g.lug.k === 'face' ? T('flache Laschen') : T('Flansch-Laschen');
    let h = '<b>' + T('Servorahmen') + '</b> · ' + servoLabel(p) + ' (' + fmt(p.a) + ' × ' + fmt(p.t) + ' × ' + fmt(p.b) + ' mm, ' + lugTxt + ')' + (C().custom ? ' · <span style="color:#ffb454">' + T('Maße angepasst') + '</span>' : '') + '<br>';
    h += T('Bauart') + ': ' + (g.type === 'clamp' ? T('Klemmrahmen mit Deckel') : T('Laschenrahmen')) + (g.brg ? ' + ' + T('Gegenlager') : '') + ' · ' + T('Boden') + ' ' + T(p.floor ? 'geschlossen' : 'offen') + '<br>';
    h += T('Außenmaße Rahmen') + ' ' + fmt(bb.hi[0] - bb.lo[0]) + ' × ' + fmt(bb.hi[1] - bb.lo[1]) + ' mm, ' + T('Einbauhöhe') + ' ' + fmt(g.zMax) + ' mm (' + (g.zMax - g.Hs > 0.005 ? fmt(g.zMax - g.Hs) + ' mm ' + T('über dem Servo') : T('nicht höher als der Servo')) + ')<br>';
    h += T('Masse') + ' ≈ ' + fmt1(vF * p.rhoP) + ' g' + (vL ? ' + ' + T('Deckel') + ' ' + fmt1(vL * p.rhoP) + ' g' : '') + ' (' + T('Dichte') + ' ' + fmt(p.rhoP) + ' g/cm³)';
    if (p.servo && p.servo.g) h += ' · ' + T('Servo') + ' ' + fmt1(p.servo.g) + ' g';
    h += '<br>';
    if (g.scrN) {
      const sc = SCREWS[p.screw][0];
      h += T('Schrauben') + ': ' + g.scrN + ' × ' + T(sc) + (p.screw === 'own' ? ' (' + T('Kernloch') + ' Ø ' + fmt(p.dk) + ' mm)' : '') + ', ' + T('höchstens') + ' ' + fmt1(g.scrMax) + ' mm ' + T('lang') + '<br>';
    }
    if (g.brg) h += T('Gegenlager') + ': ' + T(BRG[p.brgType][0]) + (p.brgType === 'own' ? ' ' + fmt(p.brgDi) + ' × ' + fmt(p.brgD) + ' × ' + fmt(p.brgB) : '') + ', ' + T('Sitz') + ' Ø ' + fmt(2 * g.brg.Rb) + ' mm, ' + T('Hebelfreiraum') + ' ' + fmt(p.armGap) + ' mm<br>';
    if (p.servo && p.servo.src && g.lug) h += '<span style="color:#8a97a6">' + T('Laschenmaße') + ': ' + T(p.servo.src) + '</span><br>';
    h += '<span style="color:#8a97a6">' + T('Druck: Rahmen mit dem Klebeflansch auf das Druckbett, Deckel flach. PETG oder ASA (wärmefest im Flügel), Wände mindestens 3 Perimeter.') + '</span>';
    g.warn.forEach(w => { h += '<br><span style="color:#ffb454">' + w + '</span>'; });
    el.innerHTML = h;
  }
  function fileBase(p) {
    const nm = p.servo ? (p.servo.brand + '_' + p.servo.name.split(' / ')[0]) : 'eigen_' + fmt(p.a) + 'x' + fmt(p.t) + 'x' + fmt(p.b);
    return ('servorahmen_' + nm).replace(/[\s()]+/g, '_').replace(/,/g, '-').replace(/_+$/, '');
  }
  // Teile in Druckposition: Rahmen mit dem Flansch auf z = 0, Deckel flach; gespiegelt = x → −x (Umlauf drehen)
  function placed(g) {
    const p = g.p, out = [];
    const xf = (v, mir, dz) => {
      const o = new Float32Array(v.length);
      for (let i = 0; i < v.length; i += 9) for (let k = 0; k < 3; k++) {
        const s = mir ? [0, 2, 1][k] : k, j = i + 3 * s;
        o[i + 3 * k] = (mir ? -1 : 1) * v[j]; o[i + 3 * k + 1] = v[j + 1]; o[i + 3 * k + 2] = v[j + 2] - dz;
      }
      return o;
    };
    const vars = p.variant === 'pair' ? [false, true] : [p.variant === 'mirror'];
    vars.forEach(mir => {
      for (let n = 0; n < p.count; n++) {
        const sfx = (mir ? '_gespiegelt' : '') + (p.count > 1 ? '_' + (n + 1) : '');
        out.push({ file: 'rahmen' + sfx, v: xf(g.frame.pos, mir, 0) });
        if (g.lid && g.lid.pos.length) out.push({ file: 'deckel' + sfx, v: xf(g.lid.pos, mir, g.Hs) });
      }
    });
    // nebeneinander legen
    let xOff = 0;
    out.forEach(it => {
      const v = it.v, b = bbox(v);
      for (let i = 0; i < v.length; i += 3) { v[i] += xOff - b.lo[0]; v[i + 1] -= b.lo[1]; v[i + 2] -= b.lo[2]; }
      xOff += b.hi[0] - b.lo[0] + 6;
    });
    return out;
  }
  async function exportAll() {
    if (!G || !G.ok) { alert(G && G.msg ? G.msg : T('Kein Rahmen.')); return; }
    const base = fileBase(G.p), list = placed(G).map(it => ({ name: base + '_' + it.file + '.stl', v: it.v }));
    if (App.stlSaveMany) await App.stlSaveMany(list, 'svStl', { name: base + '.3mf' });
    else if (App.download && App.stlBinary) for (const it of list) await App.download(it.name, App.stlBinary(it.v), 'model/stl', 'svStl');
  }

  function refresh() {
    try { G = geometry(params(C())); } catch (e) { console.error(e); G = { ok: false, msg: T('Fehler beim Aufbau des Rahmens:') + ' ' + (e && e.message ? e.message : e), warn: [] }; }
    makeScene();
    infoHTML();
    draw();
  }
  function show() { wire(); refresh(); }
  function resize() { draw(); }

  // =====================================================================================
  //  Seitenleiste
  // =====================================================================================
  function srvSources() {   // Servos aus dem Reiter „Flächenservos" (nur wenn dort schon welche angelegt sind)
    const sh = ST().cfg.stegH, L = sh && Array.isArray(sh.srv) ? sh.srv : [];
    return L.map((sv, i) => {
      const id = SRV_MAP[sv.type], s = id ? dbFind(id) : null;
      const dims = s ? null : { a: +sv.a || 0, t: +sv.t || 0, b: +sv.b || 0 };
      if (!s && !(dims.a > 0 && dims.t > 0 && dims.b > 0)) return null;
      const nm = s ? s.brand + ' ' + s.name : T('Eigene Maße') + ' ' + fmt(dims.a) + ' × ' + fmt(dims.t) + ' × ' + fmt(dims.b);
      return { id: 'sv' + i, label: T('Servo') + ' ' + (i + 1) + ' — ' + nm, s, dims };
    }).filter(Boolean);
  }
  function srvrSidebar(side) {
    const { grp, hint, numRow, boolRow, selectRow, subhead } = App;
    if (!grp || !numRow) return;
    const c = C(), p = params(c);
    const RD = () => { if (ST().activeTab === TAB) refresh(); };
    const RB = () => { if (App.buildSidebar) App.buildSidebar(); RD(); };
    const N = (body, label, key, o, rebuild) => numRow(body, label, () => c[key], v => { c[key] = v; if (o && o.custom) c.custom = true; rebuild ? RB() : RD(); }, Object.assign({ step: 0.1, norender: true }, o || {}));
    const SEL = (body, label, opts, key, rebuild, h) => selectRow(body, label, opts, () => String(c[key]), v => { c[key] = v; rebuild ? RB() : RD(); }, h);
    const button = (body, txt, fn, title) => {
      const row = document.createElement('div'); row.className = 'row';
      const b = document.createElement('button'); b.type = 'button'; b.textContent = T(txt); b.style.cssText = 'flex:1'; if (title) b.title = T(title);
      b.onclick = fn; row.appendChild(b); body.appendChild(row); return b;
    };

    // ---- Servo ----
    const g1 = grp('Servo', true, TAB, { key: 'srvrServo' });
    hint(g1.body, 'Servo wählen: Gehäusemaße (und, wo bekannt, Laschen und Wellenlage) werden übernommen und bleiben danach frei änderbar. Maße: KST-Herstellerangaben, Chaservo-Katalog 2024/25.');
    selectRow(g1.body, 'Hersteller', BRANDS, () => c.brand, v => {
      c.brand = v;
      if (v !== 'own') { const s = DB.filter(q => q.brand === v)[0]; if (s && (!dbFind(c.sid) || dbFind(c.sid).brand !== v)) applyServo(c, s); }
      else c.custom = true;
      RB();
    });
    if (c.brand !== 'own') {
      const list = DB.filter(q => q.brand === c.brand).slice().sort((u, v) => u.t - v.t || u.a - v.a || u.b - v.b || (u.name < v.name ? -1 : 1));
      selectRow(g1.body, 'Typ', list.map(s => [s.id, s.name + ' — ' + fmt(s.t) + ' mm (' + fmt(s.a) + ' × ' + fmt(s.b) + ')' + (s.lug ? ' ◆' : '')]), () => c.sid, v => { applyServo(c, dbFind(v)); RB(); },
        '◆ = Laschenmaße hinterlegt (Laschenrahmen möglich). Angezeigt: Dicke, dahinter Breite × Länge längs der Welle.');
      const s = dbFind(c.sid);
      if (s) {
        const d = document.createElement('div'); d.className = 'hint';
        d.textContent = s.brand + ' ' + s.name + ': ' + fmt(s.a) + ' × ' + fmt(s.t) + ' × ' + fmt(s.b) + ' mm' + (s.g ? ', ' + fmt1(s.g) + ' g' : '') + (s.tq ? ', ' + fmt1(s.tq) + ' kg·cm' : '') + (s.spl ? ', ' + T('Abtrieb') + ' 25T ' + s.spl + ' mm' : '')
          + (s.lug ? ' · ' + T(s.lug.k === 'face' ? 'flache Laschen' : 'Flansch-Laschen') : s.none ? ' · ' + T('ohne Laschen') : ' · ' + T('Laschenmaße nicht hinterlegt'));
        if (s.spl === 4) d.textContent = d.textContent.replace('25T 4', '15T 4');
        g1.body.appendChild(d);
        if (c.custom) button(g1.body, 'Datenblattwerte wiederherstellen', () => { applyServo(c, s); RB(); }, 'Gehäuse, Laschen, Wellenlage und Kabel wieder vom gewählten Servo übernehmen.');
      }
    }
    const src = srvSources();
    if (src.length) {
      if (!src.some(q => q.id === c.pick)) c.pick = src[0].id;
      subhead(g1.body, 'Aus „Flächenservos" übernehmen');
      selectRow(g1.body, 'Servo', src.map(q => [q.id, q.label]), () => c.pick, v => { c.pick = v; }, null);
      button(g1.body, 'Übernehmen', () => {
        const q = srvSources().find(u => u.id === c.pick); if (!q) return;
        if (q.s) applyServo(c, q.s);
        else { c.brand = 'own'; c.custom = true; c.a = q.dims.a; c.t = q.dims.t; c.b = q.dims.b; c.sxe = q.dims.a / 4; c.lugK = 'none'; c.type = 'clamp'; c.hubR = hubOf(q.dims.t); }
        if (App.toast) App.toast(T('Übernommen:') + ' ' + q.label);
        RB();
      });
    }
    subhead(g1.body, 'Gehäuse');
    N(g1.body, 'Breite (quer zur Welle, mm)', 'a', { step: 0.1, min: 5, custom: true });
    N(g1.body, 'Dicke (mm)', 't', { step: 0.1, min: 3, custom: true, hint: 'Die Dicke steht senkrecht zur Beplankung. Bei offenem Boden ist sie zugleich die Einbauhöhe des Rahmens.' });
    N(g1.body, 'Länge längs der Welle (mm)', 'b', { step: 0.1, min: 5, custom: true });
    N(g1.body, 'Welle: Abstand von der Gehäusekante (mm)', 'sxe', { step: 0.1, min: 0, custom: true, hint: 'Mitte der Abtriebswelle, gemessen von der nächsten Längskante. Die Welle sitzt in Dickenrichtung mittig.' });
    N(g1.body, 'Freiraum um die Welle (Radius, mm)', 'hubR', { step: 0.5, min: 1, hint: 'Platz für die Hebelnabe: hier bleiben Anschläge und Wände weg.' });

    // ---- Laschen ----
    const g2 = grp('Laschen', false, TAB, { key: 'srvrLugs' });
    SEL(g2.body, 'Laschen des Servos', [['none', 'Keine bzw. abgeschnitten'], ['face', 'Flach (parallel zur Breitseite)'], ['flange', 'Flansch (quer zur Welle)']], 'lugK', true,
      'Flach: Laschen liegen in einer Ebene mit der Breitseite (z. B. KST X10, HS08A) — Schrauben senkrecht zur Beplankung. Flansch: Laschen stehen quer zur Welle wie beim Standardservo (z. B. KST X12-508, X06, HS08B) — Schrauben parallel zur Welle.');
    if (p.lug && p.lug.k === 'face') {
      N(g2.body, 'Laschenstärke (mm)', 'lugT', { custom: true });
      N(g2.body, 'Unterkante über der Gehäuseunterseite (mm)', 'lugZ', { custom: true, hint: 'Liegen die Laschen in der Mitte der Dicke: (Dicke − Laschenstärke) / 2.' });
      N(g2.body, 'Spannweite über die Laschen (mm)', 'lugL', { custom: true });
      N(g2.body, 'Lochabstand (mm)', 'lugHs', { custom: true });
      N(g2.body, 'Laschenhöhe ab Wellenseite (mm)', 'lugH', { custom: true });
      N(g2.body, 'Lochmitte ab Wellenseite (mm)', 'lugHy', { custom: true });
      boolRow(g2.body, 'Dritte Lasche am Gehäuseende', () => !!c.lugBot, v => { c.lugBot = v; c.custom = true; RB(); });
      if (c.lugBot) {
        N(g2.body, 'Breite (mm)', 'lugBw', { custom: true });
        N(g2.body, 'Überstand über das Gehäuse (mm)', 'lugBe', { custom: true });
        N(g2.body, 'Lochmitte ab Gehäuseende (mm)', 'lugBy', { custom: true });
      }
    } else if (p.lug && p.lug.k === 'flange') {
      N(g2.body, 'Flanschstärke (mm)', 'lugT', { custom: true });
      N(g2.body, 'Abstand Wellenseite → Flansch (mm)', 'lugYf', { custom: true });
      N(g2.body, 'Spannweite über die Laschen (mm)', 'lugL', { custom: true });
      N(g2.body, 'Lochabstand (mm)', 'lugHs', { custom: true });
      selectRow(g2.body, 'Löcher je Seite', [['1', '1'], ['2', '2']], () => String(c.lugNz), v => { c.lugNz = +v; c.custom = true; RB(); });
      if (+c.lugNz === 2) N(g2.body, 'Abstand der beiden Löcher (mm)', 'lugHz', { custom: true });
    }
    if (p.lug) hint(g2.body, 'Laschenmaße stehen nur für einige KST-Servos im Datenblatt (X06, X10, X12-508, HS08). Bei anderen Servos vom Servo abnehmen.');

    // ---- Rahmen ----
    const g3 = grp('Rahmen', true, TAB, { key: 'srvrFrame' });
    SEL(g3.body, 'Bauart', [['lugs', 'Laschenrahmen (an den Laschen verschraubt)'], ['clamp', 'Klemmrahmen mit Deckel']], 'type', true,
      'Laschenrahmen: Servo wird an seinen Laschen verschraubt, der Rahmen ist nicht höher als der Servo. Klemmrahmen: für Servos ohne Laschen — ein verschraubter Deckel drückt den Servo auf die Beplankung (Wand um „Klemmung" niedriger als der Servo).');
    N(g3.body, 'Spiel je Seite (mm)', 'clr', { step: 0.05, min: 0, hint: 'Luft zwischen Servo und Rahmen. Für Aluminiumgehäuse etwa 0,1–0,2 mm.' });
    N(g3.body, 'Wandstärke (mm)', 'wall', { step: 0.1, min: 0.4 });
    if (p.type === 'clamp') N(g3.body, 'Klemmung (mm)', 'press', { step: 0.05, min: 0, hint: 'Um so viel ist die Wand niedriger als der Servo — der Deckel liegt auf dem Servo auf und klemmt ihn beim Anziehen.' });
    boolRow(g3.body, 'Geschlossener Boden', () => !!c.floor, v => { c.floor = v; RB(); }, 'Offen: der Servo liegt direkt auf der Beplankung (flachster Einbau, Wärme geht in die Haut). Geschlossen: Boden in Flanschstärke unter dem Servo — der Rahmen lässt sich vorab montieren.');
    N(g3.body, 'Klebeflansch: Breite (mm, 0 = keiner)', 'flW', { step: 0.5, min: 0, hint: 'Umlaufender Flansch zum Einkleben auf die Beplankung (nicht auf der Wellenseite, dort schwingt der Hebel).' });
    N(g3.body, 'Klebeflansch: Stärke (mm)', 'flT', { step: 0.1, min: 0.3 });
    if (p.type === 'clamp') {
      boolRow(g3.body, 'Anschläge an der Wellenseite', () => !!c.stops, v => { c.stops = v; RB(); }, 'Kleine Nasen an den Ecken vor der Wellenseite, damit der Servo nicht herausrutscht (fallen weg, wenn sie der Hebelnabe zu nahe kommen).');
      if (c.stops) N(g3.body, 'Höhe der Anschläge (mm)', 'stopH', { step: 0.1, min: 0.4 });
    }

    // ---- Kabel ----
    const g4 = grp('Kabelaustritt', false, TAB, { key: 'srvrCable' });
    SEL(g4.body, 'Schlitz', [['far', 'Seite gegenüber der Welle'], ['near', 'Seite der Welle'], ['end', 'Gehäuseende'], ['none', 'Keiner']], 'cabSide', true);
    if (c.cabSide !== 'none') {
      N(g4.body, c.cabSide === 'end' ? 'Lage quer (mm, 0 = Mitte)' : 'Beginn ab Wellenseite (mm)', 'cabPos', { step: 0.5, hint: c.cabSide === 'end' ? null : 'Weicht Laschenböcken und Schraubaugen automatisch aus.' });
      N(g4.body, 'Schlitzbreite (mm)', 'cabW', { step: 0.5, min: 1 });
    }

    // ---- Schrauben / Deckel ----
    const g5 = grp(p.type === 'clamp' ? 'Deckel und Schrauben' : 'Schrauben', false, TAB, { key: 'srvrScrews' });
    SEL(g5.body, 'Schraube', Object.keys(SCREWS).map(k => [k, SCREWS[k][0]]), 'screw', true, 'Kernloch im Rahmen (Schraube schneidet ihr Gewinde selbst), Durchgangsloch im Deckel.');
    if (c.screw === 'own') { N(g5.body, 'Kernloch-Ø (mm)', 'dk', { step: 0.1, min: 0.5 }); N(g5.body, 'Durchgangsloch-Ø (mm)', 'dc', { step: 0.1, min: 0.5 }); }
    N(g5.body, 'Bohrtiefe im Rahmen (mm)', 'scrDepth', { step: 0.5, min: 1, hint: 'Sacklöcher — der Boden bleibt zu. Die Info oben nennt die längste passende Schraube.' });
    if (p.type !== 'clamp') {
      N(g5.body, 'Stützrand um die Laschen (mm)', 'supM', { step: 0.1, min: 0.4 });
      if (p.lug && p.lug.k === 'flange') N(g5.body, 'Tiefe der Laschenböcke (mm)', 'blkT', { step: 0.5, min: 1.5 });
    } else {
      N(g5.body, 'Deckelstärke (mm)', 'lidT', { step: 0.1, min: 0.4 });
      SEL(g5.body, 'Deckelform', [['full', 'Geschlossen'], ['rim', 'Rahmen mit Fenster']], 'lidForm', true);
      if (c.lidForm === 'rim') N(g5.body, 'Randbreite (mm)', 'lidRim', { step: 0.5, min: 1 });
      selectRow(g5.body, 'Anzahl Schrauben', [['2', '2 (Mitte)'], ['4', '4 (an den Enden)']], () => String(c.nScr), v => { c.nScr = +v; RB(); });
      N(g5.body, 'Schraubauge: Breite (mm)', 'ear', { step: 0.5, min: 3 });
    }

    // ---- Gegenlager ----
    const g6 = grp('Gegenlager', false, TAB, { key: 'srvrBrg' });
    boolRow(g6.body, 'Gegenlager in der Flucht der Welle', () => !!c.brg, v => { c.brg = v; RB(); },
      'Lagerbock hinter dem Hebel mit einem Kugellager in der Flucht der Abtriebswelle. Die Hebelschraube wird durch einen Stift bzw. eine Schraube mit Hülse ersetzt, der im Lager läuft — der Hebel kann nicht mehr kippen, die Anlenkung wird spielfrei.');
    if (p.brg) {
      SEL(g6.body, 'Kugellager', Object.keys(BRG).map(k => [k, BRG[k][0]]), 'brgType', true);
      if (c.brgType === 'own') { N(g6.body, 'Außen-Ø (mm)', 'brgD', { step: 0.5, min: 1 }); N(g6.body, 'Innen-Ø (mm)', 'brgDi', { step: 0.5, min: 0.5 }); N(g6.body, 'Breite (mm)', 'brgB', { step: 0.5, min: 0.5 }); }
      N(g6.body, 'Hebelfreiraum (mm)', 'armGap', { step: 0.5, min: 1, hint: 'Abstand Gehäuse (Wellenseite) → Lagerbock: Platz für Hebelnabe und Gestängeanschluss.' });
      N(g6.body, 'Stärke des Lagerbocks (mm)', 'brgWall', { step: 0.1, min: 1 });
      N(g6.body, 'Spiel im Lagersitz (mm, Ø/2)', 'brgClr', { step: 0.01, hint: 'Lager wird eingeklebt; bei 0 sitzt es stramm (Druckbild beachten).' });
      SEL(g6.body, 'Hebel zeigt', [['down', 'Durch die Beplankung'], ['up', 'Nach oben (von der Beplankung weg)'], ['far', 'Zur Seite gegenüber der Welle'], ['near', 'Zur Wellenseite']], 'armDir', false,
        'Auf dieser Seite bleibt der Raum zwischen Gehäuse und Lagerbock offen (keine Verbindungsleiste bzw. kein Flansch).');
    }

    // ---- Ansicht und Export ----
    const g7 = grp('Ansicht und Export', true, TAB, { key: 'srvrView' });
    const vw = c.view;
    boolRow(g7.body, 'Servo und Hebel zeigen', () => !!vw.servo, v => { vw.servo = v; RD(); });
    if (p.type === 'clamp') {
      boolRow(g7.body, 'Deckel zeigen', () => !!vw.lid, v => { vw.lid = v; RD(); });
      numRow(g7.body, 'Deckel abheben (mm)', () => vw.explode, v => { vw.explode = v; RD(); }, { step: 2, min: 0, norender: true });
    }
    SEL(g7.body, 'Ausführung', [['pair', 'Paar (normal + gespiegelt)'], ['normal', 'Normal'], ['mirror', 'Gespiegelt']], 'variant', false,
      'Für linke und rechte Tragfläche braucht man meist spiegelbildliche Rahmen (Welle bzw. Kabel auf der anderen Seite). „Gespiegelt" zeigt die gespiegelte Ausführung auch in der Ansicht.');
    N(g7.body, 'Anzahl je Ausführung', 'count', { step: 1, min: 1, max: 20, int: true });
    N(g7.body, 'Dichte Druckwerkstoff (g/cm³)', 'rhoP', { step: 0.01, min: 0.1, hint: 'Nur für die Massenschätzung (PETG ≈ 1,27, ASA ≈ 1,07, PLA ≈ 1,24).' });
    button(g7.body, 'STL / 3MF exportieren …', () => exportAll(), 'Rahmen (und Deckel) in Druckposition als STL bzw. gemeinsam als 3MF (mit Vorschau).');
    [g1, g2, g3, g4, g5, g6, g7].forEach(g => side.appendChild(g.g));
  }

  App.srvrSidebar = srvrSidebar;
  window.Servorahmen = { show, refresh, resize, _test: { DB, FAM, BRG, SCREWS, params, geometry, applyServo, boxMesh, checkMesh, signedVolume, bbox, placed, annulus, C, DEF, srvSources } };
})();
