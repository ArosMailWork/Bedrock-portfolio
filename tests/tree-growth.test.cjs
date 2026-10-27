// Run: node tests/tree-growth.test.cjs
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../js/shape-tree.js'), 'utf8');
  const { growTree } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let count = 0;
  for (let seed = 1; seed <= 80; seed++) {
    for (const mode of ['dense', 'sparse', 'single', 'empty']) {
      const w = 31, h = 17;
      const cells = Uint8Array.from({ length: w * h }, (_, i) => Number(mode === 'dense' ? (i * 17 + seed) % 7 < 4 : mode === 'sparse' ? i % 47 === 0 : mode === 'single' ? i === 200 : false));
      const tree = growTree({ w, h, cells }, { seed });
      assert.deepEqual(tree, growTree({ w, h, cells }, { seed }));
      assert.equal(tree.cells.length, cells.reduce((sum, value) => sum + value, 0), 'Canopy must not add text cells');
      for (const leaf of tree.leaves) {
        const col = Math.round(leaf.cell.x + (w - 1) / 2), row = Math.round(leaf.cell.z + (h - 1) / 2);
        assert.equal(Boolean(cells[row * w + col]), !leaf.cell.canopyOnly);
      }
      if (mode === 'single') {
        const sparse = tree.leaves.filter((leaf) => leaf.cell.canopyOnly);
        assert.ok(sparse.length > 0, 'Empty space should have sparse canopy');
        const counts = new Map();
        sparse.forEach((leaf) => counts.set(leaf.cell, (counts.get(leaf.cell) || 0) + 1));
        assert.ok([...counts.values()].every((count) => count === 6));
      }
      tree.nodes.forEach((n, i) => {
        assert.ok(n.parent < i);
        if (n.parent >= 0) assert.ok(n.y >= tree.nodes[n.parent].y, `Descending branch: ${seed}/${mode}`);
        assert.ok(Number.isFinite(n.x + n.y + n.z));
        const root = tree.roots[n.cluster];
        assert.ok(Math.hypot(n.x - root.x, n.z - root.z) < 3.8, 'Branch exceeds its local crown');
        if (!tree.nodes.some((child) => child.parent === i)) {
          assert.ok(tree.leaves.some((leaf) => leaf.cluster === n.cluster && Math.hypot(leaf.x - n.x, leaf.y - n.y, leaf.z - n.z) < 0.6), 'Bare branch tip');
        }
      });
      count++;
    }
  }
  console.log(`${count} cases passed: rising branches, valid parents, deterministic generation.`);
})();
