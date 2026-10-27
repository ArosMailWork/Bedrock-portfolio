import * as THREE from 'three';
import { pop } from './shape-tree.js';

// All placeholder colours in one place; sprites/colours are meant to be replaced later.
export const PALETTE = {
  bark: 0x6b5442,
  leaf: [0x86a96b, 0xa8bd7c, 0x708f59, 0xb8ca8b],
  tile: [0xf2ede2, 0xebe5d8, 0xe4ddcf],     // plain stone
  tileInk: [0xdcd3c2, 0xd5cbb9, 0xcec4b1],  // text cells: faintly darker, readable in 3D
  tileRing: [0xe8e4cf, 0xe1ddc6],           // grass border stone
  grass: [0x7fc24f, 0x93d05c, 0x6aae43, 0xa4d873, 0xd99bb0],
};
// Replace with RGBA PNGs; alphaTest clips transparent pixels.
export const LEAF_TEXTURE_URL = './assets/textures/leaf-placeholder.svg';
export const GRASS_TEXTURE_URL = './assets/textures/grass-placeholder.svg';
export const wind = { value: 0 }; // shared time uniform, advanced by the render loop

const MARGIN = 3;        // grass border width in cells
const SIDES = 6;         // low-poly branch cross-section
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const pick = (list, r) => list[Math.floor(r * list.length) % list.length];
const smoothstep = THREE.MathUtils.smoothstep;

function loadTexture(url) {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Instanced vertex sway, applied after the instance transform. `amount(seed)` is GLSL.
function addSway(shader, amount) {
  shader.uniforms.uTime = wind;
  shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <project_vertex>', `
    vec4 mvPosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
      vec3 seed = instanceMatrix[3].xyz;
      ${amount}
    #endif
    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;`);
}

// One closed low-poly mesh per tree. Each node owns one ring perpendicular to the branch
// (parallel-transported along chains), so horizontal limbs keep their thickness and
// consecutive segments share rings exactly (no seams).
function branchGeometry(tree, cluster, root) {
  const ids = [];
  tree.nodes.forEach((n, i) => { if (n.cluster === cluster) ids.push(i); });
  const primaryChild = new Map();
  for (const i of ids) { const n = tree.nodes[i]; if (n.parent >= 0 && n.primary) primaryChild.set(n.parent, i); }
  const positions = [], indices = [], rings = new Map();
  const v = new THREE.Vector3(), t = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
  const pos = (n) => new THREE.Vector3(n.x - root.x, n.y, n.z - root.z);
  const ring = (center, tangent, axis, radius) => {
    const start = positions.length / 3;
    w.crossVectors(tangent, axis);
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      v.copy(axis).multiplyScalar(Math.cos(a) * radius).addScaledVector(w, Math.sin(a) * radius).add(center);
      positions.push(v.x, v.y, v.z);
    }
    return start;
  };
  const anyPerpendicular = (tangent) => {
    const ref = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    return new THREE.Vector3().crossVectors(tangent, ref).normalize();
  };
  const connect = (a, b) => {
    for (let j = 0; j < SIDES; j++) {
      const k = (j + 1) % SIDES;
      indices.push(a + j, b + j, a + k, a + k, b + j, b + k);
    }
  };
  for (const i of ids) {
    const n = tree.nodes[i], p = pos(n);
    t.set(0, 0, 0);
    if (n.parent >= 0) t.add(pos(n).sub(pos(tree.nodes[n.parent])).normalize());
    if (primaryChild.has(i)) t.add(pos(tree.nodes[primaryChild.get(i)]).sub(p).normalize());
    if (t.lengthSq() < 1e-8) t.set(0, 1, 0);
    t.normalize();
    const parentRing = n.parent >= 0 && n.primary ? rings.get(n.parent) : null;
    if (parentRing) u.copy(parentRing.axis).addScaledVector(t, -parentRing.axis.dot(t));
    if (!parentRing || u.lengthSq() < 1e-6) u.copy(anyPerpendicular(t)); else u.normalize();
    const radius = Math.max(n.radius, 0.05);
    const index = ring(p, t, u, radius);
    rings.set(i, { index, axis: u.clone() });
    if (n.parent < 0) continue;
    const parent = tree.nodes[n.parent];
    // Side branches start from their own ring buried inside the parent's volume.
    const startIndex = parentRing ? parentRing.index
      : ring(pos(parent), t, u, Math.min(Math.max(parent.radius, 0.05), radius * 1.25));
    connect(startIndex, index);
    if (!primaryChild.has(i) && !ids.some((c) => tree.nodes[c].parent === i)) {
      const tip = positions.length / 3;
      positions.push(p.x, p.y, p.z);
      for (let j = 0; j < SIDES; j++) indices.push(index + j, index + (j + 1) % SIDES, tip);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

// tree: growTree() output. width/depth: plot size in cells (floor covers the whole plot).
export function buildTreeScene(tree, mask, { colors = PALETTE.leaf, width = 0, depth = 0 } = {}) {
  const group = new THREE.Group(), resources = [], meshes = [];
  const keep = (x) => { resources.push(x); return x; };
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  // ---------- Branches: plain colour, fade out first when looking down ----------
  const bark = keep(new THREE.MeshBasicMaterial({ color: PALETTE.bark, side: THREE.DoubleSide }));
  const trunks = tree.roots.map((root, cluster) => {
    const mesh = new THREE.Mesh(keep(branchGeometry(tree, cluster, root)), bark);
    mesh.position.set(root.x, 0, root.z);
    group.add(mesh);
    return mesh;
  });

  // ---------- Leaves: one instanced mesh per tree, swaying, fading via uFade ----------
  const fade = { value: 1 };
  const leafMaterial = keep(new THREE.MeshLambertMaterial({ map: keep(loadTexture(LEAF_TEXTURE_URL)), alphaTest: 0.45, side: THREE.DoubleSide }));
  leafMaterial.onBeforeCompile = (shader) => {
    addSway(shader, `
      float phase = seed.x * 0.43 + seed.z * 0.31;
      float h = clamp(seed.y / 10.0, 0.0, 1.0);
      mvPosition.x += sin(uTime * 1.3 + phase) * 0.12 * h + sin(uTime * 4.1 + phase * 7.0) * 0.03;
      mvPosition.z += cos(uTime * 1.1 + phase) * 0.09 * h;
      mvPosition.y += sin(uTime * 3.3 + phase * 5.0) * 0.025;`);
    // Opacity is applied AFTER the cutout test, so the leaf shape stays while it fades.
    shader.uniforms.uFade = fade;
    shader.fragmentShader = 'uniform float uFade;\n' + shader.fragmentShader
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a *= uFade;');
  };
  const leafGeo = keep(new THREE.PlaneGeometry(0.72, 0.72));
  const foliage = tree.roots.map((root, cluster) => {
    // Interleave cells so a reduced instance count still covers the whole crown.
    const entries = tree.leaves.filter((leaf) => leaf.cluster === cluster);
    const perCell = entries.filter((leaf) => leaf.cell === entries[0].cell).length;
    const ordered = [];
    for (let layer = 0; layer < perCell; layer++) for (let i = layer; i < entries.length; i += perCell) ordered.push(entries[i]);
    const mesh = new THREE.InstancedMesh(leafGeo, leafMaterial, ordered.length);
    ordered.forEach((leaf, i) => mesh.setColorAt(i, color.setHex(pick(colors, leaf.shade))));
    const bounds = new THREE.Box3().expandByPoint(new THREE.Vector3(root.x, 0, root.z));
    for (const leaf of ordered) bounds.expandByPoint(position.set(
      root.x + (leaf.x - root.x) * 1.2, leaf.y * 1.2 + 1, root.z + (leaf.z - root.z) * 1.2));
    mesh.boundingSphere = bounds.expandByScalar(1).getBoundingSphere(new THREE.Sphere());
    group.add(mesh); meshes.push(mesh);
    return { mesh, entries: ordered, time: 0, active: false, dirty: true,
      rotations: ordered.map((l) => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + l.tilt, 0, l.yaw, 'XYZ'))) };
  });

  // ---------- Floor: generated stone tiles over the whole plot ----------
  // Same parity as the mask so mask cells land exactly on tile centres.
  const cols = mask.w + 2 * Math.max(MARGIN, Math.ceil((width - mask.w) / 2));
  const rows = mask.h + 2 * Math.max(MARGIN, Math.ceil((depth - mask.h) / 2));
  const col0 = (cols - mask.w) / 2, row0 = (rows - mask.h) / 2;
  const tileGeo = keep(new THREE.BoxGeometry(0.98, 0.14, 0.98));
  const tiles = new THREE.InstancedMesh(tileGeo, keep(new THREE.MeshLambertMaterial()), cols * rows);
  const grassCells = [], voxelCells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c - (cols - 1) / 2, z = r - (rows - 1) / 2, rnd = hash(x, z);
    const mc = c - col0, mr = r - row0;
    const ink = mc >= 0 && mr >= 0 && mc < mask.w && mr < mask.h && mask.cells[mr * mask.w + mc];
    const edge = Math.min(c, r, cols - 1 - c, rows - 1 - r);
    const ring = edge < MARGIN;
    tiles.setMatrixAt(r * cols + c, matrix.makeTranslation(x, 0.07 + rnd * 0.03, z));
    tiles.setColorAt(r * cols + c, color.setHex(pick(ink ? PALETTE.tileInk : ring ? PALETTE.tileRing : PALETTE.tile, rnd)));
    // Clumpy grass: dense at the outer edge, thinning inwards, with low-frequency gaps.
    const clump = 0.5 + 0.5 * Math.sin(x * 0.55 + Math.sin(z * 0.4) * 2) * Math.cos(z * 0.5 - x * 0.2);
    if (ring && hash(z, x) < (edge === 0 ? 0.9 : edge === 1 ? 0.75 : 0.45) * (0.4 + clump * 0.6)) grassCells.push({ x, z, rnd });
    if (ink) voxelCells.push({ x, z, rnd });
  }
  group.add(tiles); meshes.push(tiles);

  // ---------- Grass tufts: three crossed quads per cell, swaying ----------
  const grassMaterial = keep(new THREE.MeshLambertMaterial({ map: keep(loadTexture(GRASS_TEXTURE_URL)), alphaTest: 0.45, side: THREE.DoubleSide }));
  grassMaterial.onBeforeCompile = (shader) => addSway(shader, `
      float k = position.y * position.y;
      mvPosition.x += sin(uTime * 2.0 + seed.x * 0.7 + seed.z * 0.5) * 0.12 * k;
      mvPosition.z += cos(uTime * 1.7 + seed.z * 0.6) * 0.08 * k;`);
  const grassGeo = keep(new THREE.PlaneGeometry(0.9, 0.9).translate(0, 0.45, 0));
  const grass = new THREE.InstancedMesh(grassGeo, grassMaterial, Math.max(1, grassCells.length * 3));
  grassCells.forEach((g, i) => {
    for (let j = 0; j < 3; j++) {
      const r = hash(g.x * 3 + j, g.z * 5 - j);
      rotation.setFromAxisAngle(up, r * Math.PI);
      grass.setMatrixAt(i * 3 + j, matrix.compose(position.set(g.x + (r - 0.5) * 0.6, 0.14, g.z + (hash(g.z + j, g.x) - 0.5) * 0.6),
        rotation, scale.set(0.8 + r * 0.5, 0.7 + g.rnd * 0.7, 0.8 + r * 0.5)));
      grass.setColorAt(i * 3 + j, color.setHex(pick(PALETTE.grass, r)));
    }
  });
  grass.count = grassCells.length * 3;
  grass.computeBoundingSphere();
  group.add(grass); meshes.push(grass);

  // ---------- Voxel text: rises from the floor in the top view, replaces the leaves ----------
  const rise = { value: 0 };
  const voxelMaterial = keep(new THREE.MeshLambertMaterial());
  voxelMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uRise = rise;
    shader.vertexShader = 'uniform float uRise;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y *= uRise;');
  };
  const voxelGeo = keep(new THREE.BoxGeometry(0.96, 0.6, 0.96).translate(0, 0.3, 0));
  const voxels = new THREE.InstancedMesh(voxelGeo, voxelMaterial, Math.max(1, voxelCells.length));
  voxelCells.forEach((cell, i) => {
    voxels.setMatrixAt(i, matrix.compose(position.set(cell.x, 0.15, cell.z), rotation.identity(), scale.set(1, 0.8 + cell.rnd * 0.4, 1)));
    voxels.setColorAt(i, color.setHex(pick(colors, hash(cell.z * 0.37, cell.x * 0.61))));
  });
  voxels.count = voxelCells.length;
  voxels.visible = false;
  voxels.computeBoundingSphere();
  group.add(voxels); meshes.push(voxels);

  // ---------- Animation ----------
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), worldBounds = new THREE.Sphere();
  let flat = 0;
  function updateCluster(cluster) {
    const item = foliage[cluster], root = tree.roots[cluster];
    const trunk = pop((item.time - root.delay) / 0.65);
    trunks[cluster].scale.setScalar(trunk.scale);
    trunks[cluster].position.y = trunk.lift;
    const p = pop((item.time - root.delay - 0.7) / 0.65);
    item.entries.forEach((leaf, i) => {
      position.set(root.x + (leaf.x - root.x) * trunk.scale,
        leaf.y * trunk.scale + trunk.lift + p.lift, root.z + (leaf.z - root.z) * trunk.scale);
      item.mesh.setMatrixAt(i, matrix.compose(position, item.rotations[i], scale.setScalar(p.scale * trunk.scale)));
    });
    item.mesh.instanceMatrix.needsUpdate = true;
    item.dirty = false;
  }

  return {
    group, size: { w: cols, h: rows },
    // Range activation (hysteresis), frustum culling and view-dependent leaf thinning.
    tick(dt, observer, pinned, instant = false, camera = null) {
      if (camera) {
        group.updateMatrixWorld();
        projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projection);
      }
      const leavesOn = flat < 0.85, barkOn = flat < 0.3;
      const ratio = 1 - 0.75 * smoothstep(flat, 0.15, 0.85);
      foliage.forEach((item, i) => {
        const root = tree.roots[i];
        const distance = Math.hypot(observer.x - group.position.x - root.x, observer.z - group.position.z - root.z);
        item.active = pinned || distance < (item.active ? 105 : 85);
        const end = item.active ? tree.maxT : 0;
        const next = instant ? end : THREE.MathUtils.clamp(item.time + Math.sign(end - item.time) * dt, 0, tree.maxT);
        if (next !== item.time) { item.time = next; item.dirty = true; }
        worldBounds.copy(item.mesh.boundingSphere).applyMatrix4(group.matrixWorld);
        const visible = (!camera || frustum.intersectsSphere(worldBounds)) && item.time > 0;
        if (visible && leavesOn && item.dirty) updateCluster(i);
        item.mesh.visible = visible && leavesOn;
        trunks[i].visible = visible && barkOn;
        item.mesh.count = Math.ceil(item.entries.length * ratio);
      });
    },
    setGrowth(t) { foliage.forEach((item) => { item.time = Math.min(tree.maxT, t); item.dirty = true; }); },
    // 0 = 3D trees, 1 = voxel text. Branches go first, leaves fade and thin, voxels rise.
    setFlat(p) {
      flat = p;
      bark.opacity = 1 - smoothstep(p, 0, 0.3);
      bark.transparent = bark.opacity < 1;
      fade.value = 1 - smoothstep(p, 0.35, 0.85);
      leafMaterial.transparent = fade.value < 1;
      leafMaterial.depthWrite = fade.value === 1;
      rise.value = smoothstep(p, 0.3, 0.8);
      voxels.visible = rise.value > 0;
    },
    dispose() { resources.forEach((r) => r.dispose()); meshes.forEach((m) => m.dispose()); },
  };
}
