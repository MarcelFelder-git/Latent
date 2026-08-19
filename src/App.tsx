import { useCallback, useEffect, useRef, useState } from "react";
import { Controls, type Adjustments } from "./components/Controls";
import { Viewer } from "./components/Viewer";
import { DEFAULT_STOCK, stockBySlug } from "./lib/film/stocks";

const NEUTRAL: Adjustments = {
  exposure: 0,
  contrast: 1,
  grain: 1,
  halation: 1,
};

export default function App() {
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [stockSlug, setStockSlug] = useState(DEFAULT_STOCK.slug);
  const [adjustments, setAdjustments] = useState<Adjustments>(NEUTRAL);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stock = stockBySlug(stockSlug);

  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Das ist keine Bilddatei.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      setImage((prev) => {
        prev?.close();
        return bitmap;
      });
      setOriginalUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setError(null);
    } catch {
      // Safari kann HEIC nicht ueber createImageBitmap dekodieren.
      setError("Dieses Bildformat kann der Browser nicht dekodieren. JPEG oder PNG?");
    }
  }, []);

  // Einfuegen aus der Zwischenablage.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (file) void loadFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  // Objekt-URL beim Verlassen freigeben.
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  const handleExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Export fehlgeschlagen.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `film-lab-${stock.slug}-${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
      },
      "image/jpeg",
      0.92,
    );
  }, [stock.slug]);

  return (
    <div className="app">
      {image ? (
        <Viewer
          image={image}
          originalUrl={originalUrl}
          params={{ stock, ...adjustments }}
          onError={setError}
          canvasRef={canvasRef}
        />
      ) : (
        <div
          className={dragOver ? "dropzone over" : "dropzone"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void loadFile(file);
          }}
        >
          <h1>Film Lab</h1>
          <p>
            Foto hierher ziehen, einfuegen oder auswaehlen. Alles laeuft lokal im
            Browser - nichts wird hochgeladen.
          </p>
          <button className="pick" onClick={() => fileInputRef.current?.click()}>
            Foto waehlen
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
            }}
          />
        </div>
      )}

      <Controls
        stock={stock}
        onStockChange={setStockSlug}
        adjustments={adjustments}
        onAdjust={setAdjustments}
        onReset={() => setAdjustments(NEUTRAL)}
        onExport={handleExport}
        canExport={image !== null}
      />

      {error && (
        <div className="controls" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="error">{error}</p>
        </div>
      )}
    </div>
  );
}
