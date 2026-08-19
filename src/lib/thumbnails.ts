import type { Adjustments } from "./film/adjustments";
import type { ScannerProfile } from "./film/scanners";
import type { FilmStock } from "./film/stocks";
import { FilmRenderer, type Crop } from "./gl/renderer";

/**
 * Kleine Vorschaubilder des *eigenen* Fotos, einmal durch jeden Film.
 *
 * Aussuchen durch Hinschauen statt durch Lesen - eine Beschreibung wie
 * "cremige Lichter" hilft niemandem, der die Filme nicht kennt.
 */

const THUMB_EDGE = 220;

/**
 * Ein einziger, wiederverwendeter WebGL-Kontext. Browser begrenzen die Zahl
 * gleichzeitiger Kontexte (in der Groessenordnung von 16) - fuer jede
 * Vorschau einen neuen zu erzeugen, wuerde das Limit in Sekunden reissen und
 * den Kontext der Hauptansicht mitreissen.
 */
let shared: { canvas: HTMLCanvasElement; renderer: FilmRenderer } | null = null;

function getRenderer(): FilmRenderer | null {
  if (shared) return shared.renderer;
  try {
    const canvas = document.createElement("canvas");
    const renderer = new FilmRenderer(canvas, THUMB_EDGE);
    shared = { canvas, renderer };
    return renderer;
  } catch {
    // Kein WebGL2 - dann gibt es eben keine Vorschau. Die App bleibt nutzbar.
    return null;
  }
}

/** Liefert je Stock-Slug eine data:-URL, oder ein leeres Objekt bei Problemen. */
export function renderStockThumbnails(
  bitmap: ImageBitmap,
  stocks: FilmStock[],
  scanner: ScannerProfile,
  adjustments: Adjustments,
  crop: Crop,
): Record<string, string> {
  const renderer = getRenderer();
  if (!renderer || !shared) return {};

  const out: Record<string, string> = {};
  try {
    renderer.setImage(bitmap);
    renderer.setCrop(crop);
    for (const stock of stocks) {
      renderer.render({ stock, scanner, ...adjustments });
      out[stock.slug] = shared.canvas.toDataURL("image/jpeg", 0.72);
    }
  } catch {
    return {};
  }
  return out;
}
