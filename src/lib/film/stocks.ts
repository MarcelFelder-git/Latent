/**
 * Ein Filmstock ist reine Daten. Ein neuer Stock heisst: ein Objekt mehr in
 * STOCKS, keine Zeile Code. Das ist Absicht - die Kurven-Parameter sind der
 * eigentliche kreative Teil und sollen ohne Deploy justierbar bleiben.
 */

/**
 * Ein Ast der charakteristischen Kurve, pro Farbkanal.
 *
 * Echter Film hat je Emulsionsschicht eine eigene Dichtekurve. Genau daher
 * kommt der Farbcharakter: Portras Schatten kippen leicht kuehl, die Lichter
 * laufen cremig warm aus. Ein globaler Kontrastregler kann das nicht.
 *
 * speed     Verschiebung entlang der Belichtungsachse, in Blendenstufen.
 *           0 = Pivot auf Mittelgrau. Negativ = Kanal reagiert frueher und
 *           wird damit heller.
 * gamma     Steigung des geraden Kurventeils. Kleiner = flacher. Negativfilm
 *           liegt typisch bei 0.5-0.7.
 * toe       Wie weit der Kanal in die Tiefen hinunterreicht (0..1). Kleiner =
 *           die Schatten laufen frueher in ein Plateau, werden also angehoben.
 *           Die Differenz zwischen den Kanaelen ist der Farbstich der Tiefen.
 * shoulder  Wie weit der Kanal in die Lichter hinaufreicht. Kleiner = macht
 *           frueher dicht. Die Differenz zwischen den Kanaelen ist der
 *           Farbstich der Lichter.
 */
export interface CurveParams {
  speed: number;
  gamma: number;
  toe: number;
  shoulder: number;
}

export interface FilmStock {
  slug: string;
  name: string;
  iso: number;
  /** Kurzbeschreibung fuer die UI. */
  blurb: string;

  curve: { r: CurveParams; g: CurveParams; b: CurveParams };

  /**
   * Schwarzweissfilm. Die drei Kanaele werden vor der Entwicklung spektral
   * gewichtet zu einem Wert zusammengefasst; die drei Kurven sind dann
   * identisch. Es braucht also keinen Sonderweg in der Pipeline - genau
   * daran zeigt sich, ob die Architektur taugt.
   */
  monochrome?: boolean;

  /**
   * Spektrale Empfindlichkeit fuer Schwarzweiss. Klassischer Film ist
   * blauempfindlicher als das menschliche Auge - deshalb kommen blaue Himmel
   * ohne Gelbfilter zu hell heraus.
   */
  spectral: [number, number, number];

  /**
   * Spektrale Ueberlagerung der Schichten, als 3x3-Matrix in Zeilenform.
   * Filmschichten sind nicht sauber getrennt - blaues Licht belichtet die
   * Gruenschicht ein bisschen mit. Zeilensummen bleiben 1.0, damit
   * Neutralgrau neutral bleibt.
   */
  crosstalk: [number, number, number, number, number, number, number, number, number];

  grain: {
    /** Korngroesse in Bildpixeln. Groesser = groberes Korn. */
    size: number;
    /** Grundstaerke. Wird in der UI zusaetzlich skaliert. */
    intensity: number;
    /** Pro Kanal - die Blauschicht ist bei echtem Film immer die koernigste. */
    channelBias: [number, number, number];
  };

  halation: {
    /**
     * Ab welcher *linearen* Belichtung Licht in die Nachbarschaft streut.
     * Mittelgrau liegt bei 0.18, jede Verdopplung ist eine Blendenstufe -
     * 0.72 entspricht also etwa +2 Blenden.
     */
    threshold: number;
    /** Tap-Schrittweite im verkleinerten Halationspuffer, nicht in
     *  Bildpixeln. Sinnvoll ist etwa 1.0 bis 3.0. */
    radius: number;
    strength: number;
    /** Farbe des Streulichts. Rot dominiert, weil langwelliges Licht am
     *  weitesten durch die Emulsion wandert. */
    tint: [number, number, number];
  };

  /** Wie stark Farben zu den Lichtern hin ausbleichen. */
  highlightDesat: number;
}

export const STOCKS: FilmStock[] = [
  {
    slug: "portra-400",
    name: "Portra 400",
    iso: 400,
    blurb: "Weiche Schatten, cremige Lichter, Hauttoene bleiben stehen.",
    spectral: [0.3, 0.4, 0.3],
    curve: {
      // Rot reicht am weitesten in beide Richtungen. Ergebnis: Lichter laufen
      // warm aus (R > G > B), Tiefen kippen kuehl (B > G > R).
      r: { speed: 0.0, gamma: 0.58, toe: 0.92, shoulder: 1.05 },
      g: { speed: 0.0, gamma: 0.6, toe: 0.88, shoulder: 0.97 },
      b: { speed: -0.06, gamma: 0.64, toe: 0.84, shoulder: 0.88 },
    },
    crosstalk: [
      1.0, 0.02, -0.02,
      0.01, 1.0, -0.01,
      -0.01, 0.03, 0.98,
    ],
    grain: { size: 1.5, intensity: 0.055, channelBias: [0.85, 1.0, 1.35] },
    halation: { threshold: 0.9, radius: 1.4, strength: 0.06, tint: [1.0, 0.34, 0.16] },
    highlightDesat: 0.35,
  },
  {
    slug: "cinestill-800t",
    name: "Cinestill 800T",
    iso: 800,
    blurb: "Kunstlichtfilm ohne Lichthofschutz - Lichter gluehen rot.",
    spectral: [0.3, 0.4, 0.3],
    curve: {
      r: { speed: 0.08, gamma: 0.66, toe: 0.9, shoulder: 1.02 },
      g: { speed: 0.0, gamma: 0.68, toe: 0.86, shoulder: 0.93 },
      // Tungsten-balanciert: die Blauschicht ist deutlich empfindlicher
      // (speed weit negativ), deshalb wirken Tageslichtaufnahmen kuehl.
      b: { speed: -0.34, gamma: 0.7, toe: 0.82, shoulder: 0.86 },
    },
    crosstalk: [
      1.0, 0.03, -0.03,
      0.02, 1.0, -0.02,
      -0.02, 0.02, 1.0,
    ],
    grain: { size: 2.1, intensity: 0.085, channelBias: [0.9, 1.0, 1.45] },
    // Der Grund fuer den ganzen Film: ohne Anti-Halation-Schicht streut Licht
    // durch den Traeger zurueck in die Emulsion. Daher der breite rote Hof.
    halation: { threshold: 0.45, radius: 2.6, strength: 0.4, tint: [1.0, 0.16, 0.08] },
    highlightDesat: 0.28,
  },
  {
    slug: "tri-x-400",
    name: "Tri-X 400",
    iso: 400,
    blurb: "Schwarzweiss, kraeftiges Korn, blaue Himmel kommen hell.",
    monochrome: true,
    // Deutlich blauempfindlicher als das Auge - der klassische Grund fuer den
    // Gelbfilter in der Landschaftsfotografie.
    spectral: [0.26, 0.36, 0.38],
    curve: {
      // Alle drei identisch: nach der spektralen Zusammenfassung ist ohnehin
      // nur noch ein Wert da. Kein Sonderfall in der Pipeline noetig.
      r: { speed: 0.0, gamma: 0.72, toe: 0.95, shoulder: 1.1 },
      g: { speed: 0.0, gamma: 0.72, toe: 0.95, shoulder: 1.1 },
      b: { speed: 0.0, gamma: 0.72, toe: 0.95, shoulder: 1.1 },
    },
    crosstalk: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    grain: { size: 2.4, intensity: 0.11, channelBias: [1.0, 1.0, 1.0] },
    halation: { threshold: 0.8, radius: 1.6, strength: 0.07, tint: [1.0, 1.0, 1.0] },
    highlightDesat: 0.0,
  },
];

export const DEFAULT_STOCK = STOCKS[0];

export function stockBySlug(slug: string): FilmStock {
  return STOCKS.find((s) => s.slug === slug) ?? DEFAULT_STOCK;
}
