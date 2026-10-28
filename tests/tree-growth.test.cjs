// Run: node tests/tree-growth.test.cjs
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../js/shape-tree.js'), 'utf8');
  const { growTree, planForest, TREE_SHAPE } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let count = 0;
  // Streaming: a tree built on demand is identical however often / in whatever order it is built,
  // and its leaves stay inside the crown box planned before building (used for culling).
  {
    const w = 61, h = 33, cells = Uint8Array.from({ length: w * h }, (_, i) => Number((i * 13) % 9 < 4));
    const forest = planForest({ w, h, cells }, { seed: 5 });
    const order = forest.roots.map((_, i) => i).reverse();
    const first = order.map((i) => forest.build(i));
    order.forEach((i, k) => assert.deepEqual(forest.build(i), first[k], 'Rebuilt tree differs'));
    first.forEach((built, k) => {
      const b = forest.boxes[order[k]];
      for (const l of built.leaves) {
        assert.ok(l.x >= b.min.x - 0.6 && l.x <= b.max.x + 0.6 && l.z >= b.min.z - 0.6 && l.z <= b.max.z + 0.6, 'Leaf outside planned box');
      }
    });
  }
  for (let seed = 1; seed <= 80; seed++) {
    for (const mode of ['dense', 'sparse', 'single', 'empty']) {
      const w = 31, h = 17;
      const cells = Uint8Array.from({ length: w * h }, (_, i) => Number(mode === 'dense' ? (i * 17 + seed) % 7 < 4 : mode === 'sparse' ? i % 47 === 0 : mode === 'single' ? i === 200 : false));
      const tree = growTree({ w, h, cells }, { seed });
      assert.deepEqual(tree, growTree({ w, h, cells }, { seed }));
      assert.equal(tree.cells.length, cells.reduce((sum, value) => sum + value, 0), 'Canopy must not add text cells');
      if (mode === 'empty') assert.equal(tree.leaves.length, 0);
      else {
        // Leaves first: every tree has foliage; empty columns hold sparse filler leaves.
        tree.roots.forEach((_, k) => assert.ok(tree.leaves.some((l) => l.cluster === k), 'Tree without leaves'));
        const fillers = tree.leaves.filter((l) => l.filler).length, core = tree.leaves.length - fillers;
        assert.ok(fillers > 0, 'Empty space inside a crown should hold filler leaves');
        if (mode === 'single') assert.ok(core > 0 && core < fillers, 'One ink column, many sparse filler columns');
        // Every core leaf sits above an ink cell; fillers never do.
        for (const leaf of tree.leaves) {
          const col = Math.round(Math.round(leaf.x) + (w - 1) / 2), row = Math.round(Math.round(leaf.z) + (h - 1) / 2);
          const onInk = col >= 0 && row >= 0 && col < w && row < h && cells[row * w + col] === 1;
          if (Math.abs(leaf.x - Math.round(leaf.x)) < 0.49 && Math.abs(leaf.z - Math.round(leaf.z)) < 0.49) assert.equal(onInk, !leaf.filler);
        }
        // Every ink cell is covered by core leaves (the text must read from above).
        for (const cell of tree.cells) {
          assert.ok(tree.leaves.some((l) => !l.filler && Math.abs(l.x - cell.x) <= 0.5 && Math.abs(l.z - cell.z) <= 0.5), 'Ink cell without leaves');
        }
        // Leaves face outwards: a unit normal on every leaf.
        assert.ok(tree.leaves.every((l) => Math.abs(Math.hypot(l.nx, l.ny, l.nz) - 1) < 1e-6));
        // Oak proportions: bare trunk >= clearTrunk minimum, crown height ~ width / aspect.
        tree.roots.forEach((root, k) => {
          const own = tree.leaves.filter((l) => l.cluster === k);
          const low = Math.min(...own.map((l) => l.y)), high = Math.max(...own.map((l) => l.y));
          assert.ok(low >= TREE_SHAPE.clearTrunk[0] - 0.01, `Crown too low: ${low}`);
          const reach = Math.max(...own.map((l) => Math.hypot(l.x - root.x, l.z - root.z)));
          assert.ok(high - low > reach * 2 / TREE_SHAPE.aspect * 0.6, 'Crown too flat for an oak');
        });
      }
      tree.nodes.forEach((n, i) => {
        assert.ok(n.parent < i);
        if (n.parent >= 0) assert.ok(n.y >= tree.nodes[n.parent].y, `Descending branch: ${seed}/${mode}`);
        assert.ok(Number.isFinite(n.x + n.y + n.z + n.radius));
        const root = tree.roots[n.cluster];
        assert.ok(Math.hypot(n.x - root.x, n.z - root.z) < TREE_SHAPE.crownRadius[1] * 1.2 + 0.7, 'Branch exceeds its local crown');
        if (!tree.nodes.some((child) => child.parent === i)) {
          assert.ok(tree.leaves.some((leaf) => leaf.cluster === n.cluster && Math.hypot(leaf.x - n.x, leaf.y - n.y, leaf.z - n.z) < 0.6), 'Bare branch tip');
        }
      });
      // Pipe model: the trunk base is the thickest part of every tree.
      tree.roots.forEach((_, k) => {
        const own = tree.nodes.filter((n) => n.cluster === k);
        assert.equal(own[0].parent, -1);
        assert.ok(own.every((n) => n.radius <= own[0].radius), 'Branch thicker than the root flare');
      });
      count++;
    }
  }
  console.log(`${count} cases passed (+ streaming rebuild check): leaves-first oak crowns, core/filler leaves, rising branches, pipe-model radii, deterministic generation.`);
})();
