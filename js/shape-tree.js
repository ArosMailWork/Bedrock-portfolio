// Mask-driven park trees. World units: one text-mask cell = one unit; image row zero faces -z.
// Leaves come first: every crown is an oak-shaped dome filled with leaves. Leaves above ink
// cells are the readable "core"; leaves above empty cells are sparse "fillers" that complete the
// silhouette for the walking camera and fade out when looking down (tree-mesh.js). Branches are
// then derived backwards: leaf clumps -> twigs -> limbs -> trunk, with pipe-model thickness.
// Only ink cells feed `cells` / the voxel text.
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
const dist3 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
const mean = (points) => {
  const m = { x: 0, y: 0, z: 0 };
  for (const p of points) { m.x += p.x; m.y += p.y; m.z += p.z; }
  return { x: m.x / points.length, y: m.y / points.length, z: m.z / points.length };
};

// k-means with farthest-point seeds: groups nearby points (3D) into at most k clumps.
function clusterPoints(points, k, rand) {
  if (points.length <= k) return points.map((p) => [p]);
  const centers = [points[Math.floor(rand() * points.length)]];
  const nearest = points.map((p) => dist3(p, centers[0]));
  while (centers.length < k) {
    let best = 0;
    nearest.forEach((d, i) => { if (d > nearest[best]) best = i; });
    centers.push(points[best]);
    points.forEach((p, i) => { nearest[i] = Math.min(nearest[i], dist3(p, points[best])); });
  }
  let groups = [];
  for (let iteration = 0; iteration < 5; iteration++) {
    groups = centers.map(() => []);
    for (const p of points) {
      let best = 0;
      centers.forEach((c, i) => { if (dist3(p, c) < dist3(p, centers[best])) best = i; });
      groups[best].push(p);
    }
    groups.forEach((g, i) => { if (g.length) centers[i] = mean(g); });
  }
  return groups.filter((g) => g.length);
}

// Shape tunables (see docs/customization-guide.md). Crown proportions were measured on a
// reference photo of a free-standing oak: crown = 81% of the tree height, crown width = 1.35 x
// crown height, widest at 65% of the crown height from the top, flat underside, lumpy surface.
export const TREE_SHAPE = {
  crownRadius: [3.6, 4.7],  // horizontal crown radius: crown spread + 0.5, clamped (m); max >= spacing + 0.5
  aspect: 1.35,             // crown width / crown height
  widest: 0.65,             // widest point, as a share of the crown height from the top
  clearTrunk: [2.8, 3.3],   // bare trunk below the crown (m); keeps the walking camera out of leaves
  bumps: 0.14,              // cauliflower clumps on the crown top, share of the upper crown height
  shell: 0.28,              // leaves live in the outer 28% of the crown (its inside is never seen)
  leavesPerTwig: 12,        // leaves gathered by one twig
  limbs: 5,                 // main limbs per tree (upper bound)
  pull: 0.45,               // how far each parent level moves from its children towards the fork
};

// Two stages, so big plots can stream: planForest() decides every crown up front (cheap: centre,
// dome, root, trunk radius) and returns build(i), which grows one tree's leaves and branches on
// demand with its own seeded random stream (the same tree every time it is rebuilt).
export function planForest(mask, { seed = 1, leavesPerCell = 18, spacing = 4.2, fillerDensity = 0.15 } = {}) {
  const rand = mulberry32(seed);
  const S = TREE_SHAPE;
  const cells = [], crowns = [];
  for (let row = 0; row < mask.h; row++) for (let col = 0; col < mask.w; col++) {
    if (mask.cells[row * mask.w + col]) cells.push({ x: col - (mask.w - 1) / 2, z: row - (mask.h - 1) / 2 });
  }
  const kindAt = (x, z) => (mask.kind ? mask.kind[Math.round(z + (mask.h - 1) / 2) * mask.w + Math.round(x + (mask.w - 1) / 2)] : 0);
  const inkAt = (x, z) => {
    const col = Math.round(x + (mask.w - 1) / 2), row = Math.round(z + (mask.h - 1) / 2);
    return col >= 0 && row >= 0 && col < mask.w && row < mask.h && mask.cells[row * mask.w + col] === 1;
  };

  // 1. Crown centres: shuffled dart throwing over the ink, every ink cell within `spacing` of a
  //    centre. A spatial hash keeps this linear for page-sized masks.
  const shuffled = cells.map((c) => [rand(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  const buckets = new Map();
  for (const cell of shuffled) {
    let crown = null;
    const bx = Math.floor(cell.x / spacing), bz = Math.floor(cell.z / spacing);
    for (let i = -1; i <= 1 && !crown; i++) for (let j = -1; j <= 1 && !crown; j++) {
      crown = (buckets.get((bx + i) + ',' + (bz + j)) || []).find((c) => dist2(cell, c.center) <= spacing ** 2) || null;
    }
    if (!crown) {
      crown = { center: cell, points: [] };
      crowns.push(crown);
      const k = bx + ',' + bz;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(crown);
    }
    crown.points.push(cell);
  }

  // 2. Crown domes. A column (cell x/z) inside a crown spans [bottom, top]: elliptic top half,
  //    flat superellipse (power 4) underside, wobbly rim and cauliflower bumps on top.
  const roots = crowns.map((crown) => {
    const c = crown.center;
    const spread = Math.sqrt(Math.max(...crown.points.map((p) => dist2(p, c))));
    crown.radius = Math.min(S.crownRadius[1], Math.max(S.crownRadius[0], spread + 0.5));
    crown.size = crown.radius / 4;
    const height = (2 * crown.radius) / S.aspect;
    crown.up = height * S.widest;
    crown.down = height - crown.up;
    crown.mid = lerp(S.clearTrunk[0], S.clearTrunk[1], rand()) + crown.down; // widest point
    crown.phase = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
    crown.R0 = (0.3 + rand() * 0.08) * crown.size;
    crown.kind = kindAt(c.x, c.z);
    crown.points = null;
    // Root sits off the crown centre, so trunks do not line up along text rows.
    const ra = rand() * Math.PI * 2, ro = 0.2 + rand() * 0.4;
    return { x: c.x + Math.cos(ra) * ro, z: c.z + Math.sin(ra) * ro, delay: rand() * 0.25, radius: crown.R0 * 1.45 };
  });
  const column = (crown, x, z) => {
    const [p0, p1, p2, p3] = crown.phase;
    const a = Math.atan2(z - crown.center.z, x - crown.center.x);
    // Rim only bulges outwards (1..1.18 x radius), so every ink cell of the crown stays covered.
    const rim = crown.radius * (1 + 0.06 * (1 + Math.sin(3 * a + p0)) + 0.03 * (1 + Math.sin(5 * a + p1)));
    const d = Math.hypot(x - crown.center.x, z - crown.center.z) / rim;
    if (d >= 1) return null;
    const bump = 0.5 + 0.5 * Math.sin(x * 1.25 + p2) * Math.cos(z * 1.1 + p3);
    return {
      top: crown.mid + crown.up * Math.sqrt(1 - d * d) * (1 - S.bumps * (1 - bump)),
      bottom: crown.mid - crown.down * (1 - d ** 4) ** 0.25,
      d,
    };
  };
  const footprint = (crown, visit) => {
    const reach = Math.ceil(crown.radius * 1.2);
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      const x = crown.center.x + i, z = crown.center.z + j, span = column(crown, x, z);
      if (span) visit(x, z, span);
    }
  };
  // Overlapping domes share a column's leaves, so overlaps are not twice as dense.
  const cover = new Map();
  for (const crown of crowns) footprint(crown, (x, z) => { const k = x + ',' + z; cover.set(k, (cover.get(k) || 0) + 1); });
  // Crown bounds (local), known before any tree is built: falling leaves, culling.
  const boxes = crowns.map((crown) => {
    const r = crown.radius * 1.18 + 0.5;
    return {
      min: { x: crown.center.x - r, y: crown.mid - crown.down, z: crown.center.z - r },
      max: { x: crown.center.x + r, y: crown.mid + crown.up, z: crown.center.z + r },
    };
  });

  // One tree: leaves first, then branches derived backwards. Node indices are local (0 = root).
  function build(tree) {
    const crown = crowns[tree], c = crown.center, root = roots[tree], R0 = crown.R0;
    const rand = mulberry32((seed * 7919 + tree * 104729) | 0);
    const nodes = [];
    const hasPrimary = new Set();
    // Chain of `steps` nodes from node `from` towards `to`, bowed sideways by `bend`.
    const chain = (from, to, steps, r0, r1, bend) => {
      const a = nodes[from];
      const d = { x: to.x - a.x, y: to.y - a.y, z: to.z - a.z };
      // Lateral bow stays horizontal so it cannot turn a rising chain downward.
      const side = rand() < 0.5 ? -1 : 1, horizontal = Math.hypot(d.x, d.z);
      const p = horizontal > 1e-6 ? { x: (-d.z / horizontal) * side, z: (d.x / horizontal) * side } : { x: side, z: 0 };
      let parent = from;
      for (let j = 1; j <= steps; j++) {
        const t = j / steps, bow = Math.sin(Math.PI * t) * bend;
        nodes.push({
          x: a.x + d.x * t + p.x * bow, y: a.y + d.y * t, z: a.z + d.z * t + p.z * bow,
          radius: Math.max(0.05, lerp(r0, r1, t)), parent, cluster: tree,
          primary: !hasPrimary.has(parent),
        });
        hasPrimary.add(parent);
        parent = nodes.length - 1;
      }
      return parent;
    };

    // 3. Leaves first: fill the crown column by column. Ink columns get `leavesPerCell` core
    //    leaves, empty ones `fillerDensity` of that as fillers. The inside of a crown is never
    //    seen, so leaves only live in its outer shell (ellipsoidal radius >= 1 - shell; power 4
    //    below the widest point, matching the flat underside). Rim columns also carry the side
    //    walls, so they get up to 2.5x the leaves. Each leaf stores the crown normal at its
    //    position (nx, ny, nz); tree-mesh lights leaves with it, so the crown shades as one mass.
    const own = [];
    const radial = (d, y) => (y > crown.mid ? Math.hypot(d, (y - crown.mid) / crown.up)
      : (d ** 4 + ((crown.mid - y) / crown.down) ** 4) ** 0.25);
    footprint(crown, (x, z, span) => {
      const filler = !inkAt(x, z);
      const wanted = leavesPerCell * (filler ? fillerDensity : 1) * (1 + 1.5 * span.d ** 4) / cover.get(x + ',' + z);
      const count = Math.floor(wanted + rand());
      for (let i = 0; i < count; i++) {
        const lx = x + (rand() - 0.5), lz = z + (rand() - 0.5);
        let y = 0;
        for (let attempt = 0; attempt < 8; attempt++) {
          y = span.bottom + (span.top - span.bottom) * rand();
          if (radial(span.d, y) >= 1 - S.shell) break;
          if (attempt === 7) y = rand() < 0.6 ? span.top - 0.6 * rand() : span.bottom + 0.4 * rand();
        }
        const n = { x: (lx - c.x) / crown.radius, y: (y - crown.mid) / (y > crown.mid ? crown.up : crown.down) + 0.15, z: (lz - c.z) / crown.radius };
        const len = Math.hypot(n.x, n.y, n.z) || 1;
        own.push({
          x: lx, y, z: lz, nx: n.x / len, ny: n.y / len, nz: n.z / len,
          filler, cluster: tree, yaw: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 2.5, shade: rand(),
        });
      }
    });
    if (!own.length) own.push({ x: c.x, y: crown.mid, z: c.z, nx: 0, ny: 1, nz: 0, filler: false, cluster: tree, yaw: 0, tilt: 0, shade: rand() });

    // 4. Branches backwards: leaf clumps -> twig tips -> parent levels -> main limbs -> fork.
    const lowest = Math.min(...own.map((l) => l.y));
    const fork = { x: lerp(root.x, c.x, 0.75), y: Math.min(lowest - 0.6, crown.mid - crown.down), z: lerp(root.z, c.z, 0.75) };
    const towardsFork = (p, amount) => {
      const t = Math.min(1, amount / (Math.sqrt(dist3(p, fork)) || 1));
      return { x: lerp(p.x, fork.x, t), y: lerp(p.y, fork.y, t), z: lerp(p.z, fork.z, t) };
    };
    // Twig tip: just inside the clump leaf nearest the clump centre, so every tip ends in foliage.
    let level = clusterPoints(own, Math.max(1, Math.round(own.length / S.leavesPerTwig)), rand).map((group) => {
      const m = mean(group);
      const anchor = group.reduce((best, l) => (dist3(l, m) < dist3(best, m) ? l : best));
      return { ...towardsFork(anchor, 0.55), weight: group.length, children: [] };
    });
    // Each parent level gathers ~3 children, sits between their centre and the fork, and stays
    // below its lowest child (branches only rise towards the leaves).
    while (level.length > S.limbs) {
      level = clusterPoints(level, Math.max(S.limbs, Math.round(level.length / 3)), rand).map((group) => {
        if (group.length === 1) return group[0];
        const m = mean(group);
        const p = { x: lerp(m.x, fork.x, S.pull), y: lerp(m.y, fork.y, S.pull), z: lerp(m.z, fork.z, S.pull) };
        p.y = Math.min(p.y, Math.min(...group.map((g) => g.y)) - 0.15);
        return { ...p, weight: group.reduce((sum, g) => sum + g.weight, 0), children: group };
      });
    }
    fork.y = Math.max(1.5, Math.min(fork.y, Math.min(...level.map((l) => l.y)) - 0.1));

    // 5. Nodes, parents first. Pipe model: a branch's cross-section is proportional to its leaves.
    const radiusOf = (weight) => Math.max(0.05, R0 * Math.sqrt(weight / own.length));
    const bend = rand() < 0.6 ? rand() * 0.12 : 0.12 + rand() * 0.25; // mostly straight trunks
    // Root flare, buried 0.3 m so the base never shows a gap on uneven tiles / while popping in.
    nodes.push({ x: root.x, y: -0.3, z: root.z, radius: root.radius, parent: -1, cluster: tree, primary: false });
    const forkIndex = chain(0, fork, 6, R0, R0 * 0.85, bend);
    const grow = (from, node) => {
      const length = Math.sqrt(dist3(nodes[from], node)), r = radiusOf(node.weight);
      const end = chain(from, node, Math.min(3, Math.max(1, Math.round(length / 1.2))), r * 1.15, r, 0.06 * length);
      [...node.children].sort((a, b) => b.weight - a.weight).forEach((child) => grow(end, child));
    };
    // Heaviest limb continues the trunk; the others leave from staggered upper trunk nodes.
    [...level].sort((a, b) => b.weight - a.weight).forEach((limb, i) => grow(forkIndex - (i % 3), limb));
    return { nodes, leaves: own };
  }

  return { cells, roots, crowns, boxes, build, maxT: 2.3 };
}

// Whole forest at once (tests, small masks): every tree built, node indices made global.
export function growTree(mask, options = {}) {
  const forest = planForest(mask, options);
  const nodes = [], leaves = [];
  forest.roots.forEach((_, i) => {
    const built = forest.build(i), offset = nodes.length;
    for (const n of built.nodes) nodes.push({ ...n, parent: n.parent < 0 ? -1 : n.parent + offset });
    leaves.push(...built.leaves);
  });
  let height = 0;
  for (const l of leaves) height = Math.max(height, l.y);
  return { nodes, leaves, cells: forest.cells, roots: forest.roots, maxT: forest.maxT, height };
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
