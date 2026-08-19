#!/usr/bin/env python3
"""
Erzeugt die App-Icons: der Filmsteg als Marke.

Bewusst ohne Bildbibliothek: die Marke besteht aus Rechtecken mit runden
Ecken, die sich analytisch beschreiben lassen. So bleiben die Icons
reproduzierbar - wer die Farbe aendert, laesst das Skript neu laufen,
statt in einem Grafikprogramm nachzubauen.

    python scripts/make-icons.py

Gezeichnet wird vierfach ueberabgetastet und danach gemittelt; das ergibt
weiche Kanten ohne Filterkram.
"""

import math
import struct
import zlib
from pathlib import Path

HINTERGRUND = (0x14, 0x12, 0x10)
AKZENT = (0xD4, 0x54, 0x2A)

SS = 4  # Ueberabtastung pro Achse

# Alles in Anteilen der Kantenlaenge, damit jede Groesse gleich aussieht.
# Die Marke ist der Filmsteg, den der Renderer auch um das Bild zeichnet:
# ein Streifen mit Perforation und einem freien Bildfenster.
#
# Der Streifen bleibt innerhalb des Kreises mit Radius 0,4 um die Mitte -
# das ist die Schutzzone, die Android bei maskierbaren Icons freihaelt.
STREIFEN = (0.20, 0.26, 0.80, 0.74)
STREIFEN_RADIUS = 0.045

FENSTER = (0.245, 0.410, 0.755, 0.590)
FENSTER_RADIUS = 0.018

LOCH_BREITE = 0.078
LOCH_HOEHE = 0.070
LOCH_RADIUS = 0.016
LOCH_MITTEN_X = (0.26, 0.38, 0.50, 0.62, 0.74)
LOCH_MITTEN_Y = (0.335, 0.665)


def abstand_zu_rundrechteck(x, y, box, radius):
    """Vorzeichenbehafteter Abstand: negativ innen, positiv aussen."""
    x0, y0, x1, y1 = box
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2 - radius, (y1 - y0) / 2 - radius
    dx = abs(x - mx) - hx
    dy = abs(y - my) - hy
    aussen = math.hypot(max(dx, 0.0), max(dy, 0.0))
    return aussen + min(max(dx, dy), 0.0) - radius


def _loecher():
    for cy in LOCH_MITTEN_Y:
        for cx in LOCH_MITTEN_X:
            yield (
                cx - LOCH_BREITE / 2,
                cy - LOCH_HOEHE / 2,
                cx + LOCH_BREITE / 2,
                cy + LOCH_HOEHE / 2,
            )


LOECHER = tuple(_loecher())


def ist_akzent(x, y):
    """Streifen minus Bildfenster minus Perforation."""
    if abstand_zu_rundrechteck(x, y, STREIFEN, STREIFEN_RADIUS) > 0:
        return False
    if abstand_zu_rundrechteck(x, y, FENSTER, FENSTER_RADIUS) <= 0:
        return False
    for loch in LOECHER:
        if abstand_zu_rundrechteck(x, y, loch, LOCH_RADIUS) <= 0:
            return False
    return True


def zeichne(kante):
    breit = kante * SS
    schritt = 1.0 / breit
    zeilen = []
    for j in range(breit):
        y = (j + 0.5) * schritt
        zeilen.append([1 if ist_akzent((i + 0.5) * schritt, y) else 0 for i in range(breit)])

    # Auf die Zielgroesse mitteln - das ergibt die weichen Kanten.
    daten = bytearray()
    for y in range(kante):
        daten.append(0)  # Filterbyte je Zeile
        for x in range(kante):
            summe = 0
            for dy in range(SS):
                reihe = zeilen[y * SS + dy]
                for dx in range(SS):
                    summe += reihe[x * SS + dx]
            a = summe / (SS * SS)
            for k in range(3):
                daten.append(round(HINTERGRUND[k] + (AKZENT[k] - HINTERGRUND[k]) * a))
            daten.append(255)
    return bytes(daten)


def chunk(typ, nutzlast):
    roh = typ + nutzlast
    return struct.pack(">I", len(nutzlast)) + roh + struct.pack(">I", zlib.crc32(roh))


def schreibe_png(pfad, kante):
    pixel = zeichne(kante)
    kopf = struct.pack(">IIBBBBB", kante, kante, 8, 6, 0, 0, 0)  # 8 bit RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", kopf)
        + chunk(b"IDAT", zlib.compress(pixel, 9))
        + chunk(b"IEND", b"")
    )
    pfad.write_bytes(png)
    print(f"{pfad}  {kante}x{kante}  {len(png):,} Bytes")


if __name__ == "__main__":
    ziel = Path(__file__).resolve().parent.parent / "public"
    ziel.mkdir(exist_ok=True)
    schreibe_png(ziel / "icon-192.png", 192)
    schreibe_png(ziel / "icon-512.png", 512)
    # iOS legt selbst runde Ecken an und mag keine Transparenz.
    schreibe_png(ziel / "apple-touch-icon.png", 180)
