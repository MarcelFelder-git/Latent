import type { FilmStock } from "../film/stocks";
import { BLUR_SRC, COMPOSITE_SRC, GRADE_SRC, HIGHLIGHT_SRC, VERT_SRC } from "./shaders";

/**
 * Der Renderkern. Bewusst ohne DOM-Zugriffe ausser dem Canvas selbst - damit
 * laesst sich das Ganze spaeter unveraendert in einen Web Worker mit
 * OffscreenCanvas verschieben, wenn die Voll-Aufloesung dran ist.
 */

/** Vorschau-Deckel. Voll-Aufloesung kommt spaeter im Worker. */
const MAX_EDGE = 2048;

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

/** Zwei Durchlaeufe ergeben einen deutlich gaussfoermigeren Abfall als einer. */
const HALATION_ITERATIONS = 2;

export interface RenderParams {
  stock: FilmStock;
  /** Belichtungskorrektur in Blendenstufen. */
  exposure: number;
  /** Faktor auf das Gamma des Stocks. 1 = wie hinterlegt. */
  contrast: number;
  /** Faktor auf die Kornstaerke des Stocks. */
  grain: number;
  /** Faktor auf die Halationsstaerke des Stocks. */
  halation: number;
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

  private gradePass: Pass;
  private highlightPass: Pass;
  private blurPass: Pass;
  private compositePass: Pass;

  private imageTex: WebGLTexture | null = null;
  private grade: Target | null = null;
  private halfA: Target | null = null;
  private halfB: Target | null = null;

  private imageWidth = 0;
  private imageHeight = 0;

  /** RGBA16F als Zwischenformat - 8 Bit wuerden im Linearlicht sichtbar banden. */
  private colorType: number;
  private colorInternal: number;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true, // damit spaeter toBlob() den Export liefern kann
    });
    if (!gl) throw new Error("WebGL2 wird von diesem Browser nicht unterstuetzt.");
    this.gl = gl;

    // Ohne diese Erweiterung laesst sich nicht in Half-Float-Texturen rendern.
    // Dann faellt die Pipeline auf 8 Bit zurueck: sichtbar schlechter in den
    // Verlaeufen, aber besser als gar kein Bild.
    if (gl.getExtension("EXT_color_buffer_float")) {
      this.colorInternal = gl.RGBA16F;
      this.colorType = gl.HALF_FLOAT;
    } else {
      console.warn("EXT_color_buffer_float fehlt - Pipeline laeuft auf 8 Bit.");
      this.colorInternal = gl.RGBA8;
      this.colorType = gl.UNSIGNED_BYTE;
    }

    this.gradePass = new Pass(gl, GRADE_SRC);
    this.highlightPass = new Pass(gl, HIGHLIGHT_SRC);
    this.blurPass = new Pass(gl, BLUR_SRC);
    this.compositePass = new Pass(gl, COMPOSITE_SRC);

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

  /** Bild laden und alle Renderziele auf die passende Groesse bringen. */
  setImage(source: ImageBitmap | HTMLImageElement): void {
    const gl = this.gl;
    const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
    this.imageWidth = Math.max(1, Math.round(source.width * scale));
    this.imageHeight = Math.max(1, Math.round(source.height * scale));

    this.canvas.width = this.imageWidth;
    this.canvas.height = this.imageHeight;

    if (this.imageTex) gl.deleteTexture(this.imageTex);
    this.imageTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    // Kein UNPACK_FLIP_Y_WEBGL - das Flag wird fuer ImageBitmap-Quellen
    // ignoriert. Gedreht wird im Grade-Shader, siehe shaders.ts.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.disposeTarget(this.grade);
    this.disposeTarget(this.halfA);
    this.disposeTarget(this.halfB);

    const halfW = Math.max(8, Math.ceil(this.imageWidth / HALATION_DOWNSAMPLE));
    const halfH = Math.max(8, Math.ceil(this.imageHeight / HALATION_DOWNSAMPLE));
    this.grade = this.makeTarget(this.imageWidth, this.imageHeight);
    this.halfA = this.makeTarget(halfW, halfH);
    this.halfB = this.makeTarget(halfW, halfH);
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
    if (!this.imageTex || !this.grade || !this.halfA || !this.halfB) return;

    const { stock } = p;
    gl.bindVertexArray(this.vao);

    // --- 1) Belichtung -> Dichte -------------------------------------
    this.gradePass.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.uniform1i(this.gradePass.loc("uImage"), 0);
    gl.uniform1f(this.gradePass.loc("uExposure"), p.exposure);
    // transpose = true, damit die Matrix in stocks.ts zeilenweise lesbar bleibt.
    gl.uniformMatrix3fv(
      this.gradePass.loc("uCrosstalk"), true, new Float32Array(stock.crosstalk),
    );
    const curves = [
      ["uCurveR", stock.curve.r],
      ["uCurveG", stock.curve.g],
      ["uCurveB", stock.curve.b],
    ] as const;
    for (const [name, c] of curves) {
      gl.uniform4f(
        this.gradePass.loc(name),
        c.speed,
        c.gamma * p.contrast,
        c.toe,
        c.shoulder,
      );
    }
    this.drawTo(this.grade);

    // --- 2) Lichter isolieren ----------------------------------------
    this.highlightPass.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.grade.tex);
    gl.uniform1i(this.highlightPass.loc("uSrc"), 0);
    gl.uniform1f(this.highlightPass.loc("uThreshold"), stock.halation.threshold);
    this.drawTo(this.halfA);

    // --- 3+4) Streuung: zwei Gauss-Durchgaenge ------------------------
    // radius ist die Tap-Schrittweite im verkleinerten Puffer, nicht in
    // Bildpixeln. Werte deutlich ueber ~3 fangen wieder an zu ringen.
    const r = stock.halation.radius;
    this.blurPass.use();
    gl.uniform1i(this.blurPass.loc("uSrc"), 0);
    gl.activeTexture(gl.TEXTURE0);

    for (let i = 0; i < HALATION_ITERATIONS; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.halfA.tex);
      gl.uniform2f(this.blurPass.loc("uDirection"), r / this.halfA.width, 0);
      this.drawTo(this.halfB);

      gl.bindTexture(gl.TEXTURE_2D, this.halfB.tex);
      gl.uniform2f(this.blurPass.loc("uDirection"), 0, r / this.halfA.height);
      this.drawTo(this.halfA);
    }

    // --- 5) Zusammensetzen -------------------------------------------
    this.compositePass.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.grade.tex);
    gl.uniform1i(this.compositePass.loc("uGraded"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.halfA.tex);
    gl.uniform1i(this.compositePass.loc("uHalation"), 1);

    gl.uniform2f(this.compositePass.loc("uImageSize"), this.imageWidth, this.imageHeight);
    gl.uniform3fv(this.compositePass.loc("uHalationTint"), stock.halation.tint);
    gl.uniform1f(
      this.compositePass.loc("uHalationStrength"),
      stock.halation.strength * p.halation,
    );
    gl.uniform1f(this.compositePass.loc("uGrainSize"), stock.grain.size);
    gl.uniform1f(
      this.compositePass.loc("uGrainIntensity"),
      stock.grain.intensity * p.grain,
    );
    gl.uniform3fv(this.compositePass.loc("uGrainBias"), stock.grain.channelBias);
    // Fester Startwert: ein Foto hat festes Korn, es soll nicht flimmern.
    gl.uniform1f(this.compositePass.loc("uSeed"), 11.7);
    gl.uniform3fv(this.compositePass.loc("uScannerLift"), stock.scanner.lift);
    gl.uniform3fv(this.compositePass.loc("uScannerGain"), stock.scanner.gain);
    this.drawTo(null);

    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    this.disposeTarget(this.grade);
    this.disposeTarget(this.halfA);
    this.disposeTarget(this.halfB);
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    this.gradePass.dispose();
    this.highlightPass.dispose();
    this.blurPass.dispose();
    this.compositePass.dispose();
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
  }
}
