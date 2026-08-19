import { pushCurve, pushGrain } from "../film/curve";
import type { ScannerProfile } from "../film/scanners";
import type { FilmStock } from "../film/stocks";
import { BLUR_SRC, DEVELOP_SRC, HIGHLIGHT_SRC, SCENE_SRC, VERT_SRC } from "./shaders";

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
  scanner: ScannerProfile;
  /** Belichtungskorrektur in Blendenstufen. */
  exposure: number;
  /** Push/Pull in Blendenstufen: laenger oder kuerzer entwickeln. */
  push: number;
  /** -1 kuehl bis +1 warm. */
  warmth: number;
  /** 0 = Original, 1 = volle Emulation. */
  strength: number;
  /** Faktor auf die Kornstaerke des Stocks. */
  grain: number;
  /** Faktor auf die Halationsstaerke des Stocks. */
  halation: number;
  /** 0 = keine Vignette. */
  vignette: number;
}

/**
 * Warm = mehr Rot, weniger Blau. Gruen bleibt als Anker stehen, damit die
 * Gesamthelligkeit beim Drehen nicht mitwandert.
 */
function whiteBalanceGain(warmth: number): [number, number, number] {
  return [1 + warmth * 0.22, 1, 1 - warmth * 0.22];
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

  private imageWidth = 0;
  private imageHeight = 0;

  /**
   * RGBA16F als Zwischenformat. Hier nicht optional: der Szenenpuffer haelt
   * *lineares* Licht, und das geht deutlich ueber 1.0 hinaus - eine Lampe
   * kann bei 20 liegen. In 8 Bit waere sie auf 1.0 abgeschnitten und es gaebe
   * ueberhaupt keine Halation.
   */
  private colorType: number;
  private colorInternal: number;
  readonly hasFloatBuffers: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true, // damit toBlob() den Export liefern kann
    });
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
    // ignoriert. Gedreht wird in den Shadern, siehe imageUv() in shaders.ts.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.disposeTarget(this.scene);
    this.disposeTarget(this.haloA);
    this.disposeTarget(this.haloB);

    const hw = Math.max(8, Math.ceil(this.imageWidth / HALATION_DOWNSAMPLE));
    const hh = Math.max(8, Math.ceil(this.imageHeight / HALATION_DOWNSAMPLE));
    this.scene = this.makeTarget(this.imageWidth, this.imageHeight);
    this.haloA = this.makeTarget(hw, hh);
    this.haloB = this.makeTarget(hw, hh);
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
    if (!this.imageTex || !this.scene || !this.haloA || !this.haloB) return;

    const { stock, scanner } = p;
    gl.bindVertexArray(this.vao);

    // --- 1) Szene: lineares Licht -------------------------------------
    this.scenePass.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.uniform1i(this.scenePass.loc("uImage"), 0);
    gl.uniform1f(this.scenePass.loc("uExposure"), p.exposure);
    gl.uniform3fv(this.scenePass.loc("uWhiteBalance"), whiteBalanceGain(p.warmth));
    // transpose = true, damit die Matrix in stocks.ts zeilenweise lesbar bleibt.
    gl.uniformMatrix3fv(
      this.scenePass.loc("uCrosstalk"), true, new Float32Array(stock.crosstalk),
    );
    gl.uniform1f(this.scenePass.loc("uMonochrome"), stock.monochrome ? 1 : 0);
    gl.uniform3fv(this.scenePass.loc("uSpectral"), stock.spectral);
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

    for (let i = 0; i < HALATION_ITERATIONS; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.haloA.tex);
      gl.uniform2f(this.blurPass.loc("uDirection"), r / this.haloA.width, 0);
      this.drawTo(this.haloB);

      gl.bindTexture(gl.TEXTURE_2D, this.haloB.tex);
      gl.uniform2f(this.blurPass.loc("uDirection"), 0, r / this.haloA.height);
      this.drawTo(this.haloA);
    }

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

    gl.uniform1f(this.developPass.loc("uStrength"), p.strength);
    this.drawTo(null);

    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    this.disposeTarget(this.scene);
    this.disposeTarget(this.haloA);
    this.disposeTarget(this.haloB);
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    this.scenePass.dispose();
    this.highlightPass.dispose();
    this.blurPass.dispose();
    this.developPass.dispose();
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
  }
}
