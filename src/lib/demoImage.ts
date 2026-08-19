/**
 * Ein mitgeliefertes Motiv, damit man die App ausprobieren kann, ohne erst ein
 * eigenes Foto hochzuladen.
 *
 * Das ist der wichtigste kleine Baustein der ganzen Oberflaeche: wer einen
 * fremden Link oeffnet, laedt dort kein privates Foto hoch. Ohne Beispiel
 * sieht ein Besucher nur eine leere Ablageflaeche und geht wieder.
 *
 * Bewusst gezeichnet statt als Datei mitgeliefert - das spart ein paar hundert
 * Kilobyte im Bundle, und die Szene ist gezielt darauf angelegt, die
 * Unterschiede zwischen den Filmen zu zeigen: eine helle Sonne fuer die
 * Halation, tiefe Silhouetten fuer den Fuss der Kurve, ein weicher
 * Himmelsverlauf fuer die Schulter.
 */

const W = 1500;
const H = 1000;

export async function createDemoImage(): Promise<ImageBitmap> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const horizon = H * 0.62;

  // Himmel: tiefes Blau oben, warm zum Horizont.
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#1c2c4a");
  sky.addColorStop(0.45, "#4a5a7a");
  sky.addColorStop(0.78, "#c98a5a");
  sky.addColorStop(1, "#f0b070");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);

  // Sonne knapp ueber dem Horizont - der Ausloeser fuer den Lichthof.
  const sunX = W * 0.68;
  const sunY = horizon - 70;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 260);
  glow.addColorStop(0, "rgba(255,246,220,0.95)");
  glow.addColorStop(0.25, "rgba(255,200,130,0.45)");
  glow.addColorStop(1, "rgba(255,180,110,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, horizon);

  ctx.fillStyle = "#fffdf4";
  ctx.beginPath();
  ctx.arc(sunX, sunY, 46, 0, Math.PI * 2);
  ctx.fill();

  // Duennes Gewoelk - weiche Mitteltoene fuer den geraden Kurventeil.
  ctx.globalAlpha = 0.22;
  for (const [cx, cy, rx, ry] of [
    [W * 0.2, horizon * 0.42, 260, 26],
    [W * 0.5, horizon * 0.3, 200, 18],
    [W * 0.82, horizon * 0.5, 230, 22],
  ]) {
    ctx.fillStyle = "#ffd9b0";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Wasser: spiegelt den Himmel gedaempft.
  const water = ctx.createLinearGradient(0, horizon, 0, H);
  water.addColorStop(0, "#8a6a52");
  water.addColorStop(0.5, "#3a3242");
  water.addColorStop(1, "#181622");
  ctx.fillStyle = water;
  ctx.fillRect(0, horizon, W, H - horizon);

  // Lichtstrasse auf dem Wasser - kleine Spitzlichter, die auch streuen.
  for (let i = 0; i < 42; i++) {
    const t = i / 41;
    const y = horizon + t * (H - horizon) * 0.95;
    const spread = 12 + t * 150;
    const w = 24 + Math.random() * spread;
    const a = (1 - t) * 0.55;
    ctx.fillStyle = `rgba(255,214,150,${a.toFixed(3)})`;
    ctx.fillRect(sunX - w / 2 + (Math.random() - 0.5) * spread, y, w, 3 + t * 4);
  }

  // Huegel als Silhouette - tiefe Schatten fuer den Fuss der Kurve.
  const hill = (offsetY: number, farbe: string, amp: number) => {
    ctx.fillStyle = farbe;
    ctx.beginPath();
    ctx.moveTo(0, horizon + offsetY);
    for (let x = 0; x <= W; x += 10) {
      const y =
        horizon + offsetY - Math.sin(x / 420) * amp - Math.sin(x / 130) * amp * 0.28;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, horizon + 4);
    ctx.lineTo(0, horizon + 4);
    ctx.closePath();
    ctx.fill();
  };
  hill(2, "#3a3140", 58);
  hill(6, "#241f2c", 34);

  // Vordergrund, fast schwarz.
  ctx.fillStyle = "#0e0c14";
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, H - 120);
  for (let x = 0; x <= W; x += 12) {
    ctx.lineTo(x, H - 120 + Math.sin(x / 90) * 16 + Math.sin(x / 27) * 6);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  return createImageBitmap(canvas);
}
