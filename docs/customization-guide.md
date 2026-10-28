# Customizing Portfolio Garden

## Run

Windows: double-click `run.bat`. It starts a local server in its own window (close that window to stop
it) and opens `http://localhost:4173/tree-demo.html` in the default browser.
Manual: `npx http-server . -p 4173 -c-1`, then open the same URL.
Do not open the HTML through `file://`: JavaScript modules, fonts and textures need HTTP.
There is no build step. Three.js is loaded through the import map in `tree-demo.html`.
After editing a file, reload the browser tab (the server runs with caching off).

## The pipeline at a glance

```
portfolio-data.js  PLOTS[i] = { title, lines, colors, ... }
      │  garden.js plotMask(): each line -> maskFromPixelFont() (shape-mask.js), stacked
      ▼
text mask          { w, h, cells } 1 = ink cell, 1 cell = 1 world unit
      │  shape-tree.js planForest(mask, { seed, leavesPerCell, fillerDensity }) → build(i) per tree
      ▼
tree data          leaves first (crown domes) -> branches derived backwards -> trunk
      │  tree-mesh.js buildTreeScene(forest, mask, { colors, bodyColors, seed }) (streams trees)
      ▼
meshes + shaders   bark mesh, instanced leaves (sway/sink shader), stone floor, voxel text
      │  garden.js init(): layout in four quadrants, colliders, park, render loop
      ▼
scene
```

Read in this order: `tree-demo.html` → `js/portfolio-data.js` → `js/garden.js` →
`js/shape-mask.js` → `js/shape-tree.js` → `js/tree-mesh.js` → `js/park.js`, `js/island.js`, `js/fountain.js`.

## 1. Content: auto-generated plots from text

Edit `PLOTS` in `js/portfolio-data.js`:

| Field | Effect |
|-------|--------|
| `title` | First (top) text line of the plot, also the minimap / sign label |
| `lines` | Further text lines; each becomes rows of trees and voxel text |
| `colors` | Leaf colours of this plot (3 hex values); darkest one colours the voxel text |
| `body` | Optional list of paragraphs (any length). Grows as full-size trees (same size as `lines`) below them, word-wrapped to `TEXT.bodyWrap`; voxel text in the minimap |
| `bodyColors` | Optional colours for the body trees (default: the plot colours, darker) |
| `label`, `note`, `href` | Data only: not displayed anywhere yet (wire them into the HUD if needed) |

- Everything is generated at load time: change the text, reload, and trees, floor, voxels,
  island size and colliders follow. There is no saved map file.
- Text sizes: `TEXT` in `garden.js`: `titleScale` (title = 2× the font), `lineGap`, `bodyGap`,
  `bodyWrap` (body line width in font pixels = metres; 360 ≈ 60 characters). Long bodies make big
  plots and a big island; trees, grass, tiles and voxels stream / are chunked, so this stays smooth.
- Each character is about 5–7 cells wide; 1 cell = 1 m. Keep lines short (≤ ~13 characters), or
  plots and the island grow large and the leaf count (GPU cost) rises.
- Glyphs come from the Jersey10 pixel font (`assets/fonts/Jersey10-Regular.ttf`). Lines are centred
  and separated by 3 empty rows (`plotMask()` in `garden.js`, `row += m.h + 3`).
- The layout assumes exactly 4 plots (quadrants from `i % 2` / `i < 2`, 4 entries in `JITTER`).
  For a fifth plot, extend `JITTER` and replace the quadrant formula in `init()` with your own
  positions; the island radius is recomputed automatically from the floor tiles.
- A logo or image instead of text: `maskFromImage(img, { res, threshold })` in `shape-mask.js`
  returns the same `{ w, h, cells }` mask. Load an `Image`, await `img.decode()`, and return that
  mask from `plotMask()` for the plot in question. Not wired in by default.

## 2. Tree model (`js/shape-tree.js`)

How a tree is built (all deterministic for a given `seed`):
1. **Crowns.** Ink cells are grouped; every ink cell is within `spacing` (4.2) of its crown centre.
   One crown = one tree, so trunks stand ~5–6 m apart.
2. **Oak shape.** Each crown copies the proportions measured on a reference oak photo: crown width
   = 1.35 × crown height, widest at 65% from the top, rounded top with lumpy "cauliflower" bumps,
   near-vertical lower sides, flat underside, ~3 m of bare trunk (so the walking camera stays out
   of the leaves). Trees end up ~8–10 m tall and 7–11 m wide.
3. **Leaves first.** Leaves fill only the outer shell of the crown (the inside is never seen).
   Above ink cells: `leavesPerCell` **core** leaves (they make the text readable from above).
   Above empty cells: `fillerDensity ×` that as **filler** leaves, drawn 1.3× bigger, that only
   complete the silhouette for the walking camera and dissolve as soon as the camera looks down.
4. **Branches backwards.** Leaves are clustered into twigs (~12 leaves each), twigs into larger
   branches (~3 per level), until ≤ 5 main limbs remain. Each level sits between its children and
   the fork and always below them, so branches only rise.
5. **Thickness (pipe model).** A branch's cross-section is proportional to the number of leaves it
   carries, so the trunk thickens naturally towards the root.

Knobs:

| Where | Knob | Effect |
|-------|------|--------|
| `planForest` option | `leavesPerCell` (18) | Core leaves per column above ink. Main density/GPU cost knob |
| `planForest` option | `fillerDensity` (0.15) | Filler leaves above empty cells (walking view only). Higher = fuller crowns, more GPU |
| `planForest` option | `spacing` (4.2) | Crown grouping distance = distance between trunks. Keep `crownRadius[1] ≥ spacing + 0.5` |
| `TREE_SHAPE.crownRadius` | [3.6, 4.7] | Crown radius range (m) |
| `TREE_SHAPE.aspect` | 1.35 | Crown width / height. Lower = taller, rounder crown |
| `TREE_SHAPE.widest` | 0.65 | Widest point as a share of crown height from the top |
| `TREE_SHAPE.clearTrunk` | [2.8, 3.3] | Bare trunk under the crown (m). Below ~2.5 the camera enters the leaves |
| `TREE_SHAPE.bumps` | 0.14 | Lumpiness of the crown top |
| `TREE_SHAPE.shell` | 0.28 | Thickness of the leaf layer (share of crown radius) |
| `TREE_SHAPE.leavesPerTwig` | 12 | Fewer = more, finer twigs |
| `TREE_SHAPE.limbs` | 5 | Main limbs per tree |
| `TREE_SHAPE.pull` | 0.45 | 0 = branches split late (brushy), 1 = split near the fork (open) |
| inside `planForest` | `R0 = (0.3 + rand() * 0.08) * size` | Trunk thickness |
| `tree-mesh.js` | `FILLER_SCALE` (1.3) | Size of filler leaves relative to core leaves |

`garden.js` passes `{ seed: i * 17 + 3 }` per plot; change it to get different trees for the same text.
After changing the generator run `node tests/tree-growth.test.cjs` (320 cases: rising branches,
reach, leaves at every branch tip, every ink cell covered by core leaves, oak proportions,
pipe-model radii, determinism). If you deliberately change a rule, update the matching assertion.

## 3. Meshes and materials (`js/tree-mesh.js`)

- `PALETTE.bark`: trunk colour. `PALETTE.leaf`: fallback leaf colours (plots override via `colors`).
- `FOLIAGE_TEXTURE_URL`: foliage sprite (Bruno Simon's foliage SDF, MIT, see
  `assets/textures/third-party/`): a grayscale distance field of a clump of small leaves, cut at
  `LEAF_THRESHOLD` (lower = fatter leaves). Any grayscale SDF/mask works (red channel is read).
  `LEAF_SIZE`: quad size in metres. Leaf colour = mix of the darkest and lightest plot colour by
  how much the crown faces the sun (`SUN_OFFSET`).
- `SIDES` (8): sides of each branch cross-section. Higher = rounder silhouette, more triangles.
- Branch normals are written by hand (radial per ring) and triangles must wind counter-clockwise
  seen from outside. If you change `connect()` or `ring()`, keep that order: inward-facing triangles
  bring back striped shadow acne on the trunks.
- Leaf orientation: `rotations` in `buildTreeScene` (random tilt/heading/spin). Leaf lighting does not use
  the quad orientation but the crown normal (`aCrown`), so the crown shades as one rounded mass.
- Filler fade: `fillerFade` (set in `garden.js` from the camera's downward angle) dissolves filler leaves
  and branches with an ordered dither. Change the angles in `smoothstep(-projected.y, 0.45, 0.8)`.
- Far minimap zoom: `mapFill` closes the gaps between voxels/tiles above 90–160 m camera height.
- Floor tiles: `PALETTE.tile` / `tileInk`, `MARGIN`, erosion probabilities `KEEP`.

### Using a modelled (GLB) tree or prop

There is no importer UI. Put files in `assets/models/` and load them from code. First vendor a
`GLTFLoader` matching the Three.js version under `vendor/three/addons/loaders/` (not included).

```js
// garden.js, top:
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// inside init(), after `physics` exists:
const gltf = await new GLTFLoader().loadAsync('./assets/models/bench.glb');
gltf.scene.position.set(8, 0, 4);
gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
scene.add(gltf.scene);
physics.box(8, 0.5, 4, 1, 0.5, 0.4); // half-sizes; a mesh alone does not block the player
```

To replace only the leaf look, change the sprite rather than the generator. To replace whole trees
with a model, keep `planForest()` for positions (`forest.roots`) and place a model per root instead of
`branchGeometry()`; leaf sinking/voxel blending then has to be reimplemented for that model.

## 4. Shaders

A shader runs on the GPU. `uniforms` are values passed from JavaScript; the vertex shader moves
corners of triangles; the fragment shader picks each pixel's colour. Three.js built-in materials
are patched with `onBeforeCompile` (string replace of a `#include` chunk), so lighting/shadows keep working.

| File → function | What it does | Typical edits |
|-----------------|--------------|---------------|
| `tree-mesh.js` → `addSway()` + leaf `onBeforeCompile` | Shared wind (`windHere`), sprite cut + shimmer, two-tone colour, filler / see-through discard, `uSink`, `uFade` | `0.35` crown lean, `2.2` shimmer, `LEAF_THRESHOLD` |
| `tree-mesh.js` → voxel `onBeforeCompile` | `uRise` height of the voxel text | – |
| `park.js` → `bladeMat.onBeforeCompile` | Grass sway, bending away from `uPlayer`, tip colour `uTip` | `PARK_COLORS.grassTip`, bend radius |
| `island.js` → `buildWater()` | Ocean colour by depth, shore foam, rings | Colours, foam width |
| `fountain.js` → `waterSurface()` | Stylised water after bruno-simon.com: depth colour, rim foam, drifting foam strokes, white line around the pillar | `WATER_COLORS`, number of bands (`depth * 5.0`), drift speed (`0.35`) |
| `fountain.js` → droplet `Points` | Opaque two-tone droplets on ballistic arcs | `WATER_COLORS.dropCore` / `dropRim`, counts/sizes in `addEmitter()` calls |
| `tree-mesh.js` → `BAYER_GLSL` | Ordered dither used to dissolve filler leaves and bark | – |
| `post.js` | Bloom chain + composite: tilt/haze blur, vignette, colour grading | See section 8 |
| `sky.js` | Sky dome gradient + sun glow, cloud material | `SKY` colours |
| `wind-lines.js` | Wind line ribbon width / travelling bump | `WIND_LINES` |
| `garden.js` top | Hemisphere + sun light, shadow map size and area (`SHADOW_HALF`) | Mood/lighting (sky colours live in `sky.js`) |

`wind.value` (seconds) is the shared clock for all animated shaders. Colours above 1.0 trigger the
post glow. Check the browser console after shader edits: a GLSL typo shows as a compile error
and the object disappears.

## 5. Movement and camera (`js/garden.js`)

- `WALK_SPEED` (8 m/s), `RUN_SPEED` (14 m/s, hold Shift), next to `viewBlend`.
- Start: `RAMP_S` (0.15 s) from standstill to full speed, linear. Stop: `DECEL` (10) damping rate,
  about `3 / DECEL` seconds of glide. Lower `DECEL` = longer glide.
- Hop-and-wobble walk: `HOP.rate` (hops/s at walking speed), `HOP.height` (m), `HOP.lean` (rad).
  It only moves the `visual` group (body + eyes), never the physics capsule.
- Walk <-> minimap transition: `TRANSITION_S` (0.5 s); `ROTATE_SHARE` (0.4) = share of it used
  to finish the rotation before the position arrives.
- Jump/gravity: `JUMP_SPEED`, `GRAVITY` in `js/physics.js`.
- Camera arm: `shoulderPose()` (4.2 m behind, 0.85 m right, 2 m up). `PITCH_RANGE`: looking down
  orbits the camera up around the character (it keeps its place on screen).

## 6. Trees to voxels (minimap)

`viewBlend()` maps camera height 25–70 m to progress 0–1. `setFlat()` in `tree-mesh.js`: branches
fade over 0–0.3, leaves sink (`uSink`) over 0.05–0.8 and fade over 0.65–0.8, voxels appear over 0.05–0.5.
Opening the minimap targets at least 70 m height, where the voxel text is fully readable.

## 7. Park, grass and props

`buildPark()` in `js/park.js` builds paths, benches, lodges, lamps, bushes, flowers and grass
procedurally; `PARK_COLORS` holds their colours. Each solid prop needs a mesh and a physics collider.
Grass is sampled on a 0.32 m grid (density rejection `0.08 + 0.85 * dense`); clear an area by adding
e.g. `if (Math.hypot(px - 10, pz - 8) < 3) continue;` before `blades.push()`. No grass-painting editor exists.
Falling leaves: see section 8 (wind).

## 8. Wind, sky and post processing

**Wind (`js/wind.js`).** One wind for everything: `WIND.angle` (direction), `WIND.strength`,
`WIND.speed` (how fast gusts travel). Grass, tree crowns, the foliage shimmer, falling leaves and
wind lines all read it. To make a calmer island lower `strength`; to change direction change `angle`.
- Grass bend: `windHere * k * bladeH * 1.2` in `park.js` (blade material).
- Crown lean / shimmer: `windHere * 0.35 * h` and `length(windHere) * 2.2` in `tree-mesh.js`.
- Falling leaves (`leaf-fall.js`): `AIR_SPEED`, `GROUND_SPEED`, `GUST` (wind needed to move a resting
  leaf), `KICK_RADIUS`, `RATE`, `POOL`, `REST`, `FADE`, `SIZE`.
- Wind lines (`wind-lines.js`): `LENGTH` (28 m), `WAVE` (how much the line waves), and `WIND_LINES`
  (interval, duration, drift, thickness, spread, height).

**Sky (`js/sky.js`).** `SKY` colours (horizon = fog colour, zenith, sun glow, cloud tints) and
`CLOUDS` (count, area, height, size, drift speed). Clouds are hidden in the minimap.

**Post processing (`js/post.js`, Settings → Post processing).** Sliders change `POST_SETTINGS` live;
the defaults ("Reset to default") are `POST_DEFAULTS`, the split-toning colours `GRADE_COLORS`.
To add a new effect later:
1. add a uniform and its GLSL in the composite pass (`composite = pass(...)`), inside the
   `if (uEnabled > 0.5)` block if it should follow the checkbox;
2. set the uniform from `POST_SETTINGS` in `render()`;
3. add a default to `POST_DEFAULTS` and a row `{ key, label, min, max, step }` to `POST_CONTROLS`:
   the settings panel builds the slider automatically.

**Lighting (`js/garden.js` top).** Hemisphere (sky / violet bounce), sun colour + intensity,
`SHADOW_HALF` (shadow area while walking / in the minimap: smaller = sharper shadows).
`SUN_OFFSET` (in `tree-mesh.js`) is the sun direction used by the light and the foliage two-tone.

## 9. Verify after changes

1. `node tests/tree-growth.test.cjs` (tree generator).
2. Reload the page; console must be free of errors.
3. Walk (WASD, Shift, Space), open the minimap, zoom in/out, replay growth, resize the window.
Performance scales with total leaves (`leavesPerCell`, `gapDensity`, text length) and the shadow map size.

## 10. Streaming (big islands)

Trees are planned at start (`planForest()`) but only built when you come near
(`treeSettings.buildsPerFrame`, default 4 per frame, nearest first) and freed after they shrink away.
Grass streams in squares (`GRASS` in `park.js`: chunk size, build radius, free radius, per frame).
Floor tiles and voxels are 32-cell chunks. Raise `buildsPerFrame` if trees appear too slowly when
running; lower it if you see hitches.

## 11. Baked minimap (`js/map-bake.js`)

Zoomed far out, the minimap shows one image of the island rendered from above at load time, instead
of the live 3D scene. `MAP_BAKE`: `size` (texture px; bigger = sharper text, more memory), `from` / `to`
(camera heights of the crossfade), `edge` (soft border). Anything that must not appear in the image
gets `object.userData.skipBake = true`; anything that must stay visible on top of it gets
`object.layers.enable(MAP_BAKE.layer)` (the player and the sea do).
