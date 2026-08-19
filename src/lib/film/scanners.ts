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
    lift: [0.012, 0.013, 0.02],
    gain: [0.99, 0.99, 0.985],
    saturation: 1.08,
  },
  {
    slug: "noritsu",
    name: "Noritsu",
    blurb: "Flauer und waermer, mehr Zeichnung in den Lichtern.",
    lift: [0.022, 0.018, 0.016],
    gain: [0.975, 0.98, 0.985],
    saturation: 0.94,
  },
];

export const DEFAULT_SCANNER = SCANNERS[0];

export function scannerBySlug(slug: string): ScannerProfile {
  return SCANNERS.find((s) => s.slug === slug) ?? DEFAULT_SCANNER;
}
