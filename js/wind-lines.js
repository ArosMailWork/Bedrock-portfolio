// Wind lines after bruno-simon.com (folio-2025, MIT, sources/Game/World/WindLines.js): thin white
// long, nearly straight ribbons near the player that draw themselves along their length while drifting
// downwind, then vanish. A small pool is reused; a new line starts every 0.3–2 s.
import * as THREE from 'three';
import { WIND } from './wind.js';

const POOL = 4, LENGTH = 28, DIVISIONS = 60;
const WAVE = 0.18; // vertical wave amplitude (m): low = long, almost straight streaks
export const WIND_LINES = {
  interval: [0.3, 2],   // seconds between two lines
  duration: 5,          // seconds a line lives
  translation: 2,       // metres drifted downwind during its life
  thickness: 0.1,       // ribbon width (m) at its thickest
  spread: 30,           // lines appear within this square (m) around the player
  height: [1.6, 3.2],   // above the ground (m)
};

function ribbonGeometry() {
  // Catmull-Rom through 4 handles alternating up/down: a long, barely waving streak along local z.
  const handles = Array.from({ length: 4 }, (_, i) => new THREE.Vector3(0, ((i % 2) - 0.5) * WAVE, -LENGTH / 2 + (i * LENGTH) / 3));
  const points = new THREE.CatmullRomCurve3(handles).getPoints(DIVISIONS);
  const position = [], ratio = [], side = [], index = [];
  points.forEach((point, i) => {
    for (const s of [-1, 1]) { position.push(point.x, point.y, point.z); ratio.push(i / DIVISIONS); side.push(s); }
    if (i) { const a = (i - 1) * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('aRatio', new THREE.Float32BufferAttribute(ratio, 1));
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), LENGTH);
  return geometry;
}

export function createWindLines(scene) {
  const geometry = ribbonGeometry();
  const lines = Array.from({ length: POOL }, () => {
    const progress = { value: 0 };
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uProgress: progress, uThickness: { value: WIND_LINES.thickness } },
      // Width = taper towards both ends x a bump that travels from start to end with progress.
      vertexShader: `
        attribute float aRatio, aSide; uniform float uProgress, uThickness;
        void main() {
          float base = smoothstep(0.0, 1.0, 1.0 - abs(aRatio - 0.5) * 2.0);
          float travel = smoothstep(0.0, 1.0, 1.0 - abs(aRatio - (uProgress * 3.0 - 1.0)));
          vec3 p = position + normalize(vec3(0.0, 1.0, -1.0)) * aSide * 0.5 * uThickness * base * travel;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, 0.85); }',
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.userData.skipBake = true;
    scene.add(mesh);
    return { mesh, progress, time: 0, start: new THREE.Vector3() };
  });
  let wait = 0;
  return {
    // active = false hides all lines (minimap / transitions).
    update(dt, player, active) {
      wait -= dt;
      const dir = new THREE.Vector2(Math.sin(WIND.angle), Math.cos(WIND.angle));
      if (active && wait <= 0) {
        const line = lines.find((l) => !l.mesh.visible);
        if (line) {
          line.time = 0;
          line.start.set(player.x + (Math.random() - 0.5) * WIND_LINES.spread,
            player.y + THREE.MathUtils.lerp(WIND_LINES.height[0], WIND_LINES.height[1], Math.random()),
            player.z + (Math.random() - 0.5) * WIND_LINES.spread);
          line.mesh.rotation.y = WIND.angle; // local +z now points downwind
          line.mesh.visible = true;
        }
        wait = THREE.MathUtils.lerp(WIND_LINES.interval[0], WIND_LINES.interval[1], Math.random());
      }
      for (const line of lines) {
        if (!line.mesh.visible) continue;
        line.time += dt;
        const k = line.time / WIND_LINES.duration;
        if (k >= 1 || !active) { line.mesh.visible = false; continue; }
        line.progress.value = k;
        line.mesh.position.set(line.start.x + dir.x * WIND_LINES.translation * k, line.start.y, line.start.z + dir.y * WIND_LINES.translation * k);
      }
    },
  };
}
