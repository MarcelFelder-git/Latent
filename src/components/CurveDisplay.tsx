import { useMemo } from "react";
import { curveAtStops, pushCurve } from "../lib/film/curve";
import type { CurveParams, FilmStock } from "../lib/film/stocks";

/**
 * Die charakteristische Kurve, live gezeichnet aus denselben Parametern, die
 * der Shader gerade rechnet. Das ist nicht Deko: es macht sichtbar, was die
 * App tut, und es zeigt auf einen Blick, dass hier gerechnet und nicht eine
 * fertige Tabelle drueberlegt wird.
 */

const STOPS_MIN = -5;
const STOPS_MAX = 5;
const SAMPLES = 64;

const W = 260;
const H = 132;
const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 8;
const PAD_B = 20;

const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const CHANNEL_COLORS = ["#e8564f", "#7cbc3a", "#4f9ae8"];
const MONO_COLOR = "#c9c2b8";

function pathFor(p: CurveParams): string {
  let d = "";
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const stops = STOPS_MIN + (STOPS_MAX - STOPS_MIN) * t;
    const v = curveAtStops(stops, p);
    const x = PAD_L + t * PLOT_W;
    const y = PAD_T + (1 - v) * PLOT_H;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

interface CurveDisplayProps {
  stock: FilmStock;
  push: number;
}

export function CurveDisplay({ stock, push }: CurveDisplayProps) {
  const paths = useMemo(() => {
    const { r, g, b } = stock.curve;
    // Schwarzweiss: die drei Kurven sind identisch, eine Linie genuegt.
    const sources = stock.monochrome ? [g] : [r, g, b];
    return sources.map((c) => pathFor(pushCurve(c, push)));
  }, [stock, push]);

  const midX = PAD_L + PLOT_W * ((0 - STOPS_MIN) / (STOPS_MAX - STOPS_MIN));
  const midY = PAD_T + PLOT_H * 0.5;

  return (
    <figure className="curve">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={
          stock.monochrome
            ? `Kennlinie von ${stock.name}, eine Graustufenkurve.`
            : `Kennlinie von ${stock.name}, je eine Kurve fuer Rot, Gruen und Blau.`
        }
      >
        <rect
          x={PAD_L}
          y={PAD_T}
          width={PLOT_W}
          height={PLOT_H}
          fill="none"
          stroke="var(--border)"
          strokeWidth="0.5"
        />
        {/* Mittelgrau als Fadenkreuz - der Bezugspunkt der ganzen Kurve. */}
        <line
          x1={midX}
          y1={PAD_T}
          x2={midX}
          y2={PAD_T + PLOT_H}
          stroke="var(--border)"
          strokeWidth="0.5"
          strokeDasharray="2 3"
        />
        <line
          x1={PAD_L}
          y1={midY}
          x2={PAD_L + PLOT_W}
          y2={midY}
          stroke="var(--border)"
          strokeWidth="0.5"
          strokeDasharray="2 3"
        />

        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={stock.monochrome ? MONO_COLOR : CHANNEL_COLORS[i]}
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        <text x={PAD_L} y={H - 6} className="curve-tick">
          −5 EV
        </text>
        <text x={midX} y={H - 6} className="curve-tick" textAnchor="middle">
          Mittelgrau
        </text>
        <text x={W - PAD_R} y={H - 6} className="curve-tick" textAnchor="end">
          +5 EV
        </text>
      </svg>
      <figcaption>
        {stock.monochrome
          ? "Belichtung waagerecht, Helligkeit senkrecht."
          : "Je eine Kurve pro Filmschicht. Wo sie auseinanderlaufen, entsteht der Farbcharakter."}
      </figcaption>
    </figure>
  );
}
