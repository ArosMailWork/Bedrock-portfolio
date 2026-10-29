// Paver textures for the smooth WORK walkways (career road, social circle, patios): drawn on
// canvases in the plot tile colours. Straight strips use a square grid (1 m tiles, UVs in metres /
// GRID_M); round places use concentric rings of bricks, like a circular driveway.
import * as THREE from 'three';
import { PALETTE } from './tree-mesh.js';

const GRID_M = 4;          // metres covered by one grid texture repeat (4 x 4 tiles)
const RING_W = 0.55;       // radial paver ring width (m)
const BRICK_L = 0.6;       // radial brick length along the ring (m)
const PX_PER_M = 96;       // radial texture resolution
const GROUT = '#cfc4b0';
const hex = (h) => `#${h.toString(16).padStart(6, '0')}`;
const TONES = [...PALETTE.tile, ...PALETTE.tile, PALETTE.tileInk[0]].map(hex);
const BAND = PALETTE.tileInk.map(hex); // darker accent rings
const rand = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function finish(canvas, repeat) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

let gridTexture = null;
// Square tiles, 4 x 4 per repeat, a slight colour play, light grout.
export function gridMaterial() {
  if (!gridTexture) {
    const n = 4, px = 64, canvas = document.createElement('canvas');
    canvas.width = canvas.height = n * px;
    const ctx = canvas.getContext('2d'), r = rand(7);
    ctx.fillStyle = GROUT; ctx.fillRect(0, 0, n * px, n * px);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = TONES[Math.floor(r() * TONES.length)];
      ctx.fillRect(i * px + 2, j * px + 2, px - 4, px - 4);
    }
    gridTexture = finish(canvas, true);
  }
  return new THREE.MeshLambertMaterial({ map: gridTexture });
}
// UVs of a flat geometry in world metres / GRID_M, so every strip shows 1 m tiles.
export function gridUVs(geometry, sx, sz) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * sx) / GRID_M, (uv.getY(i) * sz) / GRID_M);
  return geometry;
}

// Concentric rings of bricks for a disc of radius r (m); every third ring in the darker tone.
export function radialMaterial(r, seed = 1) {
  const size = Math.min(2048, Math.ceil(2 * r * PX_PER_M)), k = size / (2 * r), c = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), rnd = rand(seed * 977 + 13);
  ctx.fillStyle = GROUT; ctx.fillRect(0, 0, size, size);
  const gap = 2.5;
  // Centre: a single round stone.
  ctx.fillStyle = BAND[0];
  ctx.beginPath(); ctx.arc(c, c, RING_W * 0.8 * k, 0, Math.PI * 2); ctx.fill();
  for (let ring = 1, inner = RING_W * 0.8; inner < r; ring++, inner += RING_W) {
    const outer = Math.min(r, inner + RING_W), count = Math.max(6, Math.round((2 * Math.PI * (inner + outer) / 2) / BRICK_L));
    const offset = rnd() * Math.PI * 2, band = ring % 3 === 0;
    for (let b = 0; b < count; b++) {
      const a0 = offset + (b / count) * Math.PI * 2, a1 = offset + ((b + 1) / count) * Math.PI * 2;
      const ga = gap / (inner * k); // angular grout at the inner edge
      ctx.fillStyle = band ? BAND[Math.floor(rnd() * BAND.length)] : TONES[Math.floor(rnd() * TONES.length)];
      ctx.beginPath();
      ctx.arc(c, c, outer * k - gap, a0 + ga / 2, a1 - ga / 2);
      ctx.arc(c, c, inner * k + gap, a1 - ga / 2, a0 + ga / 2, true);
      ctx.closePath(); ctx.fill();
    }
  }
  return new THREE.MeshLambertMaterial({ map: finish(canvas, false) });
}
