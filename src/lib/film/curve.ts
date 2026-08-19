import type { CurveParams } from "./stocks";

/**
 * Die charakteristische Kurve in TypeScript.
 *
 * ACHTUNG: dieselbe Formel steht als GLSL in shaders.ts (Funktion `hdCurve`).
 * Beide muessen synchron bleiben - sonst zeigt die Kurvenanzeige etwas
 * anderes an, als der Shader rechnet. Der Grund fuer die Doppelung: GLSL
 * laeuft auf der GPU pro Pixel, die Anzeige braucht die Werte auf der CPU.
 */

/** Mittelgrau in linearem Licht, als Zweierlogarithmus. */
export const MID_GREY_LOG2 = Math.log2(0.18);

/** Weiche, monotone Begrenzung: bildet (-inf, inf) auf (-k, k) ab. */
export function softLimit(x: number, k: number): number {
  return x / (1 + Math.abs(x) / k);
}

/** Lineare Belichtung -> Ausgabewert 0..1. */
export function hdCurve(linearExposure: number, p: CurveParams): number {
  const logE = Math.log2(Math.max(linearExposure, 1e-6));
  const x = (logE - MID_GREY_LOG2 - p.speed) * p.gamma;
  const y = x < 0 ? softLimit(x, p.toe) : softLimit(x, p.shoulder);
  return Math.min(1, Math.max(0, 0.5 + 0.5 * y));
}

/** Bequemer fuer die Anzeige: Blendenstufen relativ zu Mittelgrau. */
export function curveAtStops(stops: number, p: CurveParams): number {
  return hdCurve(0.18 * Math.pow(2, stops), p);
}

/**
 * Push/Pull - laenger oder kuerzer entwickeln.
 *
 * Das ist der Regler, den Analogfotografen wirklich benutzen, und er ist
 * gleichzeitig einfacher und ehrlicher als ein blanker Kontrastregler: beim
 * Pushen steigt der Kontrast, das Korn wird groeber *und* die Schatten saufen
 * ab. Diese drei Dinge sind physikalisch gekoppelt, also gehoeren sie an
 * einen Regler.
 */
export function pushCurve(c: CurveParams, push: number): CurveParams {
  return {
    speed: c.speed,
    // Laengere Entwicklung = steilere Kurve.
    gamma: c.gamma * (1 + push * 0.16),
    // Die Schatten profitieren nicht mit - sie laufen frueher zu.
    toe: c.toe * (1 - push * 0.1),
    // Die Lichter dehnen sich etwas.
    shoulder: c.shoulder * (1 + push * 0.05),
  };
}

/** Korn wird beim Pushen deutlich groeber. */
export function pushGrain(push: number): number {
  return 1 + push * 0.45;
}
