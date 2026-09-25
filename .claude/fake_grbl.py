"""GRBL-Attrappe zum Mitschreiben, WIE ein Sender sendet.

Zweck: herausfinden, wie sich GRBLHotwire (RCKeith) von unserem eigenen Sender
unterscheidet - schickt es Zeilen im Voraus oder einzeln, welche Befehle setzt
es vorweg, wie oft fragt es den Status ab, welche Vorschubwerte stehen drin.

Aufbau:
    GRBLHotwire  <-->  COM-Paar (com0com)  <-->  dieses Skript
Der Sender verbindet sich auf die eine Seite des Paares (z. B. COM11), dieses
Skript horcht auf der anderen (z. B. COM12) und antwortet wie ein echter GRBL.

Start:   python .claude/fake_grbl.py COM12
         python .claude/fake_grbl.py COM12 --log mitschrift.txt

Nachgebildet wird so viel, dass ein Sender zufrieden ist:
  - Startmeldung "Grbl 1.1f ['$' for help]"
  - "ok" je Zeile, aber erst wenn ein Platz im Planer frei ist (16 Bloecke),
    damit man am Zeitstempel sieht, ob der Sender vorausschickt
  - Statusbericht auf "?" mit mitlaufender Position und Geschwindigkeit
  - $$ (Einstellungen), $I, $G, $X, $H, Echtzeitbytes (!, ~, 0x18, 0x85)
  - G0/G1 mit X/Y/Z/A, F, G90/G91, G93/G94 - die Dauer wird real abgewartet,
    damit sich der Sender wie an einer echten Maschine verhaelt.
"""
import sys, time, threading, re, math

try:
    import serial
except ImportError:
    sys.exit('pyserial fehlt:  python -m pip install pyserial')

def words_present(up):
    """Steht in der Zeile ueberhaupt eine Achse?"""
    return any(re.search(a + r'-?\d*\.?\d+', up) for a in ('X', 'Y', 'Z', 'A'))


AXES = ['X', 'Y', 'Z', 'A']            # 4 Achsen wie an der Schneidmaschine
PLANNER = 16                            # Bloecke im Planer (wie GRBL)
RX_BUF = 128                            # Empfangspuffer in Byte (wie GRBL)

SETTINGS = {
    '0': '10', '1': '25', '2': '0', '3': '0', '4': '0', '5': '0', '6': '0',
    '10': '1', '11': '0.010', '12': '0.002', '13': '0', '20': '0', '21': '0',
    '22': '0', '23': '0', '24': '25.000', '25': '500.000', '26': '250',
    '27': '1.000', '30': '1000', '31': '0', '32': '0',
    '100': '80.000', '101': '80.000', '102': '80.000', '103': '80.000',
    '110': '1000.000', '111': '1000.000', '112': '1000.000', '113': '1000.000',
    '120': '30.000', '121': '30.000', '122': '30.000', '123': '30.000',
    '130': '500.000', '131': '200.000', '132': '500.000', '133': '200.000',
}


class Machine:
    """Fuehrt Bewegungen in Echtzeit aus, damit der Sender realistisch wartet."""

    def __init__(self):
        self.pos = {a: 0.0 for a in AXES}
        self.queue = []                 # [(ziel, dauer_s)]
        self.lock = threading.Lock()
        self.feed = 0.0                 # mm/min (G94) bzw. 1/min (G93)
        self.inverse = False            # G93 aktiv?
        self.absolute = True            # G90
        self.mode = 0                   # modale Bewegungsart (G0/G1)
        self.rate_now = 0.0
        self.hold = False
        self.run = True
        threading.Thread(target=self._exec, daemon=True).start()

    # ---- Bewegungen ausfuehren ------------------------------------------
    def _exec(self):
        while self.run:
            with self.lock:
                job = self.queue[0] if self.queue else None
            if not job:
                self.rate_now = 0.0
                time.sleep(0.005)
                continue
            target, dur = job
            start = dict(self.pos)
            dist = math.sqrt(sum((target[a] - start[a]) ** 2 for a in AXES))
            self.rate_now = dist / dur * 60 if dur > 0 else 0.0
            t0 = time.time()
            while True:
                if self.hold:
                    t0 += 0.01
                    time.sleep(0.01)
                    continue
                f = 1.0 if dur <= 0 else min(1.0, (time.time() - t0) / dur)
                for a in AXES:
                    self.pos[a] = start[a] + (target[a] - start[a]) * f
                if f >= 1.0:
                    break
                time.sleep(0.002)
            with self.lock:
                if self.queue:
                    self.queue.pop(0)

    def busy(self):
        with self.lock:
            return len(self.queue)

    def full(self):
        return self.busy() >= PLANNER

    def clear(self):
        with self.lock:
            self.queue.clear()

    # ---- G-Code auswerten -------------------------------------------------
    def gcode(self, line):
        """Bewegung einreihen. Gibt None zurueck oder einen Fehlertext."""
        up = line.upper()
        if 'G90' in up:
            self.absolute = True
        if 'G91' in up:
            self.absolute = False
        if 'G93' in up:
            self.inverse = True
        if 'G94' in up:
            self.inverse = False
        mf = re.search(r'F(-?\d*\.?\d+)', up)
        if mf:
            self.feed = float(mf.group(1))
        # Mehrere G-Woerter je Zeile sind erlaubt ("G93 G1 X..") - aus allen
        # nur die Bewegungsart heraussuchen, sonst faellt G1 unter den Tisch.
        gs = [int(g) for g in re.findall(r'G(\d+)', up)]
        mv = [g for g in gs if g in (0, 1, 2, 3, 4)]
        mode = mv[0] if mv else (self.mode if words_present(up) else None)
        words = {a: float(m.group(1)) for a in AXES
                 for m in [re.search(a + r'(-?\d*\.?\d+)', up)] if m}
        if mode in (0, 1):
            self.mode = mode
        if mode == 4:                                   # G4 P<sek> - Verweilen
            mp = re.search(r'P(\d*\.?\d+)', up)
            if mp:
                self._queue(dict(self.pos), float(mp.group(1)))
            return None
        if not words or mode not in (0, 1, None):
            return None
        target = dict(self.pos)
        for a, v in words.items():
            target[a] = v if self.absolute else self.pos[a] + v
        dist = math.sqrt(sum((target[a] - self.pos[a]) ** 2 for a in AXES))
        if mode == 0:
            dur = dist / 3000.0 * 60
        elif self.inverse:
            if not (self.feed > 0):
                return 'error:22'                        # F in G93 zwingend
            dur = 60.0 / self.feed
        else:
            if not (self.feed > 0):
                return 'error:22'
            dur = dist / self.feed * 60
        self._queue(target, dur)
        return None

    def _queue(self, target, dur):
        with self.lock:
            self.queue.append((target, dur))

    def status(self):
        st = 'Hold:0' if self.hold else ('Run' if self.busy() else 'Idle')
        mpos = ','.join('%.3f' % self.pos[a] for a in AXES)
        return '<%s|MPos:%s|FS:%.0f,0|Bf:%d,%d>' % (
            st, mpos, self.rate_now, PLANNER - self.busy(), RX_BUF)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    port = sys.argv[1]
    baud = 115200
    logname = None
    if '--baud' in sys.argv:
        baud = int(sys.argv[sys.argv.index('--baud') + 1])
    if '--log' in sys.argv:
        logname = sys.argv[sys.argv.index('--log') + 1]

    ser = serial.Serial(port, baud, timeout=0.01)
    log = open(logname, 'w', encoding='utf-8') if logname else None
    t0 = time.time()
    m = Machine()

    def out(txt, tag='<<'):
        stamp = '%8.3f %s %s' % (time.time() - t0, tag, txt)
        print(stamp, flush=True)
        if log:
            log.write(stamp + '\n')
            log.flush()

    def say(txt):
        ser.write((txt + '\r\n').encode())

    print('GRBL-Attrappe auf %s (%d Baud). Sender jetzt verbinden.  Ende: Strg+C'
          % (port, baud))
    print('Zeitstempel in Sekunden. ">>" = vom Sender, "<<" = Antwort.\n')
    time.sleep(0.2)
    say("Grbl 1.1f ['$' for help]")
    out("Grbl 1.1f ['$' for help]")

    buf = b''
    pending = []                 # Zeilen, die auf einen Planerplatz warten
    try:
        while True:
            data = ser.read(256)
            for b in data:
                ch = bytes([b])
                # Echtzeitbytes stehen mitten im Datenstrom und haben kein \n
                if b in (0x18, 0x21, 0x7E, 0x3F, 0x85) or b >= 0x80:
                    if b == 0x3F:                     # '?' Statusabfrage
                        s = m.status()
                        out('?', '>>')
                        say(s)
                        out(s)
                    elif b == 0x21:                   # '!' Feed Hold
                        m.hold = True
                        out('! (Feed Hold)', '>>')
                    elif b == 0x7E:                   # '~' weiter
                        m.hold = False
                        out('~ (Resume)', '>>')
                    elif b == 0x18:                   # Ctrl-X Soft-Reset
                        m.clear(); m.hold = False; pending.clear()
                        out('0x18 (Soft-Reset)', '>>')
                        say("Grbl 1.1f ['$' for help]")
                    elif b == 0x85:                   # Jog abbrechen
                        m.clear()
                        out('0x85 (Jog Cancel)', '>>')
                    else:
                        out('Echtzeitbyte 0x%02X' % b, '>>')
                    continue
                if ch in (b'\n', b'\r'):
                    if buf:
                        pending.append(buf.decode('ascii', 'replace').strip())
                        buf = b''
                else:
                    buf += ch

            # Zeilen abarbeiten, sobald ein Planerplatz frei ist. Genau hier
            # sieht man am Zeitstempel, ob der Sender vorausschickt.
            while pending and not m.full():
                line = pending.pop(0)
                out(line, '>>')
                resp = handle(line, m, say, out)
                if resp:
                    say(resp)
                    out(resp)
            time.sleep(0.002)
    except KeyboardInterrupt:
        pass
    finally:
        m.run = False
        ser.close()
        if log:
            log.close()
            print('\nMitschrift gespeichert: ' + logname)


def handle(line, m, say, out):
    """Eine Zeile beantworten. Rueckgabe = Antwort oder None (dann 'ok')."""
    if not line:
        return 'ok'
    if line == '$$':
        for k in sorted(SETTINGS, key=lambda x: int(x)):
            txt = '$%s=%s' % (k, SETTINGS[k])
            say(txt); out(txt)
        return 'ok'
    if line == '$I':
        say('[VER:1.1f.20170801:]'); out('[VER:1.1f.20170801:]')
        say('[OPT:V,15,128]'); out('[OPT:V,15,128]')
        return 'ok'
    if line == '$G':
        mode = 'G93' if m.inverse else 'G94'
        txt = '[GC:G0 G54 G17 G21 %s %s M5 M9 T0 F0 S0]' % (
            'G90' if m.absolute else 'G91', mode)
        say(txt); out(txt)
        return 'ok'
    if line in ('$X', '$H') or line.startswith('$'):
        if line.startswith('$J='):
            err = m.gcode(line[3:])
            return err or 'ok'
        if re.match(r'^\$\d+=', line):
            k, v = line[1:].split('=', 1)
            SETTINGS[k] = v
            return 'ok'
        return 'ok'
    err = m.gcode(line)
    return err or 'ok'


if __name__ == '__main__':
    main()
