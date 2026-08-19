import type { ImageStats } from "../analyze";
import { NEUTRAL, type Adjustments } from "./adjustments";

/**
 * Aus Messwerten einen Filmvorschlag ableiten.
 *
 * Bewusst als lesbare Regeln und nicht als Blackbox: jeder Vorschlag bringt
 * seine Begruendung mit, und die Begruendung ist derselbe Satz, den ein
 * Fotograf sagen wuerde. Das ist nicht nur ehrlicher - es macht den Vorschlag
 * auch korrigierbar, weil man sieht, worauf er sich stuetzt.
 *
 * Das Modell trifft hier keine Entscheidung; es setzt einen Startpunkt. Alle
 * Regler bleiben danach offen.
 */
export interface Suggestion {
  stock: string;
  scanner: string;
  adjustments: Adjustments;
  /** Wie der Vorschlag heisst, in einem Halbsatz. */
  headline: string;
  /** Worauf er sich stuetzt - je ein Satz pro Messwert. */
  reasons: string[];
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

export function suggestLook(stats: ImageStats): Suggestion {
  const reasons: string[] = [];

  // --- Szene einordnen -------------------------------------------------
  // Die Schwelle fuer Spitzlichter ist bewusst niedrig: vier Strassenlampen
  // in einem Bild machen zusammen keinen halben Prozent der Flaeche aus, sind
  // aber genau der Fall, um den es hier geht. Entscheidend ist nicht wieviel
  // hell ist, sondern dass ueberhaupt etwas hell ist, waehrend der Rest
  // absaeuft.
  const dunkelMitLichtern =
    stats.brightness < 0.3 && stats.highlightArea > 0.0008 && stats.shadowArea > 0.25;
  /**
   * Hier liegt die Grenze dieser Herangehensweise, und sie ist grundsaetzlich:
   * Sand, Holz und beige Waende liegen farblich exakt im selben Bereich wie
   * Haut. Rein aus den Farbwerten laesst sich das nicht trennen - dafuer
   * braeuchte es ein Modell, das die Szene *versteht*.
   *
   * Konsequenzen daraus: die Begruendung behauptet nur, was gemessen wurde
   * ("im Farbbereich von Hauttoenen"), nicht was daraus folgt. Und ein
   * Anteil ueber der Haelfte des Bildes ist fuer ein Portraet unplausibel -
   * das ist dann eine Flaeche, kein Gesicht.
   */
  const vieleHauttoene = stats.skinArea > 0.12 && stats.skinArea < 0.5;
  // Enger gefasst, damit nur wirklich farblose Motive nach Schwarzweiss
  // laufen - ein kontrastreiches Motiv mit gedaempften Farben soll nicht
  // allein deshalb entfaerbt werden.
  const flauUndFarblos = stats.saturation < 0.12;
  const hartesLicht = stats.contrast > 0.28 && stats.brightness > 0.42;

  let stock = "portra-400";
  let scanner = "frontier";
  let headline = "Ausgewogen";
  const adj: Adjustments = { ...NEUTRAL };

  if (dunkelMitLichtern) {
    stock = "cinestill-800t";
    headline = "Nachtaufnahme mit Lichtquellen";
    adj.push = 0.5;
    adj.halation = 1.4;
    adj.vignette = 0.28;
    reasons.push(
      `Dunkles Motiv (${pct(stats.brightness)} mittlere Helligkeit) mit hellen Punkten - typisch fuer Kunstlicht.`,
      "Cinestill glueht um Lampen, weil ihm die Lichthofschutzschicht fehlt.",
    );
  } else if (flauUndFarblos) {
    stock = "tri-x-400";
    headline = "Wenig Farbe im Motiv";
    adj.push = 0.6;
    adj.grain = 1.15;
    reasons.push(
      `Nur ${pct(stats.saturation)} Farbigkeit - die Farbe traegt das Bild hier nicht.`,
      "Schwarzweiss macht daraus eine Entscheidung statt eines Mangels.",
    );
  } else if (vieleHauttoene) {
    stock = "portra-400";
    scanner = "noritsu";
    headline = "Hauttoene im Bild";
    adj.push = -0.25;
    adj.grain = 0.75;
    adj.vignette = 0.12;
    reasons.push(
      `${pct(stats.skinArea)} der Flaeche liegt im Farbbereich von Hauttoenen.`,
      "Portra haelt Hauttoene getrennt, Noritsu scannt dazu zurueckhaltender.",
    );
  } else if (hartesLicht) {
    stock = "portra-400";
    scanner = "noritsu";
    headline = "Hartes Licht";
    adj.push = -0.45;
    adj.exposure = -0.2;
    reasons.push(
      `Hoher Kontrastumfang bei ${pct(stats.brightness)} Helligkeit - Mittagslicht oder Gegenlicht.`,
      "Flachere Entwicklung faengt die Lichter ab, statt sie ausbrennen zu lassen.",
    );
  } else {
    reasons.push("Keine ausgepraegte Besonderheit gemessen - Portra als Allrounder.");
  }

  // --- Feinabgleich aus den Messwerten ---------------------------------
  if (stats.clipped > 0.01) {
    adj.exposure -= 0.25;
    reasons.push(
      `${pct(stats.clipped)} der Pixel sind schon im Original ausgefressen - etwas dunkler entwickelt.`,
    );
  } else if (stats.brightness < 0.22) {
    adj.exposure += 0.35;
    reasons.push("Insgesamt sehr dunkel - Belichtung angehoben.");
  }

  // Warmth wird nur *entgegengesetzt* korrigiert, und nur zur Haelfte: ein
  // warmer Sonnenuntergang soll warm bleiben, ein Farbstich aber weg.
  if (Math.abs(stats.warmth) > 0.35) {
    adj.warmth = Math.max(-0.6, Math.min(0.6, -stats.warmth * 0.5));
    reasons.push(
      stats.warmth > 0
        ? "Deutlicher Warmstich - zur Haelfte ausgeglichen, der Rest bleibt Stimmung."
        : "Deutlicher Kaltstich - zur Haelfte ausgeglichen.",
    );
  }

  return { stock, scanner, adjustments: adj, headline, reasons };
}
