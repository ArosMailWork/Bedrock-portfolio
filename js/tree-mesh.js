import * as THREE from 'three';
import { pop } from './shape-tree.js';
import { WIND_GLSL, windUniforms } from './wind.js';

// All placeholder colours in one place; sprites/colours are meant to be replaced later.
export const PALETTE = {
  bark: 0xa77c59,
  leaf: [0x86a96b, 0xa8bd7c, 0x708f59, 0xb8ca8b],
  tile: [0xf2ede2, 0xebe5d8, 0xe4ddcf],     // plain stone
  tileInk: [0xdcd3c2, 0xd5cbb9, 0xcec4b1],  // text cells: faintly darker, readable in 3D
  tileWalk: [0xe8b98a, 0xe0ab7a, 0xefc69b], // plot walkways (park.js paths): orange paving
};
// Foliage sprite: a distance field of a clump of small diamond leaves (red channel = distance to
// the nearest leaf edge). From bruno-simon.com (github.com/brunosimon/folio-2025, MIT, see
// assets/textures/third-party/LICENSE-folio-2025.md). Cut at LEAF_THRESHOLD: lower = fatter leaves.
export const FOLIAGE_TEXTURE_URL = './assets/textures/third-party/foliage-sdf-bruno-simon.png';
export const LEAF_THRESHOLD = 0.3;
export const LEAF_SIZE = 1.2;  // quad size (m); each quad shows a clump of ~20 small leaves
// garden.js places the sun at target + SUN_OFFSET; foliage two-tone uses the same direction.
export const SUN_OFFSET = new THREE.Vector3(-28, 55, 22);
const SUN_DIR = SUN_OFFSET.clone().normalize();
export const wind = { value: 0 }; // shared time uniform, advanced by the render loop
// User-tunable (settings panel): trees grow within growRange m, shrink beyond growRange + 15 m.
export const treeSettings = { growRange: 40, buildsPerFrame: 4 }; // buildsPerFrame: streaming budget
// Filler leaves (shape-tree.js) complete the crown for the walking camera only. garden.js drives
// fillerFade (1 = visible, 0 = gone) from the camera's downward angle; they are drawn bigger.
export const fillerFade = { value: 1 };
// Branch visibility (1 = shown); garden.js follows fillerFade only outside the walking view, so
// branches never cross the text from above but trunks stay when the walking camera looks down.
export const barkFade = { value: 1 };
// Camera -> player distance while walking (0 = off): leaves closer to the camera than the player
// are dropped, so crowns never hide the character (Bruno's foliage "see-through").
export const seeThrough = { value: 0 };
export const FILLER_SCALE = 1.3;
// 0..1 when the minimap is zoomed far out: voxels and tiles grow to close their sub-pixel gaps
// (which flickered while panning) and tile colours flatten so the text stays crisp.
export const mapFill = { value: 0 };
// Voxel pop for the map transition: voxels spring up in a wave spreading from this world point
// (garden.js sets it to the transition's destination); VOXEL.spread metres reach the last delay.
export const mapCenter = { value: new THREE.Vector3() };
export const VOXEL = { height: 1.2, spread: 60 };

const MARGIN = 6;        // stone border around the text, in cells
const ROOT_CHIPS = 0.9;  // rootChips: broken-tile ring round a trunk, beyond its radius (m)
const PAVED = 4;         // cells around the text that are always paved
const SOLID = 3;         // cells around the text that never erode (tilt / chip / lawn)
// Plot walkways (cells): ring = distance band from the text's bounding box, gap = minimum empty
// rows between lines for a rung, spur = width of the entry strip towards the plaza.
export const WALK = { ring: [2, 4], gap: 3, spur: 3.2 };
const SIDES = 8;         // low-poly branch cross-section (smooth radial normals hide the facets)
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const pick = (list, r) => list[Math.floor(r * list.length) % list.length];
const smoothstep = THREE.MathUtils.smoothstep;
// 4x4 ordered-dither threshold in [0, 1): screen-door fading without transparency sorting.
const BAYER_GLSL = `
  float bayer2(vec2 v) { return mod(2.0 * v.x + 3.0 * v.y, 4.0); }
  float bayer4(vec2 p) { p = mod(floor(p), 4.0); return (4.0 * bayer2(mod(p, 2.0)) + bayer2(floor(p / 2.0)) + 0.5) / 16.0; }`;

// isColor = false for data textures (masks, distance fields): no sRGB decoding.
function loadTexture(url, isColor = true) {
  const texture = new THREE.TextureLoader().load(url);
  if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Instanced vertex sway, applied after the instance transform. `amount(seed)` is GLSL.
// `seed` = instance position (mesh-local), `windHere` = shared wind push (wind.js) at its world x/z.
export function addSway(shader, amount) {
  shader.uniforms.uTime = wind;
  Object.assign(shader.uniforms, windUniforms);
  shader.vertexShader = `uniform float uTime;\n${WIND_GLSL}\n` + shader.vertexShader.replace('#include <project_vertex>', `
    vec4 mvPosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
      vec3 seed = instanceMatrix[3].xyz;
      vec2 windHere = windOffset((modelMatrix * vec4(seed, 1.0)).xz);
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
  const positions = [], normals = [], indices = [], rings = new Map();
  const v = new THREE.Vector3(), t = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
  const pos = (n) => new THREE.Vector3(n.x - root.x, n.y, n.z - root.z);
  const ring = (center, tangent, axis, radius) => {
    const start = positions.length / 3;
    w.crossVectors(tangent, axis);
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      v.copy(axis).multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
      normals.push(v.x, v.y, v.z); // radial: smooth shading around the branch
      v.multiplyScalar(radius).add(center);
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
      indices.push(a + j, a + k, b + j, a + k, b + k, b + j); // counter-clockwise from outside
    }
  };
  for (const i of ids) {
    const n = tree.nodes[i], p = pos(n);
    t.set(0, 0, 0);
    if (n.parent >= 0) t.add(pos(n).sub(pos(tree.nodes[n.parent])).normalize());
    if (primaryChild.has(i)) t.add(pos(tree.nodes[primaryChild.get(i)]).sub(p).normalize());
    // The root ring lies flat (it is buried below the ground): a ring perpendicular to a leaning
    // trunk would lift one side out of the ground and leave a visible gap.
    if (t.lengthSq() < 1e-8 || n.parent < 0) t.set(0, 1, 0);
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
      normals.push(t.x, t.y, t.z);
      for (let j = 0; j < SIDES; j++) indices.push(index + j, index + (j + 1) % SIDES, tip);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.computeBoundingSphere();
  return geo;
}

// forest: planForest() output; mask may carry `kind` (0 = title/lines, 1 = body) per cell.
// Trees stream: a tree's branches and leaves are built (forest.build) only when it enters the grow
// range, at most treeSettings.buildsPerFrame per frame, nearest first, and freed again once it has
// shrunk away. Floor tiles and voxels are split into CHUNK x CHUNK cell meshes, so off-screen parts
// are frustum-culled. The floor is an organic low-poly patch around the text.
const CHUNK = 32;
const WORN = new THREE.Color(0xb9b49a); // weathered, mossy stone at the border
const KEEP = [0, 0.4, 0.7, 0.88, 0.97]; // tile survival by distance (cells) to the lawn
// Stone tile material shared by the plots and the tile fields: in the far map (mapFill) tiles
// close their gaps and their colours flatten towards the plain tile colour.
function makeTileMaterial() {
  const material = new THREE.MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFill = mapFill;
    shader.uniforms.uFlat = { value: new THREE.Color(PALETTE.tile[0]) };
    shader.vertexShader = 'uniform float uFill;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz *= mix(1.0, 1.0 / 0.98, uFill);');
    shader.fragmentShader = 'uniform float uFill;\nuniform vec3 uFlat;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uFlat, uFill * 0.6);');
  };
  return material;
}


// toward: [sx, sz] signs of the plot corner facing the plaza (walkway spur direction), or null.
// rootChips: tiles round each tree trunk break into chips, so the trees look rooted in the soil.
export function buildTreeScene(forest, mask, { colors = PALETTE.leaf, bodyColors = colors, seed = 0, toward = null, rootChips = false } = {}) {
  const byLightness = (list) => [...list].sort((a, b) => new THREE.Color(a).getHSL({}).l - new THREE.Color(b).getHSL({}).l);
  const tonesByKind = [byLightness(colors), byLightness(bodyColors)];
  // Darkest palette colour gives the most contrast against the pale tiles.
  const voxelHexByKind = tonesByKind.map((tones) => tones[0]);
  const group = new THREE.Group(), resources = [];
  const keep = (x) => { resources.push(x); return x; };
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const color = new THREE.Color();

  // ---------- Branches: plain colour, fade out first when looking down ----------
  // Front faces only: outward normals keep the shadow normal-bias on the right side (no acne).
  const bark = keep(new THREE.MeshLambertMaterial({ color: PALETTE.bark }));
  // Branches dissolve (ordered dither) with barkFade: outside the walking view they would cross the text.
  bark.onBeforeCompile = (shader) => {
    shader.uniforms.uBarkFade = barkFade;
    shader.fragmentShader = `uniform float uBarkFade;\n${BAYER_GLSL}\n` + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (bayer4(gl_FragCoord.xy) >= uBarkFade) discard;');
  };
  // Invisible crown proxies cast the canopy shadow instead of every leaf.
  const shadowOnly = keep(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  const crownGeo = keep(new THREE.IcosahedronGeometry(1, 1));
  // Plot-local crown boxes (known before trees are built), used by the falling-leaf particles.
  const crowns = forest.boxes.map((b, cluster) => ({ cluster, box: new THREE.Box3(new THREE.Vector3(b.min.x, b.min.y, b.min.z), new THREE.Vector3(b.max.x, b.max.y, b.max.z)) }));

  // ---------- Leaves: one instanced mesh per tree, swaying, fading via uFade ----------
  const fade = { value: 1 }, sink = { value: 0 };
  const alphaMap = keep(loadTexture(FOLIAGE_TEXTURE_URL, false));
  // Two-tone foliage (after Bruno's Foliage.js): colour = mix(darkest, lightest colour) by how much
  // the crown normal faces the sun; instance colours only add a small brightness variation.
  function leafMaterialFor(tones) {
    const material = keep(new THREE.MeshLambertMaterial({ alphaMap, alphaTest: LEAF_THRESHOLD, side: THREE.DoubleSide }));
    material.onBeforeCompile = (shader) => {
      // Crowns lean downwind with the gusts; the sprite UV turns with the gust strength, so the
      // small leaves inside each clump shimmer (Bruno rotates the foliage UV the same way).
      addSway(shader, `
        float h = clamp(seed.y / 10.0, 0.0, 1.0);
        mvPosition.xz += windHere * 0.35 * h;
        mvPosition.y += sin(uTime * 3.3 + seed.x * 2.1 + seed.z * 1.7) * 0.025;
        vLeafSpin = length(windHere) * 2.2 + seed.x * 0.37 + seed.z * 0.51;
        vLeafRand = fract(sin(dot(seed.xz, vec2(12.9898, 78.233)) + seed.y) * 43758.5453);
        mvPosition.y = mix(mvPosition.y, -1.2 + position.y * 0.1, uSink);`);
      shader.uniforms.uSink = sink;
      shader.uniforms.uSunDir = { value: SUN_DIR };
      shader.uniforms.uLeafA = { value: new THREE.Color(tones[0]) };
      shader.uniforms.uLeafB = { value: new THREE.Color(tones[tones.length - 1]) };
      // Lighting uses the crown normal (aCrown), not the quad's own orientation: leaves keep random
      // orientations (no edge-on slivers on the silhouette) while the crown shades like one mass.
      shader.vertexShader = 'uniform float uSink;\nuniform vec3 uSunDir;\nattribute float aFiller;\nattribute vec3 aCrown;\nvarying float vFiller, vLeafSpin, vLeafLight, vLeafRand, vViewDepth;\n' + shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFiller = aFiller;\nvLeafLight = smoothstep(0.0, 1.0, dot(normalize(aCrown), uSunDir));')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvViewDepth = -mvPosition.z;')
        .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\ntransformedNormal = normalize(normalMatrix * aCrown);');
      // Opacity is applied AFTER the cutout test, so the leaf shape stays while it fades.
      // Filler leaves drop out leaf by leaf as fillerFade falls (stays opaque, keeps depth writes).
      shader.uniforms.uFade = fade;
      shader.uniforms.uFillerFade = fillerFade;
      shader.uniforms.uSeeThrough = seeThrough;
      shader.fragmentShader = `uniform float uFade, uFillerFade, uSeeThrough;\nuniform vec3 uLeafA, uLeafB;\nvarying float vFiller, vLeafSpin, vLeafLight, vLeafRand, vViewDepth;\n` + shader.fragmentShader
        .replace('#include <alphamap_fragment>', `
          vec2 leafUv = vAlphaMapUv - 0.5;
          float cs = cos(vLeafSpin), sn = sin(vLeafSpin);
          leafUv = vec2(cs * leafUv.x - sn * leafUv.y, sn * leafUv.x + cs * leafUv.y) + 0.5;
          diffuseColor.a *= texture2D(alphaMap, leafUv).r;`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(uLeafA, uLeafB, vLeafLight);')
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          // Whole leaves drop out one by one (random threshold per leaf), no screen-door dots.
          if (vFiller > 0.5 && vLeafRand >= uFillerFade) discard;
          if (vViewDepth < uSeeThrough - 0.4 - vLeafRand) discard;
          diffuseColor.a *= uFade;`)
        // Both faces of a leaf take the crown normal (no back-face flip).
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    return material;
  }
  const leafMaterials = tonesByKind.map(leafMaterialFor);
  const leafGeo = keep(new THREE.PlaneGeometry(LEAF_SIZE, LEAF_SIZE));

  // ---------- Trees: planned up front, built on demand ----------
  const trees = forest.roots.map((root, i) => {
    const b = forest.boxes[i];
    // Bounds cover the 1.2x pop overshoot around the root.
    const box = new THREE.Box3(
      new THREE.Vector3(root.x + (b.min.x - root.x) * 1.2, -0.5, root.z + (b.min.z - root.z) * 1.2),
      new THREE.Vector3(root.x + (b.max.x - root.x) * 1.2, b.max.y * 1.2 + 1, root.z + (b.max.z - root.z) * 1.2));
    return { root, kind: forest.crowns[i].kind, bounds: box.getBoundingSphere(new THREE.Sphere()), time: 0, active: false, built: null, dirty: true };
  });
  function buildTree(i) {
    const t = trees[i], data = forest.build(i);
    const trunk = new THREE.Mesh(branchGeometry({ nodes: data.nodes }, i, t.root), bark);
    trunk.position.set(t.root.x, 0, t.root.z);
    trunk.castShadow = trunk.receiveShadow = true;
    const b = forest.boxes[i];
    const proxy = new THREE.Mesh(crownGeo, shadowOnly);
    proxy.position.set((b.min.x + b.max.x) / 2 - t.root.x, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2 - t.root.z);
    proxy.scale.set((b.max.x - b.min.x) * 0.36, (b.max.y - b.min.y) * 0.42, (b.max.z - b.min.z) * 0.36);
    proxy.castShadow = true;
    trunk.add(proxy);
    // Per-tree copy of the 4-vertex quad carrying per-leaf filler flag and crown normal.
    const entries = data.leaves;
    const geometry = leafGeo.clone();
    geometry.setAttribute('aFiller', new THREE.InstancedBufferAttribute(Float32Array.from(entries, (l) => (l.filler ? 1 : 0)), 1));
    geometry.setAttribute('aCrown', new THREE.InstancedBufferAttribute(Float32Array.from(entries.flatMap((l) => [l.nx, l.ny, l.nz])), 3));
    const leaves = new THREE.InstancedMesh(geometry, leafMaterials[t.kind], entries.length);
    leaves.receiveShadow = true;
    entries.forEach((leaf, k) => leaves.setColorAt(k, color.setScalar(0.9 + leaf.shade * 0.2)));
    leaves.boundingSphere = t.bounds.clone();
    // Built after this frame's tree updates: hidden until the next tick has posed it at its growth
    // time (scale 0), otherwise it flashes for one frame at full size with unplaced leaves.
    trunk.visible = leaves.visible = false;
    group.add(trunk, leaves);
    // Random spin in the leaf plane, tilt up to ~72 degrees from flat, random heading.
    const rotations = entries.map((l) => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + l.tilt, l.yaw, l.shade * 6.28, 'YXZ')));
    t.built = { trunk, leaves, entries, rotations };
    t.dirty = true;
  }
  function freeTree(i) {
    const { trunk, leaves } = trees[i].built;
    group.remove(trunk, leaves);
    trunk.geometry.dispose(); leaves.geometry.dispose(); leaves.dispose();
    trees[i].built = null;
  }
  function updateTree(i) {
    const t = trees[i], { trunk: trunkMesh, leaves, entries, rotations } = t.built, root = t.root;
    const trunk = pop((t.time - root.delay) / 0.65);
    trunkMesh.scale.setScalar(trunk.scale);
    trunkMesh.position.y = trunk.lift;
    const p = pop((t.time - root.delay - 0.7) / 0.65);
    entries.forEach((leaf, k) => {
      position.set(root.x + (leaf.x - root.x) * trunk.scale, leaf.y * trunk.scale + trunk.lift + p.lift, root.z + (leaf.z - root.z) * trunk.scale);
      leaves.setMatrixAt(k, matrix.compose(position, rotations[k], scale.setScalar(p.scale * trunk.scale * (leaf.filler ? FILLER_SCALE : 1))));
    });
    leaves.instanceMatrix.needsUpdate = true;
    t.dirty = false;
  }

  // ---------- Floor: organic patch of stone tiles (rounded, noisy outline) ----------
  // Same parity as the mask so mask cells land exactly on tile centres.
  const cols = mask.w + 2 * MARGIN, rows = mask.h + 2 * MARGIN;
  const col0 = MARGIN, row0 = MARGIN;
  const inkAt = (c, r) => { const mc = c - col0, mr = r - row0; return mc >= 0 && mr >= 0 && mc < mask.w && mr < mask.h && mask.cells[mr * mask.w + mc]; };
  const kindAt = (c, r) => (mask.kind ? mask.kind[(r - row0) * mask.w + (c - col0)] : 0);
  // Square (Chebyshev) dilation of the ink: cells within d of any ink cell.
  const dilate = (d) => {
    const row = new Uint8Array(cols * rows), out = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      for (let k = -d; k <= d && !row[r * cols + c]; k++) if (inkAt(c + k, r)) row[r * cols + c] = 1;
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      for (let k = -d; k <= d && !out[r * cols + c]; k++) if (r + k >= 0 && r + k < rows && row[(r + k) * cols + c]) out[r * cols + c] = 1;
    }
    return out;
  };
  const paved = dilate(PAVED), solid = dilate(SOLID);
  // 1. Organic outline.
  const inside = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c - (cols - 1) / 2, z = r - (rows - 1) / 2;
    const nx = x / (cols / 2), nz = z / (rows / 2), a = Math.atan2(nz, nx);
    const wobble = 1 + 0.1 * Math.sin(a * 5 + seed) + 0.05 * Math.sin(a * 11 + seed * 2);
    if (paved[r * cols + c] || (nx ** 4 + nz ** 4) * wobble <= 1) inside[r * cols + c] = 1;
  }
  // 1b. Walkways (the plot's side paths): a ring with rounded corners around the text block,
  //     rungs along the wider gaps between lines, and a wide spur from the ring corner facing the
  //     plaza (`toward`) out through the patch edge, where the main park path arrives (`entry`).
  //     The cells are only protected from erosion here; park.js draws the walkways as smooth
  //     curbed paths (main path style, orange paving) from `walkways` (plot-local layout).
  const walk = new Uint8Array(cols * rows);
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (inkAt(c, r)) { minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
  }
  const mark = (c, r) => { if (c >= 0 && r >= 0 && c < cols && r < rows && !inkAt(c, r)) walk[r * cols + c] = 1; };
  let entry = null, spurFrom = null;
  const toLocal = (c, r) => ({ x: c - (cols - 1) / 2, z: r - (rows - 1) / 2 });
  const rungs = [];
  if (toward && minC <= maxC) {
    const dx = toward[0] / Math.SQRT2, dz = toward[1] / Math.SQRT2, mid = (WALK.ring[0] + WALK.ring[1]) / 2;
    const c0 = (toward[0] < 0 ? minC : maxC) + dx * mid, r0 = (toward[1] < 0 ? minR : maxR) + dz * mid;
    spurFrom = toLocal(c0, r0);
    for (let t = 0; t < cols + rows; t += 0.5) {
      const pc = c0 + dx * t, pr = r0 + dz * t, rc = Math.round(pc), rr = Math.round(pr);
      if (t > 1 && !(rc >= 0 && rr >= 0 && rc < cols && rr < rows && inside[rr * cols + rc])) {
        entry = { x: pc + dx * 1.8 - (cols - 1) / 2, z: pr + dz * 1.8 - (rows - 1) / 2 };
        break;
      }
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (Math.hypot(rc + i - pc, rr + j - pr) <= WALK.spur / 2) mark(rc + i, rr + j);
    }
  }
  if (minC <= maxC) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const d = Math.hypot(Math.max(minC - c, 0, c - maxC), Math.max(minR - r, 0, r - maxR));
      if (d >= WALK.ring[0] && d < WALK.ring[1]) mark(c, r);
      if (d < WALK.ring[1]) inside[r * cols + c] = 1; // the floor fills the whole walkway frame
    }
    let run = 0;
    for (let r = minR; r <= maxR + 1; r++) {
      let empty = r <= maxR;
      for (let c = minC; c <= maxC && empty; c++) if (inkAt(c, r)) empty = false;
      if (empty) { run++; continue; }
      if (run >= WALK.gap) {
        const width = run >= 4 ? 2 : 1, top = r - run + Math.floor((run - width) / 2);
        for (let rr = top; rr < top + width; rr++) for (let c = minC - WALK.ring[0]; c <= maxC + WALK.ring[0]; c++) mark(c, rr);
        rungs.push({ z: toLocal(0, top + (width - 1) / 2).z, half: width / 2 + 0.25 });
      }
      run = 0;
    }
  }
  for (let i = 0; i < walk.length; i++) if (walk[i]) inside[i] = 1;
  // Walkway layout for park.js (plot-local metres): ring = centre line round the text box at
  // `offset`, rungs = horizontal paths across it, spur = from the ring corner to the entry.
  const walkways = minC <= maxC ? {
    box: { x0: toLocal(minC, 0).x, x1: toLocal(maxC, 0).x, z0: toLocal(0, minR).z, z1: toLocal(0, maxR).z },
    offset: (WALK.ring[0] + WALK.ring[1]) / 2 - 0.5, ringHalf: (WALK.ring[1] - WALK.ring[0]) / 2 + 0.1,
    rungs, spur: entry && spurFrom ? { from: spurFrom, to: entry, half: WALK.spur / 2 } : null,
  } : null;
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
  const floorCells = [], chips = [], voxelCells = [], floorKeys = new Set();
  const rooted = new Uint8Array(cols * rows), rootChipCells = [], rootTileCells = [];
  if (rootChips) for (const root of forest.roots) {
    const reach = root.radius + ROOT_CHIPS, c0 = Math.round(root.x + (cols - 1) / 2), r0 = Math.round(root.z + (rows - 1) / 2);
    for (let r = r0 - 3; r <= r0 + 3; r++) for (let c = c0 - 3; c <= c0 + 3; c++) {
      if (c >= 0 && r >= 0 && c < cols && r < rows && Math.hypot(c - (cols - 1) / 2 - root.x, r - (rows - 1) / 2 - root.z) < reach) rooted[r * cols + c] = 1;
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!inside[r * cols + c]) continue;
    const x = c - (cols - 1) / 2, z = r - (rows - 1) / 2, rnd = hash(x + seed, z), rnd2 = hash(z - seed, x * 1.3);
    const ink = inkAt(c, r), e = edge[r * cols + c];
    const onWalk = walk[r * cols + c] === 1;
    const protectedCell = solid[r * cols + c] === 1 || onWalk;
    const wear = protectedCell || e > 4 ? 0 : 1 - KEEP[e];
    if (rooted[r * cols + c] && !onWalk) {
      // Round a trunk: broken tiles on soil on foot (lawn shows, grass grows); in the minimap the
      // cell shows a whole tile (rootTiles), so the text reads cleanly. The text voxel stays.
      if (rnd < 0.7) rootChipCells.push({ x: x + (rnd - 0.5) * 0.5, z: z + (rnd2 - 0.5) * 0.5, rnd, size: 0.3 + rnd2 * 0.35, chip: true });
      rootTileCells.push({ x, z, ink, rnd, wear: 0, chip: false });
      if (ink) voxelCells.push({ x, z, kind: kindAt(c, r) });
      continue;
    }
    if (rnd2 < wear) {
      if (rnd < 0.55) chips.push({ x: x + (rnd - 0.5) * 0.5, z: z + (rnd2 - 0.5) * 0.5, rnd, size: 0.25 + rnd * 0.3 });
      continue; // lawn shows through; grass grows here
    }
    floorCells.push({ x, z, ink, rnd, wear, walk: onWalk });
    floorKeys.add(`${x},${z}`);
    if (ink) voxelCells.push({ x, z, kind: kindAt(c, r) });
  }
  // Split instances into CHUNK x CHUNK cell meshes (frustum culling per chunk).
  const chunked = (items, makeMesh) => {
    const byKey = new Map();
    for (const item of items) {
      const k = `${Math.floor(item.x / CHUNK)},${Math.floor(item.z / CHUNK)}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(item);
    }
    return [...byKey.values()].map((list) => { const mesh = makeMesh(list); mesh.computeBoundingSphere(); group.add(mesh); return mesh; });
  };
  const tileGeo = keep(new THREE.BoxGeometry(0.98, 0.1, 0.98));
  const tileMaterial = keep(makeTileMaterial());

  const tileMesh = (list) => {
    const tiles = new THREE.InstancedMesh(tileGeo, tileMaterial, list.length);
    list.forEach((cell, i) => {
      if (cell.chip) {
        rotation.setFromEuler(new THREE.Euler(0, cell.rnd * 6.28, 0));
        tiles.setMatrixAt(i, matrix.compose(position.set(cell.x, -0.01, cell.z), rotation, scale.set(cell.size, 0.8, cell.size * 0.8)));
        tiles.setColorAt(i, color.setHex(pick(PALETTE.tile, cell.rnd)).lerp(WORN, 0.4));
        return;
      }
      const w = cell.wear;
      rotation.setFromEuler(new THREE.Euler((cell.rnd - 0.5) * 0.12 * w, (cell.rnd - 0.5) * 0.5 * w, 0));
      tiles.setMatrixAt(i, matrix.compose(position.set(cell.x, 0.01 + cell.rnd * 0.025 - w * 0.03, cell.z), rotation, scale.set(1 - w * 0.25, 1, 1 - w * 0.2)));
      tiles.setColorAt(i, color.setHex(pick(cell.ink ? PALETTE.tileInk : PALETTE.tile, cell.rnd)).lerp(WORN, w * 0.5));
    });
    tiles.receiveShadow = true;
    return tiles;
  };
  const tileMeshes = chunked([...floorCells.map((cell) => ({ ...cell, chip: false })), ...chips.map((chip) => ({ ...chip, chip: true }))], tileMesh);
  // Root rings: chips on foot, whole tiles in the minimap (swapped in setFlat).
  const rootChipMeshes = chunked(rootChipCells, tileMesh), rootTileMeshes = chunked(rootTileCells, tileMesh);
  for (const m of rootTileMeshes) m.visible = false;

  // ---------- Voxel text: rises from the floor in the top view, replaces the leaves ----------
  const rise = { value: 0 }, voxelFade = { value: 1 };
  // Opaque blocks as thick as a leaf layer; they fade in with an ordered dither (screen-door:
  // depth-correct, no transparency sorting, so overlapping blocks never ghost). uRise (0..1, from setFlat) drives a pop wave: each
  // block waits by its distance to mapCenter, then springs up with a back-out overshoot.
  const voxelMaterial = keep(new THREE.MeshLambertMaterial());
  voxelMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uRise = rise;
    shader.uniforms.uFill = mapFill;
    shader.uniforms.uCenter = mapCenter;
    shader.uniforms.uFade = voxelFade;
    shader.fragmentShader = `uniform float uFade;\n${BAYER_GLSL}\n` + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (bayer4(gl_FragCoord.xy) >= uFade) discard;');
    shader.vertexShader = 'uniform float uRise, uFill;\nuniform vec3 uCenter;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 blockAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float delay = clamp(distance(blockAt.xz, uCenter.xz) / ${VOXEL.spread.toFixed(1)}, 0.0, 1.0) * 0.6;
        float t = clamp((uRise - delay) / 0.4, 0.0, 1.0), u = t - 1.0;
        float popY = 1.0 + 2.70158 * u * u * u + 1.70158 * u * u;   // back-out
        // uFill (zoomed far out / baked map): blocks flatten to a thin slab, so the perspective
        // view shows no block sides and matches the straight-down baked image.
        transformed.y *= max(popY, 0.0) * mix(1.0, 0.2, uFill);
        transformed.xz *= mix(1.0, 1.0 / 0.96, uFill) * min(t * 1.6, 1.0);`);
  };
  const voxelGeo = keep(new THREE.BoxGeometry(0.96, VOXEL.height, 0.96).translate(0, VOXEL.height / 2, 0));
  const voxelMeshes = chunked(voxelCells, (list) => {
    const voxels = new THREE.InstancedMesh(voxelGeo, voxelMaterial, list.length);
    // One flat colour per text kind and one height: the minimap text must read cleanly.
    list.forEach((cell, i) => {
      voxels.setMatrixAt(i, matrix.makeTranslation(cell.x, 0.06, cell.z));
      voxels.setColorAt(i, color.setHex(voxelHexByKind[cell.kind]));
    });
    voxels.visible = false;
    voxels.receiveShadow = true;
    return voxels;
  });

  // ---------- Animation ----------
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), worldBounds = new THREE.Sphere();
  const worldRoot = new THREE.Vector3(), queue = [];
  let flat = 0;
  return {
    group, size: { w: cols, h: rows }, floor: floorCells, crowns,
    // Plot-local point just outside the patch where the walkway spur ends (main path joins), or null.
    entry, walkways,
    // Within SOLID cells of the text (plot-local): where the text trees stand (decor keeps off).
    isText: (x, z) => { const c = Math.round(x + (cols - 1) / 2), r = Math.round(z + (rows - 1) / 2); return c >= 0 && r >= 0 && c < cols && r < rows && solid[r * cols + c] === 1; },
    isGrown: (cluster) => !!trees[cluster].built && trees[cluster].time >= forest.maxT && trees[cluster].built.leaves.visible,
    // Local plot coordinates -> is this a stone tile? (grass and props avoid the floor)
    isFloor: (x, z) => floorKeys.has(`${Math.round(x + (cols - 1) / 2) - (cols - 1) / 2},${Math.round(z + (rows - 1) / 2) - (rows - 1) / 2}`),
    // Number of trees currently built (streaming diagnostics).
    builtCount: () => trees.reduce((n, t) => n + (t.built ? 1 : 0), 0),
    // Range activation (hysteresis), streaming build/free, frustum culling and growth.
    tick(dt, observer, pinned, instant = false, camera = null) {
      group.updateMatrixWorld();
      if (camera) {
        projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projection);
      }
      const leavesOn = flat < 0.8, barkOn = flat < 0.3, range = treeSettings.growRange;
      queue.length = 0;
      trees.forEach((t, i) => {
        worldRoot.set(t.root.x, 0, t.root.z).applyMatrix4(group.matrixWorld);
        const distance = Math.hypot(observer.x - worldRoot.x, observer.z - worldRoot.z);
        worldBounds.copy(t.bounds).applyMatrix4(group.matrixWorld);
        const inView = !camera || frustum.intersectsSphere(worldBounds);
        t.active = (pinned && inView) || distance < (t.active ? range + 15 : range);
        // Nothing to show in the flat minimap: do not build there, voxels carry the text.
        if (!t.built) { if (t.active && leavesOn) queue.push([distance, i]); return; }
        const end = t.active ? forest.maxT : 0;
        const next = instant ? end : THREE.MathUtils.clamp(t.time + Math.sign(end - t.time) * dt, 0, forest.maxT);
        if (next !== t.time) { t.time = next; t.dirty = true; }
        if (t.time === 0 && !t.active) { freeTree(i); return; }
        const visible = inView && t.time > 0;
        if (visible && leavesOn && t.dirty) updateTree(i);
        t.built.leaves.visible = visible && leavesOn;
        t.built.trunk.visible = visible && barkOn;
      });
      // Nearest trees first, a few per frame (instant = reduced motion: build everything due).
      queue.sort((a, b) => a[0] - b[0]);
      const budget = instant ? queue.length : treeSettings.buildsPerFrame;
      for (let k = 0; k < Math.min(budget, queue.length); k++) buildTree(queue[k][1]);
    },
    setGrowth(t) { trees.forEach((tree) => { if (tree.built) { tree.time = Math.min(forest.maxT, t); tree.dirty = true; } }); },
    // 0 = 3D trees, 1 = voxel text. Branches go first, leaves fade and thin, voxels rise.
    setFlat(p) {
      flat = p;
      bark.opacity = 1 - smoothstep(p, 0, 0.3);
      bark.transparent = bark.opacity < 1;
      sink.value = smoothstep(p, 0.05, 0.8);
      fade.value = 1 - smoothstep(p, 0.65, 0.8);
      for (const m of leafMaterials) { m.transparent = fade.value < 1; m.depthWrite = fade.value === 1; }
      rise.value = THREE.MathUtils.clamp((p - 0.1) / 0.9, 0, 1);
      for (const v of voxelMeshes) v.visible = rise.value > 0;
      for (const m of rootChipMeshes) m.visible = p < 0.5;
      for (const m of rootTileMeshes) m.visible = p >= 0.5;
      // Voxels fade in (dithered) while the leaves fade out.
      voxelFade.value = smoothstep(p, 0.35, 0.85);
    },
    dispose() {
      trees.forEach((t, i) => { if (t.built) freeTree(i); });
      resources.forEach((r) => r.dispose());
      [...tileMeshes, ...rootChipMeshes, ...rootTileMeshes, ...voxelMeshes].forEach((m) => m.dispose());
    },
  };
}
