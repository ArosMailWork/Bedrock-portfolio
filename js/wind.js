// Shared wind, after bruno-simon.com (github.com/brunosimon/folio-2025, MIT, sources/Game/Wind.js):
// one direction and an offset field made of two noise octaves scrolling along it, so gusts
// visibly travel across grass, leaves and particles. GLSL and JS versions give the same field.
import * as THREE from 'three';

export const WIND = {
  angle: Math.PI * 0.6, // direction the wind blows towards: (sin angle, cos angle) on x/z
  strength: 0.5,        // overall push (Bruno's default)
  speed: 2.2,           // how fast gusts travel (field scroll, m/s at the fine octave)
};

export const windUniforms = {
  uWindDir: { value: new THREE.Vector2(Math.sin(WIND.angle), Math.cos(WIND.angle)) },
  uWindTime: { value: 0 },
  uWindStrength: { value: WIND.strength },
};

export function updateWind(dt) {
  windUniforms.uWindDir.value.set(Math.sin(WIND.angle), Math.cos(WIND.angle));
  windUniforms.uWindStrength.value = WIND.strength;
  windUniforms.uWindTime.value += dt;
}

// windOffset(p): horizontal push at world x/z. Mostly downwind (bias), gusts add up to ~2x.
export const WIND_GLSL = `
  uniform vec2 uWindDir; uniform float uWindTime, uWindStrength;
  float windHash(vec2 i) { return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453); }
  float windNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(windHash(i), windHash(i + vec2(1.0, 0.0)), f.x), mix(windHash(i + vec2(0.0, 1.0)), windHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  vec2 windOffset(vec2 p) {
    float n1 = windNoise(p * 0.22 - uWindDir * uWindTime * ${(WIND.speed * 0.22).toFixed(4)}) - 0.5;
    float n2 = windNoise(p * 0.07 - uWindDir * uWindTime * ${(WIND.speed * 0.07 * 0.4).toFixed(4)}) - 0.5;
    return uWindDir * (n1 + n2 + 0.35) * uWindStrength;
  }`;

const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// Same field on the CPU (falling leaves). Returns the push along the wind and writes x/z into out.
export function windAt(x, z, out = { x: 0, z: 0 }) {
  const { uWindDir: { value: dir }, uWindTime: { value: t }, uWindStrength: { value: k } } = windUniforms;
  const n1 = noise(x * 0.22 - dir.x * t * WIND.speed * 0.22, z * 0.22 - dir.y * t * WIND.speed * 0.22) - 0.5;
  const n2 = noise(x * 0.07 - dir.x * t * WIND.speed * 0.028, z * 0.07 - dir.y * t * WIND.speed * 0.028) - 0.5;
  const push = (n1 + n2 + 0.35) * k;
  out.x = dir.x * push; out.z = dir.y * push;
  return push;
}
