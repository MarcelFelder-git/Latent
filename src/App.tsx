import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls } from "./components/Controls";
import { Viewer } from "./components/Viewer";
import { NEUTRAL, type Adjustments } from "./lib/film/adjustments";
import type { Preset } from "./lib/film/presets";
import { DEFAULT_SCANNER, scannerBySlug } from "./lib/film/scanners";
import { DEFAULT_STOCK, STOCKS, stockBySlug } from "./lib/film/stocks";
import { createDemoImage } from "./lib/demoImage";
import { readExifSegment, spliceExif } from "./lib/exif";
import { EXPORT_MAX_EDGE, FilmRenderer } from "./lib/gl/renderer";
import { renderStockThumbnails } from "./lib/thumbnails";

interface Photo {
  id: string;
  name: string;
  bitmap: ImageBitmap;
  url: string;
  /** Nur bei hochgeladenen Dateien vorhanden - Quelle fuer die EXIF-Daten. */
  file: File | null;
}

/** Mehr geladene Bilder gleichzeitig zu halten kostet nur Speicher. */
const MAX_PHOTOS = 8;

interface Snapshot {
  stockSlug: string;
  scannerSlug: string;
  adjustments: Adjustments;
}

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stockSlug, setStockSlug] = useState(DEFAULT_STOCK.slug);
  const [scannerSlug, setScannerSlug] = useState(DEFAULT_SCANNER.slug);
  const [adjustments, setAdjustments] = useState<Adjustments>(NEUTRAL);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [renderVersion, setRenderVersion] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stock = stockBySlug(stockSlug);
  const scanner = scannerBySlug(scannerSlug);
  const active = useMemo(
    () => photos.find((p) => p.id === activeId) ?? null,
    [photos, activeId],
  );

  // ---------------------------------------------------------------- Bilder

  const addPhoto = useCallback(
    (bitmap: ImageBitmap, name: string, url: string, file: File | null) => {
      const photo: Photo = { id: crypto.randomUUID(), name, bitmap, url, file };
      setPhotos((prev) => {
        const next = [...prev, photo];
        // Aeltestes freigeben, wenn die Liste voll ist.
        while (next.length > MAX_PHOTOS) {
          const drop = next.shift()!;
          drop.bitmap.close();
          URL.revokeObjectURL(drop.url);
        }
        return next;
      });
      setActiveId(photo.id);
      setError(null);
    },
    [],
  );

  const loadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Das ist keine Bilddatei.");
        return;
      }
      try {
        const bitmap = await createImageBitmap(file);
        addPhoto(bitmap, file.name, URL.createObjectURL(file), file);
      } catch {
        // Safari kann HEIC nicht ueber createImageBitmap dekodieren.
        setError("Dieses Bildformat kann der Browser nicht dekodieren. JPEG oder PNG?");
      }
    },
    [addPhoto],
  );

  const loadDemo = useCallback(async () => {
    try {
      const bitmap = await createDemoImage();
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
      addPhoto(
        bitmap,
        "Beispielmotiv",
        blob ? URL.createObjectURL(blob) : "",
        null,
      );
    } catch {
      setError("Beispielmotiv konnte nicht erzeugt werden.");
    }
  }, [addPhoto]);

  // Einfuegen aus der Zwischenablage - funktioniert jederzeit, auch wenn
  // schon ein Bild geladen ist.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (file) void loadFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  // Alles freigeben, wenn die Seite verlassen wird.
  useEffect(() => {
    return () => {
      for (const p of photos) {
        p.bitmap.close();
        URL.revokeObjectURL(p.url);
      }
    };
    // Absichtlich nur beim Aushaengen - photos hier als Abhaengigkeit wuerde
    // bei jedem neuen Bild alle bisherigen schliessen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------- Verlauf

  const history = useRef<Snapshot[]>([]);
  const skipPush = useRef(false);
  const [historyLength, setHistoryLength] = useState(0);

  useEffect(() => {
    if (skipPush.current) {
      skipPush.current = false;
      return;
    }
    const snapshot: Snapshot = { stockSlug, scannerSlug, adjustments };
    // Verzoegert, damit eine Reglerbewegung einen einzigen Eintrag ergibt
    // und nicht dreissig.
    const timer = setTimeout(() => {
      const last = history.current[history.current.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;
      history.current.push(snapshot);
      if (history.current.length > 40) history.current.shift();
      setHistoryLength(history.current.length);
    }, 400);
    return () => clearTimeout(timer);
  }, [stockSlug, scannerSlug, adjustments]);

  const undo = useCallback(() => {
    if (history.current.length < 2) return;
    history.current.pop();
    const prev = history.current[history.current.length - 1];
    skipPush.current = true;
    setStockSlug(prev.stockSlug);
    setScannerSlug(prev.scannerSlug);
    setAdjustments(prev.adjustments);
    setHistoryLength(history.current.length);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // -------------------------------------------------------- Vorschaubilder

  useEffect(() => {
    if (!active) {
      setThumbnails({});
      return;
    }
    // Verzoegert: waehrend einer Reglerbewegung waeren das sonst drei
    // zusaetzliche Renderdurchgaenge pro Bildwiederholung.
    const timer = setTimeout(() => {
      setThumbnails(renderStockThumbnails(active.bitmap, STOCKS, scanner, adjustments));
    }, 250);
    return () => clearTimeout(timer);
  }, [active, scanner, adjustments]);

  // Histogramm muss nach dem Neuzeichnen lesen. Dieser Effekt haengt in App
  // und laeuft damit nach denen des Viewers - das Canvas ist dann aktuell.
  useEffect(() => {
    setRenderVersion((v) => v + 1);
  }, [stockSlug, scannerSlug, adjustments, activeId]);

  // ------------------------------------------------------------- Export

  const handleExport = useCallback(async () => {
    if (!active) return;
    setExporting(true);
    try {
      // Eigener Renderer mit hoeherem Deckel - die Bildschirmvorschau laeuft
      // aus Geschwindigkeitsgruenden auf 2048 Pixel, das reicht fuer eine
      // Ausgabedatei nicht.
      const canvas = document.createElement("canvas");
      const renderer = new FilmRenderer(canvas, EXPORT_MAX_EDGE);
      renderer.setImage(active.bitmap);
      renderer.render({ stock, scanner, ...adjustments });
      const blob = await new Promise<Blob | null>((r) =>
        canvas.toBlob(r, "image/jpeg", 0.94),
      );
      renderer.dispose();
      if (!blob) throw new Error("Der Browser konnte kein JPEG erzeugen.");

      let out = blob;
      if (active.file) {
        const exif = await readExifSegment(active.file);
        if (exif) out = await spliceExif(blob, exif);
      }

      const name = `film-lab-${stock.slug}-${scanner.slug}-${Date.now()}.jpg`;
      const file = new File([out], name, { type: "image/jpeg" });

      // Auf dem Telefon ist Teilen der brauchbare Weg, am Rechner der
      // Download. Teilen kann fehlschlagen, wenn die Nutzergeste durch das
      // Rendern verfallen ist - dann eben herunterladen.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch {
          /* faellt unten auf den Download zurueck */
        }
      }
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      // Nicht sofort freigeben: manche Browser lesen den Blob erst nach dem
      // Ende des Ereignisses, ein Widerruf im selben Zug bricht den Download ab.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export fehlgeschlagen.");
    } finally {
      setExporting(false);
    }
  }, [active, stock, scanner, adjustments]);

  const applyPreset = useCallback((preset: Preset) => {
    setStockSlug(preset.stock);
    setScannerSlug(preset.scanner);
    setAdjustments(preset.adjustments);
  }, []);

  // -------------------------------------------------------------- Ansicht

  return (
    <div
      className={dragOver ? "app drag" : "app"}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void loadFile(file);
      }}
    >
      <main className="stage">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {active ? (
          <>
            <Viewer
              image={active.bitmap}
              originalUrl={active.url}
              params={{ stock, scanner, ...adjustments }}
              onError={setError}
              canvasRef={canvasRef}
            />
            <div className="filmstrip">
              {photos.map((p) => (
                <button
                  key={p.id}
                  className="strip-item"
                  aria-pressed={p.id === activeId}
                  aria-label={p.name}
                  title={p.name}
                  onClick={() => setActiveId(p.id)}
                >
                  <img src={p.url} alt="" />
                </button>
              ))}
              <button
                className="strip-add"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Weiteres Foto laden"
              >
                +
              </button>
            </div>
          </>
        ) : (
          <div className="dropzone">
            <h1>Film Lab</h1>
            <p>
              Foto hierher ziehen, einfuegen oder auswaehlen. Alles laeuft lokal im
              Browser - nichts wird hochgeladen.
            </p>
            <div className="dropzone-actions">
              <button className="pick" onClick={() => fileInputRef.current?.click()}>
                Foto waehlen
              </button>
              <button className="pick ghost" onClick={() => void loadDemo()}>
                Beispielmotiv ansehen
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            // Zuruecksetzen, damit dieselbe Datei erneut gewaehlt werden kann.
            e.target.value = "";
          }}
        />
      </main>

      <Controls
        stock={stock}
        onStockChange={setStockSlug}
        scanner={scanner}
        onScannerChange={setScannerSlug}
        adjustments={adjustments}
        onAdjust={setAdjustments}
        onPreset={applyPreset}
        onReset={() => setAdjustments(NEUTRAL)}
        onUndo={undo}
        canUndo={historyLength >= 2}
        onExport={() => void handleExport()}
        exporting={exporting}
        canExport={active !== null}
        thumbnails={thumbnails}
        canvasRef={canvasRef}
        renderVersion={renderVersion}
      />
    </div>
  );
}
