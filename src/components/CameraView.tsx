import { useCallback, useEffect, useRef, useState } from "react";
import { FilmRenderer, type RenderParams } from "../lib/gl/renderer";

interface CameraViewProps {
  params: RenderParams;
  onCapture: (bitmap: ImageBitmap) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

type Facing = "environment" | "user";

/**
 * Live-Sucher, der schon durch die Filmemulation laeuft.
 *
 * Das ist die einzige Stelle in der App mit einer Dauerschleife. Bei einem
 * Standbild waere die reine Verschwendung - da wird nur neu gezeichnet, wenn
 * sich etwas geaendert hat. Ein Videobild aendert sich sechzigmal pro
 * Sekunde, also laeuft hier requestAnimationFrame.
 *
 * Aufgenommen wird das *unbearbeitete* Kamerabild, nicht das, was im Sucher
 * steht. Der Sucher zeigt, wie es aussehen wird; gespeichert wird sozusagen
 * das Negativ - sonst waere die Filmwahl nach dem Ausloesen eingebrannt.
 */
export function CameraView({ params, onCapture, onClose, onError }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FilmRenderer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number>(0);

  // Die Schleife soll bei jeder Reglerbewegung die neuen Werte sehen, ohne
  // dass sie dafuer neu gestartet werden muesste.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const [facing, setFacing] = useState<Facing>("environment");
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [seitenverhaeltnis, setSeitenverhaeltnis] = useState("4 / 3");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let abgebrochen = false;
    setReady(false);

    (async () => {
      // Ohne sicheren Kontext gibt es mediaDevices gar nicht - das ist keine
      // Ablehnung durch den Nutzer, sondern eine Vorgabe des Browsers.
      if (!navigator.mediaDevices?.getUserMedia) {
        onError(
          "Kamerazugriff braucht eine sichere Verbindung (https oder localhost).",
        );
        onClose();
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
          audio: false,
        });
        if (abgebrochen) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        stopStream();
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        // play() loest auf, sobald Bilder kommen - nicht zwingend erst, wenn
        // die Bildgroesse feststeht. Wer hier weitermacht, legt die
        // Renderziele auf 0x0 an und schaut danach auf ein schwarzes Bild.
        if (video.videoWidth === 0) {
          await new Promise<void>((fertig) => {
            const timer = window.setTimeout(fertig, 3000);
            video.addEventListener(
              "loadedmetadata",
              () => {
                window.clearTimeout(timer);
                fertig();
              },
              { once: true },
            );
          });
        }
        if (abgebrochen || video.videoWidth === 0) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        if (!rendererRef.current) rendererRef.current = new FilmRenderer(canvas);
        rendererRef.current.setImage(video);
        setSeitenverhaeltnis(`${video.videoWidth} / ${video.videoHeight}`);
        setReady(true);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        onError(
          name === "NotAllowedError"
            ? "Kamerazugriff wurde abgelehnt. Im Browser wieder freigeben und erneut versuchen."
            : name === "NotFoundError"
              ? "Keine Kamera gefunden."
              : `Kamera nicht verfuegbar (${err instanceof Error ? err.message : "unbekannt"}).`,
        );
        onClose();
      }
    })();

    return () => {
      abgebrochen = true;
    };
  }, [facing, onClose, onError, stopStream]);

  // Zeichenschleife.
  useEffect(() => {
    if (!ready) return;
    const schleife = () => {
      const renderer = rendererRef.current;
      const video = videoRef.current;
      if (renderer && video && video.readyState >= 2) {
        try {
          renderer.updateImage(video);
          renderer.render(paramsRef.current);
        } catch {
          // Ein einzelnes verlorenes Bild ist kein Grund, die Schleife
          // abzubrechen - beim naechsten Durchlauf kann es wieder gehen.
        }
      }
      frameRef.current = requestAnimationFrame(schleife);
    };
    frameRef.current = requestAnimationFrame(schleife);
    return () => cancelAnimationFrame(frameRef.current);
  }, [ready]);

  // Alles freigeben, wenn die Ansicht verschwindet.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(frameRef.current);
      rendererRef.current?.dispose();
      rendererRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const ausloesen = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    try {
      // Ueber ein Canvas statt direkt aus dem Video, weil die Frontkamera
      // gespiegelt angezeigt wird und das Ergebnis dazu passen muss - sonst
      // steht Schrift im Bild plotzlich seitenverkehrt.
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (facing === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0);
      const bitmap = await createImageBitmap(canvas);
      onCapture(bitmap);
      setCount((c) => c + 1);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Aufnahme fehlgeschlagen.");
    }
  }, [facing, onCapture, onError]);

  return (
    <div className="viewer">
      <div className="frame camera" style={{ aspectRatio: seitenverhaeltnis }}>
        <canvas
          ref={canvasRef}
          className={facing === "user" ? "gespiegelt" : undefined}
        />
        {!ready && <p className="camera-warten">Kamera wird geoeffnet…</p>}

        <div className="frame-tools">
          <button
            className="compare-toggle"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          >
            {facing === "user" ? "Rueckkamera" : "Frontkamera"}
          </button>
          <button className="compare-toggle" onClick={onClose}>
            Schliessen
          </button>
        </div>

        <div className="camera-leiste">
          {count > 0 && <span className="camera-zaehler">{count} aufgenommen</span>}
          <button className="ausloeser" onClick={() => void ausloesen()} disabled={!ready}>
            <span className="sr-only">Ausloesen</span>
          </button>
        </div>
      </div>

      {/* Das Video wird nie direkt gezeigt - es ist nur die Quelle fuer die
          Textur. Zu sehen ist immer das emulierte Bild. */}
      <video ref={videoRef} playsInline muted className="hidden-input" />
    </div>
  );
}
