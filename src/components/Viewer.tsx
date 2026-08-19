import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { FilmRenderer, type RenderParams } from "../lib/gl/renderer";

interface ViewerProps {
  image: ImageBitmap | null;
  originalUrl: string | null;
  params: RenderParams;
  onError: (message: string) => void;
  /** Von App gehalten, damit der Export an die Pixel kommt. */
  canvasRef: RefObject<HTMLCanvasElement>;
  /**
   * Wird mit den auf 0..1 normierten Bildkoordinaten des Klicks gerufen,
   * solange die Pipette aktiv ist.
   */
  onPick: (u: number, v: number) => void;
}

/**
 * Besitzt das Canvas und die Renderer-Instanz. Gerendert wird nur, wenn sich
 * etwas geaendert hat - kein requestAnimationFrame-Dauerlauf. Ein Foto ist
 * statisch, eine Endlosschleife wuerde nur Akku kosten.
 */
export function Viewer({
  image,
  originalUrl,
  params,
  onError,
  canvasRef,
  onPick,
}: ViewerProps) {
  const rendererRef = useRef<FilmRenderer | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const [comparing, setComparing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [dragging, setDragging] = useState(false);

  // Renderer einmalig aufbauen.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new FilmRenderer(canvas);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return;
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [onError, canvasRef]);

  // Neues Bild in die Textur laden.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !image) return;
    try {
      renderer.setImage(image);
      renderer.render(params);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
    // params bewusst nicht in den Abhaengigkeiten: das erledigt der Effekt
    // darunter. Hier geht es nur um den Bildwechsel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, onError]);

  // Reglerbewegung -> neu zeichnen.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !renderer.hasImage) return;
    try {
      renderer.render(params);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [params, onError]);

  const updateSplit = useCallback((clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setSplit(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  }, []);

  return (
    <div className="viewer">
      {/*
        Das Seitenverhaeltnis steht am Rahmen, nicht am Canvas. Ein
        max-height in Prozent braucht eine definierte Elternhoehe - die gibt
        es in dieser Kette nicht, weshalb Hochformatbilder vorher unten aus
        dem Bild liefen. Mit aspect-ratio rechnet der Browser die passende
        Box selbst aus, und die Ueberlagerungen sitzen deckungsgleich.
      */}
      <div
        className={picking ? "frame picking" : "frame"}
        ref={frameRef}
        style={image ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
        onClick={(e) => {
          if (!picking) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          onPick(
            (e.clientX - rect.left) / rect.width,
            (e.clientY - rect.top) / rect.height,
          );
          // Nach einem Griff wieder aus - eine Pipette, die anbleibt, klickt
          // einem beim naechsten Mal versehentlich den Abgleich kaputt.
          setPicking(false);
        }}
      >
        <canvas ref={canvasRef} />

        {comparing && originalUrl && (
          <>
            <img
              className="compare"
              src={originalUrl}
              alt="Original ohne Emulation"
              // Links das Original, rechts die Emulation.
              style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}
            />
            <div
              className="split-handle"
              style={{ left: `${split * 100}%` }}
              role="slider"
              tabIndex={0}
              aria-label="Vergleichsposition"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split * 100)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(true);
              }}
              onPointerMove={(e) => dragging && updateSplit(e.clientX)}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId);
                setDragging(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 0.04));
                if (e.key === "ArrowRight") setSplit((s) => Math.min(1, s + 0.04));
              }}
            />
            <span className="compare-tag left">Original</span>
            <span className="compare-tag right">{params.stock.name}</span>
          </>
        )}

        <div className="frame-tools">
          <button
            className="compare-toggle"
            aria-pressed={picking}
            title="Auf eine Stelle klicken, die neutral grau sein soll"
            onClick={(e) => {
              e.stopPropagation();
              setPicking((p) => !p);
            }}
          >
            {picking ? "Klick ins Bild" : "Graupunkt"}
          </button>
          <button
            className="compare-toggle"
            aria-pressed={comparing}
            onClick={(e) => {
              e.stopPropagation();
              setComparing((c) => !c);
            }}
          >
            {comparing ? "Vergleich aus" : "Vergleich"}
          </button>
        </div>
      </div>
    </div>
  );
}
