import type { ImageStats } from "../analyze";
import type { SceneLabel, SceneScores } from "../semantic";
import { NEUTRAL, type Adjustments } from "./adjustments";

/**
 * Aus Messwerten - und wenn vorhanden aus der Szenenerkennung - einen
 * Filmvorschlag ableiten.
 *
 * Bewusst als lesbare Regeln und nicht als Blackbox: jeder Vorschlag bringt
 * seine Begruendung mit, und die Begruendung ist derselbe Satz, den ein
 * Fotograf sagen wuerde. Das ist nicht nur ehrlicher - es macht den Vorschlag
 * auch korrigierbar, weil man sieht, worauf er sich stuetzt.
 *
 * Aufgabenteilung: das Modell beantwortet *was ist das fuer eine Szene*, die
 * Messung beantwortet *wie ist sie belichtet*. Helligkeit und Kontrast
 * braucht kein Modell, die misst man direkt und genauer.
 *
 * Entschieden wird nichts endgueltig - es ist ein Startpunkt, alle Regler
 * bleiben danach offen.
 */
export interface Suggestion {
  stock: string;
  scanner: string;
  adjustments: Adjustments;
  headline: string;
  reasons: string[];
  /** Ob die Szene vom Modell kam oder aus den Farbwerten geschaetzt wurde. */
  usedModel: boolean;
}

type Szene = "nacht" | "portraet" | "monochrom" | "hartesLicht" | "neutral";

const pct = (v: number) => `${Math.round(v * 100)} %`;

const SZENEN_NAMEN: Record<SceneLabel, string> = {
  portrait: "Portraet",
  people: "Menschen",
  night: "Nachtszene",
  beach: "Strand",
  landscape: "Landschaft",
  indoor: "Innenraum",
  street: "Strassenszene",
  food: "Essen",
};

/** Szene allein aus den Farbwerten - der Weg ohne Modell. */
function szeneAusMessung(stats: ImageStats): { szene: Szene; gruende: string[] } {
  // Entscheidend ist nicht, wieviel hell ist, sondern dass ueberhaupt etwas
  // hell ist, waehrend der Rest absaeuft. Vier Strassenlampen machen zusammen
  // keinen halben Prozent der Flaeche aus.
  if (stats.brightness < 0.3 && stats.highlightArea > 0.0008 && stats.shadowArea > 0.25) {
    return {
      szene: "nacht",
      gruende: [
        `Dunkles Motiv (${pct(stats.brightness)} mittlere Helligkeit) mit hellen Punkten - typisch fuer Kunstlicht.`,
      ],
    };
  }
  if (stats.saturation < 0.12) {
    return {
      szene: "monochrom",
      gruende: [`Nur ${pct(stats.saturation)} Farbigkeit - die Farbe traegt das Bild hier nicht.`],
    };
  }
  if (stats.skinArea > 0.12 && stats.skinArea < 0.5) {
    return {
      szene: "portraet",
      gruende: [
        `${pct(stats.skinArea)} der Flaeche liegt im Farbbereich von Hauttoenen.`,
        "Ohne Szenenerkennung ist das eine Vermutung - Sand und Holz sehen genauso aus.",
      ],
    };
  }
  if (stats.contrast > 0.28 && stats.brightness > 0.42) {
    return {
      szene: "hartesLicht",
      gruende: [
        `Hoher Kontrastumfang bei ${pct(stats.brightness)} Helligkeit - Mittagslicht oder Gegenlicht.`,
      ],
    };
  }
  return { szene: "neutral", gruende: ["Keine ausgepraegte Besonderheit gemessen."] };
}

/** Szene aus dem Modell, mit den Farbwerten als Ergaenzung. */
function szeneAusModell(
  scene: SceneScores,
  stats: ImageStats,
): { szene: Szene; gruende: string[] } {
  const sortiert = (Object.entries(scene) as [SceneLabel, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const [oben, wert] = sortiert[0] ?? ["landscape", 0];
  const gruende = [`Modell erkennt: ${SZENEN_NAMEN[oben]} (${pct(wert)}).`];

  const menschen = (scene.portrait ?? 0) + (scene.people ?? 0);
  const nacht = scene.night ?? 0;

  // Nacht schlaegt alles andere: dort entscheidet das Licht, nicht das Motiv.
  if (nacht > 0.3 || (oben === "night" && nacht > 0.2)) {
    gruende.push("Kunstlicht im Dunkeln - Cinestill glueht um Lampen.");
    return { szene: "nacht", gruende };
  }

  if (menschen > 0.35) {
    gruende.push(
      "Portra haelt Hauttoene getrennt, Noritsu scannt dazu zurueckhaltender.",
    );
    return { szene: "portraet", gruende };
  }

  // Hier zahlt sich das Modell aus: ohne es wuerde eine Sandflaeche wegen
  // ihrer Farbe als Portraet durchgehen.
  if ((oben === "beach" || oben === "landscape") && stats.skinArea > 0.12) {
    gruende.push(
      `Die ${pct(stats.skinArea)} hautfarbene Flaeche gehoeren zum Motiv, nicht zu einem Gesicht.`,
    );
  }

  if (stats.saturation < 0.12) {
    gruende.push(`Nur ${pct(stats.saturation)} Farbigkeit - die Farbe traegt das Bild nicht.`);
    return { szene: "monochrom", gruende };
  }
  if (stats.contrast > 0.28 && stats.brightness > 0.42) {
    gruende.push(`Hoher Kontrastumfang bei ${pct(stats.brightness)} Helligkeit.`);
    return { szene: "hartesLicht", gruende };
  }
  return { szene: "neutral", gruende };
}

export function suggestLook(stats: ImageStats, scene?: SceneScores | null): Suggestion {
  const { szene, gruende } =
    scene && Object.keys(scene).length > 0
      ? szeneAusModell(scene, stats)
      : szeneAusMessung(stats);
  const reasons = [...gruende];

  let stock = "portra-400";
  let scanner = "frontier";
  let headline = "Ausgewogen";
  const adj: Adjustments = { ...NEUTRAL };

  switch (szene) {
    case "nacht":
      stock = "cinestill-800t";
      headline = "Nachtaufnahme mit Lichtquellen";
      adj.push = 0.5;
      adj.halation = 1.4;
      adj.vignette = 0.28;
      break;
    case "monochrom":
      stock = "tri-x-400";
      headline = "Wenig Farbe im Motiv";
      adj.push = 0.6;
      adj.grain = 1.15;
      break;
    case "portraet":
      scanner = "noritsu";
      headline = "Menschen im Bild";
      adj.push = -0.25;
      adj.grain = 0.75;
      adj.vignette = 0.12;
      break;
    case "hartesLicht":
      scanner = "noritsu";
      headline = "Hartes Licht";
      adj.push = -0.45;
      adj.exposure = -0.2;
      break;
    default:
      headline = "Ausgewogen";
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

  // Farbstich wird nur zur Haelfte ausgeglichen: ein warmer Sonnenuntergang
  // soll warm bleiben, ein Kunstlichtstich aber weg.
  if (Math.abs(stats.warmth) > 0.35) {
    adj.warmth = Math.max(-0.6, Math.min(0.6, -stats.warmth * 0.5));
    reasons.push(
      stats.warmth > 0
        ? "Deutlicher Warmstich - zur Haelfte ausgeglichen, der Rest bleibt Stimmung."
        : "Deutlicher Kaltstich - zur Haelfte ausgeglichen.",
    );
  }

  return {
    stock,
    scanner,
    adjustments: adj,
    headline,
    reasons,
    usedModel: Boolean(scene && Object.keys(scene).length > 0),
  };
}
