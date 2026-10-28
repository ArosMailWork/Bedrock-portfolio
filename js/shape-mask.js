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

// Paragraphs in the same pixel font, word-wrapped to `maxWidth` font pixels, drawn white on a
// transparent canvas (maskFromBody samples it). 1 font pixel = `scale` canvas pixels (crisp edges
// when sampled). Size is returned in font pixels.
export const BODY_LINE_PX = 14;  // 10 px glyphs + descent + leading
export async function bodyCanvas(paragraphs, { maxWidth, fontUrl = 'assets/fonts/Jersey10-Regular.ttf' } = {}) {
  await loadPixelFont(fontUrl);
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${1 / FONT_PIXEL_EM}px JerseyGrid`; // 1 canvas px = 1 font pixel while measuring
  const lines = [];
  paragraphs.forEach((paragraph, p) => {
    if (p) lines.push(''); // blank line between paragraphs
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
  });
  const width = Math.ceil(Math.max(1, ...lines.map((l) => measure.measureText(l).width)));
  const height = lines.length * BODY_LINE_PX;
  const scale = Math.max(1, Math.min(4, Math.floor(4096 / Math.max(width, height))));
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.font = `${scale / FONT_PIXEL_EM}px JerseyGrid`;
  ctx.fillStyle = '#fff';
  lines.forEach((line, i) => ctx.fillText(line, 0, (i * BODY_LINE_PX + 11) * scale));
  return { canvas, width, height };
}

// Body paragraphs as a mask (one cell per font pixel), like maskFromPixelFont for a whole page.
export async function maskFromBody(paragraphs, options) {
  const { canvas, width, height } = await bodyCanvas(paragraphs, options);
  const scale = canvas.width / width;
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  const cells = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const px = Math.floor((c + 0.5) * scale), py = Math.floor((r + 0.5) * scale);
    cells[r * width + c] = data[(py * canvas.width + px) * 4 + 3] > 127 ? 1 : 0;
  }
  return { w: width, h: height, cells };
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
