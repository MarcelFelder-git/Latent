import { pushCurve, pushGrain } from "../film/curve";
import type { ScannerProfile } from "../film/scanners";
import type { FilmStock } from "../film/stocks";
import { whiteBalanceGain } from "../film/whitebalance";
import { BLUR_SRC, DEVELOP_SRC, HIGHLIGHT_SRC, SCENE_SRC, VERT_SRC } from "./shaders";

/**
 * Der Renderkern. Bewusst ohne DOM-Zugriffe ausser dem Canvas selbst - damit
 * laesst sich das Ganze spaeter unveraendert in einen Web Worker mit
 * OffscreenCanvas verschieben, wenn die Voll-Aufloesung dran ist.
 */

/** Standard-Deckel fuer die Bildschirmvorschau. */
export const PREVIEW_MAX_EDGE = 2048;

/**
 * Deckel fuer den Export. Deutlich hoeher als die Vorschau, aber nicht
 * unbegrenzt: der Szenenpuffer liegt in RGBA16F, ein 6000x4000-Bild braucht
 * dafuer allein rund 190 MB. Auf dem Telefon ist das der sichere Absturz.
 */
export const EXPORT_MAX_EDGE = 4096;

/**
 * Die Halation laeuft auf stark verkleinertem Puffer. Ein 9-Tap-Kernel kann
 * nur wenige Pixel weit streuen - zieht man die Taps weiter auseinander,
 * entstehen sichtbare Ringe statt eines weichen Scheins. Also: klein rechnen
 * und beim Hochskalieren die bilineare Filterung glaetten lassen. Nebeneffekt,
 * der hier richtig ist: der Lichthof bleibt ein konstanter Bruchteil des
 * Bildes, unabhaengig von der Scanaufloesung - genau wie beim echten Film,
 * wo die Streuung eine physische Distanz in der Emulsion ist.
 */
const HALATION_DOWNSAMPLE = 8;

/**
 * Der zweite Streudurchlauf laeuft mit dieser vielfachen Schrittweite.
 *
 * Zwei gleich weite Gauss-Durchlaeufe ergeben zusammen nur die Wurzel aus
 * zwei an Verbreiterung - viel zu wenig, um daraus zwei unterscheidbare
 * Streubreiten zu gewinnen. Gemessen lagen die Halbwertsabstaende von Rot und
 * Blau danach vier Pixel auseinander, also im Rauschen. Mit dem groesseren
 * Schritt wird der weite Hof rund zweieinhalbmal so breit wie der enge.
 *
 * Ringe sind dabei kein Problem, obwohl die Taps weiter auseinanderliegen:
 * der zweite Durchlauf arbeitet auf einem bereits geglaetteten Bild.
 */
const HALATION_WIDE_FACTOR = 2.2;

/**
 * Beschnitt in Bildkoordinaten, Ursprung oben links, alles auf 0..1 normiert.
 * Kein Beschnitt entspricht {x: 0, y: 0, w: 1, h: 1}.
 */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Hoehe eines Randstreifens, als Anteil der Gesamtausgabe. Echtes Kleinbild
 * ist 35 mm hoch bei 24 mm Bildhoehe, der Rand macht also gut 15 Prozent je
 * Seite aus. Etwas knapper gehalten, damit das Bild die Hauptsache bleibt.
 */
export const BORDER_FRACTION = 0.13;

/** Perforationen ueber die Bildbreite. Kleinbild hat acht pro Vollformat. */
const SPROCKETS = 8;

/** Groesse der Textur mit der Randschrift. */
const LABEL_W = 1024;
const LABEL_H = 64;

/**
 * Ein 2D-Canvas, das im Fenster wie im Worker funktioniert - der Export
 * erzeugt die Randschrift im Worker, wo es kein document gibt.
 */
function make2D(w: number, h: number) {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d");
    return ctx ? { canvas: c as unknown as TexImageSource, ctx } : null;
  }
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  return ctx ? { canvas: c as unknown as TexImageSource, ctx } : null;
}

export interface RenderParams {
  stock: FilmStock;
  scanner: ScannerProfile;
  /** Belichtungskorrektur in Blendenstufen. */
  exposure: number;
  /** Push/Pull in Blendenstufen: laenger oder kuerzer entwickeln. */
  push: number;
  /** -1 kuehl bis +1 warm. */
  warmth: number;
  /** -1 gruen bis +1 magenta. */
  tint: number;
  /** 0 = Original, 1 = volle Emulation. */
  strength: number;
  /** Faktor auf die Kornstaerke des Stocks. */
  grain: number;
  /** Faktor auf die Halationsstaerke des Stocks. */
  halation: number;
  /** 0 = keine Vignette. */
  vignette: number;
  /**
   * Filmrand mit Perforation und Randschrift. Optional, weil er fuer
   * Vorschaubilder und das Vergleichsblatt nicht gewollt ist - dort geht es
   * um die Emulsion, nicht um die Aufmachung.
   */
  border?: boolean;
}

/** Was sich als Bildquelle hochladen laesst - Standbild oder Live-Video. */
export type ImageSource = ImageBitmap | HTMLImageElement | HTMLVideoElement;

/**
 * Ein Video traegt seine Bildgroesse in videoWidth/videoHeight; width und
 * height sind dort die Anzeigegroesse des Elements und damit nutzlos.
 * Abgefragt wird das ueber die Eigenschaft und nicht ueber instanceof, weil
 * es HTMLVideoElement im Worker gar nicht gibt.
 */
function quellGroesse(s: ImageSource): { w: number; h: number } {
  if ("videoWidth" in s) return { w: s.videoWidth, h: s.videoHeight };
  return { w: s.width, h: s.height };
}

/** Drei Kanalwerte auf ihren Mittelwert ziehen - fuer Schwarzweissfilm. */
function flatten(v: [number, number, number]): [number, number, number] {
  const m = (v[0] + v[1] + v[2]) / 3;
  return [m, m, m];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader konnte nicht kompiliert werden:\n${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, fsSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Programm konnte nicht gelinkt werden:\n${log}`);
  }
  return prog;
}

/** Programm plus Cache fuer Uniform-Locations (getUniformLocation ist teuer). */
class Pass {
  readonly program: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext, fsSrc: string) {
    this.program = link(gl, fsSrc);
  }

  loc(name: string): WebGLUniformLocation | null {
    if (!this.locs.has(name)) {
      this.locs.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.locs.get(name)!;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

/** Renderziel: Textur plus Framebuffer. */
interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

export class FilmRenderer {
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private quad: WebGLBuffer;

  private scenePass: Pass;
  private highlightPass: Pass;
  private blurPass: Pass;
  private developPass: Pass;

  private imageTex: WebGLTexture | null = null;
  private scene: Target | null = null;
  private haloA: Target | null = null;
  private haloB: Target | null = null;
  private haloNarrow: Target | null = null;

  private imageWidth = 0;
  private imageHeight = 0;

  private labelTex: WebGLTexture | null = null;
  private labelText = "";

  /**
   * RGBA16F als Zwischenformat. Hier nicht optional: der Szenenpuffer haelt
   * *lineares* Licht, und das geht deutlich ueber 1.0 hinaus - eine Lampe
   * kann bei 20 liegen. In 8 Bit waere sie auf 1.0 abgeschnitten und es gaebe
   * ueberhaupt keine Halation.
   */
  private colorType: number;
  private colorInternal: number;
  readonly hasFloatBuffers: boolean;

  /**
   * Quelle und Beschnitt werden gemerkt, damit ein neuer Ausschnitt nur die
   * Renderziele neu anlegen muss. Die Textur erneut hochzuladen waere bei
   * jedem Ziehen am Ausschnitt zweistellige Megabyte an Arbeit.
   */
  private source: ImageSource | null = null;
  private crop: Crop = FULL_CROP;
  /** Quellgroesse, mit der die Renderziele zuletzt angelegt wurden. */
  private appliedW = 0;
  private appliedH = 0;

  /**
   * Nimmt auch ein OffscreenCanvas - so laeuft derselbe Renderkern im Worker,
   * wo der Export hingehoert, ohne dass die Oberflaeche einfriert.
   */
  constructor(
    private canvas: HTMLCanvasElement | OffscreenCanvas,
    private maxEdge: number = PREVIEW_MAX_EDGE,
  ) {
    // Die Ueberladungen von getContext lassen sich fuer die Vereinigung aus
    // Canvas und OffscreenCanvas nicht aufloesen - beide liefern hier
    // denselben Kontext, also einmal explizit sagen, was herauskommt.
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true, // damit toBlob() den Export liefern kann
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 wird von diesem Browser nicht unterstuetzt.");
    this.gl = gl;

    this.hasFloatBuffers = gl.getExtension("EXT_color_buffer_float") !== null;
    if (this.hasFloatBuffers) {
      this.colorInternal = gl.RGBA16F;
      this.colorType = gl.HALF_FLOAT;
    } else {
      console.warn(
        "EXT_color_buffer_float fehlt - lineares Licht wird bei 1.0 " +
          "abgeschnitten, die Halation faellt entsprechend schwach aus.",
      );
      this.colorInternal = gl.RGBA8;
      this.colorType = gl.UNSIGNED_BYTE;
    }

    this.scenePass = new Pass(gl, SCENE_SRC);
    this.highlightPass = new Pass(gl, HIGHLIGHT_SRC);
    this.blurPass = new Pass(gl, BLUR_SRC);
    this.developPass = new Pass(gl, DEVELOP_SRC);

    // Ein einzelnes uebergrosses Dreieck deckt den Clip-Space ab - eine Kante
    // weniger als ein Quad aus zwei Dreiecken.
    this.vao = gl.createVertexArray()!;
    this.quad = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private makeTarget(width: number, height: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, this.colorInternal, width, height, 0,
      gl.RGBA, this.colorType, null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer unvollstaendig (0x${status.toString(16)}).`);
    }
    return { tex, fbo, width, height };
  }

  private disposeTarget(t: Target | null): void {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  /** Bild laden. Der Ausschnitt bleibt erhalten. */
  setImage(source: ImageSource): void {
    const gl = this.gl;
    this.source = source;

    if (this.imageTex) gl.deleteTexture(this.imageTex);
    this.imageTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    // Kein UNPACK_FLIP_Y_WEBGL - das Flag wird fuer ImageBitmap-Quellen
    // ignoriert. Gedreht wird in den Shadern, siehe imageUv() in shaders.ts.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.applyCrop();
  }

  /**
   * Nur die Bilddaten erneuern, ohne Renderziele neu anzulegen. Fuer den
   * Live-Sucher: dort kommt sechzigmal pro Sekunde ein neues Bild gleicher
   * Groesse, und jedes Mal alle Puffer neu zu belegen waere Verschwendung.
   */
  updateImage(source: ImageSource): void {
    const gl = this.gl;
    if (!this.imageTex) {
      this.setImage(source);
      return;
    }
    this.source = source;

    // Ein Video meldet seine Groesse erst, wenn die Metadaten da sind - beim
    // ersten Aufruf steht dort oft noch 0x0. Ohne diese Nachpruefung blieben
    // die Renderziele fuer immer auf ihrer Anfangsgroesse stehen und der
    // Sucher waere schwarz. Faengt nebenbei den Aufloesungswechsel beim
    // Umschalten zwischen Front- und Rueckkamera mit ab.
    const { w, h } = quellGroesse(source);
    if (w > 0 && h > 0 && (w !== this.appliedW || h !== this.appliedH)) {
      this.applyCrop();
    }

    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /** Ausschnitt setzen und die Renderziele darauf anpassen. */
  setCrop(crop: Crop): void {
    this.crop = crop;
    if (this.source) this.applyCrop();
  }

  /**
   * Groesse der Ausgabe ergibt sich aus Quelle mal Ausschnitt, gedeckelt auf
   * maxEdge. Dass ein enger Ausschnitt eine kleinere Ausgabe hat, ist genau
   * richtig: das Korn bleibt ein konstanter Bruchteil der *Ausgabe*, wird
   * beim Beschneiden also groesser - so wie bei einer Vergroesserung vom
   * Negativ.
   */
  private applyCrop(): void {
    const src = this.source;
    if (!src) return;
    const { w: sw, h: sh } = quellGroesse(src);
    if (sw === 0 || sh === 0) return;
    this.appliedW = sw;
    this.appliedH = sh;
    const cw = sw * this.crop.w;
    const ch = sh * this.crop.h;
    const scale = Math.min(1, this.maxEdge / Math.max(cw, ch));
    this.imageWidth = Math.max(1, Math.round(cw * scale));
    this.imageHeight = Math.max(1, Math.round(ch * scale));

    this.canvas.width = this.imageWidth;
    this.canvas.height = this.imageHeight;

    this.disposeTarget(this.scene);
    this.disposeTarget(this.haloA);
    this.disposeTarget(this.haloB);
    this.disposeTarget(this.haloNarrow);

    const hw = Math.max(8, Math.ceil(this.imageWidth / HALATION_DOWNSAMPLE));
    const hh = Math.max(8, Math.ceil(this.imageHeight / HALATION_DOWNSAMPLE));
    this.scene = this.makeTarget(this.imageWidth, this.imageHeight);
    this.haloA = this.makeTarget(hw, hh);
    this.haloB = this.makeTarget(hw, hh);
    this.haloNarrow = this.makeTarget(hw, hh);
  }

  /** Ausgabegroesse in Pixeln, nach Beschnitt und Deckelung (ohne Rand). */
  get outputSize(): { width: number; height: number } {
    return { width: this.imageWidth, height: this.imageHeight };
  }

  /**
   * Randschrift als Textur. Wird nur neu gezeichnet, wenn sich der Text
   * aendert - das passiert beim Filmwechsel, nicht bei jedem Regler.
   */
  private ensureLabel(text: string): void {
    if (this.labelTex && this.labelText === text) return;
    const gl = this.gl;
    const flaeche = make2D(LABEL_W, LABEL_H);
    if (!flaeche) return;
    const { canvas, ctx } = flaeche;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, LABEL_W, LABEL_H);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    // Generisches sans-serif statt system-ui: im Worker ist nicht garantiert,
    // dass die Schriftauswahl des Systems aufgeloest wird.
    ctx.font = "600 30px sans-serif";
    ctx.fillText(text, 26, LABEL_H / 2 + 1);
    ctx.font = "22px sans-serif";
    ctx.globalAlpha = 0.75;
    const rechts = "LATENT";
    ctx.fillText(rechts, LABEL_W - 26 - ctx.measureText(rechts).width, LABEL_H / 2 + 1);
    ctx.globalAlpha = 1;

    if (!this.labelTex) this.labelTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.labelTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.labelText = text;
  }

  get hasImage(): boolean {
    return this.imageTex !== null;
  }

  private drawTo(target: Target | null): void {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(p: RenderParams): void {
    const gl = this.gl;
    if (!this.imageTex || !this.scene || !this.haloA || !this.haloB || !this.haloNarrow)
      return;

    const { stock, scanner } = p;

    // Der Rand vergroessert nur die Ausgabe, nicht die Zwischenpuffer - die
    // bleiben auf Bildgroesse, der Rand entsteht erst im letzten Durchgang.
    const b = p.border ? BORDER_FRACTION : 0;
    const zielHoehe = Math.max(1, Math.round(this.imageHeight / (1 - 2 * b)));
    if (this.canvas.width !== this.imageWidth || this.canvas.height !== zielHoehe) {
      this.canvas.width = this.imageWidth;
      this.canvas.height = zielHoehe;
    }
    if (p.border) this.ensureLabel(`${stock.name.toUpperCase()}  ${stock.iso}`);

    gl.bindVertexArray(this.vao);

    // --- 1) Szene: lineares Licht -------------------------------------
    this.scenePass.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.uniform1i(this.scenePass.loc("uImage"), 0);
    gl.uniform1f(this.scenePass.loc("uExposure"), p.exposure);
    gl.uniform3fv(
      this.scenePass.loc("uWhiteBalance"),
      whiteBalanceGain(p.warmth, p.tint),
    );
    // transpose = true, damit die Matrix in stocks.ts zeilenweise lesbar bleibt.
    gl.uniformMatrix3fv(
      this.scenePass.loc("uCrosstalk"), true, new Float32Array(stock.crosstalk),
    );
    gl.uniform1f(this.scenePass.loc("uMonochrome"), stock.monochrome ? 1 : 0);
    gl.uniform3fv(this.scenePass.loc("uSpectral"), stock.spectral);
    gl.uniform2f(this.scenePass.loc("uCropOffset"), this.crop.x, this.crop.y);
    gl.uniform2f(this.scenePass.loc("uCropSize"), this.crop.w, this.crop.h);
    this.drawTo(this.scene);

    // --- 2) Helle Bereiche isolieren ----------------------------------
    this.highlightPass.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
    gl.uniform1i(this.highlightPass.loc("uSrc"), 0);
    gl.uniform1f(this.highlightPass.loc("uThreshold"), stock.halation.threshold);
    this.drawTo(this.haloA);

    // --- 3+4) Streuung: zwei Gauss-Durchlaeufe -------------------------
    // radius ist die Tap-Schrittweite im verkleinerten Puffer, nicht in
    // Bildpixeln. Werte deutlich ueber ~3 fangen wieder an zu ringen.
    const r = stock.halation.radius;
    this.blurPass.use();
    gl.uniform1i(this.blurPass.loc("uSrc"), 0);
    gl.activeTexture(gl.TEXTURE0);

    // Durchlauf 1 -> enger Hof. Das Ergebnis wird aufgehoben.
    gl.bindTexture(gl.TEXTURE_2D, this.haloA.tex);
    gl.uniform2f(this.blurPass.loc("uDirection"), r / this.haloA.width, 0);
    this.drawTo(this.haloB);
    gl.bindTexture(gl.TEXTURE_2D, this.haloB.tex);
    gl.uniform2f(this.blurPass.loc("uDirection"), 0, r / this.haloA.height);
    this.drawTo(this.haloNarrow);

    // Durchlauf 2 -> weiter Hof, aufbauend auf dem engen.
    const rw = r * HALATION_WIDE_FACTOR;
    gl.bindTexture(gl.TEXTURE_2D, this.haloNarrow.tex);
    gl.uniform2f(this.blurPass.loc("uDirection"), rw / this.haloA.width, 0);
    this.drawTo(this.haloB);
    gl.bindTexture(gl.TEXTURE_2D, this.haloB.tex);
    gl.uniform2f(this.blurPass.loc("uDirection"), 0, rw / this.haloA.height);
    this.drawTo(this.haloA);

    // --- 5) Entwickeln -------------------------------------------------
    this.developPass.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
    gl.uniform1i(this.developPass.loc("uScene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.haloA.tex);
    gl.uniform1i(this.developPass.loc("uHalation"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.uniform1i(this.developPass.loc("uImage"), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.haloNarrow.tex);
    gl.uniform1i(this.developPass.loc("uHalationNarrow"), 3);

    const curves = [
      ["uCurveR", stock.curve.r],
      ["uCurveG", stock.curve.g],
      ["uCurveB", stock.curve.b],
    ] as const;
    for (const [name, base] of curves) {
      const c = pushCurve(base, p.push);
      gl.uniform4f(this.developPass.loc(name), c.speed, c.gamma, c.toe, c.shoulder);
    }

    gl.uniform3fv(this.developPass.loc("uHalationTint"), stock.halation.tint);
    gl.uniform3fv(this.developPass.loc("uHalationSpread"), stock.halation.spread);
    gl.uniform1f(
      this.developPass.loc("uHalationStrength"),
      stock.halation.strength * p.halation,
    );
    gl.uniform1f(this.developPass.loc("uHighlightDesat"), stock.highlightDesat);

    gl.uniform2f(this.developPass.loc("uImageSize"), this.imageWidth, this.imageHeight);
    gl.uniform1f(this.developPass.loc("uGrainSize"), stock.grain.size);
    gl.uniform1f(
      this.developPass.loc("uGrainIntensity"),
      stock.grain.intensity * p.grain * pushGrain(p.push),
    );
    gl.uniform3fv(this.developPass.loc("uGrainBias"), stock.grain.channelBias);
    gl.uniform3fv(this.developPass.loc("uGrainSizeBias"), stock.grain.sizeBias);
    // Fester Startwert: ein Foto hat festes Korn, es soll nicht flimmern.
    gl.uniform1f(this.developPass.loc("uSeed"), 11.7);

    gl.uniform1f(this.developPass.loc("uVignette"), p.vignette);
    gl.uniform1f(this.developPass.loc("uMonochrome"), stock.monochrome ? 1 : 0);

    // Die Scannerprofile heben die Kanaele unterschiedlich an - das ist bei
    // Farbfilm der halbe Charakter, wuerde einem Graustufenbild aber einen
    // Farbstich verpassen. Fuer Schwarzweiss also einebnen.
    const lift = stock.monochrome ? flatten(scanner.lift) : scanner.lift;
    const gain = stock.monochrome ? flatten(scanner.gain) : scanner.gain;
    gl.uniform3fv(this.developPass.loc("uScannerLift"), lift);
    gl.uniform3fv(this.developPass.loc("uScannerGain"), gain);
    gl.uniform1f(this.developPass.loc("uScannerSat"), scanner.saturation);
    gl.uniform1f(this.developPass.loc("uBlackPoint"), scanner.blackPoint);
    gl.uniform1f(this.developPass.loc("uWhitePoint"), scanner.whitePoint);

    gl.uniform1f(this.developPass.loc("uStrength"), p.strength);
    gl.uniform2f(this.developPass.loc("uCropOffset"), this.crop.x, this.crop.y);
    gl.uniform2f(this.developPass.loc("uCropSize"), this.crop.w, this.crop.h);

    gl.uniform1f(this.developPass.loc("uBorder"), p.border ? 1 : 0);
    gl.uniform1f(this.developPass.loc("uBorderFraction"), BORDER_FRACTION);
    gl.uniform1f(this.developPass.loc("uSprockets"), SPROCKETS);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.labelTex);
    gl.uniform1i(this.developPass.loc("uLabel"), 4);
    this.drawTo(null);

    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    this.disposeTarget(this.scene);
    this.disposeTarget(this.haloA);
    this.disposeTarget(this.haloB);
    this.disposeTarget(this.haloNarrow);
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    if (this.labelTex) gl.deleteTexture(this.labelTex);
    this.scenePass.dispose();
    this.highlightPass.dispose();
    this.blurPass.dispose();
    this.developPass.dispose();
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
  }
}
