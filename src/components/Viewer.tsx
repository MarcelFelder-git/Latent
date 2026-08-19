import { useEffect, useRef, useState, type RefObject } from "react";
import { FilmRenderer, type RenderParams } from "../lib/gl/renderer";

interface ViewerProps {
  image: ImageBitmap | null;
  originalUrl: string | null;
  params: RenderParams;
  onError: (message: string) => void;
  /** Von App gehalten, damit der Export an die Pixel kommt. */
  canvasRef: RefObject<HTMLCanvasElement>;
}

/**
 * Besitzt das Canvas und die Renderer-Instanz. Gerendert wird nur, wenn sich
 * etwas geaendert hat - kein requestAnimationFrame-Dauerlauf. Ein Foto ist
 * statisch, eine Endlosschleife wuerde nur Akku kosten.
 */
export function Viewer({ image, originalUrl, params, onError, canvasRef }: ViewerProps) {
  const rendererRef = useRef<FilmRenderer | null>(null);
  const [comparing, setComparing] = useState(false);

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

  return (
    <div className="viewer">
      <div
        className="frame"
        onPointerDown={() => setComparing(true)}
        onPointerUp={() => setComparing(false)}
        onPointerLeave={() => setComparing(false)}
      >
        <canvas ref={canvasRef} />
        {comparing && originalUrl && (
          <img className="compare" src={originalUrl} alt="Original ohne Emulation" />
        )}
        {originalUrl && (
          <span className="compare-hint">
            {comparing ? "Original" : "Halten zum Vergleichen"}
          </span>
        )}
      </div>
    </div>
  );
}
