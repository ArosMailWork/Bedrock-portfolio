// Turn a shape into a boolean grid: { w, h, cells } with cells[row * w + col] = 0 | 1.

// Jersey10 is drawn on a pixel grid: 1 font pixel = 75 units, 1400 units per em.
const FONT_PIXEL_EM = 75 / 1400;
const SCALE = 8; // render 8x larger and sample pixel centers -> no anti-aliasing artifacts

let fontPromise = null;
function loadPixelFont(url) {
  // Separate FontFace (no CSS size-adjust) so canvas metrics match the font's own grid.
  fontPromise ??= new FontFace('JerseyGrid', `url(${url})`).load().then((f) => document.fonts.add(f));
  return fontPromise;
}

// Text in the Jersey10 pixel font: exactly one cell per font pixel, cropped to the ink.
export async function maskFromPixelFont(text, { fontUrl = 'assets/fonts/Jersey10-Regular.ttf' } = {}) {
  await loadPixelFont(fontUrl);
  const fontSize = SCALE / FONT_PIXEL_EM;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.font = `${fontSize}px JerseyGrid`;
  const cols = Math.ceil(ctx.measureText(text).width / SCALE) + 2;
  const rows = 16; // 10 px ascent + 2 px descent + padding
  canvas.width = cols * SCALE;
  canvas.height = rows * SCALE;
  ctx.font = `${fontSize}px JerseyGrid`;
  ctx.fillStyle = '#000';
  ctx.fillText(text, SCALE, 12 * SCALE); // baseline on a pixel boundary

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const on = (r, c) => data[((r * SCALE + SCALE / 2) * canvas.width + c * SCALE + SCALE / 2) * 4 + 3] > 127;

  // Crop to the ink bounding box.
  let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (on(r, c)) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
  }
  const w = Math.max(0, c1 - c0 + 1), h = Math.max(0, r1 - r0 + 1);
  const cells = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells[r * w + c] = on(r + r0, c + c0) ? 1 : 0;
  return { w, h, cells };
}

// Any image / canvas, letterboxed into a res x res grid. A cell is on when the pixel is
// opaque and dark: alpha * (1 - luminance) > threshold (`invert` for light shapes).
export function maskFromImage(img, { res = 32, threshold = 0.5, invert = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = res;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = res / Math.max(iw, ih);
  ctx.drawImage(img, (res - iw * s) / 2, (res - ih * s) / 2, iw * s, ih * s);

  const { data } = ctx.getImageData(0, 0, res, res);
  const cells = new Uint8Array(res * res);
  for (let i = 0; i < cells.length; i++) {
    const lum = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
    cells[i] = (data[i * 4 + 3] / 255) * (invert ? lum : 1 - lum) > threshold ? 1 : 0;
  }
  return { w: res, h: res, cells };
}
