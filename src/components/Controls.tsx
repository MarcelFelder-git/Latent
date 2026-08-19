import { useState, type RefObject } from "react";
import { CurveDisplay } from "./CurveDisplay";
import { Histogram } from "./Histogram";
import type { Adjustments } from "../lib/film/adjustments";
import { PRESETS, type Preset } from "../lib/film/presets";
import { SCANNERS, type ScannerProfile } from "../lib/film/scanners";
import { STOCKS, type FilmStock } from "../lib/film/stocks";

interface SliderProps {
  label: string;
  /** Fachbegriff, falls die Beschriftung bewusst laienfreundlich ist. */
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({ label, hint, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <div>
      <div className="slider-head">
        <span className="slider-name" title={hint}>
          {label}
        </span>
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
  onPreset: (preset: Preset) => void;
  onReset: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onExport: () => void;
  exporting: boolean;
  canExport: boolean;
  /** Vorschaubilder je Stock-Slug, sobald berechnet. */
  thumbnails: Record<string, string>;
  canvasRef: RefObject<HTMLCanvasElement>;
  renderVersion: number;
}

export function Controls({
  stock,
  onStockChange,
  scanner,
  onScannerChange,
  adjustments,
  onAdjust,
  onPreset,
  onReset,
  onUndo,
  canUndo,
  onExport,
  exporting,
  canExport,
  thumbnails,
  canvasRef,
  renderVersion,
}: ControlsProps) {
  const [erklaert, setErklaert] = useState<string | null>(null);

  const set =
    <K extends keyof Adjustments>(key: K) =>
    (value: number) =>
      onAdjust({ ...adjustments, [key]: value });

  return (
    <aside className="controls">
      <section>
        <h2 className="section-label">Voreinstellung</h2>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.slug} className="preset" title={p.blurb} onClick={() => onPreset(p)}>
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-label">Filmmaterial</h2>
        <div className="stocks">
          {STOCKS.map((s) => (
            <div key={s.slug} className="stock-row">
              <button
                className="stock"
                // Ohne das meldet der Screenreader den zusammengeklebten
                // Inhalt aller Spans als Namen.
                aria-label={`${s.name}, ISO ${s.iso}`}
                aria-pressed={s.slug === stock.slug}
                onClick={() => onStockChange(s.slug)}
              >
                {thumbnails[s.slug] ? (
                  <img className="stock-thumb" src={thumbnails[s.slug]} alt="" />
                ) : (
                  <span className="stock-thumb placeholder" />
                )}
                <span className="stock-text">
                  <span className="stock-head">
                    <span className="stock-name">{s.name}</span>
                    <span className="stock-iso">ISO {s.iso}</span>
                  </span>
                  <span className="stock-blurb">{s.blurb}</span>
                </span>
              </button>
              <button
                className="explain"
                aria-label={`Was ist ${s.name}?`}
                aria-expanded={erklaert === s.slug}
                onClick={() => setErklaert(erklaert === s.slug ? null : s.slug)}
              >
                ?
              </button>
              {erklaert === s.slug && <p className="stock-detail">{s.detail}</p>}
            </div>
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
            hint="Laenger oder kuerzer entwickeln: mehr Kontrast, mehr Korn"
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
            hint="Ueberblendung zwischen Original und Emulation"
            value={adjustments.strength}
            min={0}
            max={1}
            step={0.01}
            format={asPercent}
            onChange={set("strength")}
          />
        </div>
      </section>

      {canExport && (
        <section>
          <h2 className="section-label">Tonwerte</h2>
          <Histogram canvasRef={canvasRef} version={renderVersion} />
        </section>
      )}

      <section>
        <h2 className="section-label">Labor</h2>
        <div className="stocks">
          {SCANNERS.map((s) => (
            <button
              key={s.slug}
              className="stock plain"
              aria-label={`Scanner ${s.name}`}
              aria-pressed={s.slug === scanner.slug}
              onClick={() => onScannerChange(s.slug)}
            >
              <span className="stock-text">
                <span className="stock-head">
                  <span className="stock-name">{s.name}</span>
                </span>
                <span className="stock-blurb">{s.blurb}</span>
              </span>
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
            label="Lichtschein"
            hint="Halation: Streulicht um helle Stellen"
            value={adjustments.halation}
            min={0}
            max={3}
            step={0.05}
            format={asPercent}
            onChange={set("halation")}
          />
          <Slider
            label="Raender abdunkeln"
            hint="Vignette"
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
        <button onClick={onUndo} disabled={!canUndo}>
          Zurueck
        </button>
        <button onClick={onReset}>Neutral</button>
        <button onClick={onExport} disabled={!canExport || exporting}>
          {exporting ? "Export laeuft" : "Export"}
        </button>
      </div>
    </aside>
  );
}
