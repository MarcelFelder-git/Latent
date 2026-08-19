import type { Adjustments } from "../lib/film/adjustments";
import type { ScannerProfile } from "../lib/film/scanners";
import type { FilmStock } from "../lib/film/stocks";
import { FilmRenderer, type Crop } from "../lib/gl/renderer";

/**
 * Entwickelt ein Bild in voller Aufloesung abseits des Hauptthreads.
 *
 * Bei 4096 Pixeln dauert ein Durchgang lange genug, dass die Oberflaeche
 * sichtbar stehenbleibt - Regler reagieren nicht, der Fortschritt friert ein.
 * Der Renderkern war von Anfang an ohne DOM-Zugriffe gebaut, damit genau
 * dieser Umzug spaeter nur ein OffscreenCanvas statt eines Canvas braucht.
 */

export interface ExportRequest {
  bitmap: ImageBitmap;
  maxEdge: number;
  stock: FilmStock;
  scanner: ScannerProfile;
  adjustments: Adjustments;
  crop: Crop;
  quality: number;
}

export type ExportResponse =
  | { ok: true; blob: Blob }
  | { ok: false; error: string };

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  const req = event.data;
  let renderer: FilmRenderer | null = null;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    renderer = new FilmRenderer(canvas, req.maxEdge);
    renderer.setImage(req.bitmap);
    renderer.setCrop(req.crop);
    renderer.render({
      stock: req.stock,
      scanner: req.scanner,
      ...req.adjustments,
    });
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: req.quality,
    });
    const antwort: ExportResponse = { ok: true, blob };
    self.postMessage(antwort);
  } catch (err) {
    const antwort: ExportResponse = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(antwort);
  } finally {
    renderer?.dispose();
    // Die uebertragene Kopie wird hier nicht mehr gebraucht.
    req.bitmap.close();
  }
};
