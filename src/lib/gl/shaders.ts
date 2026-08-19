/**
 * Die Emulations-Pipeline als GLSL. Fuenf Durchgaenge:
 *
 *   1 SCENE      sRGB -> linear, Belichtung, Weissabgleich, Uebersprechen
 *   2 HIGHLIGHT  helle Bereiche isolieren (stark verkleinert)
 *   3 BLUR (x)   separierbarer Gauss
 *   4 BLUR (y)
 *   5 DEVELOP    Streulicht + H&D-Kurve + Korn + Vignette + Scanner
 *
 * Entscheidend ist die Reihenfolge in Durchgang 5: das Streulicht wird zur
 * *Belichtung* addiert und laeuft dann durch die Kurve. In echt streut das
 * Licht in der Emulsion, bevor entwickelt wird - der Lichthof wird also von
 * der Schulter mitkomprimiert und laeuft dadurch weich aus. Legt man ihn
 * stattdessen auf das fertige Bild, sitzt er flach obendrauf und sieht nach
 * Effekt aus.
 *
 * Alles laeuft auf einem bildschirmfuellenden Dreieck. Kein three.js: dafuer
 * waere eine Szenengraph-Bibliothek reiner Overhead.
 */

export const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Gemeinsame Helfer, in jeden Fragment-Shader eingesetzt. */
const COMMON = `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

// Bildzeilen laufen von oben, GL-Texturkoordinaten von unten - einmal drehen.
// Bewusst hier und nicht per UNPACK_FLIP_Y_WEBGL beim Upload: dieses Flag
// wird fuer ImageBitmap-Quellen ignoriert, das Bild stuende dann auf dem
// Kopf. So haengt die Orientierung nicht davon ab, wie der Aufrufer das Bild
// geladen hat.
vec2 imageUv(vec2 uv) {
  return vec2(uv.x, 1.0 - uv.y);
}
`;

/** Durchgang 1: aus dem Bildschirmbild wird eine lineare Szenenbelichtung. */
export const SCENE_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform float uExposure;        // Blendenstufen
uniform vec3 uWhiteBalance;     // Verstaerkung pro Kanal
uniform mat3 uCrosstalk;
uniform float uMonochrome;      // 0 oder 1
uniform vec3 uSpectral;         // spektrale Wichtung fuer Schwarzweiss
${COMMON}

void main() {
  vec3 lin = srgbToLinear(texture(uImage, imageUv(vUv)).rgb);
  lin *= exp2(uExposure) * uWhiteBalance;

  // Schichten sind spektral nicht sauber getrennt.
  lin = max(uCrosstalk * lin, 0.0);

  // Schwarzweissfilm sieht nur eine Helligkeit. Das passiert vor der
  // Entwicklung, deshalb wirkt sich die spektrale Wichtung auch auf den
  // Lichthof aus - so wie beim echten Material.
  if (uMonochrome > 0.5) {
    lin = vec3(dot(lin, uSpectral));
  }

  fragColor = vec4(lin, 1.0);
}`;

/**
 * Durchgang 2: nur behalten, was hell genug zum Streuen ist. Die Schwelle
 * liegt in *linearer* Belichtung, nicht in Bildschirmwerten - Mittelgrau ist
 * 0.18, jede Verdopplung eine Blende.
 */
export const HIGHLIGHT_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform float uThreshold;
${COMMON}

void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  float lum = dot(c, LUMA);
  // Weicher Uebergang ueber eine Blendenstufe, sonst entstehen harte Kanten.
  float w = smoothstep(uThreshold, uThreshold * 2.0, lum);
  fragColor = vec4(c * w, 1.0);
}`;

/** Durchgang 3+4: separierbarer Gauss, einmal horizontal, einmal vertikal. */
export const BLUR_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform vec2 uDirection;   // Schrittweite pro Tap, in UV

const float W[9] = float[9](
  0.0162, 0.0540, 0.1216, 0.1946, 0.2270, 0.1946, 0.1216, 0.0540, 0.0162
);

void main() {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    sum += texture(uSrc, vUv + uDirection * float(i - 4)).rgb * W[i];
  }
  fragColor = vec4(sum, 1.0);
}`;

/**
 * Durchgang 5: entwickeln.
 *
 * Die Reihenfolge bildet die physische Kette nach: Streulicht und Korn
 * entstehen in der Emulsion, die Vignette kommt vom Objektiv, das
 * Scannerprofil ganz am Schluss.
 *
 * Die Kurve bildet Belichtung direkt auf den *fertigen* Bildwert ab, also auf
 * das Ergebnis von Negativ, Entwicklung und Scan zusammen. Bewusste
 * Vereinfachung gegenueber echter Negativdichte - sichtbar ist dasselbe, und
 * es spart den Umweg ueber Transmission und Invertierung. Deshalb wird am
 * Ende auch nicht mehr nach sRGB kodiert.
 */
export const DEVELOP_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;      // lineare Belichtung
uniform sampler2D uHalation;   // lineares Streulicht, weichgezeichnet
uniform sampler2D uImage;      // Original, fuer die Ueberblendung

uniform vec4 uCurveR;          // speed, gamma, toe, shoulder
uniform vec4 uCurveG;
uniform vec4 uCurveB;

uniform vec3 uHalationTint;
uniform float uHalationStrength;
uniform float uHighlightDesat;

uniform vec2 uImageSize;
uniform float uGrainSize;
uniform float uGrainIntensity;
uniform vec3 uGrainBias;
uniform float uSeed;

uniform float uVignette;
uniform float uMonochrome;

uniform vec3 uScannerLift;
uniform vec3 uScannerGain;
uniform float uScannerSat;

uniform float uStrength;       // 0 = Original, 1 = volle Emulation
${COMMON}

// Weiche, monotone Begrenzung: bildet (-inf, inf) auf (-k, k) ab.
// Das ist der Fuss bzw. die Schulter der Kurve.
float softLimit(float x, float k) {
  return x / (1.0 + abs(x) / k);
}

// Charakteristische Kurve eines Kanals.
// Muss identisch bleiben zu hdCurve() in lib/film/curve.ts, sonst zeigt die
// Kurvenanzeige etwas anderes an als hier gerechnet wird.
const float MID_GREY_LOG2 = -2.4739;  // log2(0.18)

float hdCurve(float e, vec4 p) {
  float logE = log2(max(e, 1e-6));
  float x = (logE - MID_GREY_LOG2 - p.x) * p.y;
  float y = (x < 0.0) ? softLimit(x, p.z) : softLimit(x, p.w);
  return clamp(0.5 + 0.5 * y, 0.0, 1.0);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Wertrauschen statt Pixelrauschen: echtes Korn klumpt, es flimmert nicht.
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  // --- Belichtung plus Streulicht -------------------------------------
  // Addition im Linearlicht und VOR der Kurve: Streulicht ist zusaetzliche
  // Belichtung, keine Aufhellung des fertigen Bildes.
  vec3 scene = texture(uScene, vUv).rgb;
  scene += texture(uHalation, vUv).rgb * uHalationTint * uHalationStrength;

  // --- Entwicklung ----------------------------------------------------
  vec3 c = vec3(
    hdCurve(scene.r, uCurveR),
    hdCurve(scene.g, uCurveG),
    hdCurve(scene.b, uCurveB)
  );

  // Farben bleichen zu den Lichtern hin aus - je naeher an der Schulter,
  // desto weniger Farbstoff bleibt zum Differenzieren.
  float lum = dot(c, LUMA);
  c = mix(c, vec3(lum), smoothstep(0.5, 1.0, lum) * uHighlightDesat);

  // --- Korn -----------------------------------------------------------
  // In Bildkoordinaten, nicht in Bildschirmkoordinaten: das Korn sitzt im
  // Film, es darf beim Zoomen nicht mitwachsen.
  vec2 gp = vUv * uImageSize / max(uGrainSize, 0.5);
  // Farbfilm hat drei Emulsionsschichten, die unabhaengig voneinander koernen
  // - deshalb drei getrennte Rauschabtastungen. Schwarzweissfilm hat nur eine
  // Schicht: dort muss dasselbe Korn in allen Kanaelen stehen, sonst faerbt
  // sich ein Graustufenbild bunt ein.
  vec3 n;
  if (uMonochrome > 0.5) {
    n = vec3(valueNoise(gp + vec2(uSeed, 0.0)) - 0.5);
  } else {
    n = vec3(
      valueNoise(gp + vec2(uSeed, 0.0)),
      valueNoise(gp + vec2(0.0, uSeed + 37.0)),
      valueNoise(gp + vec2(uSeed + 71.0, 19.0))
    ) - 0.5;
  }

  // Korn ist in den Mitteltoenen am sichtbarsten und verschwindet in
  // gesaettigtem Schwarz und ausgefressenem Weiss.
  float envelope = 4.0 * lum * (1.0 - lum);
  c += n * uGrainBias * uGrainIntensity * envelope;

  // --- Objektiv -------------------------------------------------------
  // Streng genommen nicht der Film, sondern die Kamera. Traegt aber viel
  // dazu bei, dass ein Bild "analog" gelesen wird.
  float rad = length(vUv - 0.5) * 1.4142;
  c *= max(1.0 - uVignette * rad * rad, 0.0);

  // --- Scanner --------------------------------------------------------
  float sl = dot(c, LUMA);
  c = mix(vec3(sl), c, uScannerSat);
  c = c * uScannerGain + uScannerLift;

  // --- Ueberblendung zum Original -------------------------------------
  vec3 original = texture(uImage, imageUv(vUv)).rgb;
  c = mix(original, c, uStrength);

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
