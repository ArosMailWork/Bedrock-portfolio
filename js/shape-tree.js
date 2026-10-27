// Mask-driven park trees. World units: one text-mask cell = one unit; image row zero faces -z.
// Leaves always stay within 0.30 units (x/z) of an ink cell, so the canopy projects onto the
// text from above. Trunks/branches are free: roots are scattered off the text rows.
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

// Lloyd iterations from given seeds; returns non-empty { center, points } groups.
function cluster(points, seeds, iterations = 3) {
  const centers = seeds.map((p) => ({ x: p.x, z: p.z }));
  let groups = [];
  for (let it = 0; it < iterations; it++) {
    groups = centers.map(() => []);
    for (const p of points) {
      let best = 0, bestD = Infinity;
      centers.forEach((c, i) => { const d = dist2(c, p); if (d < bestD) { bestD = d; best = i; } });
      groups[best].push(p);
    }
    centers.forEach((c, i) => {
      const g = groups[i];
      if (!g.length) return;
      c.x = g.reduce((s, p) => s + p.x, 0) / g.length;
      c.z = g.reduce((s, p) => s + p.z, 0) / g.length;
    });
  }
  return groups.map((points, i) => ({ center: centers[i], points })).filter((g) => g.points.length);
}

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

export function growTree(mask, { seed = 1, leavesPerCell = 18, spacing = 6.5 } = {}) {
  const rand = mulberry32(seed);
  const cells = [], nodes = [], leaves = [], roots = [];
  for (let row = 0; row < mask.h; row++) for (let col = 0; col < mask.w; col++) {
    if (mask.cells[row * mask.w + col]) cells.push({ x: col - (mask.w - 1) / 2, z: row - (mask.h - 1) / 2 });
  }
  if (!cells.length) return { nodes, leaves, cells, roots, maxT: 2.3, height: 0 };

  // 1. Poisson-disk crown centres over the ink (shuffled dart throwing), relaxed by Lloyd.
  const shuffled = cells.map((c) => [rand(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  const seeds = [];
  for (const c of shuffled) if (seeds.every((s) => dist2(s, c) >= spacing * spacing)) seeds.push(c);
  const crowns = cluster(cells, seeds, 2);

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
    const ra = rand() * Math.PI * 2, ro = 0.6 + rand() * 1.6;
    const root = { x: c.x + Math.cos(ra) * ro, z: c.z + Math.sin(ra) * ro, delay: rand() * 0.25 };
    roots.push(root);
    const trunkH = (3.6 + rand() * 1.0) * size;
    const top = (9 + rand() * 1.6) * size;
    const base = trunkH + 0.8;
    const R0 = (0.34 + rand() * 0.1) * size;
    // Mostly straight; some trunks curve gently.
    const bend = rand() < 0.6 ? rand() * 0.12 : 0.12 + rand() * 0.25;

    const start = nodes.length;
    nodes.push({ x: root.x, y: 0, z: root.z, radius: R0 * 1.15, parent: -1, cluster: tree, primary: false });
    const fork = { x: lerp(root.x, c.x, 0.75), y: trunkH, z: lerp(root.z, c.z, 0.75) };
    chain(start, fork, 6, R0, R0 * 0.72, bend, tree);
    const trunkNodes = Array.from({ length: 3 }, (_, i) => start + 4 + i); // upper third of trunk

    // 2. Main limbs -> sub-branches -> twigs, each heading to its share of the crown cells.
    const limbs = cluster(pts, spreadSeeds(pts, Math.min(5, Math.max(2, Math.ceil(pts.length / 14))), rand));
    for (const limb of limbs) {
      const from = trunkNodes[Math.floor(rand() * trunkNodes.length)];
      const f = nodes[from];
      const limbEnd = {
        x: lerp(f.x, limb.center.x, 0.6), z: lerp(f.z, limb.center.z, 0.6),
        y: trunkH + (top - trunkH) * (0.36 + rand() * 0.12),
      };
      const limbTip = chain(from, limbEnd, 4, R0 * 0.62, R0 * 0.4, 0.2, tree);
      const subs = cluster(limb.points, spreadSeeds(limb.points, Math.min(3, Math.ceil(limb.points.length / 6)), rand));
      for (const sub of subs) {
        const l = nodes[limbTip];
        const subEnd = {
          x: lerp(l.x, sub.center.x, 0.8), z: lerp(l.z, sub.center.z, 0.8),
          y: l.y + (top - l.y) * (0.42 + rand() * 0.2),
        };
        const subTip = chain(limbTip, subEnd, 3, R0 * 0.36, R0 * 0.22, 0.12, tree);
        for (const cell of spreadSeeds(sub.points, Math.min(3, sub.points.length), rand)) {
          const s = nodes[subTip];
          chain(subTip, { x: cell.x, y: s.y + 0.3 + rand() * 0.6, z: cell.z }, 2, 0.08, 0.05, 0.05, tree);
        }
      }
    }

    // 3. Leaves: a dome over the crown, grouped in three clumps per cell (gaps show branches).
    for (const cell of pts) {
      const d = Math.sqrt(dist2(cell, c)) / spread;
      const yTop = top - d * d * (top - base) * 0.5;
      const yLow = base + d * (yTop - base) * 0.35;
      const perClump = Math.ceil(leavesPerCell / 3);
      for (let k = 0; k < 3; k++) {
        const yc = yLow + (yTop - yLow) * ((k + 0.2 + rand() * 0.6) / 3);
        for (let i = 0; i < perClump && k * perClump + i < leavesPerCell; i++) {
          const a = rand() * Math.PI * 2;
          leaves.push({
            x: cell.x + Math.cos(a) * 0.24 + (rand() - 0.5) * 0.12,
            y: yc + (rand() - 0.5) * 0.7,
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
