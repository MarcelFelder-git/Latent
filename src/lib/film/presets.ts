import { NEUTRAL, type Adjustments } from "./adjustments";

/**
 * Voreinstellungen und Rezepte sind dieselbe Sache von zwei Enden: wer sich
 * nicht auskennt, waehlt eine fertige Vorgabe nach Motiv; wer sich auskennt,
 * legt eigene an und wendet sie auf eine ganze Serie an. Deshalb sind die
 * Namen nach *Situation* benannt, nicht nach Technik - "Goldene Stunde" sagt
 * einem Laien etwas, "Portra +1 Push, 60 % Halation" nicht.
 */
export interface Preset {
  slug: string;
  name: string;
  blurb: string;
  stock: string;
  scanner: string;
  adjustments: Adjustments;
}

export const PRESETS: Preset[] = [
  {
    slug: "portraet",
    name: "Portraet",
    blurb: "Hauttoene halten, Kontrast zurueck.",
    stock: "portra-400",
    scanner: "noritsu",
    adjustments: { ...NEUTRAL, push: -0.3, warmth: 0.12, grain: 0.7, vignette: 0.12 },
  },
  {
    slug: "goldene-stunde",
    name: "Goldene Stunde",
    blurb: "Warme Lichter, weiche Schatten.",
    stock: "portra-400",
    scanner: "frontier",
    adjustments: { ...NEUTRAL, exposure: 0.25, warmth: 0.3, halation: 1.4, vignette: 0.22 },
  },
  {
    slug: "nachts-in-der-stadt",
    name: "Nachts in der Stadt",
    blurb: "Neon glueht, Schatten bleiben tief.",
    stock: "cinestill-800t",
    scanner: "frontier",
    adjustments: { ...NEUTRAL, exposure: -0.2, push: 0.6, halation: 1.5, vignette: 0.3 },
  },
  {
    slug: "grelle-sonne",
    name: "Grelle Sonne",
    blurb: "Harte Mittagssonne gebaendigt.",
    stock: "portra-400",
    scanner: "noritsu",
    adjustments: { ...NEUTRAL, exposure: -0.35, push: -0.5, warmth: -0.08, vignette: 0.1 },
  },
  {
    slug: "reportage",
    name: "Reportage",
    blurb: "Schwarzweiss, kraeftig, koernig.",
    stock: "tri-x-400",
    scanner: "frontier",
    adjustments: { ...NEUTRAL, push: 1, grain: 1.3, vignette: 0.25 },
  },
];
