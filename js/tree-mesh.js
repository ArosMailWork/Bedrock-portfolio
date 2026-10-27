import * as THREE from 'three';
import { pop } from './shape-tree.js';

// All placeholder colours in one place; sprites/colours are meant to be replaced later.
export const PALETTE = {
  bark: 0xa77c59,
  leaf: [0x86a96b, 0xa8bd7c, 0x708f59, 0xb8ca8b],
  tile: [0xf2ede2, 0xebe5d8, 0xe4ddcf],     // plain stone
  tileInk: [0xdcd3c2, 0xd5cbb9, 0xcec4b1],  // text cells: faintly darker, readable in 3D
};
// Replace with an RGBA PNG; alphaTest clips transparent pixels.
export const LEAF_TEXTURE_URL = './assets/textures/leaf-maple-lowpoly.svg';
export const wind = { value: 0 }; // shared time uniform, advanced by the render loop
// User-tunable (settings panel): trees grow within growRange m, shrink beyond growRange + 15 m.
export const treeSettings = { growRange: 40 };

const MARGIN = 4;        // stone border around the text, in cells
const SIDES = 7;         // low-poly branch cross-section
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const pick = (list, r) => list[Math.floor(r * list.length) % list.length];
const smoothstep = THREE.MathUtils.smoothstep;

function loadTexture(url) {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Instanced vertex sway, applied after the instance transform. `amount(seed)` is GLSL.
export function addSway(shader, amount) {
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
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// tree: growTree() output. The floor is an organic low-poly patch around the text.
export function buildTreeScene(tree, mask, { colors = PALETTE.leaf, seed = 0 } = {}) {
  // Darkest palette colour gives the most contrast against the pale tiles.
  const voxelHex = [...colors].sort((a, b) => new THREE.Color(a).getHSL({}).l - new THREE.Color(b).getHSL({}).l)[0];
  const group = new THREE.Group(), resources = [], meshes = [];
  const keep = (x) => { resources.push(x); return x; };
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  // ---------- Branches: plain colour, fade out first when looking down ----------
  const bark = keep(new THREE.MeshLambertMaterial({ color: PALETTE.bark, side: THREE.DoubleSide }));
  // Invisible crown proxies cast the canopy shadow instead of every leaf.
  const shadowOnly = keep(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  const crownGeo = keep(new THREE.IcosahedronGeometry(1, 1));
  const crowns = []; // plot-local crown boxes, used by the falling-leaf particles
  const trunks = tree.roots.map((root, cluster) => {
    const mesh = new THREE.Mesh(keep(branchGeometry(tree, cluster, root)), bark);
    mesh.position.set(root.x, 0, root.z);
    mesh.castShadow = mesh.receiveShadow = true;
    const crown = new THREE.Box3();
    for (const leaf of tree.leaves) if (leaf.cluster === cluster) crown.expandByPoint(position.set(leaf.x - root.x, leaf.y, leaf.z - root.z));
    if (!crown.isEmpty()) {
      crowns.push({ cluster, box: crown.clone().translate(new THREE.Vector3(root.x, 0, root.z)) });
      const proxy = new THREE.Mesh(crownGeo, shadowOnly);
      crown.getCenter(proxy.position);
      crown.getSize(proxy.scale).multiplyScalar(0.42);
      proxy.castShadow = true;
      mesh.add(proxy);
    }
    group.add(mesh);
    return mesh;
  });

  // ---------- Leaves: one instanced mesh per tree, swaying, fading via uFade ----------
  const fade = { value: 1 }, sink = { value: 0 };
  const leafMaterial = keep(new THREE.MeshLambertMaterial({ map: keep(loadTexture(LEAF_TEXTURE_URL)), alphaTest: 0.45, side: THREE.DoubleSide }));
  leafMaterial.onBeforeCompile = (shader) => {
    addSway(shader, `
      float phase = seed.x * 0.43 + seed.z * 0.31;
      float h = clamp(seed.y / 10.0, 0.0, 1.0);
      mvPosition.x += sin(uTime * 1.3 + phase) * 0.12 * h + sin(uTime * 4.1 + phase * 7.0) * 0.03;
      mvPosition.z += cos(uTime * 1.1 + phase) * 0.09 * h;
      mvPosition.y += sin(uTime * 3.3 + phase * 5.0) * 0.025;
      mvPosition.y = mix(mvPosition.y, -1.2 + position.y * 0.1, uSink);`);
    shader.uniforms.uSink = sink;
    shader.vertexShader = 'uniform float uSink;\n' + shader.vertexShader;
    // Opacity is applied AFTER the cutout test, so the leaf shape stays while it fades.
    shader.uniforms.uFade = fade;
    shader.fragmentShader = 'uniform float uFade;\n' + shader.fragmentShader
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a *= uFade;');
  };
  const leafGeo = keep(new THREE.PlaneGeometry(0.9, 0.9)); // maple sprite fills ~90% of the quad
  const foliage = tree.roots.map((root, cluster) => {
    // Canopy-only cells have fewer leaves; retain every entry without fixed-size cell grouping.
    const ordered = tree.leaves.filter((leaf) => leaf.cluster === cluster);
    const mesh = new THREE.InstancedMesh(leafGeo, leafMaterial, ordered.length);
    mesh.receiveShadow = true;
    ordered.forEach((leaf, i) => mesh.setColorAt(i, color.setHex(pick(colors, leaf.shade))));
    const bounds = new THREE.Box3().expandByPoint(new THREE.Vector3(root.x, 0, root.z));
    for (const leaf of ordered) bounds.expandByPoint(position.set(
      root.x + (leaf.x - root.x) * 1.2, leaf.y * 1.2 + 1, root.z + (leaf.z - root.z) * 1.2));
    mesh.boundingSphere = bounds.expandByScalar(1).getBoundingSphere(new THREE.Sphere());
    group.add(mesh); meshes.push(mesh);
    return { mesh, entries: ordered, time: 0, active: false, dirty: true,
      rotations: ordered.map((l) => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + l.tilt, 0, l.yaw, 'XYZ'))) };
  });

  // ---------- Floor: organic patch of stone tiles (rounded, noisy outline) ----------
  // Same parity as the mask so mask cells land exactly on tile centres.
  const cols = mask.w + 2 * MARGIN, rows = mask.h + 2 * MARGIN;
  const col0 = MARGIN, row0 = MARGIN;
  const inkAt = (c, r) => { const mc = c - col0, mr = r - row0; return mc >= 0 && mr >= 0 && mc < mask.w && mr < mask.h && mask.cells[mr * mask.w + mc]; };
  const nearInk = (c, r) => { for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (inkAt(c + dc, r + dr)) return true; return false; };
  // 1. Organic outline.
  const inside = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c - (cols - 1) / 2, z = r - (rows - 1) / 2;
    const nx = x / (cols / 2), nz = z / (rows / 2), a = Math.atan2(nz, nx);
    const wobble = 1 + 0.1 * Math.sin(a * 5 + seed) + 0.05 * Math.sin(a * 11 + seed * 2);
    if (nearInk(c, r) || (nx ** 4 + nz ** 4) * wobble <= 1) inside[r * cols + c] = 1;
  }
  // 2. Distance (in cells, max 4) from each inside cell to the lawn.
  const edge = new Uint8Array(cols * rows).fill(9);
  const isIn = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && inside[r * cols + c];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!inside[r * cols + c]) continue;
    for (let k = 1; k <= 4 && edge[r * cols + c] === 9; k++) {
      if (!isIn(c - k, r) || !isIn(c + k, r) || !isIn(c, r - k) || !isIn(c, r + k)) edge[r * cols + c] = k;
    }
  }
  // 3. Erode the border into the lawn: tiles thin out, tilt, shrink and sink; some break into
  //    chips. Text cells (and their direct neighbours) are never touched.
  const KEEP = [0, 0.4, 0.7, 0.88, 0.97];
  const floorCells = [], chips = [], voxelCells = [], floorKeys = new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!inside[r * cols + c]) continue;
    const x = c - (cols - 1) / 2, z = r - (rows - 1) / 2, rnd = hash(x + seed, z), rnd2 = hash(z - seed, x * 1.3);
    const ink = inkAt(c, r), e = edge[r * cols + c];
    const protectedCell = ink || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => inkAt(c + dc, r + dr));
    const wear = protectedCell || e > 4 ? 0 : 1 - KEEP[e];
    if (rnd2 < wear) {
      if (rnd < 0.55) chips.push({ x: x + (rnd - 0.5) * 0.5, z: z + (rnd2 - 0.5) * 0.5, rnd, size: 0.25 + rnd * 0.3 });
      continue; // lawn shows through; grass grows here
    }
    floorCells.push({ x, z, ink, rnd, wear });
    floorKeys.add(`${x},${z}`);
    if (ink) voxelCells.push({ x, z, rnd });
  }
  const tileGeo = keep(new THREE.BoxGeometry(0.98, 0.1, 0.98));
  const tiles = new THREE.InstancedMesh(tileGeo, keep(new THREE.MeshLambertMaterial()), floorCells.length + chips.length);
  const worn = new THREE.Color(0xb9b49a); // weathered, mossy stone at the border
  floorCells.forEach((cell, i) => {
    const w = cell.wear;
    rotation.setFromEuler(new THREE.Euler((cell.rnd - 0.5) * 0.12 * w, (cell.rnd - 0.5) * 0.5 * w, 0));
    tiles.setMatrixAt(i, matrix.compose(position.set(cell.x, 0.01 + cell.rnd * 0.025 - w * 0.03, cell.z), rotation, scale.set(1 - w * 0.25, 1, 1 - w * 0.2)));
    tiles.setColorAt(i, color.setHex(pick(cell.ink ? PALETTE.tileInk : PALETTE.tile, cell.rnd)).lerp(worn, w * 0.5));
  });
  chips.forEach((chip, k) => {
    rotation.setFromEuler(new THREE.Euler(0, chip.rnd * 6.28, 0));
    tiles.setMatrixAt(floorCells.length + k, matrix.compose(position.set(chip.x, -0.01, chip.z), rotation, scale.set(chip.size, 0.8, chip.size * 0.8)));
    tiles.setColorAt(floorCells.length + k, color.setHex(pick(PALETTE.tile, chip.rnd)).lerp(worn, 0.4));
  });
  tiles.receiveShadow = true;
  tiles.computeBoundingSphere();
  group.add(tiles); meshes.push(tiles);

  // ---------- Voxel text: rises from the floor in the top view, replaces the leaves ----------
  const rise = { value: 0 };
  const voxelMaterial = keep(new THREE.MeshLambertMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  voxelMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uRise = rise;
    shader.vertexShader = 'uniform float uRise;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y *= uRise;');
  };
  const voxelGeo = keep(new THREE.BoxGeometry(0.96, 0.6, 0.96).translate(0, 0.3, 0));
  const voxels = new THREE.InstancedMesh(voxelGeo, voxelMaterial, Math.max(1, voxelCells.length));
  voxelCells.forEach((cell, i) => {
    // One flat colour and height: the minimap text must read cleanly (leaves stay multicolour).
    voxels.setMatrixAt(i, matrix.makeTranslation(cell.x, 0.06, cell.z));
    voxels.setColorAt(i, color.setHex(voxelHex));
  });
  voxels.count = voxelCells.length;
  voxels.visible = false;
  voxels.receiveShadow = true;
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
    group, size: { w: cols, h: rows }, floor: floorCells, crowns,
    isGrown: (cluster) => foliage[cluster].time >= tree.maxT && foliage[cluster].mesh.visible,
    // Local plot coordinates -> is this a stone tile? (grass and props avoid the floor)
    isFloor: (x, z) => floorKeys.has(`${Math.round(x + (cols - 1) / 2) - (cols - 1) / 2},${Math.round(z + (rows - 1) / 2) - (rows - 1) / 2}`),
    // Range activation (hysteresis), frustum culling and view-dependent leaf thinning.
    tick(dt, observer, pinned, instant = false, camera = null) {
      if (camera) {
        group.updateMatrixWorld();
        projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projection);
      }
      const leavesOn = flat < 0.8, barkOn = flat < 0.3;
      const ratio = 1; // Preserve crown density while it sinks; no instance-count popping.
      foliage.forEach((item, i) => {
        const root = tree.roots[i];
        const distance = Math.hypot(observer.x - group.position.x - root.x, observer.z - group.position.z - root.z);
        const range = treeSettings.growRange;
        item.active = pinned || distance < (item.active ? range + 15 : range);
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
      sink.value = smoothstep(p, 0.05, 0.8);
      fade.value = 1 - smoothstep(p, 0.65, 0.8);
      leafMaterial.transparent = fade.value < 1;
      leafMaterial.depthWrite = fade.value === 1;
      rise.value = 1;
      voxelMaterial.opacity = smoothstep(p, 0.05, 0.5);
      voxelMaterial.depthWrite = voxelMaterial.opacity === 1;
      voxels.visible = voxelMaterial.opacity > 0;
    },
    dispose() { resources.forEach((r) => r.dispose()); meshes.forEach((m) => m.dispose()); },
  };
}
