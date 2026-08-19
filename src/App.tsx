import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls } from "./components/Controls";
import { Viewer } from "./components/Viewer";
import { NEUTRAL, type Adjustments } from "./lib/film/adjustments";
import {
  BUILTIN_PRESETS,
  loadCustomPresets,
  removeCustomPreset,
  saveCustomPreset,
  type Preset,
} from "./lib/film/presets";
import { DEFAULT_SCANNER, scannerBySlug } from "./lib/film/scanners";
import { DEFAULT_STOCK, STOCKS, stockBySlug } from "./lib/film/stocks";
import { cropFor, DEFAULT_FORMAT, formatById } from "./lib/film/cropFormats";
import { suggestLook, type Suggestion } from "./lib/film/suggest";
import { neutralizeFrom } from "./lib/film/whitebalance";
import { analyzeImage } from "./lib/analyze";
import {
  classifyScene,
  isSemanticLoaded,
  loadSemantic,
  type LoadProgress,
} from "./lib/semantic";
import { buildComparisonSheet } from "./lib/comparison";
import { developToBlob } from "./lib/exportImage";
import { createDemoImage } from "./lib/demoImage";
import { readExifSegment, spliceExif } from "./lib/exif";
import { EXPORT_MAX_EDGE, FULL_CROP } from "./lib/gl/renderer";
import { decodeLook, lookUrl } from "./lib/lookLink";
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
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [customPresets, setCustomPresets] = useState<Preset[]>(() => loadCustomPresets());
  const [formatId, setFormatId] = useState(DEFAULT_FORMAT.id);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [border, setBorder] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [useModel, setUseModel] = useState(false);
  const [modelStatus, setModelStatus] = useState<LoadProgress | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stock = stockBySlug(stockSlug);
  const scanner = scannerBySlug(scannerSlug);
  const active = useMemo(
    () => photos.find((p) => p.id === activeId) ?? null,
    [photos, activeId],
  );
  const presets = useMemo(
    () => [...BUILTIN_PRESETS, ...customPresets],
    [customPresets],
  );

  const format = formatById(formatId);
  const crop = useMemo(
    () =>
      active
        ? cropFor(format.ratio, active.bitmap.width, active.bitmap.height, cropOffset)
        : FULL_CROP,
    [active, format.ratio, cropOffset],
  );

  // Ein neues Format setzt die Verschiebung zurueck - der bisherige Wert
  // bezog sich auf einen anderen Spielraum und waere nur Zufall.
  const handleFormat = useCallback((id: string) => {
    setFormatId(id);
    setCropOffset({ x: 0, y: 0 });
  }, []);

  const handleCropDrag = useCallback((dx: number, dy: number) => {
    setCropOffset((o) => ({
      x: Math.min(0.5, Math.max(-0.5, o.x + dx)),
      y: Math.min(0.5, Math.max(-0.5, o.y + dy)),
    }));
  }, []);

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
      addPhoto(bitmap, "Beispielmotiv", blob ? URL.createObjectURL(blob) : "", null);
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

  // Einen geteilten Look aus der Adresszeile uebernehmen.
  useEffect(() => {
    const look = decodeLook(window.location.hash);
    if (!look) return;
    setStockSlug(look.stock);
    setScannerSlug(look.scanner);
    setAdjustments(look.adjustments);
    setHinweis("Look aus dem Link uebernommen.");
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
      setThumbnails(renderStockThumbnails(active.bitmap, STOCKS, scanner, adjustments, crop));
    }, 250);
    return () => clearTimeout(timer);
  }, [active, scanner, adjustments, crop]);

  // Histogramm muss nach dem Neuzeichnen lesen. Dieser Effekt haengt in App
  // und laeuft damit nach denen des Viewers - das Canvas ist dann aktuell.
  useEffect(() => {
    setRenderVersion((v) => v + 1);
  }, [stockSlug, scannerSlug, adjustments, activeId]);

  // ----------------------------------------------------------- Graupunkt

  /**
   * Zwischenspeicher fuer die Pipette: das Bild verkleinert als 2D-Canvas.
   * Ein 4000-Pixel-Bild fuer jeden Klick neu zu zeichnen waere Verschwendung,
   * und das Verkleinern mittelt nebenbei das Rauschen weg.
   */
  const sample = useRef<{
    id: string;
    ctx: CanvasRenderingContext2D;
    w: number;
    h: number;
  } | null>(null);

  const handlePick = useCallback(
    (u: number, v: number) => {
      if (!active) return;
      let cache = sample.current;
      if (!cache || cache.id !== active.id) {
        const EDGE = 640;
        const scale = Math.min(
          1,
          EDGE / Math.max(active.bitmap.width, active.bitmap.height),
        );
        const w = Math.max(1, Math.round(active.bitmap.width * scale));
        const h = Math.max(1, Math.round(active.bitmap.height * scale));
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(active.bitmap, 0, 0, w, h);
        cache = { id: active.id, ctx, w, h };
        sample.current = cache;
      }

      const x = Math.min(cache.w - 1, Math.max(0, Math.round(u * cache.w)));
      const y = Math.min(cache.h - 1, Math.max(0, Math.round(v * cache.h)));
      const x0 = Math.max(0, x - 2);
      const y0 = Math.max(0, y - 2);
      const bw = Math.min(5, cache.w - x0);
      const bh = Math.min(5, cache.h - y0);

      let d: Uint8ClampedArray;
      try {
        d = cache.ctx.getImageData(x0, y0, bw, bh).data;
      } catch {
        setError("Der Bildpunkt liess sich nicht auslesen.");
        return;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }

      // Gemessen wird im *Original*, nicht im entwickelten Bild. Das ist die
      // richtige fotografische Bedeutung: der Klick sagt "das war in
      // Wirklichkeit grau" - der Farbcharakter des Films soll danach ja
      // erhalten bleiben und nicht wegkorrigiert werden.
      const { warmth, tint } = neutralizeFrom(r / n, g / n, b / n);
      setAdjustments((a) => ({ ...a, warmth, tint }));
    },
    [active],
  );

  // -------------------------------------------------------------- Vorschlag

  const handleSuggest = useCallback(async () => {
    if (!active) return;
    const stats = analyzeImage(active.bitmap);
    if (!stats) {
      setError("Das Bild liess sich nicht auswerten.");
      return;
    }

    // Die Szenenerkennung ist eine Zutat, keine Voraussetzung: schlaegt sie
    // fehl, faellt der Vorschlag auf die reine Farbmessung zurueck statt
    // ganz auszubleiben.
    let scene = null;
    if (useModel) {
      try {
        if (!isSemanticLoaded()) {
          setModelStatus({ ratio: null, text: "Modell wird geladen" });
          await loadSemantic(setModelStatus);
        }
        scene = await classifyScene(active.bitmap);
      } catch (err) {
        setError(
          `Szenenerkennung nicht verfuegbar (${
            err instanceof Error ? err.message : "unbekannter Fehler"
          }) - Vorschlag beruht nur auf den Farbwerten.`,
        );
      } finally {
        setModelStatus(null);
      }
    }

    const vorschlag = suggestLook(stats, scene);
    setStockSlug(vorschlag.stock);
    setScannerSlug(vorschlag.scanner);
    setAdjustments(vorschlag.adjustments);
    setSuggestion(vorschlag);
  }, [active, useModel]);

  // Ein neues Bild macht den alten Vorschlag hinfaellig.
  useEffect(() => {
    setSuggestion(null);
  }, [activeId]);

  // --------------------------------------------------------------- Presets

  const handleSavePreset = useCallback(
    (name: string) => {
      setCustomPresets(
        saveCustomPreset({ name, stock: stockSlug, scanner: scannerSlug, adjustments }),
      );
    },
    [stockSlug, scannerSlug, adjustments],
  );

  const handleApplyPreset = useCallback((preset: Preset) => {
    setStockSlug(preset.stock);
    setScannerSlug(preset.scanner);
    // Fehlende Felder aelterer Presets mit den Vorgaben auffuellen, sonst
    // bricht ein gespeichertes Preset nach jeder neuen Reglerachse.
    setAdjustments({ ...NEUTRAL, ...preset.adjustments });
  }, []);

  // ------------------------------------------------------------- Export

  /**
   * Ein Foto in voller Aufloesung entwickeln und als JPEG zurueckgeben. Der
   * eigentliche Renderdurchgang laeuft im Worker, damit die Oberflaeche nicht
   * fuer Sekunden stehenbleibt; das Einsetzen der EXIF-Daten bleibt hier,
   * weil nur der Hauptthread die Originaldatei hat.
   */
  const entwickeln = useCallback(
    async (photo: Photo): Promise<Blob> => {
      const eigenerCrop = cropFor(
        format.ratio,
        photo.bitmap.width,
        photo.bitmap.height,
        cropOffset,
      );
      const blob = await developToBlob({
        bitmap: photo.bitmap,
        maxEdge: EXPORT_MAX_EDGE,
        stock,
        scanner,
        adjustments,
        crop: eigenerCrop,
        border,
      });
      if (!photo.file) return blob;
      const exif = await readExifSegment(photo.file);
      return exif ? spliceExif(blob, exif) : blob;
    },
    [stock, scanner, adjustments, format.ratio, cropOffset, border],
  );

  const download = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    // Nicht sofort freigeben: manche Browser lesen den Blob erst nach dem
    // Ende des Ereignisses, ein Widerruf im selben Zug bricht den Download ab.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, []);

  const dateiname = useCallback(
    (photo: Photo) => {
      const basis = photo.name.replace(/\.[^.]+$/, "") || "bild";
      return `${basis}-${stock.slug}-${scanner.slug}.jpg`;
    },
    [stock.slug, scanner.slug],
  );

  const handleExport = useCallback(async () => {
    if (!active) return;
    setExportStatus("Export laeuft");
    try {
      const blob = await entwickeln(active);
      const name = dateiname(active);
      const file = new File([blob], name, { type: "image/jpeg" });

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
      download(blob, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export fehlgeschlagen.");
    } finally {
      setExportStatus(null);
    }
  }, [active, entwickeln, dateiname, download]);

  const handleExportAll = useCallback(async () => {
    if (photos.length === 0) return;
    try {
      for (let i = 0; i < photos.length; i++) {
        setExportStatus(`Bild ${i + 1} von ${photos.length}`);
        const blob = await entwickeln(photos[i]);
        download(blob, dateiname(photos[i]));
        // Kurze Pause: mehrere Downloads kurz hintereinander laesst nicht
        // jeder Browser durch, und der Nutzer soll die Nachfrage sehen.
        await new Promise((r) => setTimeout(r, 350));
      }
      setHinweis(`${photos.length} Bilder exportiert.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stapelexport fehlgeschlagen.");
    } finally {
      setExportStatus(null);
    }
  }, [photos, entwickeln, dateiname, download]);

  const handleComparison = useCallback(async () => {
    if (!active) return;
    setExportStatus("Vergleich laeuft");
    try {
      const blob = await buildComparisonSheet(
        active.bitmap,
        STOCKS,
        scanner,
        adjustments,
        crop,
      );
      download(blob, `film-lab-vergleich-${scanner.slug}.jpg`);
      setHinweis("Vergleichsbild aller Filme gespeichert.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vergleichsbild fehlgeschlagen.");
    } finally {
      setExportStatus(null);
    }
  }, [active, scanner, adjustments, crop, download]);

  const handleCopyLink = useCallback(async () => {
    const url = lookUrl({ stock: stockSlug, scanner: scannerSlug, adjustments });
    // Adresszeile mitziehen, damit ein Neuladen den Look behaelt.
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      setHinweis("Link zum Look kopiert.");
    } catch {
      setHinweis("Link steht in der Adresszeile.");
    }
  }, [stockSlug, scannerSlug, adjustments]);

  // Hinweise wieder ausblenden.
  useEffect(() => {
    if (!hinweis) return;
    const t = setTimeout(() => setHinweis(null), 4000);
    return () => clearTimeout(t);
  }, [hinweis]);

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
        {hinweis && !error && <p className="hinweis">{hinweis}</p>}

        {active ? (
          <>
            <Viewer
              image={active.bitmap}
              originalUrl={active.url}
              params={{ stock, scanner, ...adjustments, border }}
              onError={setError}
              canvasRef={canvasRef}
              onPick={handlePick}
              crop={crop}
              onCropDrag={handleCropDrag}
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
        presets={presets}
        onApplyPreset={handleApplyPreset}
        onSavePreset={handleSavePreset}
        onDeletePreset={(id) => setCustomPresets(removeCustomPreset(id))}
        onReset={() => setAdjustments(NEUTRAL)}
        onUndo={undo}
        canUndo={historyLength >= 2}
        onExport={() => void handleExport()}
        onExportAll={() => void handleExportAll()}
        onComparison={() => void handleComparison()}
        formatId={formatId}
        onFormatChange={handleFormat}
        border={border}
        onBorderChange={setBorder}
        onSuggest={() => void handleSuggest()}
        suggestion={suggestion}
        useModel={useModel}
        onUseModelChange={setUseModel}
        modelStatus={modelStatus}
        onCopyLink={() => void handleCopyLink()}
        exportStatus={exportStatus}
        canExport={active !== null}
        photoCount={photos.length}
        thumbnails={thumbnails}
        canvasRef={canvasRef}
        renderVersion={renderVersion}
      />
    </div>
  );
}
