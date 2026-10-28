// Baked minimap: once, after loading, an orthographic camera straight above the island renders the
// map state (voxel text, floors, paths, houses, sea; no trees, grass, clouds, wind or player) into a
// mipmapped texture. A plane carrying it fades in as the minimap camera climbs; once fully shown the
// camera only draws MAP_BAKE.layer (the plane, the live sea, the player marker, the lights), so the
// far minimap costs almost nothing and cannot flicker (no thin geometry, mipmaps instead).
import * as THREE from 'three';

export const MAP_BAKE = {
  size: 4096,          // texture size (px), clamped to the GPU limit; ~0.3 m per px for R = 570 m
  from: 200, to: 300,  // camera height (m): live 3D below `from`, baked image above `to`, crossfade between
  layer: 1,            // render layer of the objects still drawn over the baked image
  edge: 0.06,          // share of the image fading out at its border into the live sea
};

export function createMapBake(renderer, scene, islandR) {
  const size = Math.min(MAP_BAKE.size, renderer.capabilities.maxTextureSize);
  const extent = islandR * 1.15;
  const target = new THREE.WebGLRenderTarget(size, size, {
    samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, colorSpace: THREE.SRGBColorSpace,
  });
  target.texture.anisotropy = 8;
  const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 1, 2000);
  camera.position.set(0, 1000, 0);
  camera.up.set(0, 0, -1); // image top = -z, right = +x: matches the plane's UVs
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const mix = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, depthWrite: false, fog: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMix = mix;
    shader.fragmentShader = `uniform float uMix;\n` + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec2 edge = min(vMapUv, 1.0 - vMapUv);
      diffuseColor.a *= uMix * smoothstep(0.0, ${MAP_BAKE.edge.toFixed(3)}, min(edge.x, edge.y));`);
  };
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * extent, 2 * extent).rotateX(-Math.PI / 2), material);
  plane.position.y = 0.9; // above floors and voxels, below houses (hidden once fully baked anyway)
  plane.renderOrder = 10;
  plane.layers.enable(MAP_BAKE.layer);
  plane.visible = false;
  plane.userData.skipBake = true;
  scene.add(plane);

  return {
    // prepare(): put the scene in its map state; restore(): undo. Objects with userData.skipBake
    // (and their children) are hidden while baking.
    bake(prepare, restore) {
      const hidden = [];
      scene.traverse((o) => { if (o.userData.skipBake && o.visible) { o.visible = false; hidden.push(o); } });
      prepare(camera, extent);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      restore();
      hidden.forEach((o) => { o.visible = true; });
    },
    // Returns the crossfade amount for this camera height (0 = live 3D, 1 = baked image only).
    update(height, active) {
      mix.value = active ? THREE.MathUtils.smoothstep(height, MAP_BAKE.from, MAP_BAKE.to) : 0;
      plane.visible = mix.value > 0;
      return mix.value;
    },
  };
}
