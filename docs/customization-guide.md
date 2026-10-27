# Customizing Portfolio Garden

## Run and reading order

Run `npx http-server . -p 4173 -c-1`, then open `http://localhost:4173/tree-demo.html`.
Do not open the HTML through `file://`: JavaScript modules, fonts and textures need HTTP.
There is no build step or package manifest. Three.js is loaded through the HTML import map.

Read in this order:
1. `tree-demo.html`: entry point, import map, HTML controls.
2. `js/portfolio-data.js`: portfolio content and per-plot foliage colours.
3. `js/garden.js`: startup, layout, camera, keyboard input, animation loop.
4. `js/shape-mask.js` → `js/shape-tree.js` → `js/tree-mesh.js`: text mask → tree data → visible meshes.
5. `js/park.js`, `js/island.js`, `js/fountain.js`: environment.

## Text and map

Edit `PLOTS` in `js/portfolio-data.js`: `title`, `lines`, `label`, `note`, `href`, `colors`.
Use short lines: characters occupy world-space cells, so longer text makes larger plots and islands.
The current layout assumes four plots in four quadrants; adding a fifth requires changing layout logic.
`plotMask()` in `garden.js` stacks text masks with three-cell line gaps. `shape-mask.js` owns glyph rendering.
`init()` in `garden.js` places plots using `GAP_X`, `GAP_Z`, `JITTER`; `houses` positions the lodges.
Coordinates: x/z are the ground plane, y is height. Plot-local coordinates are offset by the plot group.
The map is generated at runtime, not loaded from a saved map/JSON file.

## Items and imported models

Built-in objects are procedural geometry in `buildPark()` (`js/park.js`): paths, benches, houses,
lamps, bushes and flowers. `PARK_COLORS` controls their colours. The fountain lives in `js/fountain.js`.
Each solid object needs both a visible mesh and a physics collider. `physics.box()` receives half-sizes,
not full sizes. A mesh alone does not block the player.

There is no drag-and-drop asset importer. Put models in `assets/models/` and load them from code.
If adding GLTF loading, first provide a GLTFLoader compatible with the vendored Three.js version
(and its dependencies) under `vendor/three/addons/loaders/`; do not assume the loader is already installed.
Example, after the matching loader is available, inside async `init()`:

```js
// At the top of garden.js:
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Inside init(), after physics is available:
const gltf = await new GLTFLoader().loadAsync('./assets/models/bench.glb');
gltf.scene.position.set(8, 0, 4);
gltf.scene.scale.setScalar(1);
gltf.scene.traverse((object) => {
  if (object.isMesh) {
    object.castShadow = true;
    object.receiveShadow = true;
  }
});
scene.add(gltf.scene);
physics.box(8, 0.5, 4, 1, 0.5, 0.4);
```

Use GLB with embedded textures for simple deployment. Keep paths relative and filenames case-correct.
For textures, follow `loadTexture()` and `LEAF_TEXTURE_URL` in `tree-mesh.js`.
Colour textures use SRGB; numeric masks/normal maps should not be tagged as colour textures.

## Trees and foliage

`growTree()` in `shape-tree.js` controls crown spacing, trunk height, forks, leaf density and crown dome.
`seed` makes the same input produce the same tree. `leavesPerCell` controls density.
Leaves stay within 0.30 units of their source cell. Source cells now include sparse canopy-only cells in text gaps; only original ink cells become voxels.
The crown uses uneven height lobes and a compact upper foliage band. Downward twig targets are skipped.
`tree-mesh.js`: `PALETTE.bark`, fallback `PALETTE.leaf`, `LEAF_TEXTURE_URL`, leaf plane size and sway.
Per-plot `PLOTS.colors` overrides the fallback leaf palette.
`leaf-fall.js`: `RATE` (18 leaves/sec), `POOL` (384 live slots), `SPAWN_RADIUS`, `REST`, `FADE`.
Increasing rate alone will hit pool capacity. Falling leaves are hidden/paused in the minimap.

## Trees to voxels

`viewBlend()` in `garden.js` maps camera height 25–70 to progress 0–1.
Opening the minimap targets at least height 70 to show fully readable voxel text.
Zooming closer reverses the effect.
`setFlat()` in `tree-mesh.js`: branches fade first; `uSink` lowers foliage into the ground over
progress 0.05–0.8; leaf opacity fades at 0.65–0.8. Voxel opacity rises over 0.05–0.5.
Full leaf instance counts are kept during sinking to avoid disappearing chunks.

## Grass data and painting

There is currently NO grass painting editor or saved brush mask. `buildPark()` samples grass on a
0.32-unit grid using seeded randomness and a `clump` formula. It excludes paths, house areas, plaza,
and existing plot floor tiles. `groundColor()` in `island.js` provides the root colour.
Change `step`, the density rejection (`0.08 + 0.85 * dense`), blade height, or `PARK_COLORS.grassTip`.
To manually clear a patch, add a coordinate condition before `blades.push()`; e.g.
`if (Math.hypot(px - 10, pz - 8) < 3) continue;` clears a circular patch.
A painted grayscale texture could replace density selection later, but loading/sampling such a
mask and a painting interface are not implemented.

## Shaders and lighting

- `island.js` → `buildWater()`: ocean colours, shore foam, animated streaks. No inland river is active.
- `fountain.js` → `waterSurface()` and particle shaders: ripple colours, luminous rim, droplets.
- `tree-mesh.js` → `addSway()` and leaf `onBeforeCompile`: wind and foliage sinking.
- `park.js` → blade material `onBeforeCompile`: grass sway, player bending, tip colours.
- `post.js`: HDR glow threshold (1.15), glow strength (0.3), blur radius, vignette.
- `garden.js`: hemisphere/sun colours and intensities, sky/fog, shadow map and pixel-ratio cap.

A shader runs on the GPU. `uniforms` are values passed from JS; `vertexShader` moves vertices;
`fragmentShader` decides pixel colour. The shared `wind.value` clock animates these effects.
Colours above 1 in linear HDR can trigger glow. Glow is a screen-space effect, not a physical light.
Trade-off: more leaves, higher resolution, extra shader samples and larger shadow maps increase GPU work.

## Verification

Run `node tests/tree-growth.test.cjs` for 320 seeded/sparse/empty mask cases.
Test walking and minimap, zoom in/out, replay growth and window resize. Check the browser console
for shader compilation errors. Visual parity with the reference and low-end performance need manual review.

## Current visual tuning
Crown radius is capped at 3 in shape-tree.js; new roots cover outlying cells instead of long branches.
Terminal branches have a leaf clump at their endpoint. Changing this requires updating tree tests.
Voxel opacity uses smoothstep(progress, 0.05, 0.5), approximately 2/3 at camera height 42.2.
The heading has one MINIMAP button and scales to 0.667; dock/settings are at the top-right.
Fountain noise is quantized to three bands; particle silhouettes are hard octagons.
Walking tilt blur is off, transition haze remains. Brighter leaf palettes live in portfolio-data.js.

### Latest tree/UI adjustments
Fork nodes now stagger along trunk nodes 2–6. Crown radius and terminal-leaf checks remain.
The left view-toggle handles both MINIMAP and TPS CAMERA; right dock has settings/replay only.
Bark is #6b5442 (historical value), untextured. All plot palettes use #f22e26, the byte conversion
of ICQR Coral RGB [0.95,0.18,0.15] from its public bundle, not the distinct UI swatch #e83030.

### Spreading canopy tuning
`shape-tree.js`: crown tops use 7.2–8.4 times tree size. Limb shoulders travel 72% horizontally
and 35% vertically before the terminal segment. The 3-unit crown radius still bounds reach.
Empty cells in the mask bounds and within radius 3 of a crown receive one-third leaf density.
The `canopyOnly` marker is foliage-only; do not write these cells back into the text mask.
All gap leaves share normal foliage sinking and fading, with no voxel underneath.
Bark is #a77c59. Plot colours are now screenshot-matched pink/green/yellow/green, superseding
the raw Coral palette described above. Adjust PLOTS.colors for the final on-screen result.
