import { FULL_CROP, type Crop } from "../gl/renderer";

/**
 * Bildformate, benannt nach dem Filmmaterial statt nach Zahlen.
 *
 * Ein Fotograf denkt nicht in "1:1", sondern in "6x6" - das ist die
 * Rollfilmkassette, die dieses Format erzeugt. Die Zahl steht daneben, weil
 * sie fuer alle anderen die verstaendlichere ist.
 */
export interface CropFormat {
  id: string;
  name: string;
  hint: string;
  /** Breite geteilt durch Hoehe. null = kein Beschnitt. */
  ratio: number | null;
}

export const CROP_FORMATS: CropFormat[] = [
  { id: "frei", name: "Frei", hint: "Originalformat", ratio: null },
  { id: "3-2", name: "3:2", hint: "Kleinbild, quer", ratio: 3 / 2 },
  { id: "2-3", name: "2:3", hint: "Kleinbild, hoch", ratio: 2 / 3 },
  { id: "1-1", name: "1:1", hint: "6x6 Rollfilm", ratio: 1 },
  { id: "7-6", name: "7:6", hint: "6x7 Rollfilm", ratio: 7 / 6 },
  { id: "16-9", name: "16:9", hint: "Breitbild", ratio: 16 / 9 },
];

export const DEFAULT_FORMAT = CROP_FORMATS[0];

export function formatById(id: string): CropFormat {
  return CROP_FORMATS.find((f) => f.id === id) ?? DEFAULT_FORMAT;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Den groesstmoeglichen Ausschnitt im gewuenschten Verhaeltnis berechnen.
 *
 * `offset` laeuft von -0.5 bis 0.5 und verschiebt den Ausschnitt innerhalb des
 * Spielraums, der uebrig bleibt. Bei 0 sitzt er mittig; passt das Format
 * ohnehin genau, gibt es keinen Spielraum und der Wert hat keine Wirkung.
 */
export function cropFor(
  ratio: number | null,
  sourceWidth: number,
  sourceHeight: number,
  offset: { x: number; y: number },
): Crop {
  if (ratio === null || sourceWidth <= 0 || sourceHeight <= 0) return FULL_CROP;

  const quelle = sourceWidth / sourceHeight;
  let w = 1;
  let h = 1;
  if (quelle > ratio) w = ratio / quelle;
  else h = quelle / ratio;

  const spielraumX = 1 - w;
  const spielraumY = 1 - h;
  return {
    x: clamp(spielraumX * (0.5 + offset.x), 0, spielraumX),
    y: clamp(spielraumY * (0.5 + offset.y), 0, spielraumY),
    w,
    h,
  };
}
