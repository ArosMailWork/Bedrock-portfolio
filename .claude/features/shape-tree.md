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
  out with the tree grow-range slider (15–150 m, default 40) and the Post processing section
  (checkbox, 9 sliders built from `POST_CONTROLS`, reset button). Pixel SVG icons are inline.
  Loads `vendor/howler/howler.min.js` (classic script → `window.Howl`, `window.Howler`).
  Howler is only loaded; no sounds are wired (the owner handles audio).
- `js/portfolio-data.js`: placeholder portfolio content (short lines → smaller plots).
- `js/garden.js`: orchestration: layout, camera, input, minimap, transitions, render loop.
- `js/island.js`: `shoreRadius()` (JS + identical GLSL), low-poly ground, sea shader.
- `js/fountain.js`: lathe basin/bowl, stylised water discs (after bruno-simon.com), 720 GPU droplets. See "Fountain water".
- `js/leaf-fall.js`: pooled falling leaves (384) from grown crowns near the player, blown by the wind. See "Wind".
- `js/wind.js`: shared wind (direction + travelling gust field, GLSL `windOffset()` and JS `windAt()`).
- `js/wind-lines.js`: Bruno-style wind line ribbons. `js/sky.js`: gradient sky dome + low-poly clouds.
- `js/park.js`: lodge paths, plaza + fountain, hedges, bushes, flowers, lamps, benches, lodges,
  beach rocks, shoreline fences, 3D grass. `PARK_COLORS` holds all prop colours.
- `js/physics.js`: Rapier (`vendor/rapier/rapier.mjs`, @dimforge/rapier3d-compat 0.21.0,
  WASM embedded) static colliders + kinematic capsule character controller.
- `js/post.js`: bloom chain + composite (tilt-shift / haze blur, vignette, colour grading). See "Post processing".
- `js/shape-mask.js`, `js/shape-tree.js`, `js/tree-mesh.js`: text masks, trees, plot floor.
  `PALETTE`, `FOLIAGE_TEXTURE_URL` (tree-mesh) are the replaceable art hooks.
- `assets/textures/third-party/foliage-sdf-bruno-simon.png` (+ `LICENSE-folio-2025.md`, MIT, Bruno Simon):
  foliage sprite. Owner chose to reuse Bruno's file. `assets/textures/leaf-maple-lowpoly.svg` is no
  longer referenced (kept on disk).

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
`cameraFloor`. Vertical drag (`PITCH_RANGE` −0.9…0.65): looking up changes the aim only; looking
down rotates eye and aim around the shoulder anchor (player + 1.6 m) by the pitch about the camera's
right axis, so the camera rises along an arc and the character keeps its screen position
(screenshots: level vs −0.85 pitch, character within ~80 px). `cameraFloor` follows the player height with
damping (6/s grounded, 1.5/s airborne), so jumps read on screen. Camera collision: Rapier ray
from the shoulder (excluding the player body) shortens the arm. No wheel zoom while walking.
WASD/arrows move relative to camera yaw (screen axes in the minimap). Momentum: keys set a target
velocity; while a key is held the velocity moves towards it linearly, reaching full speed
`RAMP_S` 0.15 s after starting from rest (measured: 3.0 m/s @50 ms, 5.5 @100 ms, 8.1 @150 ms).
Released: damps at `DECEL` 10/s (≈1.3 m glide). `WALK_SPEED` 8 m/s, Shift = `RUN_SPEED` 14 m/s.
Hop-and-wobble (after the game "We Become What We Behold"): body + eyes live in a `visual` group
inside the physics-driven `player`; `animateHop()` hops `HOP.height` 0.25 m at `HOP.rate` 3.2
hops/s at walking speed (faster when running), leans ±`HOP.lean` 0.17 rad alternating per hop,
squashes on landing, tilts forward slightly; fades out within ~0.3 s when stopping or airborne.
Visual only (physics/camera follow `player`). Measured in the browser: 0.250 m, ±0.17 rad.
Constants sit next to `viewBlend` in `garden.js`. Space jumps
(edge-triggered, only when grounded): Rapier character controller, gravity 22 m/s², jump speed
8 m/s (≈1.4 m, verified in Node), snap-to-ground disabled while rising, head bumps stop the rise.
Minimap: left-drag pan (clamped to the island), wheel zoom between 34 m (above the canopy) and
260 m; WASD and jump still work.

## Lighting and post
Bruno's day palette (`sources/Game/Cycles/DayCycles.js` day preset: light #ffd2c2, shadow #6d3fff,
fog #00ffff → #9b89ff). Hemisphere 0xfff0e0 / 0x6a58d6 (violet bounce) + sun 0xffd2c2 × 2.9.
Sky / fog: see "Sky". Shadows: 2048 PCF map, frustum ±24 m while walking (2.3 cm per texel; was
±40 m = 3.9 cm, the owner saw blurry shadows) and ±70 m in the minimap, centred on the camera
target and snapped to whole texels in the light's right/up axes (`sunRight`, `sunUp`) so edges do
not crawl. bias −0.0003, normalBias 0.02. Casters: trunks, invisible crown proxies (one icosahedron
per tree, child of the trunk so it scales with the pop), props, player. Leaves, tiles, voxels,
grass and ground receive. Fog recedes with camera height.

## Post processing (`js/post.js`, Settings → Post processing)
Scene → 4× MSAA half-float target. Bloom like Bruno (`Rendering.js`: threshold 1, strength 0.25):
soft-knee threshold prefilter into half resolution, 5-level dual-filter downsample, tent upsample
back adding each level × `bloomRadius`. Composite: tilt-shift band blur / transition haze (golden-
angle 16 taps), + bloom × strength, × exposure, violet vignette, `linearToOutputTexel`, then grading
in display space: contrast around 0.5, saturation, split toning (shadows × #6d3fff by `shadowTint`,
highlights × #ffd2c2 by `highlightTint`). Bruno does not grade in post (his palette comes from
lighting/material); the split toning approximates his violet shadows. The old 16-tap HDR glow
(threshold 1.15) was replaced by the bloom chain.
- `POST_DEFAULTS` (on by default; values after Bruno's look): bloom 0.25 / 1.0 / 0.75, exposure 1,
  contrast 1.06, saturation 1.15, violet shadows 0.35, warm highlights 0.25, vignette 0.45.
- `POST_SETTINGS` is mutable; `POST_CONTROLS` generates the sliders in `garden.js`; checkbox disables
  bloom + grading; "Reset to default" restores the defaults. Panel scrolls (max-height).
- Adding an effect: uniform + GLSL in the composite pass, default in `POST_DEFAULTS`, row in `POST_CONTROLS`.

## Sky (`js/sky.js`)
Back-side sphere (r 800, follows the camera, drawn at the far plane, no fog): horizon #a6f4f0 →
zenith #b9b0ff by view elevation, warm #ffd2c2 glow towards the sun. Bruno uses a screen-space
radial gradient instead; a dome keeps the colour stable when the camera turns. Fog / clear colour =
horizon. Clouds: 16 meshes of 5–8 merged flattened icosahedrons (flat-shaded Lambert, white, lavender
self-light 0.6 × #c8c0ff so undersides stay pale), 55–115 m high, size 9–20, drifting downwind at
1.6 m/s in a ±450 m square; they shrink to nothing within 80 m of the wrap edge (no popping).
Hidden in the minimap (they would cover the island).

## Wind (`js/wind.js`, after Bruno's `Wind.js`)
Direction angle 0.6π (`WIND.angle`), strength 0.5. `windOffset(p)` = dir × (n1 + n2 + 0.35) ×
strength; n1 = value noise at p × 0.22 scrolling at `WIND.speed` (2.2 m/s), n2 at p × 0.07 scrolling
slower; the +0.35 bias keeps things leaning downwind, n1/n2 are travelling gusts. Same field on the
CPU (`windAt`). `addSway()` (tree-mesh) injects it for every instanced swayer as `windHere`
(sampled at the instance's world x/z).
- Grass: tip offset = windHere × height² × blade height × 1.2, bent blades shorten, tiny flutter;
  player push unchanged.
- Foliage: crowns lean windHere × 0.35 × height; sprite UV rotates by |windHere| × 2.2 (Bruno's
  foliage shimmer).
- Falling leaves (`leaf-fall.js`, after Bruno's `Leaves.js`): parallelogram quads (no texture),
  plot colours. Air: horizontal velocity follows wind × 4 m/s, fall speed 0.7–1.2 m/s, flutter.
  Ground: only gusts above 0.22 move them (towards wind × 5 m/s, damped), small hops; rest 4–8 s
  then shrink. Player within 1.1 m and faster than 1 m/s kicks them up/away. Measured: after 9 s,
  94 on the ground of which 61 moved within 0.5 s.
- Wind lines (`wind-lines.js`, after Bruno's `WindLines.js`): pool 4, every 0.3–2 s within ±15 m of
  the player, 1.6–3.2 m up; 28 m Catmull-Rom ribbon waving only ±0.09 m (`WAVE`; owner wanted long, unbent lines), width 0.1 tapered to the ends × a bump that
  travels along it over 5 s, drifting 2 m downwind. Walking view only.

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

## Tree generation (`growTree`): leaves first, branches derived backwards
Current algorithm (supersedes the tree-shape notes in the older "Update" sections below).
Shape tunables live in the exported `TREE_SHAPE` object; `growTree` options: `seed`,
`leavesPerCell` (18), `spacing` (4.2), `fillerDensity` (0.15).
1. Crown centres: shuffled dart throwing over ink cells; every ink cell joins the first centre
   within `spacing`, otherwise starts a new crown (one tree per crown). Trunks end up ~5–6 m apart
   (ABOUT 77 trees, was 125).
2. Oak crown per tree. Proportions measured with a script on the owner's reference photo of a
   free-standing oak (row-by-row silhouette width): crown 81% of tree height, bare trunk 18%,
   crown width / crown height 1.35, widest at 65% of the crown height from the top, near-vertical
   lower sides and a flat underside. The ICQR reference tree measured crown ≈ 80% of height,
   width / height ≈ 1.17, lumpy. Implementation: radius = spread + 0.5 clamped to
   `crownRadius` [3.6, 4.7] (max ≥ spacing + 0.5, so every ink cell is inside its own crown);
   crown height = 2R / `aspect`; `widest` 0.65 splits it into `up` (elliptic top) and `down`
   (power-4 superellipse underside). Bare trunk `clearTrunk` 2.8–3.3 m instead of 18% (owner chose
   "medium oak": a true 18% would put the 2 m walking camera inside the leaves). Rim bulges only
   outwards (1–1.18 R, two sine lobes); top surface has cauliflower bumps (`bumps` 0.14).
   Resulting trees ≈ 8–10 m tall, 7–11 m wide.
3. Leaves first, per integer column inside a crown: `leavesPerCell` core leaves above ink cells,
   `fillerDensity` × that filler leaves above empty cells, × (1 + 1.5 d⁴) for rim columns (they
   carry the side walls), ÷ number of overlapping crowns. Leaves only live in the outer shell
   (ellipsoidal radius ≥ 1 − `shell` 0.28; up to 8 tries, else top/underside layer), because the
   inside is never seen. Each leaf stores `filler` and the crown normal `nx, ny, nz` (ellipsoid
   gradient + 0.15 up). Counts: ABOUT 33.0k leaves (24% fillers), WORK 29.8k, SKILLS 24.5k,
   CONTACT 19.5k: ~30% more than the previous version, needed for solid side walls.
4. Branches backwards: k-means (farthest-point seeds, 5 iterations) groups leaves into twigs of
   ~12; a twig tip sits 0.55 units inside the leaf nearest its clump centre. Levels of ~3 children
   are merged repeatedly until ≤ `TREE_SHAPE.limbs` (5) main limbs remain. Each parent sits
   `pull` (0.45) of the way from its children's centre to the fork and always 0.15 below its
   lowest child, so every branch rises.
5. Trunk: root offset 0.2–0.6 from the crown centre, 6 segments to the fork (75% towards the
   crown centre, at min(lowest leaf − 0.6, crown bottom), ≥ 1.5). Mostly straight bow.
   The heaviest limb continues the trunk; the others leave from the two trunk nodes below the fork.
6. Pipe model: radius = R0 × sqrt(leaves below / tree leaves), min 0.05; R0 = (0.30–0.38) × R / 4,
   root flare 1.45 × R0. Chains of 1–3 segments (≈1.2 units each) bow sideways by 6% of length.
Node fields: `{ x, y, z, radius, parent, cluster, primary }`; `primary` marks chain continuation.

## Meshes (`buildTreeScene`)
- Branches: one closed 8-sided low-poly mesh per tree. Each node has one ring perpendicular to
  the branch direction, parallel-transported along chains, so horizontal limbs keep thickness and
  consecutive segments share rings (no seams). Side branches start from a ring buried in the
  parent. Minimum radius 0.05. Lambert bark, front faces only. Normals are written analytically
  (radial per ring vertex, tangent at tips) instead of `computeVertexNormals`, and triangles wind
  counter-clockwise from outside. Earlier the side walls wound inwards: with `DoubleSide` the
  lighting looked fine but the shadow normal-bias pushed into the trunk, producing striped
  shadow acne and hard light/dark bands up close. Verified by close-up screenshots before/after.
- Root: the root flare node is buried at y = −0.3 and its ring is forced horizontal. Before, the
  ring was perpendicular to the leaning trunk, so one side lifted above the tiles (visible gap).
- Leaves: per-tree `InstancedMesh` of `LEAF_SIZE` 1.2 m quads. Sprite = Bruno's foliage SDF
  (`FOLIAGE_TEXTURE_URL`, a clump of ~20 small diamond leaves; red channel = distance) used as
  `alphaMap`, cut at `LEAF_THRESHOLD` 0.3. Its UV rotates by |windHere| × 2.2 + a per-leaf offset
  (shimmer, as Bruno's Foliage.js). Colour: two-tone like Bruno, mix(darkest, lightest plot colour)
  by smoothstep(0, 1, crownNormal · sunDir) × instance brightness 0.9–1.1. Crown sway from the
  shared wind (see "Wind"). Fade uniform multiplies alpha AFTER the cutout test.
  Each tree has its own clone of the 4-vertex quad with instanced attributes `aFiller` and
  `aCrown` (crown normal). Quads keep random orientations (tilt ±72° from flat, random heading and
  spin), so the silhouette never shows edge-on slivers, but lighting uses `aCrown`
  (`transformedNormal = normalMatrix * aCrown`, no back-face flip): the crown shades like one mass.
- Filler leaves are drawn `FILLER_SCALE` 1.3× bigger and drop out leaf by leaf: discard when the
  leaf's random value (hash of its position) ≥ `fillerFade`. garden.js sets
  `fillerFade = 1 − smoothstep(−cameraDir.y, 0.45, 0.8)`: visible in the normal walking view, gone
  when looking down steeper than ~53° (minimap, steep walking pitch). A per-pixel dither was used
  before, but at low fade it covered the screen with dots when the walking camera looked down.
- `barkFade` = 1 while walking, = fillerFade otherwise (minimap/transition); bark dissolves with a
  4×4 ordered dither (`bayer4`), so branches never cross the text from above while trunks stay
  visible when the walking camera looks down.
- See-through (after Bruno's foliage): `seeThrough` = camera→player distance while walking; leaves
  closer to the camera than that − 0.4 − (0…1 random per leaf) are discarded, so crowns never hide
  the character.
- `mapFill` (0–1, smoothstep of camera height 90–160 m, minimap only): voxels scale x/z by up to
  1/0.96 and tiles by 1/0.98, closing the sub-pixel gaps; tile colours lerp 60% towards the base
  tile colour. Cause of the far-zoom "unstable text": at 260 m one cell is ~2.5 px, so the 4% / 2%
  gaps were sub-pixel and flickered while panning.
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
0.5 s. Rotation first: the quaternion slerps with smooth(progress / `ROTATE_SHARE` 0.4), so it
reaches its destination after 0.2 s; the position eases with smooth(progress) over the whole 0.5 s
(measured: rotation 54% / position 11% at 100 ms, 100% / 34% at 200 ms). Post haze (blur + vignette) pulses over
the whole 0.5 s; from 0.2 s to 0.4 s the blend p goes to its landing value (voxels rise, leaves
fade, branches already hidden). Reduced motion snaps everything.

## Fountain water (after bruno-simon.com)
Reference: github.com/brunosimon/folio-2025 (MIT), `sources/Game/World/WaterSurface.js`, `Terrain.js`
gradient, `AltarArea.js` particles. Read for the approach only; re-implemented in plain GLSL.
- `waterSurface(radius, y, time, inner)`: opaque disc. depth = (radius - r) / (0.75 radius).
  Colour: `WATER_COLORS.shallow` #5bc2b9 -> `deep` #13375f (Bruno's terrain gradient stops) with a
  little low-frequency noise. Foam (#f4fbff): solid wobbly rim band (depth < 0.06-0.10); strokes =
  bands parallel to the rim (5 per radius) drifting towards it (0.35/s), thinner over deep water
  (width 0.22 -> 0.04), broken by noise reseeded per band, none deeper than 0.85; a thin wavy line
  where the pillar (r 0.3) / spout (r 0.15) pierce the surface (Bruno draws white where geometry
  crosses the water plane).
- Droplets: same analytic ballistic emitters (jet 260, spill 240, splash 140, bowl 80), now opaque
  round two-tone discs: core (#e9fdff × 1.25, softly glowing) inside 38% radius, rim #7fd3ea.
  Size 0.45-1.35 × base, pops in over the first 8% of life, shrinks to 45% and vanishes at the
  end. Opaque + depth writes: no transparency sorting.
- Not ported: Bruno's screen-space blur under the water, ice, rain splashes.

## Plot text sizes, body paragraphs and streaming
Owner decisions: title bigger (2×), lines and body at the old title size (1 font px = 1 m,
full-size oaks), body in its own colours, no LOD stand-ins, bigger island accepted, streaming /
chunking allowed as needed. Body wrap width is provisional (owner will decide a layout later).
- Mask (`plotMask()`, garden.js, `TEXT = { titleScale: 2, lineGap: 3, bodyGap: 6, bodyWrap: 360 }`):
  title upscaled 2× (each font px → 2 × 2 cells), lines at font size, `body` paragraphs word-wrapped
  to 360 font px (~60 characters, `maskFromBody()` in shape-mask.js), all stacked in ONE mask with
  a `kind` array (0 = title/lines, 1 = body). One forest per plot, one tree size everywhere.
- Colours: `bodyColors` per plot (default: plot colours, lightness × 0.62, saturation × 0.8). Two leaf
  materials per plot (by the crown centre's kind); voxels coloured per cell kind.
- Result with the sample ABOUT text (~1000 characters): ABOUT plot 366 × 384 m, 2235 trees; island
  radius 570 m (was ~110); farthest minimap zoom = max(260, 2.2 R), camera far = 1.6 × that; sea
  plane = max(1600, 8 R).
- Streaming trees: `planForest()` (shape-tree.js) plans every crown up front (centre via spatial-hash
  dart throwing, dome, root, trunk radius, kind, crown box) and returns `build(i)`, which grows one
  tree (leaves first, branches backwards) with its own seeded stream, identical on every rebuild.
  `growTree()` = plan + build all (tests). `buildTreeScene()` builds a tree's meshes only when it is
  active (within the grow range, or in view in the minimap) and leaves are shown (flat < 0.8),
  nearest first, `treeSettings.buildsPerFrame` (4) per frame; it frees them again once the tree has
  shrunk to 0 outside the range. Colliders come from the planned roots (`root.radius`).
- Chunks: floor tiles and voxels are split into 32 × 32-cell InstancedMeshes (frustum culling).
  Grass (`GRASS` in park.js): 32 m squares built within 110 m of the player (2 per frame, seeded
  per square), freed beyond 150 m.
- Removed: LOD stand-ins, grouped draw units (`groupCell`), the flat canvas body and the mini-tree
  body scene.
- Measured (headless Chrome): load 1.4 s; at the plaza 240 draw calls; standing in the body text
  330 calls, ~108 trees built; running (Shift) through it worst frame 16 ms, ≤ 185 trees built;
  minimap 365–405 calls; JS heap 117–186 MB. ~100 fps headless (indicative only).
- Fix: clouds were visible in the minimap because `visible` received `null` (three only skips
  objects whose `visible === false`); now a boolean.

## Baked minimap (`js/map-bake.js`)
Problem (owner screenshot, island R 570 m): far minimap zoom showed the plot floors missing, the
shore flickering. Causes: near 0.1 / far ~2000 m gives ~1 m depth error at 1.2 km height (6 cm
floor tiles lose to the ground, shore and sea z-fight), plus tens of thousands of sub-pixel voxels.
- Once after loading, an orthographic camera straight above the island (half-extent 1.15 R) renders
  the map state into a 4096² (≤ GPU max) 4× MSAA render target with mipmaps + anisotropy 8:
  `setFlat(1)` on plots and park, fillers/bark hidden, `mapFill` 1, no fog, sun shadow frustum over
  the whole island. Hidden while baking: everything with `userData.skipBake` (sky dome, clouds, wind
  lines, falling leaves, player, the bake plane). ~0.32 m per pixel for R 570.
- A plane (y 0.9, renderOrder 10, `MeshBasicMaterial`, no fog) shows the image; alpha = crossfade ×
  smoothstep border (6%) so it melts into the live sea. Crossfade = smoothstep(camera height,
  `MAP_BAKE.from` 200, `to` 300), only in the minimap (not while leaving it).
- Fully baked (crossfade 1): camera renders only layer `MAP_BAKE.layer` (1): bake plane, live sea,
  player marker, hemisphere + sun; shadow map not updated; "C:\Users\PC\AppData\Roaming\kazuo-ai\ai-chat\bin\rtk.exe" tree streaming paused.
- Near plane follows the camera height: clamp(0.008 × height, 0.1, 15).
- Measured (headless): minimap at 1000 m: 16 draw calls / 406 triangles (was ~400 calls / 2.2 M);
  250 m crossfade 259 calls; load 1.6 s (bake included). Round trip walk → map → walk restores
  layers and shadows.
- Not live in the image: moving things (player is drawn live), tree growth state. The bake does not
  re-run when content changes at runtime (content is static).

## Range, growth and culling
Each tree activates within `treeSettings.growRange` m (default 40, settings slider) of the observer
(player when walking, map centre in minimap) and stays active until range + 15 m. Reversible pop timeline: branch mesh scale 0 → 1.2 → 1 and
lift 0 → 0.5 → 0; its foliage starts 0.7 s later with the same curve. Per-tree bounding spheres
(covering the 1.2 overshoot) are frustum-tested each frame after the camera update; hidden trees
defer matrix updates. Plots inside the minimap view stay active.

## Verification
- Browser (headless Chrome, latest round): no console errors; sky/clouds, wind lines, foliage
  sprite, settings panel, closest minimap (clouds and fillers hidden), level vs steep-down pitch,
  root close-up and fountain captured; leaf wind measured (61/94 ground leaves moving); ~100 fps
  headless (indicative only).
- Node (`node tests/tree-growth.test.cjs`, 320 cases): determinism, parent order, rising branches,
  reach < 1.2 x max crown radius + 0.7 from the root, foliage within 0.6 of every branch tip, every
  tree has leaves, core leaves only above ink and every ink cell covered, fillers present, unit
  crown normals, bare trunk >= clearTrunk minimum, crown not flatter than the oak aspect allows,
  root flare is the thickest node (pipe model), ink count unchanged.
- Browser (headless Chrome, screenshots): TPS / side / under-canopy views, closest and farthest
  minimap zoom, fountain close-up; per-frame measurements of the speed ramp, hop and transition.
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
Double-click `run.bat` (Windows): starts `npx http-server . -p 4173 -c-1` in its own window (close
it to stop), waits until the server answers (≤ 30 s), then opens `http://localhost:4173/tree-demo.html`
in the default browser. Manual: run the same npx command and open the URL.
