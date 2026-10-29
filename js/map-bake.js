// Baked map: once, after loading, an orthographic camera straight above the island renders the map
// state (voxel text, floors, paths, houses, sea; no trees, grass, clouds, wind or player). The image
// goes through the same colour grading as the 3D view (post.grade) and is copied into a plain 2D
// <canvas>, which the 2D map mode (map2d.js) pans and zooms like any web map.
import * as THREE from 'three';

export const MAP_BAKE = {
  size: 4096,   // image size (px), clamped to the GPU limit; ~0.32 m per px for an island of R 570 m
  margin: 1.15, // image half-extent = margin x island radius (includes a ring of sea)
};

export function bakeMap(renderer, scene, post, islandR, prepare, restore) {
  const size = Math.min(MAP_BAKE.size, renderer.capabilities.maxTextureSize);
  const extent = islandR * MAP_BAKE.margin;
  const scenePass = new THREE.WebGLRenderTarget(size, size, { samples: 4, type: THREE.HalfFloatType });
  // sRGB output target: the composite pass encodes to display space, like the screen.
  const graded = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, colorSpace: THREE.SRGBColorSpace });
  const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 1, 2000);
  camera.position.set(0, 1000, 0);
  camera.up.set(0, 0, -1); // image top = north (-z), right = +x, like the 2D map
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  // Objects with userData.skipBake (sky, clouds, wind lines, falling leaves, player) stay out.
  const hidden = [];
  scene.traverse((o) => { if (o.userData.skipBake && o.visible) { o.visible = false; hidden.push(o); } });
  prepare(extent);
  renderer.setRenderTarget(scenePass);
  renderer.render(scene, camera);
  post.grade(scenePass.texture, graded);
  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(graded, 0, 0, size, size, pixels);
  renderer.setRenderTarget(null);
  restore();
  hidden.forEach((o) => { o.visible = true; });
  scenePass.dispose(); graded.dispose();

  // GPU rows start at the bottom: flip while copying into the canvas.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size), row = size * 4;
  for (let y = 0; y < size; y++) image.data.set(pixels.subarray((size - 1 - y) * row, (size - y) * row), y * row);
  ctx.putImageData(image, 0, 0);
  return { canvas, extent };
}
