import { NEUTRAL, type Adjustments } from "./adjustments";

/**
 * Presets - mitgeliefert und selbst angelegt, in einem Modul.
 *
 * Beides ist dieselbe Sache von zwei Enden: wer sich nicht auskennt, waehlt
 * eine fertige Vorgabe nach Motiv; wer sich auskennt, legt eigene an und
 * wendet sie auf eine ganze Serie an. Zwei getrennte Typen dafuer waeren nur
 * Buchhaltung.
 *
 * Die mitgelieferten sind nach *Situation* benannt, nicht nach Technik -
 * "Goldene Stunde" sagt einem Laien etwas, "Portra +1 Push, 60 % Halation"
 * nicht.
 */
export interface Preset {
  id: string;
  name: string;
  blurb: string;
  stock: string;
  scanner: string;
  adjustments: Adjustments;
  /** Selbst angelegt - nur diese lassen sich loeschen. */
  custom?: boolean;
}

export const BUILTIN_PRESETS: Preset[] = [
  {
    id: "portraet",
    name: "Portraet",
    blurb: "Hauttoene halten, Kontrast zurueck.",
    stock: "portra-400",
    scanner: "noritsu",
    adjustments: { ...NEUTRAL, push: -0.3, warmth: 0.12, tint: -0.04, grain: 0.7, vignette: 0.12 },
  },
  {
    id: "goldene-stunde",
    name: "Goldene Stunde",
    blurb: "Warme Lichter, weiche Schatten.",
    stock: "portra-400",
    scanner: "frontier",
    adjustments: { ...NEUTRAL, exposure: 0.25, warmth: 0.3, halation: 1.4, vignette: 0.22 },
  },
  {
    id: "nachts-in-der-stadt",
    name: "Nachts in der Stadt",
    blurb: "Neon glueht, Schatten bleiben tief.",
    stock: "cinestill-800t",
    scanner: "frontier",
    adjustments: { ...NEUTRAL, exposure: -0.2, push: 0.6, tint: 0.06, halation: 1.5, vignette: 0.3 },
  },
  {
    id: "grelle-sonne",
    name: "Grelle Sonne",
    blurb: "Harte Mittagssonne gebaendigt.",
    stock: "portra-400",
    scanner: "noritsu",
    adjustments: { ...NEUTRAL, exposure: -0.35, push: -0.5, warmth: -0.08, vignette: 0.1 },
  },
  {
    id: "reportage",
    name: "Reportage",
    blurb: "Schwarzweiss, kraeftig, koernig.",
    stock: "tri-x-400",
    scanner: "frontier",
    adjustments: { ...NEUTRAL, push: 1, grain: 1.3, vignette: 0.25 },
  },
  {
    id: "gedaempft",
    name: "Gedaempft",
    blurb: "Zurueckhaltend, halbe Staerke.",
    stock: "portra-400",
    scanner: "noritsu",
    adjustments: { ...NEUTRAL, strength: 0.55, push: -0.2, grain: 0.5, vignette: 0.08 },
  },
];

const KEY = "film-lab.presets.v1";

/**
 * localStorage kann fehlen oder werfen - im privaten Modus mancher Browser
 * oder wenn das Kontingent voll ist. Das darf die App nie umbringen, eigene
 * Presets sind Komfort und keine Voraussetzung.
 */
function read(): Preset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as Preset[]).map((p) => ({ ...p, custom: true }));
  } catch {
    return [];
  }
}

function write(list: Preset[]): Preset[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* nicht speicherbar - die Liste gilt dann nur fuer diese Sitzung */
  }
  return list;
}

export function loadCustomPresets(): Preset[] {
  return read();
}

export function saveCustomPreset(
  entry: Omit<Preset, "id" | "blurb" | "custom">,
): Preset[] {
  const list = read();
  // Gleicher Name ueberschreibt - sonst sammeln sich drei "Portraet 2" an.
  const ohne = list.filter((p) => p.name.toLowerCase() !== entry.name.toLowerCase());
  return write([
    ...ohne,
    { ...entry, id: crypto.randomUUID(), blurb: "Eigenes Preset", custom: true },
  ]);
}

export function removeCustomPreset(id: string): Preset[] {
  return write(read().filter((p) => p.id !== id));
}
