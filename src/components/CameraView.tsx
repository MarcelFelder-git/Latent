import { useCallback, useEffect, useRef, useState } from "react";
import { FilmRenderer, type RenderParams } from "../lib/gl/renderer";

interface CameraViewProps {
  params: RenderParams;
  onCapture: (bitmap: ImageBitmap) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

type Facing = "environment" | "user";

/** Vorlaufzeiten in Sekunden. 0 heisst: sofort ausloesen. */
const VORLAUF = [0, 3, 10] as const;
type Vorlauf = (typeof VORLAUF)[number];

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
  const uhrRef = useRef<number>(0);

  // Die Schleife soll bei jeder Reglerbewegung die neuen Werte sehen, ohne
  // dass sie dafuer neu gestartet werden muesste.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  /*
   * Dasselbe fuer die Rueckmeldungen nach oben. Der Aufrufer uebergibt sie als
   * Pfeilfunktionen, die bei jedem Render neu entstehen - stuenden sie in den
   * Abhaengigkeiten des Effekts weiter unten, wuerde die Kamera bei jeder
   * Reglerbewegung neu angefordert.
   *
   * Nachgemessen, bevor es hier stand: drei Bewegungen am Belichtungsregler
   * haben getUserMedia zweimal erneut aufgerufen. Auf dem Telefon ist das ein
   * schwarzes Aufblitzen samt neuer Fokus- und Belichtungssuche - ausgerechnet
   * beim Einstellen, wofuer der Live-Sucher ueberhaupt da ist.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  const [facing, setFacing] = useState<Facing>("environment");
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [seitenverhaeltnis, setSeitenverhaeltnis] = useState("4 / 3");
  const [raster, setRaster] = useState(false);
  const [vorlauf, setVorlauf] = useState<Vorlauf>(0);
  const [restzeit, setRestzeit] = useState<number | null>(null);
  const [blitz, setBlitz] = useState(false);

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
        onErrorRef.current(
          "Kamerazugriff braucht eine sichere Verbindung (https oder localhost).",
        );
        onCloseRef.current();
        return;
      }

      try {
        // Erst die Wunschaufloesung versuchen. Schlaegt sie fehl, weil die
        // Kamera sie nicht liefern kann, bleibt nur die Richtung uebrig -
        // lieber ein kleineres Bild als gar keins. Genau das passiert auf
        // aelteren Geraeten und bei Objektiven mit fester Aufloesung.
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: facing,
              width: { ideal: 1920 },
              height: { ideal: 1440 },
            },
            audio: false,
          });
        } catch (err) {
          const name = err instanceof DOMException ? err.name : "";
          if (name !== "OverconstrainedError" && name !== "NotFoundError") throw err;
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing },
            audio: false,
          });
        }

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
        onErrorRef.current(
          name === "NotAllowedError"
            ? "Kamerazugriff wurde abgelehnt. Im Browser wieder freigeben und erneut versuchen."
            : name === "NotFoundError"
              ? "Keine Kamera gefunden."
              : `Kamera nicht verfuegbar (${err instanceof Error ? err.message : "unbekannt"}).`,
        );
        onCloseRef.current();
      }
    })();

    return () => {
      abgebrochen = true;
    };
    // Absichtlich nur die Richtung: alles andere wuerde die Kamera neu
    // anfordern, ohne dass sich an ihr etwas geaendert haette.
  }, [facing, stopStream]);

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

  /*
   * iOS haelt das Video an, sobald die App in den Hintergrund geht - beim
   * Zurueckkommen steht dann ein eingefrorenes Bild im Sucher, ohne dass
   * irgendetwas einen Fehler gemeldet haette. Also beim Zurueckkommen einmal
   * anstossen.
   */
  useEffect(() => {
    const wieder = () => {
      const video = videoRef.current;
      if (!document.hidden && video && video.paused) {
        void video.play().catch(() => {
          /* Ohne Nutzergeste kann das abgelehnt werden - dann bleibt es stehen. */
        });
      }
    };
    document.addEventListener("visibilitychange", wieder);
    return () => document.removeEventListener("visibilitychange", wieder);
  }, []);

  // Alles freigeben, wenn die Ansicht verschwindet.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.clearTimeout(uhrRef.current);
      rendererRef.current?.dispose();
      rendererRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const aufnehmen = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    try {
      // Ueber ein Canvas statt direkt aus dem Video, weil die Frontkamera
      // gespiegelt angezeigt wird und das Ergebnis dazu passen muss - sonst
      // steht Schrift im Bild ploetzlich seitenverkehrt.
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
      onCaptureRef.current(bitmap);
      setCount((c) => c + 1);
      // Kurzes Aufhellen als Rueckmeldung. Ohne Ausloeserton und ohne
      // Vibration bleibt sonst offen, ob der Druck angekommen ist.
      setBlitz(true);
      window.setTimeout(() => setBlitz(false), 140);
    } catch (err) {
      onErrorRef.current(
        err instanceof Error ? err.message : "Aufnahme fehlgeschlagen.",
      );
    }
  }, [facing]);

  /** Ausloeser: entweder sofort oder nach dem eingestellten Vorlauf. */
  const ausloesen = useCallback(() => {
    // Ein zweiter Druck waehrend des Vorlaufs bricht ab. Das erwartet man von
    // jeder Kamera-App und ist billiger als ein eigener Abbrechen-Knopf.
    if (restzeit !== null) {
      window.clearTimeout(uhrRef.current);
      setRestzeit(null);
      return;
    }
    if (vorlauf === 0) {
      void aufnehmen();
      return;
    }
    let rest: number = vorlauf;
    setRestzeit(rest);
    const tick = () => {
      rest -= 1;
      if (rest <= 0) {
        setRestzeit(null);
        void aufnehmen();
        return;
      }
      setRestzeit(rest);
      uhrRef.current = window.setTimeout(tick, 1000);
    };
    uhrRef.current = window.setTimeout(tick, 1000);
  }, [aufnehmen, restzeit, vorlauf]);

  return (
    <div className="viewer">
      <div className="frame camera" style={{ aspectRatio: seitenverhaeltnis }}>
        <canvas
          ref={canvasRef}
          className={facing === "user" ? "gespiegelt" : undefined}
        />
        {!ready && <p className="camera-warten">Kamera wird geoeffnet…</p>}

        {/* Drittelraster. Liegt ueber dem Bild und faengt keine Klicks ab. */}
        {raster && ready && (
          <div className="camera-raster" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}

        {restzeit !== null && (
          <div className="camera-countdown" aria-live="assertive">
            {restzeit}
          </div>
        )}
        {blitz && <div className="camera-blitz" aria-hidden="true" />}

        <div className="frame-tools">
          <button
            className="compare-toggle"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          >
            {facing === "user" ? "Rueckkamera" : "Frontkamera"}
          </button>
          <button
            className="compare-toggle"
            aria-pressed={raster}
            onClick={() => setRaster((r) => !r)}
          >
            Raster
          </button>
          <button
            className="compare-toggle"
            onClick={() =>
              setVorlauf((v) => VORLAUF[(VORLAUF.indexOf(v) + 1) % VORLAUF.length])
            }
          >
            {vorlauf === 0 ? "Vorlauf aus" : `${vorlauf} s`}
          </button>
          <button className="compare-toggle" onClick={onClose}>
            Schliessen
          </button>
        </div>

        <div className="camera-leiste">
          {count > 0 && <span className="camera-zaehler">{count} aufgenommen</span>}
          <button
            className={`ausloeser${restzeit !== null ? " laeuft" : ""}`}
            onClick={ausloesen}
            disabled={!ready}
          >
            <span className="sr-only">
              {restzeit !== null ? "Vorlauf abbrechen" : "Ausloesen"}
            </span>
          </button>
        </div>
      </div>

      {/* Das Video wird nie direkt gezeigt - es ist nur die Quelle fuer die
          Textur. Zu sehen ist immer das emulierte Bild. */}
      <video ref={videoRef} playsInline muted className="hidden-input" />
    </div>
  );
}
