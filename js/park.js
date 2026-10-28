// Low-poly park dressing on the island: paths, plaza + fountain, hedges, bushes, flowers,
// lamps, benches, lodges, beach rocks, fences and swaying 3D grass. Static colliders go to Rapier.
import * as THREE from 'three';
import { addSway } from './tree-mesh.js';
import { mulberry32 } from './shape-tree.js';
import { shoreRadius, groundColor } from './island.js';
import { buildFountain } from './fountain.js';

export const PARK_COLORS = {
  paving: [0xd9d3c6, 0xcdc6b7, 0xe3ddd1], curb: 0xf3efe6,
  hedge: [0x4f8a3a, 0x5a9642], bush: [0x5c9a40, 0x4b8a36, 0x6aa84a],
  flowers: [0x9b7be0, 0xf2d35b, 0xffffff, 0xef8fb2],
  wood: 0x8a6a4a, darkWood: 0x6b4f37, wall: 0xf1e3c4, roof: 0xc4664c, glass: 0x8fc2c9,
  lampPost: 0x3e4a44, lampGlow: 0xffd88a, rock: [0x9a9a96, 0x8a8d8c, 0xaaa79f],
  grassTip: 0xc9e27a, // blades fade from the ground colour at the root to this tint at the tip
};
const PATH_HALF = 1.3, PLAZA_R = 7;
// Grass streaming: square size (m), build radius, free radius, squares built per frame.
export const GRASS = { chunk: 32, radius: 110, keep: 150, perFrame: 2 };
const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

// plots: [{ x, z, view, entrance }], houses: [{ x, z, angle }] (angle: door faces +z rotated).
export function buildPark({ scene, physics, R, plots, houses, time }) {
  const rand = mulberry32(7);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
  const color = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const shade = (mesh, cast = true) => { mesh.castShadow = cast; mesh.receiveShadow = true; return mesh; };
  const add = (mesh, x, y, z, ry = 0, cast = true) => { mesh.position.set(x, y, z); mesh.rotation.y = ry; scene.add(shade(mesh, cast)); return mesh; };
  const batches = new Map(); // key -> { geo, mat, items }
  // Instanced batches, created lazily: make() returns [geometry, material].
  const batch = (key, make) => { if (!batches.has(key)) { const [geo, mat] = make(); batches.set(key, { geo, mat, items: [] }); } return batches.get(key).items; };
  const put = (items, x, y, z, ry, sx, sy, sz, hex) => items.push({ matrix: m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, ry), s3.set(sx, sy, sz)).clone(), hex });

  const isFloor = (x, z) => plots.some((p) => Math.abs(x - p.x) <= p.w / 2 + 1 && Math.abs(z - p.z) <= p.h / 2 + 1 && p.view.isFloor(x - p.x, z - p.z));
  const nearFloor = (x, z, r) => [[r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dz]) => isFloor(x + dx, z + dz));

  // ---------- Paths: curved paving ribbons with white curbs ----------
  const pathPoints = []; // spatial grid of samples for "is this on a path?"
  const grid = new Map(), cellOf = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  const pos = [], col = [];
  const quad = (a, b, c, d, y, hex) => {
    color.setHex(hex);
    for (const p of [a, b, c, b, d, c]) { pos.push(p.x, y, p.z); col.push(color.r, color.g, color.b); }
  };
  // end: where the path meets its destination; inward: unit direction into the destination.
  function path(end, inward, bend, index) {
    const out = end.clone().setY(0).normalize();
    const start = out.clone().multiplyScalar(PLAZA_R - 1.2);          // hidden under the plaza disc
    const exit = out.clone().multiplyScalar(PLAZA_R + 1.5);           // radial exit from the plaza
    const approach = end.clone().addScaledVector(inward, -2.5);        // straight final approach
    const finish = end.clone().addScaledVector(inward, 1.5);           // tucked under tiles / doorstep
    const mid = exit.clone().lerp(approach, 0.5);
    const dir = approach.clone().sub(exit).normalize();
    mid.add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(bend));
    const curve = new THREE.CatmullRomCurve3([start, exit, mid, approach, finish], false, 'centripetal');
    const n = Math.max(8, Math.ceil(curve.getLength() / 0.9));
    const pts = curve.getSpacedPoints(n);
    const side = (i) => { const t = curve.getTangentAt(i / n); return new THREE.Vector3(-t.z, 0, t.x); };
    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[i + 1], n0 = side(i), n1 = side(i + 1);
      const at = (p, nn, k) => p.clone().addScaledVector(nn, k);
      const paving = () => PARK_COLORS.paving[Math.floor(rand() * 3)];
      quad(at(p0, n0, -PATH_HALF), at(p0, n0, 0), at(p1, n1, -PATH_HALF), at(p1, n1, 0), 0.035, paving());
      quad(at(p0, n0, 0), at(p0, n0, PATH_HALF), at(p1, n1, 0), at(p1, n1, PATH_HALF), 0.035, paving());
      quad(at(p0, n0, -PATH_HALF - 0.2), at(p0, n0, -PATH_HALF), at(p1, n1, -PATH_HALF - 0.2), at(p1, n1, -PATH_HALF), 0.07, PARK_COLORS.curb);
      quad(at(p0, n0, PATH_HALF), at(p0, n0, PATH_HALF + 0.2), at(p1, n1, PATH_HALF), at(p1, n1, PATH_HALF + 0.2), 0.07, PARK_COLORS.curb);
    }
    for (const p of pts) {
      const key = cellOf(p.x, p.z);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(p);
      pathPoints.push(p);
    }
    // Hedges on one side in alternating stretches, flowers on the other; a lamp half-way.
    for (let i = 7; i < pts.length - 5; i++) { // keep both junctions clear
      const sideSign = (Math.floor(i / 7) + index) % 2 ? 1 : -1, nn = side(Math.min(i, n - 1));
      const t = curve.getTangentAt(Math.min(i, n) / n), angle = Math.atan2(t.x, t.z);
      const h = pts[i].clone().addScaledVector(nn, sideSign * (PATH_HALF + 0.8));
      if (rand() < 0.85 && !nearFloor(h.x, h.z, 0.6)) {
        const sy = 0.75 + rand() * 0.2;
        put(batch('hedge', () => [new THREE.BoxGeometry(1, 1, 1), lambert(0xffffff)]), h.x, sy / 2, h.z, angle, 0.95, sy, 1.05, PARK_COLORS.hedge[i % 2]);
        physics.box(h.x, sy / 2, h.z, 0.45, sy / 2, 0.5, angle);
      }
      for (let k = 0; k < 3; k++) {
        const f = pts[i].clone().addScaledVector(nn, -sideSign * (PATH_HALF + 0.5 + rand() * 0.9));
        f.x += (rand() - 0.5) * 0.6;
        if (!nearFloor(f.x, f.z, 0.3)) flowers.push(f);
      }
    }
    if (pts.length > 14) {
      const lampAt = pts[Math.floor(pts.length / 2)].clone().addScaledVector(side(Math.floor(n / 2)), PATH_HALF + 0.6);
      lamp(lampAt.x, lampAt.z);
    }
  }
  const flowers = [];
  function lamp(x, z) {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.6, 6), lambert(PARK_COLORS.lampPost)), x, 1.3, z);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.36), new THREE.MeshBasicMaterial({ color: PARK_COLORS.lampGlow })), x, 2.75, z, 0, false);
    add(new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.28, 4), lambert(PARK_COLORS.lampPost)), x, 3.1, z, Math.PI / 4);
    physics.cylinder(x, 1.3, z, 1.3, 0.16);
  }

  // Plaza with fountain and paths to the lodge doors (plots blend straight into the lawn).
  add(new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R + 0.25, PLAZA_R + 0.25, 0.06, 20), lambert(PARK_COLORS.curb)), 0, 0.03, 0, 0, false);
  add(new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R, PLAZA_R, 0.08, 20), lambert(PARK_COLORS.paving[1])), 0, 0.04, 0, 0, false);
  const fountain = buildFountain(scene, physics, time);
  houses.forEach((h, i) => {
    const inward = new THREE.Vector3(-Math.sin(h.angle), 0, -Math.cos(h.angle));
    const door = new THREE.Vector3(h.x, 0, h.z).addScaledVector(inward, -4.2);
    path(door, inward, i % 2 ? 2 : -2, i + plots.length);
  });
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pathGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  pathGeo.computeVertexNormals();
  scene.add(shade(new THREE.Mesh(pathGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })), false));
  const onPath = (x, z, margin) => {
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const p of grid.get(`${cx + i},${cz + j}`) || []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (PATH_HALF + margin) ** 2) return true;
    }
    return false;
  };

  // ---------- Benches around the plaza (between paths) ----------
  for (const a of [Math.PI / 2, -Math.PI / 2]) {
    const x = Math.cos(a) * (PLAZA_R - 1.6), z = Math.sin(a) * (PLAZA_R - 1.6), ry = Math.atan2(-x, -z);
    const bench = new THREE.Group();
    const wood = lambert(PARK_COLORS.wood), dark = lambert(PARK_COLORS.darkWood);
    for (const [geo, mat, y, zz] of [[new THREE.BoxGeometry(2.2, 0.12, 0.6), wood, 0.55, 0], [new THREE.BoxGeometry(2.2, 0.5, 0.1), wood, 0.9, -0.3]]) {
      const m = shade(new THREE.Mesh(geo, mat)); m.position.set(0, y, zz); bench.add(m);
    }
    for (const lx of [-0.9, 0.9]) { const leg = shade(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.55), dark)); leg.position.set(lx, 0.27, 0); bench.add(leg); }
    bench.position.set(x, 0.04, z); bench.rotation.y = ry; scene.add(bench);
    physics.box(x, 0.5, z, 1.1, 0.5, 0.35, ry);
  }

  // ---------- Lodges: cream walls, terracotta pyramid roof, door facing the plaza ----------
  for (const h of houses) {
    const house = new THREE.Group();
    const part = (geo, hex, x, y, z, ry = 0) => { const m = shade(new THREE.Mesh(geo, lambert(hex))); m.position.set(x, y, z); m.rotation.y = ry; house.add(m); };
    part(new THREE.BoxGeometry(6, 3, 5), PARK_COLORS.wall, 0, 1.5, 0);
    const roof = shade(new THREE.Mesh(new THREE.ConeGeometry(4.9, 2.4, 4), lambert(PARK_COLORS.roof)));
    roof.position.y = 4.2; roof.rotation.y = Math.PI / 4; roof.scale.z = 0.86; house.add(roof);
    part(new THREE.BoxGeometry(0.6, 1.4, 0.6), PARK_COLORS.roof, 1.6, 4.6, -0.8);
    part(new THREE.BoxGeometry(1.2, 2, 0.12), PARK_COLORS.darkWood, 0, 1, 2.52);
    for (const wx of [-1.9, 1.9]) part(new THREE.BoxGeometry(1, 0.9, 0.12), PARK_COLORS.glass, wx, 1.8, 2.52);
    house.position.set(h.x, 0, h.z); house.rotation.y = h.angle; scene.add(house);
    physics.box(h.x, 1.5, h.z, 3.05, 1.5, 2.55, h.angle);
    for (let k = 0; k < 6; k++) flowers.push(new THREE.Vector3(h.x + Math.sin(h.angle) * 2.9 + Math.cos(h.angle) * (k < 3 ? -2.2 - k * 0.35 : 2.2 + (k - 3) * 0.35), 0, h.z + Math.cos(h.angle) * 2.9 - Math.sin(h.angle) * (k < 3 ? -2.2 - k * 0.35 : 2.2 + (k - 3) * 0.35)));
  }
  const nearHouse = (x, z, r) => houses.some((h) => Math.hypot(x - h.x, z - h.z) < r);

  // ---------- Round bushes: flanking path mouths at the plaza, plus lawn clusters ----------
  const bushes = [];
  plots.forEach((p) => {
    const a = Math.atan2(p.entrance.z, p.entrance.x);
    for (const off of [-0.5, 0.5]) {
      const x = Math.cos(a + off) * (PLAZA_R + 1.8), z = Math.sin(a + off) * (PLAZA_R + 1.8);
      if (!onPath(x, z, 1.2)) bushes.push([x, z, 0.8 + rand() * 0.3]);
    }
  });
  for (let tries = 0; tries < 900 && bushes.length < 130; tries++) {
    const a = rand() * Math.PI * 2, r = (0.25 + rand() * 0.6) * shoreRadius(a, R);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z) < PLAZA_R + 3 || onPath(x, z, 1.4) || nearFloor(x, z, 1.8) || isFloor(x, z) || nearHouse(x, z, 5.5)) continue;
    for (let k = 0, n = 1 + Math.floor(rand() * 3); k < n; k++) bushes.push([x + (rand() - 0.5) * 2.2, z + (rand() - 0.5) * 2.2, 0.7 + rand() * 0.7]);
  }
  const bushItems = batch('bush', () => [new THREE.IcosahedronGeometry(1, 1), lambert(0xffffff)]);
  for (const [x, z, sc] of bushes) {
    put(bushItems, x, sc * 0.65, z, rand() * 6, sc, sc * 0.85, sc, PARK_COLORS.bush[Math.floor(rand() * 3)]);
    physics.ball(x, sc * 0.65, z, sc * 0.85);
  }

  // ---------- Flowers (no colliders) ----------
  const flowerItems = batch('flower', () => [new THREE.OctahedronGeometry(0.13, 0), lambert(0xffffff)]);
  const stemItems = batch('stem', () => [new THREE.CylinderGeometry(0.02, 0.02, 1, 3).translate(0, 0.5, 0), lambert(0xffffff)]);
  for (const f of flowers) {
    const hgt = 0.25 + rand() * 0.25;
    put(stemItems, f.x, 0, f.z, 0, 1, hgt, 1, 0x4f8a3a);
    put(flowerItems, f.x, hgt, f.z, rand() * 3, 1, 1, 1, PARK_COLORS.flowers[Math.floor(rand() * 4)]);
  }

  // ---------- Beach rocks and broken shoreline fences ----------
  const rockItems = batch('rock', () => [new THREE.DodecahedronGeometry(1, 0), lambert(0xffffff)]);
  for (let i = 0; i < 34; i++) {
    const a = rand() * Math.PI * 2, s = 0.965 + rand() * 0.07, r = s * shoreRadius(a, R), sc = 0.4 + rand() * 1.1;
    put(rockItems, Math.cos(a) * r, -0.45 + sc * 0.2, Math.sin(a) * r, rand() * 6, sc, sc * 0.6, sc * (0.8 + rand() * 0.4), PARK_COLORS.rock[i % 3]);
  }
  const postItems = batch('post', () => [new THREE.BoxGeometry(0.2, 1.2, 0.2), lambert(0xffffff)]);
  const railItems = batch('rail', () => [new THREE.BoxGeometry(1, 0.12, 0.08), lambert(0xffffff)]);
  for (const [a0, a1] of [[0.35, 0.95], [3.4, 3.95]]) {
    let prev = null;
    for (let a = a0; a <= a1; a += 2.2 / (0.88 * R)) {
      const r = 0.88 * shoreRadius(a, R), p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      put(postItems, p.x, 0.6, p.z, a, 1, 1, 1, PARK_COLORS.darkWood);
      if (prev && rand() < 0.85) {
        const mid = prev.clone().lerp(p, 0.5), len = prev.distanceTo(p), ry = Math.atan2(-(p.z - prev.z), p.x - prev.x);
        for (const y of [0.45, 0.9]) put(railItems, mid.x, y, mid.z, ry, len, 1, 1, PARK_COLORS.wood);
        physics.box(mid.x, 0.6, mid.z, len / 2, 0.6, 0.1, ry);
      }
      prev = p;
    }
  }

  for (const { geo, mat, items } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    items.forEach((it, i) => { mesh.setMatrixAt(i, it.matrix); mesh.setColorAt(i, color.setHex(it.hex)); });
    mesh.count = items.length;
    mesh.computeBoundingSphere();
    scene.add(shade(mesh));
  }

  // ---------- Grass: dense thin blades that grow out of the ground colour ----------
  // Single triangles with up-facing normals shade exactly like the lawn, so a field of blades
  // reads as soft fur rather than dark spikes. Dense patches + sparse lawn + tall plot borders.
  // Streamed in GRASS.chunk-metre squares: only squares within GRASS.radius of the player exist
  // (built a few per frame, seeded per square so they come back identical), squares beyond
  // GRASS.keep are freed. Keeps the blade count flat however large the island grows.
  const bladeGeo = new THREE.BufferGeometry();
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.07, 0, 0, 0.07, 0, 0, 0, 1, 0], 3));
  bladeGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const grassGrow = { value: 1 }, grassPlayer = { value: new THREE.Vector3(1e4, 0, 1e4) };
  const tip = new THREE.Color(PARK_COLORS.grassTip);
  const bladeMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  bladeMat.onBeforeCompile = (shader) => {
    // Shared wind (wind.js): blades lean downwind, travelling gusts bend them further and make
    // them a little shorter; a tiny flutter keeps calm blades alive.
    addSway(shader, `
      float k = position.y * position.y;
      float bladeH = length(instanceMatrix[1].xyz);
      mvPosition.xz += windHere * k * bladeH * 1.2;
      mvPosition.y -= dot(windHere, windHere) * k * bladeH * 0.5;
      mvPosition.x += sin(uTime * 7.0 + seed.x * 3.1 + seed.z) * 0.015 * k;
      vec2 away = seed.xz - uPlayer.xz;   // grass bends away from the player
      float push = (1.0 - smoothstep(0.35, 1.5, length(away))) * position.y;
      mvPosition.xz += normalize(away + 1e-4) * push * 0.55;
      mvPosition.y -= push * 0.3;`);
    shader.uniforms.uGrow = grassGrow;
    shader.uniforms.uPlayer = grassPlayer;
    shader.uniforms.uTip = { value: tip };
    shader.vertexShader = 'uniform float uGrow; uniform vec3 uPlayer;\nvarying float vBladeH;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBladeH = position.y;\ntransformed.y *= uGrow;');
    shader.fragmentShader = 'uniform vec3 uTip;\nvarying float vBladeH;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTip, pow(max(vBladeH, 0.0), 1.6) * 0.65);')
      // Both faces use the up normal: no flipped (dark) back faces.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  const tilt = new THREE.Euler();
  function buildGrassChunk(cx, cz) {
    const step = 0.32, size = GRASS.chunk;
    const rand = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x5bd1e995);
    const blades = [];
    for (let x = cx * size; x < (cx + 1) * size; x += step) for (let z = cz * size; z < (cz + 1) * size; z += step) {
      const px = x + rand() * step, pz = z + rand() * step;
      const sNorm = Math.hypot(px, pz) / shoreRadius(Math.atan2(pz, px), R);
      if (sNorm > 0.9 || Math.hypot(px, pz) < PLAZA_R + 0.6) continue;
      const clump = 0.5 + 0.5 * Math.sin(px * 0.13 + Math.sin(pz * 0.11) * 2) * Math.cos(pz * 0.12 - px * 0.05);
      const dense = THREE.MathUtils.smoothstep(clump, 0.45, 0.75);
      if (rand() > 0.08 + 0.85 * dense) continue; // cheap reject before the costly tests
      if (nearHouse(px, pz, 4.4) || onPath(px, pz, 0.3) || isFloor(px, pz)) continue;
      const edge = nearFloor(px, pz, 1.0);
      const h = edge ? 0.7 + rand() * 0.5 : 0.25 + dense * 0.65 + rand() * 0.25;
      blades.push([px, pz, h, sNorm]);
    }
    if (!blades.length) return null;
    const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, blades.length);
    blades.forEach(([x, z, h, sNorm], i) => {
      q.setFromEuler(tilt.set((rand() - 0.5) * 0.45, rand() * 6.28, (rand() - 0.5) * 0.45));
      grass.setMatrixAt(i, m4.compose(v.set(x, 0, z), q, s3.set(0.8 + rand() * 0.6, h, 1)));
      grass.setColorAt(i, groundColor(x, z, sNorm, color).multiplyScalar(0.92 + rand() * 0.1));
    });
    grass.receiveShadow = true;
    grass.computeBoundingSphere();
    grass.visible = grassGrow.value > 0;
    scene.add(grass);
    return grass;
  }
  const grassChunks = new Map(); // "cx,cz" -> InstancedMesh | null (empty square)
  function streamGrass(position) {
    const size = GRASS.chunk, pcx = Math.floor(position.x / size), pcz = Math.floor(position.z / size);
    const reach = Math.ceil(GRASS.radius / size), wanted = [];
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      const cx = pcx + i, cz = pcz + j, key = cx + ',' + cz;
      if (grassChunks.has(key)) continue;
      const d = Math.hypot((cx + 0.5) * size - position.x, (cz + 0.5) * size - position.z);
      if (d < GRASS.radius) wanted.push([d, cx, cz, key]);
    }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz, key] of wanted.slice(0, GRASS.perFrame)) grassChunks.set(key, buildGrassChunk(cx, cz));
    for (const [key, mesh] of grassChunks) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.hypot((cx + 0.5) * size - position.x, (cz + 0.5) * size - position.z) <= GRASS.keep) continue;
      if (mesh) { scene.remove(mesh); mesh.dispose(); }
      grassChunks.delete(key);
    }
  }
  return {
    // 0 = walking view, 1 = minimap: grass shrinks into the ground like the leaves fade.
    setFlat(p) {
      grassGrow.value = 1 - THREE.MathUtils.smoothstep(p, 0.1, 0.5);
      for (const mesh of grassChunks.values()) if (mesh) mesh.visible = grassGrow.value > 0;
    },
    setPlayer(position) { grassPlayer.value.copy(position); streamGrass(position); },
    setViewport: fountain.setViewport,
  };
}
