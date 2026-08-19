/**
 * Messwerte aus einem Bild, aus denen sich ein Filmvorschlag ableiten laesst.
 *
 * Bewusst gemessen und nicht geraten: Helligkeit, Kontrast, Farbtemperatur,
 * Saettigung, der Anteil an Spitzlichtern und an Hauttoenen sind genau die
 * Groessen, nach denen auch ein Mensch den Film waehlt. Ein Modell braucht es
 * erst fuer die *Bedeutung* der Szene - ob jemand posiert oder ob es ein
 * Strassenfoto ist. Diese Ebene liegt darueber, nicht darunter.
 */

/** Auf diese Kantenlaenge wird zum Messen verkleinert. */
const SAMPLE_EDGE = 256;

export interface ImageStats {
  /** Mittlere Helligkeit, 0..1. */
  brightness: number;
  /** Standardabweichung der Helligkeit - grob der Kontrastumfang. */
  contrast: number;
  /** Farbtemperatur als log2(Rot/Blau). Positiv = warm. */
  warmth: number;
  /** Mittlere Farbigkeit, 0..1. */
  saturation: number;
  /** Anteil sehr heller Pixel - Lampen, Sonne, Spiegelungen. */
  highlightArea: number;
  /** Anteil sehr dunkler Pixel. */
  shadowArea: number;
  /** Anteil Pixel im typischen Hauttonbereich. */
  skinArea: number;
  /** Anteil bereits abgeschnittener Pixel im Original. */
  clipped: number;
}

/**
 * Hauttonerkennung ueber YCbCr. Der klassische Bereich ist erstaunlich robust
 * ueber verschiedene Hautfarben hinweg, weil er die Helligkeit herausrechnet
 * und nur die Farbigkeit betrachtet - genau deshalb wird er seit Jahrzehnten
 * dafuer benutzt.
 */
function istHautton(r: number, g: number, b: number): boolean {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

export function analyzeImage(bitmap: ImageBitmap): ImageStats | null {
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  let summe = 0;
  let summeQuadrat = 0;
  let summeSaettigung = 0;
  let logWarm = 0;
  let warmZaehler = 0;
  let hell = 0;
  let dunkel = 0;
  let haut = 0;
  let clipped = 0;
  const n = w * h;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    summe += lum;
    summeQuadrat += lum * lum;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    summeSaettigung += max === 0 ? 0 : (max - min) / max;

    // Sehr dunkle Pixel taugen nicht zur Temperaturmessung - dort dominiert
    // das Rauschen das Verhaeltnis der Kanaele.
    if (lum > 0.12) {
      logWarm += Math.log2(Math.max(r, 1) / Math.max(b, 1));
      warmZaehler++;
    }

    if (lum > 0.9) hell++;
    if (lum < 0.06) dunkel++;
    if (r >= 254 && g >= 254 && b >= 254) clipped++;
    if (istHautton(r, g, b)) haut++;
  }

  const mittel = summe / n;
  return {
    brightness: mittel,
    contrast: Math.sqrt(Math.max(0, summeQuadrat / n - mittel * mittel)),
    warmth: warmZaehler > 0 ? logWarm / warmZaehler : 0,
    saturation: summeSaettigung / n,
    highlightArea: hell / n,
    shadowArea: dunkel / n,
    skinArea: haut / n,
    clipped: clipped / n,
  };
}
