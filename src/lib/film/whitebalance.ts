/**
 * Weissabgleich als zwei Achsen und die Umkehrrechnung dazu.
 *
 * Eine Achse reicht nicht: Temperatur (rot gegen blau) faengt Gluehlicht und
 * Schatten ab, aber Leuchtstoffroehren kippen ins Gruene und Blitzlicht ins
 * Magenta. Ohne die zweite Achse kann eine Pipette einen angeklickten Punkt
 * nicht wirklich neutral rechnen - sie kaeme immer nur in die Naehe.
 *
 * Gerechnet wird in Blendenstufen, nicht als additive Verstaerkung. Licht ist
 * multiplikativ: ein Kunstlichtstich verschiebt Rot gegen Blau leicht um den
 * Faktor drei, und das laesst sich mit einem Zuschlag von ein paar Prozent
 * nicht einholen. Als Exponent bleibt der Regler nahe der Mitte trotzdem fein.
 */

/** Halbe Spreizung zwischen Rot und Blau bei warmth = 1, in Blendenstufen. */
export const WARMTH_STOPS = 1.3;
/** Verschiebung des Gruenkanals bei tint = 1, in Blendenstufen. */
export const TINT_STOPS = 0.8;

/**
 * Verstaerkung pro Kanal.
 *
 * Die drei Werte sind so normiert, dass ihr geometrisches Mittel 1 ergibt -
 * damit ist die Operation eine reine Umverteilung zwischen den Kanaelen und
 * die Gesamthelligkeit wandert beim Drehen nicht mit.
 */
export function whiteBalanceGain(warmth: number, tint: number): [number, number, number] {
  const w = warmth * WARMTH_STOPS;
  const t = tint * TINT_STOPS;
  // Ausgleichsterm, damit die Summe der Exponenten null bleibt.
  const k = t / 3;
  return [2 ** (w + k), 2 ** (-2 * k), 2 ** (-w + k)];
}

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const clamp = (v: number) => Math.min(1, Math.max(-1, v));

/**
 * Aus einer angeklickten Farbe die Reglerstellungen ableiten, die sie neutral
 * machen - die Umkehrung von whiteBalanceGain.
 *
 * Die noetige Verstaerkung ist der Kehrwert der gemessenen Kanalwerte, wieder
 * auf geometrisches Mittel 1 normiert. Danach lassen sich beide Achsen direkt
 * aus den Logarithmen ablesen; ein Rest, der auf keiner der beiden Achsen
 * liegt, bleibt unkorrigiert, weil das Modell ihn nicht darstellen kann.
 */
export function neutralizeFrom(
  r: number,
  g: number,
  b: number,
): { warmth: number; tint: number } {
  const lin = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)].map((v) =>
    Math.max(v, 1e-4),
  );
  const inv = lin.map((v) => 1 / v);
  const mittel = Math.cbrt(inv[0] * inv[1] * inv[2]);
  const log = inv.map((v) => Math.log2(v / mittel));

  const warmth = (log[0] - log[2]) / (2 * WARMTH_STOPS);
  const tint = (-3 * log[1]) / (2 * TINT_STOPS);
  return { warmth: clamp(warmth), tint: clamp(tint) };
}
