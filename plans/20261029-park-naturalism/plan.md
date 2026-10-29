# Park naturalism (Townscaper-inspired)

Status: done, then revised: owner rejected lawn pockets; replaced by ring road + cross axes + spurs into plot walkways (basket-weave bricks), stone trails kept only as shortcuts between spurs and axes
Owner choices: context rules (A), clustered scatter (B), stepping-stone trails into and inside
plots (C, both), soft edges (E); new low-poly props built in code. Townscaper is a reference for
ideas only (no assets / code).

## Phases
1. Lawn pockets inside plots (`tree-mesh.js`): floor cells far from any text (Chebyshev distance
   >= `POCKET.dist`) and deep inside the patch become lawn; pockets smaller than `POCKET.minCells`
   stay paved. Existing border erosion then frays the pocket rims. Pockets exported (plot-local).
   Verify: text / voxel cells unchanged, minimap shows grass pockets only in roomy plots.
2. Stepping-stone trails (`park.js`): plaza edge -> each plot entrance (curved, stones skip
   tiles), plus one trail across each pocket along its long axis. Stones: flat irregular slabs,
   no colliders, grass avoids them. Verify: walk plaza -> plot, screenshots.
3. New props + clustered scatter (`park.js`): fern, mushroom, small rock, wildflower clump, stump,
   log, reed tuft. Cluster centres by Poisson-disk sampling, density from a noise field and from
   proximity to features; members fall off around the centre. Bushes use the same scatter.
4. Context rules (`park.js`): lawn next to tiles -> flower / rock edge band; edge trees -> ferns +
   mushrooms at the base; outer side of lodge-path bends -> bench; trail start -> lamp; lodge
   corners -> bush; shore band -> reeds.
5. Soft edges: grass tufts allowed up to the curb and around stepping stones (short blades).
6. Verify in Chrome (walk + minimap, no JS errors, tests pass), update feature doc + guide.

## Acceptance
- No JS errors; tree tests pass; map bake still matches the live view.
- Text readable in the minimap; voxel text unchanged.
- Draw calls: new props are instanced (one batch per prop type).

## Risks
- Pockets change the plot silhouette in the minimap (owner accepted).
- Large island (R ~570 m): scatter density must fall off away from the park to stay cheap.
