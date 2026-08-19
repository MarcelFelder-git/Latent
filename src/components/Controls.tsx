import { CurveDisplay } from "./CurveDisplay";
import { SCANNERS, type ScannerProfile } from "../lib/film/scanners";
import { STOCKS, type FilmStock } from "../lib/film/stocks";

export interface Adjustments {
  /** Blendenstufen heller/dunkler. */
  exposure: number;
  /** Laenger oder kuerzer entwickeln. */
  push: number;
  /** -1 kuehl bis +1 warm. */
  warmth: number;
  /** 0 = Original, 1 = volle Emulation. */
  strength: number;
  grain: number;
  halation: number;
  vignette: number;
}

export const NEUTRAL: Adjustments = {
  exposure: 0,
  push: 0,
  warmth: 0,
  strength: 1,
  grain: 1,
  halation: 1,
  vignette: 0.18,
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <div>
      <div className="slider-head">
        <span className="slider-name">{label}</span>
        <span className="slider-value">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

const asStops = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV`;
const asPercent = (v: number) => `${Math.round(v * 100)} %`;

/**
 * Push/Pull in der Sprache, die Analogfotografen benutzen - und nebenbei
 * verstaendlicher als "Kontrast", weil es beschreibt, was im Labor passiert.
 */
const asPush = (v: number) => {
  if (Math.abs(v) < 0.05) return "Normal";
  return v > 0 ? `+${v.toFixed(1)} Push` : `${v.toFixed(1)} Pull`;
};

const asWarmth = (v: number) => {
  if (Math.abs(v) < 0.03) return "neutral";
  return `${v > 0 ? "warm" : "kuehl"} ${Math.round(Math.abs(v) * 100)} %`;
};

interface ControlsProps {
  stock: FilmStock;
  onStockChange: (slug: string) => void;
  scanner: ScannerProfile;
  onScannerChange: (slug: string) => void;
  adjustments: Adjustments;
  onAdjust: (next: Adjustments) => void;
  onReset: () => void;
  onExport: () => void;
  canExport: boolean;
}

export function Controls({
  stock,
  onStockChange,
  scanner,
  onScannerChange,
  adjustments,
  onAdjust,
  onReset,
  onExport,
  canExport,
}: ControlsProps) {
  const set =
    <K extends keyof Adjustments>(key: K) =>
    (value: number) =>
      onAdjust({ ...adjustments, [key]: value });

  return (
    <aside className="controls">
      <section>
        <h2 className="section-label">Filmmaterial</h2>
        <div className="stocks">
          {STOCKS.map((s) => (
            <button
              key={s.slug}
              className="stock"
              // Ohne das meldet der Screenreader den zusammengeklebten
              // Inhalt aller drei Spans als Namen.
              aria-label={`${s.name}, ISO ${s.iso}`}
              aria-pressed={s.slug === stock.slug}
              onClick={() => onStockChange(s.slug)}
            >
              <span className="stock-head">
                <span className="stock-name">{s.name}</span>
                <span className="stock-iso">ISO {s.iso}</span>
              </span>
              <span className="stock-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-label">Kennlinie</h2>
        <CurveDisplay stock={stock} push={adjustments.push} />
      </section>

      <section>
        <h2 className="section-label">Aufnahme und Entwicklung</h2>
        <div className="sliders">
          <Slider
            label="Belichtung"
            value={adjustments.exposure}
            min={-3}
            max={3}
            step={0.05}
            format={asStops}
            onChange={set("exposure")}
          />
          <Slider
            label="Push / Pull"
            value={adjustments.push}
            min={-1}
            max={2}
            step={0.1}
            format={asPush}
            onChange={set("push")}
          />
          <Slider
            label="Weissabgleich"
            value={adjustments.warmth}
            min={-1}
            max={1}
            step={0.02}
            format={asWarmth}
            onChange={set("warmth")}
          />
          <Slider
            label="Staerke"
            value={adjustments.strength}
            min={0}
            max={1}
            step={0.01}
            format={asPercent}
            onChange={set("strength")}
          />
        </div>
      </section>

      <section>
        <h2 className="section-label">Labor</h2>
        <div className="stocks">
          {SCANNERS.map((s) => (
            <button
              key={s.slug}
              className="stock"
              aria-label={`Scanner ${s.name}`}
              aria-pressed={s.slug === scanner.slug}
              onClick={() => onScannerChange(s.slug)}
            >
              <span className="stock-head">
                <span className="stock-name">{s.name}</span>
              </span>
              <span className="stock-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <details className="more">
        <summary className="section-label">Feineinstellung</summary>
        <div className="sliders">
          <Slider
            label="Korn"
            value={adjustments.grain}
            min={0}
            max={3}
            step={0.05}
            format={asPercent}
            onChange={set("grain")}
          />
          <Slider
            label="Halation"
            value={adjustments.halation}
            min={0}
            max={3}
            step={0.05}
            format={asPercent}
            onChange={set("halation")}
          />
          <Slider
            label="Vignette"
            value={adjustments.vignette}
            min={0}
            max={0.6}
            step={0.01}
            format={asPercent}
            onChange={set("vignette")}
          />
        </div>
      </details>

      <div className="actions">
        <button onClick={onReset}>Zuruecksetzen</button>
        <button onClick={onExport} disabled={!canExport}>
          Export
        </button>
      </div>
    </aside>
  );
}
