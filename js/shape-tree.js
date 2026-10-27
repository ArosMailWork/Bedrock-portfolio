// Mask-driven park trees. World units: one text-mask cell = one unit; image row zero faces -z.
// Ink cells determine trunks and voxel text. Sparse canopy-only cells soften gaps between letters.
// Canopy-only cells never enter the returned text mask or voxel data.
export function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

// Farthest-point seeds: evenly spread limb directions inside one crown.
function spreadSeeds(points, k, rand) {
  const seeds = [points[Math.floor(rand() * points.length)]];
  while (seeds.length < k) {
    let best = null, bestD = -1;
    for (const p of points) {
      const d = Math.min(...seeds.map((s) => dist2(s, p)));
      if (d > bestD) { bestD = d; best = p; }
    }
    seeds.push(best);
  }
  return seeds;
}

export function growTree(mask, { seed = 1, leavesPerCell = 18, spacing = 3 } = {}) {
  const rand = mulberry32(seed);
  const cells = [], nodes = [], leaves = [], roots = [];
  for (let row = 0; row < mask.h; row++) for (let col = 0; col < mask.w; col++) {
    if (mask.cells[row * mask.w + col]) cells.push({ x: col - (mask.w - 1) / 2, z: row - (mask.h - 1) / 2 });
  }
  if (!cells.length) return { nodes, leaves, cells, roots, maxT: 2.3, height: 0 };

  // 1. Poisson-disk crown centres over the ink (shuffled dart throwing), relaxed by Lloyd.
  const shuffled = cells.map((c) => [rand(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  const crowns = [];
  for (const cell of shuffled) {
    let crown = crowns.find((c) => dist2(cell, c.center) <= Math.min(spacing, 3) ** 2);
    if (!crown) { crown = { center: cell, points: [] }; crowns.push(crown); }
    crown.points.push(cell);
  }

  // Sparse canopy in nearby empty cells, assigned once to the closest existing crown.
  // Keep the original ink cells untouched: only these produce voxel text.
  for (let row = 0; row < mask.h; row++) for (let col = 0; col < mask.w; col++) {
    if (mask.cells[row * mask.w + col]) continue;
    const cell = { x: col - (mask.w - 1) / 2, z: row - (mask.h - 1) / 2, canopyOnly: true };
    let nearest = null, distance = 9;
    for (const crown of crowns) {
      const d = dist2(cell, crown.center);
      if (d < distance) { distance = d; nearest = crown; }
    }
    if (nearest) nearest.points.push(cell);
  }

  const hasPrimary = new Set();
  // Chain of `steps` nodes from node `from` towards `to`, bowed sideways by `bend`.
  const chain = (from, to, steps, r0, r1, bend, tree) => {
    const a = nodes[from];
    const d = { x: to.x - a.x, y: to.y - a.y, z: to.z - a.z };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const n = { x: d.x / len, y: d.y / len, z: d.z / len };
    // Any perpendicular, rotated randomly around the chain direction.
    const ref = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let u = { x: n.y * ref.z - n.z * ref.y, y: n.z * ref.x - n.x * ref.z, z: n.x * ref.y - n.y * ref.x };
    const ul = Math.hypot(u.x, u.y, u.z); u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
    const v = { x: n.y * u.z - n.z * u.y, y: n.z * u.x - n.x * u.z, z: n.x * u.y - n.y * u.x };
    const t0 = rand() * Math.PI * 2;
    const p = { x: u.x * Math.cos(t0) + v.x * Math.sin(t0), y: u.y * Math.cos(t0) + v.y * Math.sin(t0), z: u.z * Math.cos(t0) + v.z * Math.sin(t0) };
    // Keep lateral bow horizontal so it cannot turn a rising chain downward.
    p.y = 0;
    let parent = from;
    for (let j = 1; j <= steps; j++) {
      const t = j / steps, bow = Math.sin(Math.PI * t) * bend;
      nodes.push({
        x: a.x + d.x * t + p.x * bow, y: a.y + d.y * t + p.y * bow, z: a.z + d.z * t + p.z * bow,
        radius: Math.max(0.05, lerp(r0, r1, t)), parent, cluster: tree,
        primary: !hasPrimary.has(parent),
      });
      hasPrimary.add(parent);
      parent = nodes.length - 1;
    }
    return parent;
  };

  for (const crown of crowns) {
    const tree = roots.length;
    const c = crown.center, pts = crown.points;
    const spread = Math.max(1.5, Math.sqrt(Math.max(...pts.map((p) => dist2(p, c)))));
    const size = 0.9 + rand() * 0.35;
    // Root sits off the crown centre, so trunks do not line up along text rows.
    const ra = rand() * Math.PI * 2, ro = 0.2 + rand() * 0.4;
    const root = { x: c.x + Math.cos(ra) * ro, z: c.z + Math.sin(ra) * ro, delay: rand() * 0.25 };
    roots.push(root);
    const trunkH = (3.6 + rand() * 1.0) * size;
    const top = (7.2 + rand() * 1.2) * size;
    const base = trunkH + 0.8;
    const R0 = (0.24 + rand() * 0.07) * size; // slimmer trunks
    // Mostly straight; some trunks curve gently.
    const bend = rand() < 0.6 ? rand() * 0.12 : 0.12 + rand() * 0.25;

    const start = nodes.length;
    nodes.push({ x: root.x, y: 0, z: root.z, radius: R0 * 1.45, parent: -1, cluster: tree, primary: false }); // root flare
    const fork = { x: lerp(root.x, c.x, 0.75), y: trunkH, z: lerp(root.z, c.z, 0.75) };
    chain(start, fork, 6, R0, R0 * 0.62, bend, tree);
    const crownTop = (cell) => {
      const d = Math.sqrt(dist2(cell, c)) / spread;
      const lobe = 0.5 + 0.5 * Math.sin(cell.x * 0.9 + tree * 2.1) * Math.cos(cell.z * 0.8 - tree);
      return top - d * d * (top - base) * 0.5 - lobe * 0.65;
    };
    // Short limbs end inside real leaf cells, never in empty space between letters.
    const tips = new Map();
    const branchCells = spreadSeeds(pts, Math.min(5, pts.length), rand);
    for (const [index, cell] of branchCells.entries()) {
      const end = { x: cell.x, y: crownTop(cell) - 1, z: cell.z };
      // Stagger forks along the upper trunk; the final limb continues its tip.
      const from = start + 3 + Math.round(3 * (index + 1) / branchCells.length);
      const origin = nodes[from];
      const shoulder = { x: lerp(origin.x, end.x, 0.72), y: lerp(origin.y, end.y, 0.35), z: lerp(origin.z, end.z, 0.72) };
      const elbow = chain(from, shoulder, 2, R0 * 0.5, R0 * 0.22, 0.08, tree);
      chain(elbow, end, 2, R0 * 0.22, 0.05, 0.05, tree);
      tips.set(cell, end);
    }

    // 3. Leaves: a dome over the crown, grouped in three clumps per cell (gaps show branches).
    for (const cell of pts) {
      // Rounded, uneven crown lobes instead of three evenly stacked foliage layers.
      const lobe = 0.5 + 0.5 * Math.sin(cell.x * 0.9 + tree * 2.1) * Math.cos(cell.z * 0.8 - tree);
      const yTop = crownTop(cell);
      const yLow = Math.max(base, yTop - 2.4 - lobe * 0.5);
      const count = cell.canopyOnly ? Math.ceil(leavesPerCell / 3) : leavesPerCell;
      const perClump = Math.ceil(count / 3);
      for (let k = 0; k < 3; k++) {
        const yc = yLow + (yTop - yLow) * ((k + 0.2 + rand() * 0.6) / 3);
        for (let i = 0; i < perClump && k * perClump + i < count; i++) {
          const a = rand() * Math.PI * 2;
          leaves.push({
            x: cell.x + Math.cos(a) * 0.24 + (rand() - 0.5) * 0.12,
            y: tips.has(cell) && k === 1 ? tips.get(cell).y + (rand() - 0.5) * 0.4 : yc + (rand() - 0.5) * 0.7,
            z: cell.z + Math.sin(a) * 0.24 + (rand() - 0.5) * 0.12,
            cell, cluster: tree,
            yaw: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 2.5, shade: rand(),
          });
        }
      }
    }
  }
  let height = 0;
  for (const l of leaves) height = Math.max(height, l.y);
  return { nodes, leaves, cells, roots, maxT: 2.3, height };
}

// Exact toon keyframes, shared by whole-tree growth and foliage clusters.
export function pop(t) {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.65) {
    const k = 1 - (1 - t / 0.65) ** 3;
    return { scale: 1.2 * k, lift: 0.5 * k };
  }
  const k = (t - 0.65) / 0.35;
  const e = k * k * (3 - 2 * k);
  return { scale: 1.2 - 0.2 * e, lift: 0.5 * (1 - e) };
}
