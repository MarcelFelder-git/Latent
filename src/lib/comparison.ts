import type { Adjustments } from "./film/adjustments";
import type { ScannerProfile } from "./film/scanners";
import type { FilmStock } from "./film/stocks";
import { FilmRenderer, type Crop } from "./gl/renderer";

/**
 * Alle Filme desselben Motivs nebeneinander, als eine Datei.
 *
 * Nebeneinander sieht man den Unterschied zwischen zwei Emulsionen in einer
 * Sekunde; nacheinander umgeschaltet praktisch nie, weil das Auge sich
 * zwischendurch anpasst. Fuer eine Projektvorstellung ist das ausserdem das
 * eine Bild, das die ganze Arbeit auf einmal zeigt.
 */

/** Kantenlaenge einer Kachel. Gross genug, dass Korn sichtbar bleibt. */
const TILE_EDGE = 1100;
const LABEL_HEIGHT = 56;
const GAP = 16;
const BG = "#141210";
const FG = "#e8e3dc";
const DIM = "#8d857b";

export async function buildComparisonSheet(
  bitmap: ImageBitmap,
  stocks: FilmStock[],
  scanner: ScannerProfile,
  adjustments: Adjustments,
  crop: Crop,
): Promise<Blob> {
  const gpuCanvas = document.createElement("canvas");
  const renderer = new FilmRenderer(gpuCanvas, TILE_EDGE);

  try {
    renderer.setImage(bitmap);
    renderer.setCrop(crop);
    const { width: tw, height: th } = renderer.outputSize;

    // Querformat untereinander, Hochformat nebeneinander - so bleibt das
    // Gesamtbild ungefaehr quadratisch statt zu einem Bandwurm zu werden.
    const nebeneinander = th >= tw;
    const spalten = nebeneinander ? stocks.length : 1;
    const zeilen = nebeneinander ? 1 : stocks.length;

    const zelleH = th + LABEL_HEIGHT;
    const sheet = document.createElement("canvas");
    sheet.width = spalten * tw + (spalten + 1) * GAP;
    sheet.height = zeilen * zelleH + (zeilen + 1) * GAP;

    const ctx = sheet.getContext("2d");
    if (!ctx) throw new Error("Kein 2D-Kontext fuer das Vergleichsbild.");
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, sheet.width, sheet.height);

    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      renderer.render({ stock, scanner, ...adjustments });

      const x = GAP + (nebeneinander ? i * (tw + GAP) : 0);
      const y = GAP + (nebeneinander ? 0 : i * (zelleH + GAP));
      ctx.drawImage(gpuCanvas, x, y, tw, th);

      ctx.fillStyle = FG;
      ctx.font = "500 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(stock.name, x, y + th + 14);

      ctx.fillStyle = DIM;
      ctx.font = "20px ui-monospace, SF Mono, Cascadia Mono, Menlo, monospace";
      ctx.fillText(`ISO ${stock.iso}`, x + ctx.measureText(stock.name).width + 60, y + th + 18);
    }

    // Fusszeile: unter welchem Scanner das entstanden ist.
    ctx.fillStyle = DIM;
    ctx.font = "20px ui-monospace, SF Mono, Cascadia Mono, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`Scan: ${scanner.name}`, sheet.width - GAP, sheet.height - GAP - 24);
    ctx.textAlign = "left";

    return await new Promise<Blob>((resolve, reject) => {
      sheet.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Vergleichsbild fehlgeschlagen."))),
        "image/jpeg",
        0.92,
      );
    });
  } finally {
    renderer.dispose();
  }
}
