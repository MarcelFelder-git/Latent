/**
 * Die Regler-Werte. Eigenes Modul, weil sowohl die Oberflaeche als auch die
 * Voreinstellungen und der Verlauf sie brauchen - in einer Komponente waeren
 * sie an der falschen Stelle.
 */
export interface Adjustments {
  /** Blendenstufen heller/dunkler. */
  exposure: number;
  /** Laenger oder kuerzer entwickeln. */
  push: number;
  /** -1 kuehl bis +1 warm. */
  warmth: number;
  /** 0 = Original, 1 = volle Emulation. */
  strength: number;
  grain: number;
  halation: number;
  vignette: number;
}

export const NEUTRAL: Adjustments = {
  exposure: 0,
  push: 0,
  warmth: 0,
  strength: 1,
  grain: 1,
  halation: 1,
  vignette: 0.18,
};
