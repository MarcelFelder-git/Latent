/**
 * Die Emulations-Pipeline als GLSL. Fuenf Durchgaenge:
 *
 *   1 GRADE      sRGB -> linear, Belichtung, Kanal-Uebersprechen, H&D-Kurve
 *   2 HIGHLIGHT  Lichter isolieren (halbe Aufloesung)
 *   3 BLUR (x)   separierbarer Gauss
 *   4 BLUR (y)
 *   5 COMPOSITE  Halation, Korn, Scanner-Profil -> Bildschirm
 *
 * Alles laeuft auf einem bildschirmfuellenden Quad. Kein three.js: fuer ein
 * einzelnes Quad ist eine Szenengraph-Bibliothek nur Overhead.
 */

export const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * Durchgang 1: Belichtung -> Dichte.
 *
 * Wichtig zum Verstaendnis der ganzen Datei: die Kurve bildet Szenen-
 * Belichtung direkt auf den *fertigen* Bildwert ab, also auf das Ergebnis von
 * Negativ + Entwicklung + Scan zusammen. Das ist eine bewusste Vereinfachung
 * gegenueber echter Negativdichte - sichtbar ist dasselbe, und es spart den
 * Umweg ueber Transmission und Invertierung. Deshalb wird am Ende der
 * Pipeline auch *nicht* nochmal nach sRGB kodiert.
 */
export const GRADE_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform float uExposure;     // Blendenstufen
uniform mat3 uCrosstalk;
uniform vec4 uCurveR;        // speed, gamma, toe, shoulder
uniform vec4 uCurveG;
uniform vec4 uCurveB;

const float MID_GREY_LOG2 = -2.4739;  // log2(0.18)

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

// Weiche, monotone Begrenzung: bildet (-inf, inf) auf (-k, k) ab.
// Das ist der Fuss bzw. die Schulter der Kurve.
float softLimit(float x, float k) {
  return x / (1.0 + abs(x) / k);
}

// Charakteristische Kurve eines Kanals.
// e = lineare Belichtung, p = (speed, gamma, toe, shoulder)
float hdCurve(float e, vec4 p) {
  float logE = log2(max(e, 1e-6));
  float x = (logE - MID_GREY_LOG2 - p.x) * p.y;
  float y = (x < 0.0) ? softLimit(x, p.z) : softLimit(x, p.w);
  return clamp(0.5 + 0.5 * y, 0.0, 1.0);
}

void main() {
  // Bildzeilen laufen von oben, GL-Texturkoordinaten von unten - einmal
  // drehen. Bewusst hier und nicht per UNPACK_FLIP_Y_WEBGL beim Upload:
  // dieses Flag wird fuer ImageBitmap-Quellen ignoriert, das Bild stuende
  // dann auf dem Kopf. So haengt die Orientierung nicht davon ab, wie der
  // Aufrufer das Bild geladen hat. Alle Zwischenpuffer danach behalten diese
  // Orientierung, es wird also genau einmal gedreht.
  vec3 srgb = texture(uImage, vec2(vUv.x, 1.0 - vUv.y)).rgb;
  vec3 lin = srgbToLinear(srgb) * exp2(uExposure);

  // Schichten sind spektral nicht sauber getrennt.
  lin = max(uCrosstalk * lin, 0.0);

  fragColor = vec4(
    hdCurve(lin.r, uCurveR),
    hdCurve(lin.g, uCurveG),
    hdCurve(lin.b, uCurveB),
    1.0
  );
}`;

/** Durchgang 2: nur die Bereiche behalten, die hell genug zum Streuen sind. */
export const HIGHLIGHT_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform float uThreshold;

void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Weicher Uebergang, sonst entstehen harte Kanten um die Lichter.
  float w = smoothstep(uThreshold, min(uThreshold + 0.25, 1.0), lum);
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
 * Durchgang 5: alles zusammensetzen.
 * Reihenfolge ist nicht beliebig - Halation und Korn entstehen beide in der
 * Emulsion, das Scanner-Profil kommt danach.
 */
export const COMPOSITE_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uGraded;
uniform sampler2D uHalation;
uniform vec2 uImageSize;

uniform vec3 uHalationTint;
uniform float uHalationStrength;

uniform float uGrainSize;
uniform float uGrainIntensity;
uniform vec3 uGrainBias;
uniform float uSeed;

uniform vec3 uScannerLift;
uniform vec3 uScannerGain;

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
  vec3 c = texture(uGraded, vUv).rgb;

  // --- Halation -------------------------------------------------------
  // Screen statt Addition: Streulicht soll die Lichter nicht wegbrennen.
  vec3 h = texture(uHalation, vUv).rgb * uHalationTint * uHalationStrength;
  c = 1.0 - (1.0 - c) * (1.0 - clamp(h, 0.0, 1.0));

  // --- Korn -----------------------------------------------------------
  // In Bildkoordinaten, nicht in Bildschirmkoordinaten: das Korn sitzt im
  // Film, es darf beim Zoomen nicht mitwachsen.
  vec2 gp = vUv * uImageSize / max(uGrainSize, 0.5);
  vec3 n = vec3(
    valueNoise(gp + vec2(uSeed, 0.0)),
    valueNoise(gp + vec2(0.0, uSeed + 37.0)),
    valueNoise(gp + vec2(uSeed + 71.0, 19.0))
  ) - 0.5;

  // Korn ist in den Mitteltoenen am sichtbarsten und verschwindet in
  // gesaettigtem Schwarz und ausgefressenem Weiss.
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float envelope = 4.0 * lum * (1.0 - lum);
  c += n * uGrainBias * uGrainIntensity * envelope;

  // --- Scanner --------------------------------------------------------
  c = c * uScannerGain + uScannerLift;

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
