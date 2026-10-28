// Plaza fountain: low-poly lathe basin + bowl, stylised water discs and GPU droplet particles.
// Every particle follows an analytic ballistic arc in the vertex shader (no per-frame CPU work).
import * as THREE from 'three';

const GRAVITY = 9.8;
const WATER_Y = 0.48, BOWL_Y = 1.72, SPOUT_Y = 2.2;

const lathe = (profile, color, segments = 14) => {
  const mesh = new THREE.Mesh(
    new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments),
    new THREE.MeshLambertMaterial({ color, flatShading: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
};

// Stylised water, after the water of bruno-simon.com (github.com/brunosimon/folio-2025, MIT):
// colour from a depth gradient (turquoise shallow -> navy deep), a solid foam band at the rim,
// broken foam strokes drifting towards the rim that thin out over deep water, and a thin white
// line where an object (pillar / spout, radius `inner`) pierces the surface. Re-implemented here.
export const WATER_COLORS = { shallow: 0x5bc2b9, deep: 0x13375f, foam: 0xf4fbff, dropCore: 0xe9fdff, dropRim: 0x7fd3ea };

function waterSurface(radius, y, time, inner) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: time, uRadius: { value: radius }, uInner: { value: inner },
      uShallow: { value: new THREE.Color(WATER_COLORS.shallow) }, uDeep: { value: new THREE.Color(WATER_COLORS.deep) },
      uFoam: { value: new THREE.Color(WATER_COLORS.foam) },
    },
    vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uTime, uRadius, uInner; uniform vec3 uShallow, uDeep, uFoam; varying vec2 vP;
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        vec2 k = vec2(127.1, 311.7);
        float a = fract(sin(dot(i,k))*43758.5453);
        float b = fract(sin(dot(i+vec2(1,0),k))*43758.5453);
        float c = fract(sin(dot(i+vec2(0,1),k))*43758.5453);
        float d = fract(sin(dot(i+vec2(1,1),k))*43758.5453);
        return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
      }
      void main() {
        float r = length(vP);
        float depth = clamp((uRadius - r) / (uRadius * 0.75), 0.0, 1.0);   // 0 at the rim, 1 deep
        float wobble = noise(vP * 2.2 + uTime * 0.05) - 0.5;
        vec3 col = mix(uShallow, uDeep, smoothstep(0.05, 0.85, depth + wobble * 0.15));
        // Solid foam band along the rim.
        float rim = step(depth, 0.06 + 0.04 * noise(vP * 6.0 + uTime * 0.3));
        // Bands parallel to the rim, drifting towards it; noise breaks each band into strokes.
        float wave = depth * 5.0 + uTime * 0.35;
        float breakup = noise(vP * 2.8 + floor(wave) * 7.31);
        float strokes = step(fract(wave), mix(0.22, 0.04, depth)) * step(0.42 + depth * 0.25, breakup) * step(depth, 0.85);
        // Thin line where the pillar / spout pierces the surface.
        float pierce = step(r, uInner + 0.045 + 0.015 * sin(atan(vP.y, vP.x) * 6.0 + uTime * 2.0));
        col = mix(col, uFoam, max(max(rim, strokes), pierce));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

// Emitter: count particles starting on a ring of radius r0 at height y0, flying outward with
// horizontal speed u and vertical speed vy until they reach floorY, then restarting.
function addEmitter(list, count, { r0, y0, u, vy, floorY, size }, rand) {
  for (let i = 0; i < count; i++) {
    list.push([rand() * Math.PI * 2, r0[0] + rand() * (r0[1] - r0[0]), y0,
      u[0] + rand() * (u[1] - u[0]), vy[0] + rand() * (vy[1] - vy[0]), floorY, rand(), size * (0.45 + rand() * 0.9)]);
  }
}

export function buildFountain(scene, physics, time) {
  const stone = 0xdcd5c6, stoneDark = 0xc9c1af;
  scene.add(lathe([[2.15, 0.08], [2.6, 0.08], [2.68, 0.45], [2.58, 0.62], [2.3, 0.64], [2.2, 0.5], [2.15, 0.12]], stone));
  scene.add(lathe([[0, 0.1], [2.2, 0.1], [2.2, 0.16], [0, 0.16]], 0x9fbfb6));                    // basin floor
  scene.add(lathe([[0.55, 0.12], [0.42, 0.3], [0.26, 0.55], [0.22, 1.3], [0.34, 1.48], [0, 1.5]], stoneDark, 10));
  scene.add(lathe([[0.15, 1.48], [0.6, 1.52], [1.02, 1.64], [1.06, 1.78], [0.95, 1.8], [0.88, 1.7], [0.15, 1.66]], stone, 12));
  scene.add(lathe([[0.16, 1.66], [0.11, 2.1], [0.16, 2.2], [0, 2.22]], stoneDark, 8));          // spout
  scene.add(waterSurface(2.22, WATER_Y, time, 0.3));   // pillar radius at the basin water line
  scene.add(waterSurface(0.9, BOWL_Y, time, 0.15));    // spout radius at the bowl water line
  physics.cylinder(0, 0.35, 0, 0.35, 2.7);

  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const particles = [];
  addEmitter(particles, 260, { r0: [0, 0.05], y0: SPOUT_Y, u: [0.5, 0.78], vy: [3.3, 3.9], floorY: BOWL_Y, size: 0.17 }, rand); // jet
  addEmitter(particles, 240, { r0: [0.98, 1.05], y0: BOWL_Y, u: [0.3, 0.5], vy: [0.0, 0.25], floorY: WATER_Y, size: 0.15 }, rand); // spill sheet
  addEmitter(particles, 140, { r0: [1.1, 1.4], y0: WATER_Y, u: [-0.25, 0.35], vy: [0.7, 1.4], floorY: WATER_Y, size: 0.13 }, rand); // splash
  addEmitter(particles, 80, { r0: [0.15, 0.6], y0: BOWL_Y, u: [-0.3, 0.3], vy: [0.5, 1.0], floorY: BOWL_Y, size: 0.11 }, rand); // bowl splash

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(particles.length * 3), 3));
  geo.setAttribute('aA', new THREE.Float32BufferAttribute(particles.flatMap((p) => p.slice(0, 4)), 4)); // angle, r0, y0, u
  geo.setAttribute('aB', new THREE.Float32BufferAttribute(particles.flatMap((p) => p.slice(4, 8)), 4)); // vy, floor, seed, size
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.4, 0), 3.5);
  const pixel = { value: 1 };
  // Droplets: opaque two-tone discs (bright core, dark rim) that pop in and shrink as they fall.
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: {
      uTime: time, uPixel: pixel,
      uCore: { value: new THREE.Color(WATER_COLORS.dropCore).multiplyScalar(1.25) }, // > 1: soft post glow
      uRim: { value: new THREE.Color(WATER_COLORS.dropRim) },
    },
    vertexShader: `
      attribute vec4 aA, aB; uniform float uTime, uPixel;
      void main() {
        float g = ${GRAVITY.toFixed(1)};
        float vy = aB.x, y0 = aA.z, floorY = aB.y;
        float life = (vy + sqrt(max(vy * vy + 2.0 * g * (y0 - floorY), 0.0))) / g;
        life = max(life, 0.12);
        float t = fract(uTime / life + aB.z) * life, k = t / life;
        float r = aA.y + aA.w * t;
        vec3 p = vec3(cos(aA.x) * r, y0 + vy * t - 0.5 * g * t * t, sin(aA.x) * r);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float grow = smoothstep(0.0, 0.08, k) * mix(1.0, 0.45, k) * (1.0 - smoothstep(0.88, 1.0, k));
        gl_PointSize = aB.w * grow * uPixel / -mv.z;
      }`,
    fragmentShader: `
      uniform vec3 uCore, uRim;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(d < 0.38 ? uCore : uRim, 1.0);
      }`,
  }));
  scene.add(points);
  return {
    // Point sprites are sized in pixels: keep them a constant world size across resolutions.
    setViewport(heightPx, fovDeg) { pixel.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)); },
  };
}
