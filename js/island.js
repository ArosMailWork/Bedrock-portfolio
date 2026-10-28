// Low-poly island ground + stylised sea. The shoreline formula exists twice (JS + GLSL)
// and must stay identical: ground, walls, rocks and water foam all depend on it.
import * as THREE from 'three';

export const WATER_Y = -0.35;
export const BEACH_START = 0.92;   // fraction of shore radius where grass turns to sand
export const WALK_LIMIT = 0.955;   // invisible wall ring (fraction of shore radius)

export function shoreRadius(theta, R) {
  return R * (1 + 0.06 * Math.sin(3 * theta + 0.7) + 0.04 * Math.sin(5 * theta + 2.1) + 0.025 * Math.sin(8 * theta + 1.3));
}
const SHORE_GLSL = `
  float shoreRadius(float t, float R) {
    return R * (1.0 + 0.06 * sin(3.0 * t + 0.7) + 0.04 * sin(5.0 * t + 2.1) + 0.025 * sin(8.0 * t + 1.3));
  }`;

// Height by normalised radius s = distance / shoreRadius: flat lawn, beach, sea floor.
function groundHeight(s) {
  if (s <= BEACH_START) return 0;
  if (s <= 1) { const t = (s - BEACH_START) / (1 - BEACH_START); return -0.7 * t * t * (3 - 2 * t); }
  return -0.7 - (s - 1) * 12;
}

// Smooth ground colour shared by the island mesh and the grass blades (grass roots blend in).
const LAWN_A = new THREE.Color(0x8cbd57), LAWN_B = new THREE.Color(0x76aa47);
const SAND = new THREE.Color(0xead6a0), WET = new THREE.Color(0xc9b07a);
export function groundColor(x, z, s, out = new THREE.Color()) {
  const n = 0.5 + 0.5 * Math.sin(x * 0.08 + Math.sin(z * 0.06) * 1.7) * Math.cos(z * 0.07 - x * 0.03);
  out.copy(LAWN_A).lerp(LAWN_B, n);
  out.lerp(SAND, THREE.MathUtils.smoothstep(s, 0.895, 0.935));
  return out.lerp(WET, THREE.MathUtils.smoothstep(s, 0.97, 1.0));
}

// Returns { mesh, vertices, indices } (same indexed arrays feed the physics trimesh).
// Smooth shading + per-vertex colour gradients: no visible facets on the flat lawn.
export function buildGround(R) {
  const rings = [
    ...Array.from({ length: 23 }, (_, i) => i * 0.04),
    ...Array.from({ length: 11 }, (_, i) => 0.9 + i * 0.01), 1.03, 1.07, 1.12, 1.2,
  ];
  const segments = 220;
  const vertices = [0, 0, 0], colors = [], ringStart = [0], color = new THREE.Color();
  groundColor(0, 0, 0, color); colors.push(color.r, color.g, color.b);
  for (let r = 1; r < rings.length; r++) {
    ringStart.push(vertices.length / 3);
    for (let j = 0; j < segments; j++) {
      const t = (j / segments) * Math.PI * 2, rad = rings[r] * shoreRadius(t, R);
      const x = Math.cos(t) * rad, z = Math.sin(t) * rad;
      vertices.push(x, groundHeight(rings[r]), z);
      groundColor(x, z, rings[r], color); colors.push(color.r, color.g, color.b);
    }
  }
  const indices = [];
  for (let j = 0; j < segments; j++) indices.push(0, ringStart[1] + (j + 1) % segments, ringStart[1] + j);
  for (let r = 1; r < rings.length - 1; r++) {
    for (let j = 0; j < segments; j++) {
      const a = ringStart[r] + j, b = ringStart[r] + (j + 1) % segments;
      const c = ringStart[r + 1] + j, d = ringStart[r + 1] + (j + 1) % segments;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return { mesh, vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

// Sea: depth-tinted colour by distance from the shoreline, animated foam rings and streaks.
export function buildWater(R, time) {
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uR: { value: R },
      uShallow: { value: new THREE.Color(0x63d6c6) },
      uDeep: { value: new THREE.Color(0x1d5d86) },
      uFoam: { value: new THREE.Color(0xf4fbf7) },
    }]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 vXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vXZ = world.xz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime, uR;
      uniform vec3 uShallow, uDeep, uFoam;
      varying vec2 vXZ;
      ${SHORE_GLSL}
      void main() {
        float t = atan(vXZ.y, vXZ.x);
        float d = length(vXZ) - 0.971 * shoreRadius(t, uR);      // metres from the waterline
        d += sin(t * 23.0 + uTime * 0.8) * 0.25 + sin(t * 41.0 - uTime * 0.6) * 0.12;
        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 26.0, d));
        // Rings travelling towards the beach, fading offshore.
        float band = fract(d * 0.32 + uTime * 0.22);
        float ring = (1.0 - smoothstep(0.0, 0.06, abs(band - 0.5))) * exp(-d * 0.12);
        // Thin long streaks in open water.
        float streak = smoothstep(0.985, 1.0, sin(vXZ.x * 0.05 + vXZ.y * 0.11 + sin(vXZ.y * 0.04 + uTime * 0.2) * 3.0)) * smoothstep(8.0, 20.0, d);
        float edge = 1.0 - smoothstep(0.0, 0.7, d);
        col = mix(col, uFoam, clamp(ring * 0.75 + edge + streak * 0.5, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  material.uniforms.uTime = time;
  // Sized with the island, so its edge stays beyond the farthest minimap view.
  const size = Math.max(1600, R * 8);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), material);
  mesh.position.y = WATER_Y;
  return mesh;
}
