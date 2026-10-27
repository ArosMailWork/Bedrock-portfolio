# Portfolio garden

Perspective over-the-shoulder walking camera; aerial portfolio is a separate minimap mode.
Text shapes the tree crowns at generation time. No falling-leaf text assembly.
Inspired by tree.icqr.com. Its bundle is obfuscated WebGPU code: inspection only confirmed
block (with per-tile height buffer), Grass, Branch, flowers, petals and a blur pass. No ICQR
code, textures or algorithms were copied; everything here is a re-implementation.

## Files
- `tree-demo.html`, `css/garden.css`: HUD, projected diamond, minimap/return controls, `#fx` vignette.
- `js/portfolio-data.js`: explicit placeholder portfolio content.
- `js/garden.js`: camera, movement, minimap, transitions, park props, collision, wind clock.
- `js/shape-mask.js`: Jersey10 text/image mask helpers.
- `js/shape-tree.js`: deterministic mask-driven tree skeletons + leaves, toon `pop()` curve.
- `js/tree-mesh.js`: branch meshes, foliage, floor tiles, grass, voxel text, LOD/culling.
  `PALETTE`, `LEAF_TEXTURE_URL`, `GRASS_TEXTURE_URL` are the replaceable art hooks.

## Tree generation (`growTree`)
1. Crown centres: shuffled Poisson-disk dart throwing over ink cells (spacing 6.5), then 2
   Lloyd iterations. Every ink cell belongs to its nearest crown. About half the trees of the
   old 5 × 6 bucket layout on a text-like test mask (63 trees / 1745 cells).
2. Root is offset 0.6–2.2 units from the crown centre in a random direction, so trunks do not
   line up with text rows in TPS.
3. Trunk: 6 segments root → fork (75% towards crown centre), height 3.6–4.6 × size.
   Mostly straight: 60% bow ≤ 0.12, rest 0.12–0.37 (measured max deviation 0.34).
4. Main limbs (2–5, farthest-point seeded k-means of crown cells) start at different upper
   trunk nodes → sub-branches (≤3 per limb) → twigs (≤3 per sub-branch) ending at cells.
   Segments ≤ ~2 units; maximum horizontal reach from the root measured 7.7 units.
5. Leaves: 18 per ink cell in three height clumps over a dome (top 9–10.6 × size), leaving gaps
   where branches show. Leaf x/z stays within 0.30 of its cell (asserted).
Node fields: `{ x, y, z, radius, parent, cluster, primary }`; `primary` marks chain continuation.

## Meshes (`buildTreeScene`)
- Branches: one closed 6-sided low-poly mesh per tree. Each node has one ring perpendicular to
  the branch direction, parallel-transported along chains, so horizontal limbs keep thickness and
  consecutive segments share rings (no seams). Side branches start from a ring buried in the
  parent. Minimum radius 0.05. Plain unlit bark colour (`MeshBasicMaterial`).
- Leaves: per-tree `InstancedMesh`, square placeholder sprite, alphaTest 0.45. Vertex shader sway
  (crown sway grows with height + per-leaf flutter) using the shared `wind` uniform.
  Fade uniform multiplies alpha AFTER the cutout test, so leaves fade instead of being clipped.
- Floor: stone tile per cell over the whole plot (same parity as the mask so cells align), small
  per-tile height jitter. Ink cells use the slightly darker `tileInk` palette (text faintly
  readable in 3D), border cells `tileRing`.
- Grass: 3-cell border, density highest at the edge, low-frequency gaps for clumps; three crossed
  quads per grass cell, swaying, colours include a pink accent. Placeholder sprite, NOT from ICQR.
- Voxel text: one cube per ink cell, leaf-palette colours; height scaled by uniform `uRise`.

## View blend (`setFlat(p)`, 0 = trees, 1 = voxel text)
- Branches fade over p 0–0.3, then hidden (no ugly branches from above).
- Leaves fade over p 0.35–0.85 (transparent, no depth write while fading), then not rendered.
  Instance count drops to 25% over p 0.15–0.85 (instances interleaved across cells).
- Voxels rise over p 0.3–0.8.
In minimap, p = smoothstep(camera height, 25, 70); wheel zoom (16–260) moves through it.

## Transitions
0.5 s. Camera position + quaternion interpolate together. CSS blur (≤2.4 px) + `#fx` radial
vignette pulse over the whole 0.5 s. From 0.2 s to 0.4 s, p lerps from its current value to the
landing value (voxels rise, leaves fade out). Reduced motion snaps everything.

## Range, growth and culling
Each tree activates within 85 units of the observer (player in TPS, map centre in minimap) and
stays active until beyond 105 units. Reversible pop timeline: branch mesh scale 0 → 1.2 → 1 and
lift 0 → 0.5 → 0; its foliage starts 0.7 s later with the same curve. Per-tree bounding spheres
(covering the 1.2 overshoot) are frustum-tested each frame after the camera update; hidden trees
defer matrix updates. Plots inside the minimap view stay active.

## Camera and input
TPS: eye 4.2 behind, 0.85 right, 2 above the player floor; vertical drag changes aim only.
Damped follow; no capsule bobbing; icon projected after the camera matrix update.
WASD/arrows move relative to camera yaw (screen axes in minimap) at 8 units/s.
Collision: lodges, benches, lamps, park bounds. Beds are walkable (player lifted 0.34).
Minimap button anywhere; nearby diamond opens centred on its plot; left-drag pans; wheel zooms.

## Verification
- Node: deterministic output, parent ordering, leaf-on-cell bound, trunk straightness, toon pop.
- Browser (headless): no JS/shader errors; TPS, mid-transition (vignette 0.98, blur 2.35 px),
  settled voxel minimap, mid-zoom blend and close zoom screenshots captured.
- Not measured: FPS before/after. Not verified: visual parity with ICQR, touch input.

## Run
`npx http-server . -p 4173 -c-1` → `http://localhost:4173/tree-demo.html`.
