import type { Adjustments } from "./adjustments";

/**
 * Eigene Rezepte, im Browser gespeichert.
 *
 * Die mitgelieferten Voreinstellungen decken den Einstieg ab; wer eine Serie
 * gleich aussehen lassen will, braucht aber seinen eigenen Look wiederholbar.
 * Genau das ist der Punkt, an dem aus einem Spielzeug ein Werkzeug wird - und
 * die Grundlage fuer eine spaetere Stapelverarbeitung.
 */

const KEY = "film-lab.recipes.v1";

export interface Recipe {
  id: string;
  name: string;
  stock: string;
  scanner: string;
  adjustments: Adjustments;
}

/**
 * localStorage kann fehlen oder werfen - im privaten Modus mancher Browser,
 * oder wenn das Kontingent voll ist. Das darf die App nie umbringen, Rezepte
 * sind Komfort und keine Voraussetzung.
 */
function read(): Recipe[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Recipe[]) : [];
  } catch {
    return [];
  }
}

function write(list: Recipe[]): Recipe[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* nicht speicherbar - die Liste gilt dann nur fuer diese Sitzung */
  }
  return list;
}

export function loadRecipes(): Recipe[] {
  return read();
}

export function saveRecipe(recipe: Omit<Recipe, "id">): Recipe[] {
  const list = read();
  // Gleicher Name ueberschreibt - sonst sammeln sich drei "Portrait 2" an.
  const ohne = list.filter((r) => r.name.toLowerCase() !== recipe.name.toLowerCase());
  return write([...ohne, { ...recipe, id: crypto.randomUUID() }]);
}

export function removeRecipe(id: string): Recipe[] {
  return write(read().filter((r) => r.id !== id));
}
