import type { Adjustments } from "./film/adjustments";
import type { ScannerProfile } from "./film/scanners";
import type { FilmStock } from "./film/stocks";
import { FilmRenderer, type Crop } from "./gl/renderer";
import type { ExportRequest, ExportResponse } from "../workers/exportWorker";

/**
 * Ein Bild in voller Aufloesung entwickeln - moeglichst im Worker, sonst hier.
 */

export interface DevelopOptions {
  bitmap: ImageBitmap;
  maxEdge: number;
  stock: FilmStock;
  scanner: ScannerProfile;
  adjustments: Adjustments;
  crop: Crop;
  border: boolean;
  quality?: number;
}

/**
 * Ein einziger, wiederverwendeter Worker. Ihn pro Export neu zu starten
 * kostet jedes Mal das Laden und Uebersetzen des Moduls - beim Stapelexport
 * ueber acht Bilder waere das achtmal derselbe Aufwand.
 */
let worker: Worker | null = null;
let workerBroken = false;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    return null;
  }
  if (!worker) {
    try {
      worker = new Worker(new URL("../workers/exportWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

async function developInWorker(opts: DevelopOptions): Promise<Blob> {
  const w = getWorker();
  if (!w) throw new Error("kein Worker");

  // Eine Kopie uebertragen, nicht das Original: uebertragene ImageBitmaps
  // sind auf der Absenderseite danach unbrauchbar, und die Vorschau braucht
  // ihres weiter.
  const kopie = await createImageBitmap(opts.bitmap);

  return new Promise<Blob>((resolve, reject) => {
    const aufraeumen = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    const onMessage = (e: MessageEvent<ExportResponse>) => {
      aufraeumen();
      if (e.data.ok) resolve(e.data.blob);
      else reject(new Error(e.data.error));
    };
    const onError = (e: ErrorEvent) => {
      aufraeumen();
      // Ein kaputter Worker bleibt kaputt - ab jetzt direkt der Fallback,
      // statt bei jedem Bild erneut in denselben Fehler zu laufen.
      workerBroken = true;
      worker = null;
      reject(new Error(e.message || "Worker-Fehler"));
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);

    const req: ExportRequest = {
      bitmap: kopie,
      maxEdge: opts.maxEdge,
      stock: opts.stock,
      scanner: opts.scanner,
      adjustments: opts.adjustments,
      crop: opts.crop,
      border: opts.border,
      quality: opts.quality ?? 0.94,
    };
    w.postMessage(req, [kopie]);
  });
}

function developOnMainThread(opts: DevelopOptions): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const renderer = new FilmRenderer(canvas, opts.maxEdge);
  try {
    renderer.setImage(opts.bitmap);
    renderer.setCrop(opts.crop);
    renderer.render({
      stock: opts.stock,
      scanner: opts.scanner,
      ...opts.adjustments,
      border: opts.border,
    });
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Der Browser konnte kein JPEG erzeugen.")),
        "image/jpeg",
        opts.quality ?? 0.94,
      );
    });
  } finally {
    renderer.dispose();
  }
}

/**
 * Der Fallback ist kein Notnagel fuer Exoten: Safari hat OffscreenCanvas mit
 * WebGL2 lange nicht unterstuetzt, und ein Bild ohne Export waere schlimmer
 * als ein Bild mit kurzem Ruckler.
 */
export async function developToBlob(opts: DevelopOptions): Promise<Blob> {
  try {
    return await developInWorker(opts);
  } catch {
    return developOnMainThread(opts);
  }
}
