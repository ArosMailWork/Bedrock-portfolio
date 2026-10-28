// Sky: a gradient dome (Bruno's day palette: cyan horizon -> lavender zenith, warm glow towards the
// sun) and low-poly clouds drifting downwind. Clouds wrap around a square around the island and
// shrink away near its edges, so they never pop. Hidden from the minimap (they would block it).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './shape-tree.js';
import { WIND } from './wind.js';

export const SKY = {
  horizon: 0xa6f4f0,  // also used as fog colour
  zenith: 0xb9b0ff,
  sunGlow: 0xffd2c2,
  cloud: 0xffffff,
  cloudShade: 0xc8c0ff, // self-lit tint, so cloud undersides read pale lavender, not dark
};
export const CLOUDS = { count: 16, extent: 450, height: [55, 115], size: [9, 20], speed: 1.6 };

export function createSky(scene, sunDirection) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(SKY.horizon) }, uZenith: { value: new THREE.Color(SKY.zenith) },
      uGlow: { value: new THREE.Color(SKY.sunGlow) }, uSun: { value: sunDirection.clone().normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }',
    fragmentShader: `
      uniform vec3 uHorizon, uZenith, uGlow, uSun; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = mix(uHorizon, uZenith, smoothstep(-0.05, 0.6, d.y));
        c = mix(c, uGlow, pow(max(dot(d, uSun), 0.0), 6.0) * 0.45);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.userData.skipBake = true; // not part of the baked minimap (map-bake.js)
  scene.add(dome);

  // Each cloud: 5-8 flattened low-poly icosahedrons merged, flat shaded.
  const rand = mulberry32(77);
  const material = new THREE.MeshLambertMaterial({ color: SKY.cloud, flatShading: true, fog: false,
    emissive: new THREE.Color(SKY.cloudShade).multiplyScalar(0.6) });
  const clouds = Array.from({ length: CLOUDS.count }, () => {
    const parts = Array.from({ length: 5 + Math.floor(rand() * 4) }, (_, i) => {
      const r = 0.45 + rand() * 0.45;
      return new THREE.IcosahedronGeometry(r, 0).translate((i - 3) * 0.55 + (rand() - 0.5) * 0.4, rand() * 0.35, (rand() - 0.5) * 0.9);
    });
    const mesh = new THREE.Mesh(mergeGeometries(parts).scale(1, 0.55, 1), material);
    parts.forEach((part) => part.dispose());
    mesh.userData = { u: (rand() * 2 - 1) * CLOUDS.extent, v: (rand() * 2 - 1) * CLOUDS.extent,
      size: THREE.MathUtils.lerp(CLOUDS.size[0], CLOUDS.size[1], rand()), turn: rand() * 6.28 };
    mesh.position.y = THREE.MathUtils.lerp(CLOUDS.height[0], CLOUDS.height[1], rand());
    mesh.rotation.y = mesh.userData.turn;
    mesh.userData.skipBake = true;
    scene.add(mesh);
    return mesh;
  });

  return {
    update(dt, camera, visible) {
      dome.position.copy(camera.position);
      const along = new THREE.Vector2(Math.sin(WIND.angle), Math.cos(WIND.angle)), across = new THREE.Vector2(along.y, -along.x);
      for (const cloud of clouds) {
        const c = cloud.userData, W = CLOUDS.extent;
        c.u += CLOUDS.speed * dt;
        if (c.u > W) c.u -= 2 * W;
        cloud.position.x = along.x * c.u + across.x * c.v;
        cloud.position.z = along.y * c.u + across.y * c.v;
        cloud.scale.setScalar(c.size * THREE.MathUtils.clamp((W - Math.abs(c.u)) / 80, 0, 1));
        cloud.visible = visible;
      }
    },
  };
}
