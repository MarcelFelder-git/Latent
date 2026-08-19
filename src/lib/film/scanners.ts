/**
 * Der Scanner ist Teil des Looks, nicht neutral - unter Analogfotografen ist
 * Frontier gegen Noritsu ein Glaubenskrieg. Deshalb hier eine eigene Ebene
 * und nicht als Anhaengsel am Filmstock: derselbe Film sieht je nach Labor
 * sichtbar anders aus.
 */
export interface ScannerProfile {
  slug: string;
  name: string;
  blurb: string;
  /**
   * Ausgabe-Normalisierung: welcher Wert der Entwicklung auf 0 bzw. auf 1
   * abgebildet wird.
   *
   * Ohne diese Stufe bleibt das Bild milchig. Der Dichteumfang eines
   * Negativs ist komprimiert - es erreicht weder echtes Schwarz noch echtes
   * Weiss. Ein Laborscanner zieht den Scan deshalb auf den vollen Umfang;
   * genau daher hat ein Frontier-Scan von Portra echte Lichter und Tiefen,
   * obwohl der Film selbst flau ist. Die Kurvenform bleibt erhalten, nur der
   * Umfang wird gedehnt.
   */
  blackPoint: number;
  whitePoint: number;
  /** Anhebung der Schwarzwerte pro Kanal (Grundschleier plus Scannerlicht). */
  lift: [number, number, number];
  /** Verstaerkung pro Kanal. */
  gain: [number, number, number];
  /** 1.0 = unveraendert, darunter flauer, darueber kraeftiger. */
  saturation: number;
}

export const SCANNERS: ScannerProfile[] = [
  {
    slug: "frontier",
    name: "Frontier",
    blurb: "Kraeftiger, kuehlere Tiefen, knackige Mitten.",
    // Zieht beherzt auf: echtes Schwarz, echtes Weiss.
    blackPoint: 0.06,
    whitePoint: 0.8,
    lift: [0.012, 0.013, 0.02],
    gain: [0.99, 0.99, 0.985],
    saturation: 1.08,
  },
  {
    slug: "noritsu",
    name: "Noritsu",
    blurb: "Flauer und waermer, mehr Zeichnung in den Lichtern.",
    // Zurueckhaltender - laesst oben mehr Luft, wirkt dadurch weicher.
    blackPoint: 0.03,
    whitePoint: 0.88,
    lift: [0.022, 0.018, 0.016],
    gain: [0.975, 0.98, 0.985],
    saturation: 0.94,
  },
];

export const DEFAULT_SCANNER = SCANNERS[0];

export function scannerBySlug(slug: string): ScannerProfile {
  return SCANNERS.find((s) => s.slug === slug) ?? DEFAULT_SCANNER;
}
