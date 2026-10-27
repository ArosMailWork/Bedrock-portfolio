# Portfolio garden (island park)

Low-poly island park in a Bruno-Simon-like style: over-the-shoulder camera, warm sun with
violet-tinted shadows, subtle edge blur, stylised sea, Rapier character with jump. Four portfolio plots whose trees are
generated from the text; the minimap shows the same text as voxels.
Inspired by tree.icqr.com (trees/floor) and bruno-simon.com (art direction). Both bundles are
obfuscated; no code, textures or algorithms were copied. Everything is a re-implementation.

## Files
- `tree-demo.html`, `css/garden.css`: keyyard-style HUD (uses `css/base.css` tokens: Jersey10 / VT323 /
  Inter, pixel blocks, hotbar). Heading + generated directory (top left), vertical icon dock
  (right): view toggle (map icon ↔ camera icon), settings, replay growth. Settings panel slides
  out with the tree grow-range slider (15–150 m, default 40). Pixel SVG icons are inline.
  Loads `vendor/howler/howler.min.js` (classic script → `window.Howl`, `window.Howler`).
  Howler is only loaded; no sounds are wired (the owner handles audio).
- `js/portfolio-data.js`: placeholder portfolio content (short lines → smaller plots).
- `js/garden.js`: orchestration: layout, camera, input, minimap, transitions, render loop.
- `js/island.js`: `shoreRadius()` (JS + identical GLSL), low-poly ground, sea shader.
- `js/fountain.js`: lathe basin/bowl, rippling water discs, ~1140 GPU water particles.
- `js/leaf-fall.js`: pooled falling leaves (160) from grown crowns near the player.
- `js/park.js`: lodge paths, plaza + fountain, hedges, bushes, flowers, lamps, benches, lodges,
  beach rocks, shoreline fences, 3D grass. `PARK_COLORS` holds all prop colours.
- `js/physics.js`: Rapier (`vendor/rapier/rapier.mjs`, @dimforge/rapier3d-compat 0.21.0,
  WASM embedded) static colliders + kinematic capsule character controller.
- `js/post.js`: one full-screen pass: tilt-shift edge blur, vignette, transition haze.
- `js/shape-mask.js`, `js/shape-tree.js`, `js/tree-mesh.js`: text masks, trees, plot floor.
  `PALETTE`, `LEAF_TEXTURE_URL` (tree-mesh) are the replaceable art hooks.

## Island, sea and layout
- Plots sit in four quadrants around a central plaza (gaps 16 × 14, small fixed offsets).
  Plot entrance = where the tiles end walking from the plot centre towards the plaza.
- Island radius is the smallest R keeping every plot tile (pad 2) and lodge (pad 6) within
  s ≤ 0.86 of the shore IN ITS OWN DIRECTION (shore wobbles ±12%).
- Ground: polar mesh (220 segments, 0.01 rings near the shore), flat lawn to s = 0.92, sand slope
  to -0.7 at the shore. Smooth shading + per-vertex `groundColor()` (two lawn tones blended by
  low-frequency noise, sand/wet-sand by s): no visible facets, no saw-tooth beach. Physics trimesh.
- Invisible wall ring at s = 0.955 (96 boxes). Verified in Node with Rapier: walking outwards
  in 8 directions stops at s ≈ 0.944 on the sand, above the water (y ≈ -0.15 vs -0.35).
- Sea: 1600² plane at y = -0.35. Colour by distance to the waterline (shallow → deep over 26 m),
  foam at the edge, rings travelling to the beach, thin streaks offshore. Uses scene fog.

## Park dressing (`buildPark`)
Paths: centripetal Catmull-Rom. Each starts hidden under the plaza disc and leaves radially.
Plot paths were removed (plots erode into the lawn instead, see the update section);
lodge paths bend gently and end at the doorstep. Two-tone paving quads with raised white curbs.
Hedge stretches (only from the 7th sample, never at junctions) alternate sides; flowers opposite;
one lamp on long paths only. Path-mouth bushes are skipped where they would touch a path.
Plaza: curb ring, paving, tiered fountain. Two benches. Lodges: cream walls,
terracotta pyramid roof, chimney, door + windows facing the plaza. Up to 130 round
(icosahedron) bushes, flanking path mouths and clustered on the lawn. Beach rocks, two broken
shoreline fence arcs. Colliders: hedges, bushes, lamps, benches, lodges, fences, fountain,
trunks, entrance sign posts. Flowers, rocks and grass have none.
Grass (after bruno-simon.com): one thin triangle per blade, sampled every 0.32 m, ~8% sparse lawn
plus dense noise patches, tall around plot edges. Instance colour = `groundColor()` at the root,
shader blends to `PARK_COLORS.grassTip` towards the tip, both faces use the up normal, so the field
reads as soft fur continuous with the ground. Sway via the shared wind uniform. `setFlat(p)`
shrinks blades into the ground over p 0.1–0.5 (hidden in the minimap, like the leaves).
GLSL note: `pow(max(h, 0.0), …)`: MSAA can extrapolate the height varying below 0 → NaN →
black specks spread by the post blur.

## Camera, input, physics
Walk: over-the-shoulder camera (FOV 55): eye 4.2 m behind, 0.85 m right, 2 m above
`cameraFloor`; vertical drag changes aim only. `cameraFloor` follows the player height with
damping (6/s grounded, 1.5/s airborne), so jumps read on screen. Camera collision: Rapier ray
from the shoulder (excluding the player body) shortens the arm. No wheel zoom while walking.
WASD/arrows move relative to camera yaw (screen axes in the minimap) at 8 m/s. Space jumps
(edge-triggered, only when grounded): Rapier character controller, gravity 22 m/s², jump speed
8 m/s (≈1.4 m, verified in Node), snap-to-ground disabled while rising, head bumps stop the rise.
Minimap: left-drag pan (clamped to the island), wheel zoom between 34 m (above the canopy) and
260 m; WASD and jump still work.

## Lighting and post
Sky/fog 0xcfe5e6. Hemisphere 0xfff0d8 / 0x5d6fb0 + warm sun 0xffdcae with a 2048 PCF shadow map following the
camera target (±40 m). Casters: trunks, invisible crown proxies (one icosahedron per tree,
child of the trunk so it scales with the pop), props, player. Leaves, tiles, voxels, grass and
ground receive. Fog recedes with camera height. Post pass renders the scene into a 4× MSAA
half-float target, then blurs top/bottom bands (strength 0.35 while walking, 0 in the minimap), applies a violet
vignette and the 0.5 s transition haze (replaces the old CSS blur/vignette).

## Update: plots, fountain, leaves, camera arm, UI
- Plot paths removed. Plot borders erode into the lawn: cells within 4 tiles of the outline keep
  with probability 0.4 / 0.7 / 0.88 / 0.97 by distance; kept border tiles tilt, shrink, sink and
  turn mossy; ~55% of removed tiles leave a small chip. Text cells and their direct neighbours
  never erode. Grass grows wherever a tile is missing (`isFloor` only reports kept tiles).
- Fountain particles: jet (spout → upper bowl), spill sheet (bowl rim → basin), two splash sets.
  Each particle: start ring radius/height, outward speed, vertical speed, landing height, phase;
  the vertex shader loops the ballistic arc. Point size is world-constant via `setViewport`.
- Grass bends away from the player (uniform `uPlayer`, radius ~1.5 m, scaled by blade height).
- Leaf sprite: `assets/textures/leaf-maple-lowpoly.svg`, a maple silhouette made of 90 grey
  facets (lighter towards the upper left) on transparency; instance colour tints it. Quad 0.9 m.
- Falling leaves: 7/s from crowns within 35 m whose tree is fully grown and visible; flutter down,
  lie flat 3–6 s, shrink away in 0.8 s; hidden and paused in the minimap.
- Trunks: slimmer (R0 0.24–0.31 × size), 1.45× root flare, faster taper, 7-sided, warmer bark.
  Twigs stop at 75% of the way to their cell and ≥0.8 m below that cell's canopy top.
- Camera jitter fix: measured in the browser, the shoulder→camera ray hit flickered at the ray end,
  making the arm jump 4.49–4.73 m while idle. The ray now probes 0.4 m past the camera, the arm only
  shortens for real obstacles, and its length is damped (20/s in, 3/s out). Re-measured: constant.
- Tree grow range is `treeSettings.growRange` (tree-mesh.js); shrink at range + 15 m.

## Tree generation (`growTree`)
1. Crown centres: shuffled Poisson-disk dart throwing over ink cells (spacing 6.5), then 2
   Lloyd iterations. Every ink cell belongs to its nearest crown. About half the trees of the
   old 5 × 6 bucket layout on a text-like test mask (63 trees / 1745 cells).
2. Root is offset 0.6–2.2 units from the crown centre in a random direction, so trunks do not
   line up with text rows in the walking view.
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
- Floor: organic patch of stone tiles: superellipse (|x|⁴+|z|⁴) with a noisy outline,
  always including cells within 2 of the text; 4-cell margin; ink cells slightly darker.
  `isFloor(x, z)` / `floor` expose the patch to the park, grass and island sizing.
- Voxel text (one colour per plot: the darkest palette colour; uniform height): one cube per ink cell, leaf-palette colours; height scaled by uniform `uRise`.

## View blend (`setFlat(p)`, 0 = trees, 1 = voxel text)
- Branches fade over p 0–0.3, then hidden (no ugly branches from above).
- Leaves sink into the terrain over p 0.05–0.8; their final opacity fade runs over p 0.65–0.8.
- Full leaf instance count is preserved throughout the transition.
- Voxels use fixed height and fade in over p 0.78–1.
In minimap, p = smoothstep(camera height, 25, 70); wheel zoom (16–260) moves through it.

## Transitions
0.5 s. Camera position + quaternion interpolate together. Post haze (blur + vignette) pulses over
the whole 0.5 s; from 0.2 s to 0.4 s the blend p goes to its landing value (voxels rise, leaves
fade, branches already hidden). Reduced motion snaps everything.

## Range, growth and culling
Each tree activates within `treeSettings.growRange` m (default 40, settings slider) of the observer
(player when walking, map centre in minimap) and stays active until range + 15 m. Reversible pop timeline: branch mesh scale 0 → 1.2 → 1 and
lift 0 → 0.5 → 0; its foliage starts 0.7 s later with the same curve. Per-tree bounding spheres
(covering the 1.2 overshoot) are frustum-tested each frame after the camera update; hidden trees
defer matrix updates. Plots inside the minimap view stay active.

## Verification
- Node: tree generator assertions (determinism, parent order, leaf-on-cell, trunk straightness).
- Node + Rapier: shore walls keep the character on land in 8 directions.
- Browser (headless): no JS/shader errors, Howl/Howler globals present; walk view, zoomed-out
  view, minimap at several zooms captured; walking collides with trunks and bushes.
  Headless frame counter read ~100 fps (indicative only, not the target hardware).
- Not verified: visual parity with ICQR / Bruno Simon, touch input, low-end GPU performance.

## Update: foliage sinking and scope rollback
- The experimental inland river, pond, bridge, terrain carving and vegetation exclusions were removed.
  Original polar ground, plot gaps (16 × 14) and curved lodge paths are restored. Ocean remains.
- Bottom-left walking instructions removed from `tree-demo.html`; keyboard controls are unchanged.
- Tree tips below their parent are skipped; lateral bow has no vertical component. Regression:
  `node tests/tree-growth.test.cjs` checks 320 deterministic dense/sparse/single/empty mask cases.
- Crown foliage is concentrated in an upper band with sinusoidal height lobes, rather than evenly
  filling the entire canopy height. Leaf x/z mask alignment is unchanged.
- `setFlat`: foliage sinks with `uSink` over p 0.05–0.8 and fades over 0.65–0.8. No instance thinning.
  Voxels keep full height and fade in over p 0.78–1, with depth writes only at full opacity.
  Minimap entry targets at least camera height 70 for fully visible voxels; zoom can reverse blending.
- Falling leaves: pool 384, rate 18/sec, replacing 160 and 7/sec. Radius/rest behavior unchanged.
- Per-plot leaf palettes updated towards muted green, warm peach and sage. These are reference-inspired,
  not sampled/extracted exact ICQR colour values.
- Kept fountain changes: blue/violet/cyan water, luminous rim and HDR droplets; post adds 16-tap
  thresholded glow (threshold 1.15, strength 0.3, radius 18 physical pixels). No physical water reflection.
- Customization guide: [`../../docs/customization-guide.md`](../../docs/customization-guide.md).
  Describes procedural layout, content, model loading prerequisites, shader hooks and grass placement.
  No grass-painting editor or asset-upload UI exists.

## Update: compact crowns, early voxels and sharp fountain
- Crown assignment now uses fixed ink-cell centres with a maximum radius of 3 units; uncovered cells
  create additional trees. Root offset is 0.2–0.6. This replaces relaxed wide crowns.
- Each tree has up to five short limbs ending at actual ink cells. Their tips are at canopy top minus
  1 unit, with the middle leaf clump explicitly surrounding the tip. Parent chains still rise.
  Tests additionally enforce branch reach <3.8 and foliage within 0.6 of every terminal node.
- Voxel opacity now uses smoothstep(p, 0.05, 0.5), reaching about 2/3 at p=0.326
  (camera height about 42.2). Full opacity at p=0.5. Leaf sinking remains unchanged.
- Heading directory replaced by a functional MINIMAP button; heading scales to 0.667 at top-left.
  Dock and settings are anchored 20px from the top-right. Existing right-side view toggle retained.
- Walking tilt blur is disabled. Transition haze remains. Fountain uses three-band animated value
  noise, hard ripple/foam thresholds and hard octagonal particle cutouts with two-tone highlights.
  HDR particle highlights reduced to avoid white blobs; subtle glow remains enabled.
- Leaf palettes are brighter green/sage, yellow-green and peach; artistic reference-inspired values,
  not exact samples from ICQR. No river changes.
- Verification: 320 generator cases pass including terminal foliage and maximum reach; browser startup
  and heading minimap click pass with no captured JS errors. Exact screenshot parity and GPU timing
  remain unverified.

## Update: staggered forks and ICQR Coral
- Limbs originate at staggered nodes in the upper trunk (indices 2–6); the last continues the tip.
  Radius cap, endpoint leaf clusters and rising-branch rules remain unchanged.
- The single view toggle lives inside the left heading and stays visible in map view. Label switches
  MINIMAP / TPS CAMERA; disabled state during loading/transitions is shared with the original control.
  Right dock contains only settings and replay. Map help sits below the compact heading.
- Bark restored to the historical colour #6b5442; existing untextured Lambert material retained.
- ICQR URL q=MDNodHRwczovL2ljcXIuY29tL2U selects Spring / Coral (confirmed via active swatch).
  Public main-BEr7AYxV.js palette data has Coral rgb [0.95, 0.18, 0.15], mapped to #f22e26
  in PLOTS.colors. All plots share this source colour rather than invented per-plot palettes.
  The UI swatch is #e83030, distinct from the RGB palette data. Rendering/lighting differs.

## Update: spreading crowns and sparse gap foliage
- Bark is now light brown #a77c59, still untextured.
- Reference screenshots, rather than raw ICQR RGB, guide final palettes: ABOUT pink,
  WORK green, SKILLS yellow, CONTACT green, with three nearby tones per plot.
- Crown tops lowered to (7.2–8.4) × size. Fork nodes span 3–6; each limb first travels
  72% of its horizontal distance with 35% of its rise, then turns gently upward to its leafy tip.
  Local crown radius remains 3 and branch reach remains below 3.8.
- Empty mask cells within 3 units of the nearest crown gain canopy-only foliage at one-third
  ink density (6 vs 18 leaves by default). No new trunks are added for these gap cells.
  These cells participate in the crown shape and branch endpoints but never enter tree.cells
  or the original text mask. Voxel generation remains exclusively mask-driven.
- Mesh leaf ordering no longer assumes equal leaves per cell. All foliage shares the existing
  sinking/fade effect, including the sparse gap leaves.
- 320 cases pass, including unchanged ink count, sparse-cell tagging/density, rising branches,
  maximum branch reach and foliage around terminal nodes. Browser scene loads and enters map
  without captured JS errors. Exact reference silhouette/colour parity is not yet visually verified.

## Run
`npx http-server . -p 4173 -c-1` → `http://localhost:4173/tree-demo.html`.
