import { STOCKS, type FilmStock } from "../lib/film/stocks";

export interface Adjustments {
  exposure: number;
  contrast: number;
  grain: number;
  halation: number;
}

interface ControlsProps {
  stock: FilmStock;
  onStockChange: (slug: string) => void;
  adjustments: Adjustments;
  onAdjust: (next: Adjustments) => void;
  onReset: () => void;
  onExport: () => void;
  canExport: boolean;
}

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

export function Controls({
  stock,
  onStockChange,
  adjustments,
  onAdjust,
  onReset,
  onExport,
  canExport,
}: ControlsProps) {
  const set = <K extends keyof Adjustments>(key: K) => (value: number) =>
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
        <h2 className="section-label">Entwicklung</h2>
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
            label="Kontrast"
            value={adjustments.contrast}
            min={0.5}
            max={1.8}
            step={0.01}
            format={asPercent}
            onChange={set("contrast")}
          />
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
        </div>
      </section>

      <div className="actions">
        <button onClick={onReset}>Zuruecksetzen</button>
        <button onClick={onExport} disabled={!canExport}>
          Export
        </button>
      </div>
    </aside>
  );
}
