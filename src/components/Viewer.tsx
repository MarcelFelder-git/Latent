import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  BORDER_FRACTION,
  FilmRenderer,
  type Crop,
  type RenderParams,
} from "../lib/gl/renderer";

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
  crop: Crop;
  /** Verschiebung des Ausschnitts, in Anteilen der Rahmenbreite bzw -hoehe. */
  onCropDrag: (dx: number, dy: number) => void;
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
  crop,
  onCropDrag,
}: ViewerProps) {
  const rendererRef = useRef<FilmRenderer | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const [comparing, setComparing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [dragging, setDragging] = useState(false);

  // 1:1-Ansicht. Korn und Lichthof sind Erscheinungen auf Pixelebene - in
  // einer eingepassten Vorschau lassen sie sich schlicht nicht beurteilen.
  const [zoomed, setZoomed] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

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
      renderer.setCrop(crop);
      renderer.render(params);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
    setPan({ x: 0, y: 0 });
    // params bewusst nicht in den Abhaengigkeiten: das erledigt der Effekt
    // darunter. Hier geht es nur um den Bildwechsel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, onError]);

  // Ausschnitt geaendert -> Renderziele anpassen und neu zeichnen.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !renderer.hasImage) return;
    try {
      renderer.setCrop(crop);
      renderer.render(params);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crop.x, crop.y, crop.w, crop.h, onError]);

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

  /** Verschiebung so begrenzen, dass nie ueber den Bildrand hinausgezogen wird. */
  const clampPan = useCallback((x: number, y: number) => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return { x: 0, y: 0 };
    const maxX = Math.max(0, (canvas.width - frame.clientWidth) / 2);
    const maxY = Math.max(0, (canvas.height - frame.clientHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }, [canvasRef]);

  const toggleZoom = useCallback(() => {
    setZoomed((z) => {
      if (!z) {
        // Vergleich und Zoom schliessen sich aus: die Ueberlagerung sitzt am
        // Rahmen, nicht am verschobenen Canvas, und wuerde daneben liegen.
        setComparing(false);
        setPan({ x: 0, y: 0 });
      }
      return !z;
    });
  }, []);

  const beschnitten = crop.w < 1 || crop.h < 1;
  const klassen = ["frame"];
  if (picking) klassen.push("picking");
  if (zoomed) klassen.push("zoomed");
  else if (beschnitten) klassen.push("shiftable");

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
        className={klassen.join(" ")}
        ref={frameRef}
        // Nach Beschnitt bestimmt der Ausschnitt das Verhaeltnis, nicht mehr
        // das Original - sonst laege der Rahmen neben dem Canvasinhalt.
        //
        // In der 1:1-Ansicht faellt das Verhaeltnis weg: dort ist der Rahmen
        // ein Guckloch in voller Groesse des Bereichs, und das Canvas liegt
        // absolut positioniert darin. Mit aspect-ratio waere der Rahmen auf
        // 0x0 zusammengefallen, weil ihn nichts mehr aufspannt - das Bild
        // verschwand dann komplett hinter overflow: hidden.
        style={
          image && !zoomed
            ? {
                // Der Filmrand macht die Ausgabe hoeher - sonst laege der
                // Rahmen wieder neben dem Canvasinhalt.
                aspectRatio: `${image.width * crop.w} / ${
                  (image.height * crop.h) /
                  (params.border ? 1 - 2 * BORDER_FRACTION : 1)
                }`,
              }
            : undefined
        }
        onDoubleClick={toggleZoom}
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
        onPointerDown={(e) => {
          if (picking) return;
          // Zugeschnitten laesst sich der Ausschnitt schieben, gezoomt der
          // Bildausschnitt der Lupe. Beides gleichzeitig gibt es nicht.
          if (!zoomed && crop.w >= 1 && crop.h >= 1) return;
          // setPointerCapture wirft, wenn der Zeiger nicht (mehr) aktiv ist.
          // Das darf das Ziehen nicht verhindern - ohne Capture funktioniert
          // es weiter, es endet nur frueher, wenn der Zeiger den Rahmen
          // verlaesst.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* ohne Capture weitermachen */
          }
          panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onPointerMove={(e) => {
          const start = panStart.current;
          if (!start) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (zoomed) {
            setPan(clampPan(start.px + dx, start.py + dy));
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          // Ziehen bewegt das Bild, der Ausschnitt wandert also entgegen.
          onCropDrag(-dx / rect.width, -dy / rect.height);
          panStart.current = { ...start, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          if (panStart.current) {
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              /* war nie gefangen */
            }
          }
          panStart.current = null;
        }}
      >
        <canvas
          ref={canvasRef}
          style={
            zoomed
              ? { transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))` }
              : undefined
          }
        />

        {comparing && originalUrl && !zoomed && (
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
                e.stopPropagation();
                // Wie beim Verschieben: ein fehlgeschlagenes Capture darf das
                // Ziehen nicht verhindern.
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* ohne Capture weitermachen */
                }
                setDragging(true);
              }}
              onPointerMove={(e) => dragging && updateSplit(e.clientX)}
              onPointerUp={(e) => {
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                } catch {
                  /* war nie gefangen */
                }
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
            aria-pressed={zoomed}
            title="Korn und Lichthof in Originalgroesse beurteilen (oder Doppelklick)"
            onClick={(e) => {
              e.stopPropagation();
              toggleZoom();
            }}
          >
            {zoomed ? "Einpassen" : "1:1"}
          </button>
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
            disabled={zoomed}
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
