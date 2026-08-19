import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Tonwertverteilung des fertigen Bildes.
 *
 * Wichtiger geworden, seit der Scanner auf den vollen Umfang normalisiert:
 * man muss sehen koennen, ob dabei Lichter oder Tiefen abgeschnitten werden.
 */

const BINS = 64;
/**
 * Ausgelesen wird nicht das grosse Canvas, sondern eine verkleinerte Kopie.
 * getImageData auf 2048 Pixel Kantenlaenge kostet bei jedem Reglerschritt
 * spuerbar Zeit; bei 128 ist es nicht messbar und fuer eine Verteilung
 * vollkommen ausreichend.
 */
const SAMPLE = 128;

const W = 260;
const H = 60;

interface HistogramProps {
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Zaehler, der sich bei jedem Neuzeichnen aendert. */
  version: number;
}

function toPath(bins: number[], peak: number): string {
  let d = `M0 ${H}`;
  bins.forEach((v, i) => {
    const x = (i / (BINS - 1)) * W;
    const y = H - (peak > 0 ? v / peak : 0) * H;
    d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `${d}L${W} ${H}Z`;
}

export function Histogram({ canvasRef, version }: HistogramProps) {
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [clipping, setClipping] = useState({ tiefen: 0, lichter: 0 });

  useEffect(() => {
    const source = canvasRef.current;
    if (!source || source.width === 0) return;

    if (!scratch.current) scratch.current = document.createElement("canvas");
    const small = scratch.current;
    const ratio = source.height / source.width;
    small.width = SAMPLE;
    small.height = Math.max(1, Math.round(SAMPLE * ratio));

    const ctx = small.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, small.width, small.height);

    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, small.width, small.height).data;
    } catch {
      return;
    }

    const channels = [new Array(BINS).fill(0), new Array(BINS).fill(0), new Array(BINS).fill(0)];
    let dunkel = 0;
    let hell = 0;
    const total = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        channels[c][Math.min(BINS - 1, (data[i + c] * BINS) >> 8)]++;
      }
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (l <= 2) dunkel++;
      if (l >= 253) hell++;
    }

    // Der hoechste Balken ueber alle Kanaele setzt den Massstab - sonst
    // sehen die drei Kurven unterschiedlich skaliert aus.
    const peak = Math.max(...channels.map((c) => Math.max(...c)));
    setPaths(channels.map((c) => toPath(c, peak)));
    setClipping({
      tiefen: Math.round((dunkel / total) * 1000) / 10,
      lichter: Math.round((hell / total) * 1000) / 10,
    });
  }, [canvasRef, version]);

  return (
    <figure className="histogram">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Tonwertverteilung">
        <rect x="0" y="0" width={W} height={H} fill="var(--bg)" />
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill={["#e8564f", "#7cbc3a", "#4f9ae8"][i]}
            fillOpacity="0.45"
          />
        ))}
      </svg>
      <figcaption>
        {clipping.tiefen > 0.5 || clipping.lichter > 0.5
          ? `Abgeschnitten: ${clipping.tiefen} % Tiefen, ${clipping.lichter} % Lichter`
          : "Links Schwarz, rechts Weiss. Nichts abgeschnitten."}
      </figcaption>
    </figure>
  );
}
