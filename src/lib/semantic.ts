/**
 * Szenenerkennung im Browser.
 *
 * Die Farbmessung in analyze.ts kommt an eine grundsaetzliche Grenze: Sand,
 * Holz und beige Waende liegen farblich exakt im Bereich von Haut. Aus Zahlen
 * allein ist "Gesicht" nicht von "Sandflaeche" zu trennen - das ist an einem
 * Strandmotiv nachgewiesen worden, 41 Prozent hautfarbene Flaeche ohne einen
 * Menschen im Bild.
 *
 * Genau dafuer ist ein Modell da, und nur dafuer: fuer die *Bedeutung* der
 * Szene. Helligkeit und Kontrast misst man weiterhin besser direkt, das
 * braucht kein Modell.
 *
 * Alles laeuft lokal. Das Modell wird einmalig geladen und liegt danach im
 * Cache des Browsers; es geht kein Bild an einen Server.
 */

export type SceneLabel =
  | "portrait"
  | "people"
  | "night"
  | "beach"
  | "landscape"
  | "indoor"
  | "street"
  | "food";

/**
 * Die Beschreibungen sind englisch, weil das Modell auf englischen
 * Bildunterschriften trainiert ist - uebersetzt fallen die Treffer deutlich
 * schlechter aus. Sie sind ausserdem als ganze Saetze formuliert, nicht als
 * Stichworte: "a photo of ..." entspricht der Form, in der das Modell
 * Bildunterschriften gesehen hat.
 */
const PROMPTS: Record<SceneLabel, string> = {
  portrait: "a portrait photograph of a person's face",
  people: "a photograph with people in it",
  night: "a photograph taken at night with artificial lights",
  beach: "a photograph of a sandy beach",
  landscape: "a landscape photograph of nature",
  indoor: "a photograph taken indoors",
  street: "a street photograph in a city",
  food: "a close-up photograph of food",
};

const LABELS = Object.keys(PROMPTS) as SceneLabel[];
const PROMPT_LIST = LABELS.map((l) => PROMPTS[l]);

export type SceneScores = Partial<Record<SceneLabel, number>>;

/** Kantenlaenge, auf die vor der Erkennung verkleinert wird. */
const INPUT_EDGE = 384;

/* eslint-disable @typescript-eslint/no-explicit-any */
let classifier: any = null;
let ladevorgang: Promise<any> | null = null;

export function isSemanticLoaded(): boolean {
  return classifier !== null;
}

export interface LoadProgress {
  /** 0..1, oder null solange die Gesamtgroesse unbekannt ist. */
  ratio: number | null;
  text: string;
}

/**
 * Laedt das Modell. Mehrfache Aufrufe teilen sich denselben Ladevorgang -
 * sonst wuerden zwei schnelle Klicks zwei Downloads ausloesen.
 */
export async function loadSemantic(
  onProgress?: (p: LoadProgress) => void,
): Promise<void> {
  if (classifier) return;
  if (!ladevorgang) {
    ladevorgang = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Es liegt kein Modell im Projekt - immer vom Hub holen und danach aus
      // dem Browsercache bedienen.
      env.allowLocalModels = false;

      return pipeline(
        "zero-shot-image-classification",
        "Xenova/clip-vit-base-patch32",
        {
          // Quantisiert: rund ein Viertel der Groesse bei praktisch gleicher
          // Trefferlage fuer eine so grobe Einteilung.
          dtype: "q8",
          progress_callback: (info: any) => {
            if (!onProgress) return;
            if (info?.status === "progress" && typeof info.progress === "number") {
              onProgress({
                ratio: Math.min(1, info.progress / 100),
                text: `Modell laedt: ${Math.round(info.progress)} %`,
              });
            } else if (info?.status === "ready") {
              onProgress({ ratio: 1, text: "Modell bereit" });
            } else {
              onProgress({ ratio: null, text: "Modell wird vorbereitet" });
            }
          },
        } as any,
      );
    })();
  }

  try {
    classifier = await ladevorgang;
  } catch (err) {
    // Beim naechsten Versuch neu anfangen, statt dauerhaft auf einem
    // fehlgeschlagenen Ladevorgang sitzenzubleiben.
    ladevorgang = null;
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Ordnet ein Bild den Szenen zu. Gibt null zurueck, wenn das Modell nicht
 * geladen ist - der Aufrufer entscheidet dann ohne dieses Signal weiter.
 */
export async function classifyScene(bitmap: ImageBitmap): Promise<SceneScores | null> {
  if (!classifier) return null;

  // Verkleinert uebergeben: das Modell rechnet ohnehin auf 224 Pixel, ein
  // 4000-Pixel-Bild durch die Vorverarbeitung zu schicken waere Verschwendung.
  const scale = Math.min(1, INPUT_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) return null;
  const url = URL.createObjectURL(blob);

  try {
    const roh = await classifier(url, PROMPT_LIST);
    const treffer: { label: string; score: number }[] = Array.isArray(roh) ? roh : [];
    const scores: SceneScores = {};
    for (const t of treffer) {
      const index = PROMPT_LIST.indexOf(t.label);
      if (index >= 0) scores[LABELS[index]] = t.score;
    }
    return Object.keys(scores).length > 0 ? scores : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
