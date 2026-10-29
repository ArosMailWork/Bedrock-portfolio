import * as THREE from 'three';
import { maskFromPixelFont, maskFromBody } from './shape-mask.js';
import { planForest } from './shape-tree.js';
import { buildTreeScene, wind, treeSettings, fillerFade, barkFade, seeThrough, mapFill, mapCenter, SUN_OFFSET } from './tree-mesh.js';
import { PLOTS, CAREER, SOCIAL, PROJECTS, LAB, CARNIVAL } from './portfolio-data.js';
import { buildGround, buildWater, shoreRadius, WALK_LIMIT } from './island.js';
import { buildPark } from './park.js';
import { createWorkArea } from './work-area.js';
import { createShowcase, SHOWCASE, PATH_W } from './showcase.js';
import { createCarnival } from './carnival.js';
import { createInteractivePoints } from './interactive-points.js';
import { createPhysics } from './physics.js';
import { createPost, POST_DEFAULTS, POST_SETTINGS, POST_CONTROLS } from './post.js';
import { createLeafFall } from './leaf-fall.js';
import { updateWind } from './wind.js';
import { createWindLines } from './wind-lines.js';
import { createSky, SKY } from './sky.js';
import { bakeMap } from './map-bake.js';
import { createMap2D, MAP2D } from './map2d.js';

// ---------- Renderer, light and atmosphere ----------
const renderer = new THREE.WebGLRenderer({ antialias: false }); // MSAA happens in the post target
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.querySelector('#scene').appendChild(renderer.domElement);
const post = createPost(renderer);
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY.horizon); // the sky dome covers it; fog fades into the horizon
const fog = new THREE.Fog(SKY.horizon, 90, 260);
scene.fog = fog;
// Bruno's day palette: warm sun (#ffd2c2) + violet bounce, so shadowed areas read violet.
const hemisphere = new THREE.HemisphereLight(0xfff0e0, 0x6a58d6, 1.5);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffd2c2, 2.9);
sun.castShadow = true;
// Sharp shadows: a small frustum around what the camera looks at (2048 px over 48 m = 2.3 cm per
// texel while walking), widened in the minimap. The frustum is snapped to whole texels so
// shadow edges do not crawl while the player moves.
const SHADOW_HALF = { walk: 24, map: 70 };
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF.walk, right: SHADOW_HALF.walk, top: SHADOW_HALF.walk, bottom: -SHADOW_HALF.walk, near: 1, far: 160 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const sunDir = SUN_OFFSET.clone().normalize();
const sunRight = new THREE.Vector3(0, 1, 0).cross(sunDir).normalize(), sunUp = sunDir.clone().cross(sunRight);
const sky = createSky(scene, SUN_OFFSET);
const windLines = createWindLines(scene);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 900);
const marker = document.querySelector('#plot-marker');
const viewToggle = document.querySelector('#view-toggle');
const info = document.querySelector('#plot-info');
const settingsToggle = document.querySelector('#settings-toggle');
const settingsPanel = document.querySelector('#settings');
const growRange = document.querySelector('#grow-range');
const growRangeValue = document.querySelector('#grow-range-value');
let park = null, leafFall = null, map2d = null, workArea = null, carnival = null;
const points = createInteractivePoints();
const status = document.querySelector('#status');
const keys = new Set(), plots = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let mode = 'walk', nearby = null, transition = null, islandR = 60; // mode: walk | entering | map | leaving-2d | leaving
// Focus (walk mode only): an area (showcase board, carnival booth) takes the camera to a fixed
// pose; walking and looking are off, Esc releases it. `stage` is the API handed to the areas.
let focus = null; // { eye, look, onExit }
const focusHud = document.createElement('div');
focusHud.id = 'focus-hud'; focusHud.className = 'hud-panel'; focusHud.hidden = true;
document.body.append(focusHud);
const stage = {
  camera, dom: renderer.domElement,
  get active() { return Boolean(focus); },
  focus(eye, look, onExit) {
    if (focus || mode !== 'walk' || transition) return false;
    focus = { eye: eye.clone(), look: look.clone(), onExit };
    keys.clear(); boost.on = false; dragging = false;
    viewToggle.disabled = true; marker.hidden = true;
    return true;
  },
  release() {
    if (!focus) return;
    const { onExit } = focus;
    focus = null; focusHud.hidden = true; viewToggle.disabled = false;
    onExit?.();
  },
  // HUD panel (bottom centre) while focused: html string, or null to hide.
  hud(html) { focusHud.hidden = html == null; if (html != null) focusHud.innerHTML = html; },
};
const target = new THREE.Vector3(), projected = new THREE.Vector3(), desired = new THREE.Vector3();
let cameraFloor = 0; // camera follows height slowly, so jumps read on screen
let armScale = 1;    // 0..1 share of the shoulder arm left after camera collision (smoothed)
let yaw = 0.25, pitch = 0.1, jumpQueued = false, character = null;
// Walk <-> map transition. The camera spirals around the destination: it climbs (log-lerped
// distance, polar angle to top-down) while turning its heading (azimuth) the short way round to
// north, both on one ease, so it rotates and rises at the same time. No roll: the up vector is the
// heading tilted by the polar angle, which ends as north-up when looking straight down.
// MAP_HEIGHT: height of the final top-down view (then handed over to the map controls).
const TRANSITION_S = 1.2, MAP_HEIGHT = 80;
// Cinematic ease: smootherstep on a warped clock, so the move starts gently, peaks early and
// settles over a long tail (no velocity jump at either end).
const cinematic = (t) => smoother(1 - (1 - t) ** 1.5);
const wrapAngle = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
// View layers by camera height (m), one rule for the map zoom and both transition flights (no
// separate timing): full 3D trees below TREE_HEIGHTS[0], voxel text above TREE_HEIGHTS[1], blended
// in between. Higher up the live view morphs into the baked look (mapFill, MAP2D.fill) and the
// baked image fades in on top (map2d.js, map mode only).
const TREE_HEIGHTS = [20, 45];
// Camera motion blur strength during transitions (screen smear per frame of motion).
const MOTION_BLUR = { pan: 1.0, zoom: 0.8, max: 0.04 };
const smoother = (t) => t * t * t * (t * (6 * t - 15) + 10);
// Movement feel (Settings > MOVE). Speeds in m/s. Starting: the velocity ramps linearly from 0 to
// full speed in rampS seconds. Slowing down (keys released, or a lower target speed) it glides:
// exponential damping, ~95% of the excess gone after stopGlide seconds.
// Boost: double-tap Shift (second tap within doubleTap s) and keep it held: the speed keeps climbing
// from runSpeed to boostX x walkSpeed over boostTime seconds; releasing Shift ends it (glide down).
const MOVE_DEFAULTS = { walkSpeed: 8, runSpeed: 14, rampS: 0.15, stopGlide: 0.6, boostX: 10, boostTime: 4, doubleTap: 0.3 };
const MOVE = { ...MOVE_DEFAULTS };
const MOVE_CONTROLS = [
  { key: 'walkSpeed', label: 'Walk speed (m/s)', min: 2, max: 20, step: 0.5 },
  { key: 'runSpeed', label: 'Run speed, Shift (m/s)', min: 4, max: 40, step: 1 },
  { key: 'rampS', label: 'Start-up time (s)', min: 0.05, max: 1, step: 0.05 },
  { key: 'stopGlide', label: 'Stop glide (s)', min: 0.1, max: 2, step: 0.05 },
  { key: 'boostX', label: 'Boost max (x walk speed)', min: 2, max: 20, step: 1 },
  { key: 'boostTime', label: 'Boost ramp time (s)', min: 0.5, max: 15, step: 0.5 },
  { key: 'doubleTap', label: 'Double-tap window (s)', min: 0.15, max: 0.6, step: 0.05 },
];
const boost = { on: false, speed: 0, lastShift: -Infinity };
const velocity = new THREE.Vector2(); // horizontal x/z velocity, kept between frames (momentum)
// Hop-and-wobble walk (after "We Become What We Behold"): hops per second at walking speed,
// hop height (m), sideways lean while airborne (rad). Purely visual; physics is untouched.
const HOP = { rate: 3.2, height: 0.25, lean: 0.17 };

const player = new THREE.Group();
const visual = new THREE.Group(); // hops/wobbles inside the physics-driven player group
player.add(visual);
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.72, 5, 10), new THREE.MeshLambertMaterial({ color: 0xf0b46e }));
body.position.y = 0.78; body.castShadow = true; visual.add(body);
const face = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0x35473a }));
face.position.set(-0.14, 1.1, -0.38); visual.add(face);
const otherEye = face.clone(); otherEye.position.x = 0.14; visual.add(otherEye);
// The player is not part of the baked map (map2d.js draws a dot instead).
player.userData.skipBake = true;
scene.add(player);
let hopPhase = 0, hopAmount = 0;
// Phase advances with distance travelled, so running hops faster. Each hop is half a sine
// period: up, lean to one side, land upright with a short squash; the next hop leans the other way.
function animateHop(dt, speed, grounded) {
  hopAmount = THREE.MathUtils.damp(hopAmount, grounded && speed > 0.5 ? 1 : 0, 10, dt);
  if (hopAmount < 0.01) { hopPhase = 0; visual.position.y = 0; visual.rotation.set(0, 0, 0); visual.scale.set(1, 1, 1); return; }
  // Hop rate follows the speed up to running pace (boost speeds would make it a jitter).
  hopPhase += dt * Math.PI * HOP.rate * THREE.MathUtils.clamp(speed / MOVE.walkSpeed, 0.6, MOVE.runSpeed / MOVE.walkSpeed);
  const s = Math.sin(hopPhase), air = Math.abs(s), squash = (1 - air) ** 6 * hopAmount;
  visual.position.y = HOP.height * air * hopAmount;
  visual.rotation.set(-0.08 * hopAmount, 0, HOP.lean * s * hopAmount);
  visual.scale.set(1 + 0.1 * squash, 1 - 0.14 * squash, 1 + 0.1 * squash);
}

// Over-the-shoulder camera. Vertical drag changes the aim only; Rapier shortens the arm
// when something solid sits between the shoulder and the camera.
// Looking up only moves the aim. Looking down orbits eye and aim around the shoulder anchor by
// the same angle, so the camera rises and the character keeps its place in the frame.
const PITCH_RANGE = [-0.9, 0.65];
function shoulderPose() {
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const focus = player.position.clone().addScaledVector(forward, 5);
  focus.y = cameraFloor + 2 + Math.tan(Math.max(pitch, 0)) * 9.2;
  const eye = player.position.clone().addScaledVector(forward, -4.2).addScaledVector(right, 0.85);
  eye.y = cameraFloor + 2;
  const anchor = player.position.clone(); anchor.y = cameraFloor + 1.6;
  if (pitch < 0) {
    eye.sub(anchor).applyAxisAngle(right, pitch).add(anchor);
    focus.sub(anchor).applyAxisAngle(right, pitch).add(anchor);
  }
  eye.lerpVectors(anchor, eye, armScale);
  return { eye, focus, anchor };
}
// Shorten the arm only for real obstacles (with a margin past the camera, so hits that flicker
// right at the ray end cannot toggle it), then ease: fast in, slow back out.
function updateArm(dt) {
  if (!character) return;
  const full = shoulderPoseUnclipped();
  const len = full.anchor.distanceTo(full.eye);
  const probe = full.eye.clone().sub(full.anchor).multiplyScalar((len + 0.4) / len).add(full.anchor);
  const clear = character.clearDistance(full.anchor, probe);
  const wanted = clear < len + 0.3 ? THREE.MathUtils.clamp((clear - 0.4) / len, 0.08, 1) : 1;
  armScale = THREE.MathUtils.damp(armScale, wanted, wanted < armScale ? 20 : 3, dt);
}
function shoulderPoseUnclipped() {
  const saved = armScale; armScale = 1;
  const pose = shoulderPose();
  armScale = saved;
  return pose;
}

// ---------- Input ----------
// Walking: drag to look around. The map mode has its own pan / zoom (map2d.js).
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (mode !== 'walk' || focus || event.button !== 0) return;
  dragging = true; renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging || mode !== 'walk') return;
  yaw -= event.movementX * 0.004;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.003, PITCH_RANGE[0], PITCH_RANGE[1]);
});
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('lostpointercapture', () => { dragging = false; });

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  park?.setViewport(innerHeight * renderer.getPixelRatio(), camera.fov);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
function plotViewSize(plot) {
  return 12 + Math.max(plot.h + 18, (plot.w + 16) / (innerWidth / innerHeight)) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
// CSS px per metre on the ground seen by a top-down camera at height h (and back): the map view
// (map2d.js) and the top-down 3D camera share this scale, so the baked image lines up.
const ppmAt = (h) => innerHeight / (2 * h * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
const heightAt = (ppm) => innerHeight / (2 * ppm * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
// The single height rule for the view layers (see TREE_HEIGHTS): sets the baked-look morph and
// returns the tree <-> voxel blend (0 = 3D trees, 1 = voxel text) for a camera at height y.
function applyLayers(y) {
  mapFill.value = map2d.fillAt(ppmAt(y));
  return THREE.MathUtils.smoothstep(y, TREE_HEIGHTS[0], TREE_HEIGHTS[1]);
}
function startTransition(toMap, destination, height) {
  mapCenter.value.copy(destination); // voxels pop in a wave from here
  transition = {
    start: performance.now() / 1000, toMap,
    from: camera.position.clone(), target: target.clone(),
    destination, height, prevNdc: null, prevDistance: 0,
  };
  mode = toMap ? 'entering' : 'leaving';
}
function beginView(toMap, plot = null) {
  if (transition || !plots.length || !map2d || mode === 'leaving-2d') return;
  keys.clear();
  dragging = false;
  viewToggle.disabled = true;
  marker.hidden = true;
  if (toMap) {
    const destination = plot ? new THREE.Vector3(plot.x, 0, plot.z) : new THREE.Vector3(player.position.x, 0, player.position.z);
    startTransition(true, destination, plot ? Math.max(MAP_HEIGHT, plotViewSize(plot)) : MAP_HEIGHT);
    document.body.classList.add('map-view'); info.hidden = false;
    return;
  }
  // Leaving: one flight from the current top-down view straight down to the player. Only if the
  // baked look still shows (zoomed far out) does the view first zoom in until it is gone.
  const view = map2d.view;
  const leave = () => {
    map2d.hide();
    startTransition(false, new THREE.Vector3(view.x, 0, view.z), heightAt(view.ppm));
  };
  if (map2d.fill === 0) { leave(); return; }
  mode = 'leaving-2d';
  map2d.flyTo(view.x, view.z, map2d.clearPpm, reducedMotion ? 0 : 0.45).then(leave);
}
marker.onclick = () => beginView(true, nearby);
// One toggle: map icon while walking, camera icon in the minimap.
viewToggle.onclick = () => beginView(mode === 'walk');
settingsToggle.onclick = () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsToggle.setAttribute('aria-expanded', String(!settingsPanel.hidden));
  settingsToggle.classList.toggle('active', !settingsPanel.hidden);
};
growRange.value = treeSettings.growRange;
growRange.oninput = () => {
  treeSettings.growRange = Number(growRange.value);
  growRangeValue.textContent = `${growRange.value} m`;
};
growRange.oninput();
// Post-processing panel: one slider per POST_CONTROLS row (post.js), plus enable and reset.
const postEnabled = document.querySelector('#post-enabled');
const postSliders = POST_CONTROLS.map(({ key, label, min, max, step }) => {
  const row = document.createElement('label');
  row.className = 'setting';
  row.innerHTML = `<span class="setting-row"><span>${label}</span><output></output></span><input type="range" min="${min}" max="${max}" step="${step}" />`;
  const input = row.querySelector('input'), output = row.querySelector('output');
  input.oninput = () => { POST_SETTINGS[key] = Number(input.value); output.textContent = Number(input.value).toFixed(2); };
  document.querySelector('#post-controls').append(row);
  return { key, input, output };
});
function syncPostPanel() {
  postEnabled.checked = POST_SETTINGS.enabled;
  for (const s of postSliders) { s.input.value = POST_SETTINGS[s.key]; s.output.textContent = POST_SETTINGS[s.key].toFixed(2); s.input.disabled = !POST_SETTINGS.enabled; }
}
postEnabled.onchange = () => { POST_SETTINGS.enabled = postEnabled.checked; syncPostPanel(); };
document.querySelector('#post-reset').onclick = () => { Object.assign(POST_SETTINGS, POST_DEFAULTS); syncPostPanel(); };
// Movement panel: one slider per MOVE_CONTROLS row, plus reset.
const moveSliders = MOVE_CONTROLS.map(({ key, label, min, max, step }) => {
  const row = document.createElement('label');
  row.className = 'setting';
  row.innerHTML = `<span class="setting-row"><span>${label}</span><output></output></span><input type="range" min="${min}" max="${max}" step="${step}" />`;
  const input = row.querySelector('input'), output = row.querySelector('output');
  input.oninput = () => { MOVE[key] = Number(input.value); output.textContent = Number(input.value).toFixed(2); };
  document.querySelector('#move-controls').append(row);
  return { key, input, output };
});
function syncMovePanel() {
  for (const s of moveSliders) { s.input.value = MOVE[s.key]; s.output.textContent = MOVE[s.key].toFixed(2); }
}
document.querySelector('#move-reset').onclick = () => { Object.assign(MOVE, MOVE_DEFAULTS); syncMovePanel(); };
syncMovePanel();
// Settings tabs: one section visible at a time.
const settingsTabs = [...document.querySelectorAll('.settings-tab')];
for (const tab of settingsTabs) {
  tab.onclick = () => {
    for (const other of settingsTabs) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      document.getElementById(other.getAttribute('aria-controls')).hidden = !selected;
    }
  };
}
syncPostPanel();
// Settings > GARDEN > Export: the current scene as .glb or .fbx (scene-export.js, loaded on demand).
const exportStatus = document.querySelector('#export-status');
for (const [id, kind] of [['#export-glb', 'glb'], ['#export-fbx', 'fbx']]) {
  document.querySelector(id).onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true; exportStatus.textContent = `Exporting ${kind.toUpperCase()}…`;
    try {
      const { exportGLB, exportFBX } = await import('./scene-export.js');
      const meshes = kind === 'glb' ? await exportGLB(scene) : exportFBX(scene);
      exportStatus.textContent = `Exported ${meshes} meshes as portfolio-garden.${kind}.`;
    } catch (error) {
      console.error(error);
      exportStatus.textContent = `Export failed: ${error.message}`;
    }
    button.disabled = false;
  };
}
// Minimap panel: follow-player toggle + smoothness slider (MAP2D.follow).
const mapFollow = document.querySelector('#map-follow'), mapFollowSmooth = document.querySelector('#map-follow-smooth');
const mapFollowValue = document.querySelector('#map-follow-value');
function syncMapFollow() {
  mapFollow.checked = MAP2D.follow.on;
  mapFollowSmooth.value = MAP2D.follow.smooth;
  mapFollowSmooth.disabled = !MAP2D.follow.on;
  mapFollowValue.textContent = Number(MAP2D.follow.smooth).toFixed(2);
}
mapFollow.onchange = () => { MAP2D.follow.on = mapFollow.checked; syncMapFollow(); };
mapFollowSmooth.oninput = () => { MAP2D.follow.smooth = Number(mapFollowSmooth.value); syncMapFollow(); };
syncMapFollow();
addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
    event.preventDefault();
    if (event.code === 'Space') { if (!event.repeat && (mode === 'walk' || mode === 'map')) jumpQueued = true; }
    else if (event.code === 'Escape' && focus) stage.release();
    else if (event.code === 'Escape' && mode === 'map') beginView(false);
    else if (focus) return;
    else if (mode === 'walk' || mode === 'map') {
      keys.add(event.code);
      // Boost: the second Shift press within MOVE.doubleTap seconds of the first.
      if (event.code.startsWith('Shift') && !event.repeat) {
        const now = performance.now() / 1000;
        if (now - boost.lastShift <= MOVE.doubleTap) boost.on = true;
        boost.lastShift = now;
      }
    }
  }
});
addEventListener('keyup', (event) => {
  keys.delete(event.code);
  if (!keys.has('ShiftLeft') && !keys.has('ShiftRight')) boost.on = false;
});
addEventListener('blur', () => { keys.clear(); boost.on = false; });
addEventListener('visibilitychange', () => keys.clear());
addEventListener('resize', resize);
document.querySelector('#replay').onclick = () => { plots.forEach((p) => p.view.setGrowth(0)); };

// Plot text = one mask, 1 cell = 1 m, one tree size everywhere:
//   title: TEXT.titleScale x the font (each font pixel becomes a 2 x 2 block), kind 0;
//   lines: font size, kind 0;  body (optional paragraphs): font size, word-wrapped to
//   TEXT.bodyWrap font pixels (~60 characters), kind 1 (own colours, `bodyColors`).
// `kind` per cell lets trees and voxels pick their colours.
const TEXT = { titleScale: 2, lineGap: 3, bodyGap: 6, bodyWrap: 360 };
const upscale = (m, k) => {
  const cells = new Uint8Array(m.w * k * m.h * k);
  for (let z = 0; z < m.h * k; z++) for (let x = 0; x < m.w * k; x++) cells[z * m.w * k + x] = m.cells[Math.floor(z / k) * m.w + Math.floor(x / k)];
  return { w: m.w * k, h: m.h * k, cells };
};
async function plotMask(data) {
  const blocks = [{ mask: upscale(await maskFromPixelFont(data.title), TEXT.titleScale), kind: 0, gap: 0 }];
  for (const line of data.lines) blocks.push({ mask: await maskFromPixelFont(line), kind: 0, gap: TEXT.lineGap });
  if (data.body?.length) blocks.push({ mask: await maskFromBody(data.body, { maxWidth: TEXT.bodyWrap }), kind: 1, gap: TEXT.bodyGap });
  const w = Math.max(...blocks.map((b) => b.mask.w));
  const h = blocks.reduce((sum, b) => sum + b.gap + b.mask.h, 0);
  const cells = new Uint8Array(w * h), kind = new Uint8Array(w * h);
  let row = 0;
  for (const { mask: m, kind: k, gap } of blocks) {
    row += gap;
    const left = Math.floor((w - m.w) / 2);
    for (let z = 0; z < m.h; z++) for (let x = 0; x < m.w; x++) {
      const at = (row + z) * w + left + x;
      cells[at] = m.cells[z * m.w + x];
      kind[at] = k;
    }
    row += m.h;
  }
  return { w, h, cells, kind };
}
// Default body colours: the plot colours, darker (same hue).
const darker = (hex) => { const c = new THREE.Color(hex), hsl = c.getHSL({}); return c.setHSL(hsl.h, hsl.s * 0.8, hsl.l * 0.62).getHex(); };

async function init() {
  const [physics, masks] = await Promise.all([createPhysics(), Promise.all(PLOTS.map(plotMask))]);

  // ---------- Plots: four quadrants around the plaza, slightly offset ----------
  // The gaps leave room for the ring road around the plaza and the cross axes between the plots.
  const GAP_X = 28, GAP_Z = 28, JITTER = [[-1.5, 1], [2, -1.2], [1, 1.8], [-2, -0.8]];
  // Island radius: smallest R keeping every tile (and lodge) on the lawn in ITS direction.
  let needR = 0;
  const reach = (px, pz, pad) => { needR = Math.max(needR, (Math.hypot(px, pz) + pad) / (0.86 * shoreRadius(Math.atan2(pz, px), 1))); };
  PLOTS.forEach((data, i) => {
    // Trees are only planned here; their branches and leaves are built when the player comes near.
    const forest = planForest(masks[i], { seed: i * 17 + 3 });
    const sx = i % 2 ? 1 : -1, sz = i < 2 ? -1 : 1;
    // The walkway spur leaves from the corner facing the plaza (-sx, -sz).
    const view = buildTreeScene(forest, masks[i], { colors: data.colors, bodyColors: data.bodyColors || data.colors.map(darker), seed: i * 1.7, toward: [-sx, -sz], rootChips: data.title === 'ABOUT' });
    const { w, h } = view.size;
    const x = sx * (w / 2 + GAP_X / 2) + JITTER[i][0], z = sz * (h / 2 + GAP_Z / 2) + JITTER[i][1];
    view.group.position.set(x, 0, z);
    scene.add(view.group);
    // Entrance: where the walkway spur leaves the tiles; the main park path ends here.
    const entrance = new THREE.Vector3(x + view.entry.x, 0, z + view.entry.z);
    for (const root of forest.roots) physics.cylinder(x + root.x, 1.6, z + root.z, 1.6, root.radius * 0.9);
    for (const cell of view.floor) reach(x + cell.x, z + cell.z, 2);
    plots.push({ data, forest, view, x, z, w, h, entrance, flat: -1 });
  });
  const maxW = Math.max(...plots.map((p) => p.w));
  const houses = [-1, 1].map((side) => ({ x: side * (GAP_X / 2 + maxW / 2), z: 0, angle: -side * Math.PI / 2 }));
  for (const h of houses) reach(h.x, h.z, 6);
  // WORK quadrant: the career road leaves the WORK title plot northwards and ends in the social
  // circle (work-area.js). Built before the island size is fixed, so it stays on the lawn.
  const workPlot = plots.find((p) => p.data.title === 'WORK');
  const roadStart = workPlot.z - workPlot.h / 2 + 1, boardZ = [roadStart - 9, roadStart - 24]; // Projects, Lab
  workArea = await createWorkArea({ scene, physics, points, x: workPlot.x, zStart: roadStart, career: CAREER, social: SOCIAL, exits: boardZ.map((z) => ({ z, half: PATH_W / 2 })) });
  // Projects and Lab boards on patios east of the career road (past the month counter), joined to
  // the road by short paths.
  const road = workArea.road, curb = road.x + road.halfW + 0.2;
  const east = new THREE.Vector3(-1, 0, 0); // boards face the road (west)
  const patioX = curb + 3 + SHOWCASE.patioR;
  const showcases = [
    createShowcase({ scene, physics, points, stage, kind: 'projects', title: 'PROJECTS', items: PROJECTS, x: patioX, z: boardZ[0], facing: east, entryX: curb }),
    createShowcase({ scene, physics, points, stage, kind: 'lab', title: 'LAB', items: LAB, x: patioX, z: boardZ[1], facing: east, entryX: curb }),
  ];
  // SKILLS quadrant: a fair of booths on the lawn south of the SKILLS title plot, in an arc.
  const skillsPlot = plots.find((p) => p.data.title === 'SKILLS');
  carnival = await createCarnival({ scene, physics, points, stage, booths: CARNIVAL, x0: skillsPlot.x, z0: skillsPlot.z + skillsPlot.h / 2 - 9 }); // arc centre: booths stand ~17 m south of the plot
  const areas = [workArea, ...showcases, carnival];
  for (const area of areas) for (const b of area.bounds) reach(b.x, b.z, b.r);
  const keepClear = (px, pz) => areas.some((area) => area.covers(px, pz));
  islandR = needR;
  // Transitions may look down from a few hundred metres; the far plane follows the island size.
  camera.far = Math.max(900, islandR * 3);
  camera.updateProjectionMatrix();

  // ---------- Island, sea, walls, park ----------
  const ground = buildGround(islandR);
  scene.add(ground.mesh);
  physics.trimesh(ground.vertices, ground.indices);
  scene.add(buildWater(islandR, wind));
  const wallSegments = 96;
  for (let i = 0; i < wallSegments; i++) {
    const a0 = (i / wallSegments) * Math.PI * 2, a1 = ((i + 1) / wallSegments) * Math.PI * 2;
    const r0 = WALK_LIMIT * shoreRadius(a0, islandR), r1 = WALK_LIMIT * shoreRadius(a1, islandR);
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0, x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    physics.box((x0 + x1) / 2, 1.5, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 0.3, 2, 0.3, Math.atan2(-(z1 - z0), x1 - x0));
  }
  park = buildPark({ scene, physics, R: islandR, plots, houses, time: wind, keepClear });
  leafFall = createLeafFall(scene, plots);
  for (const p of plots) { // entrance sign posts
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.4, 0.25), new THREE.MeshLambertMaterial({ color: 0x6b4f37 }));
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.12), new THREE.MeshLambertMaterial({ color: 0xf3efe6 }));
    const side = new THREE.Vector3(-p.entrance.z, 0, p.entrance.x).normalize().multiplyScalar(2);
    for (const m of [post, board]) { m.position.copy(p.entrance).add(side); m.castShadow = true; scene.add(m); }
    post.position.y = 0.7; board.position.y = 1.4;
    board.rotation.y = Math.atan2(p.entrance.x, p.entrance.z);
    physics.box(post.position.x, 0.7, post.position.z, 0.2, 0.7, 0.2);
  }

  // ---------- 2D map: one baked top-down image of the map state (map-bake.js, map2d.js) ----------
  map2d = createMap2D(bakeMap(renderer, scene, post, islandR, (extent) => {
    scene.fog = null;
    plots.forEach((p) => { p.view.setFlat(1); p.flat = -1; }); // flat = -1: re-applied next frame
    park.setFlat(1);
    fillerFade.value = 0; barkFade.value = 0; mapFill.value = 1;
    // Shadows over the whole island (coarse; only houses / props / bushes cast here).
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.set(0, 0, 0); sun.position.copy(SUN_OFFSET).multiplyScalar(3);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    scene.updateMatrixWorld();
  }, () => {
    scene.fog = fog;
    mapFill.value = 0;
    sun.shadow.camera.far = 160;
    sun.shadow.camera.right = 0; // forces the per-frame frustum update
  }));

  character = physics.createCharacter(0, 0.2, 10);
  Object.assign(player.position, character.feet());
  let pose = shoulderPose(); target.copy(pose.focus); camera.position.copy(pose.eye); camera.lookAt(target);
  resize(); status.hidden = true; viewToggle.disabled = false;
  let previous = performance.now() / 1000;
  const from = new THREE.Spherical(), to = new THREE.Spherical(), along = new THREE.Spherical();
  const centre = new THREE.Vector3(), endOffset = new THREE.Vector3(), ndc = new THREE.Vector3();
  const setViewLabel = () => {
    viewToggle.dataset.view = mode;
    viewToggle.querySelector('.view-label').textContent = mode === 'map' ? 'TPS CAMERA' : 'MINIMAP';
    viewToggle.setAttribute('aria-label', mode === 'map' ? 'Back to the garden view' : 'Open minimap');
  };

  renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000, dt = Math.min(now - previous, 0.05); previous = now;
    wind.value = now;
    let flat = mode === 'walk' ? 0 : 1;
    let haze = 0;

    // Movement (walk + map). Screen axes on the map, camera-yaw axes when walking.
    // Keys set a target velocity; the real velocity follows it (momentum). Shift runs; boost (double-
    // tapped Shift, held) keeps raising the target speed while moving.
    let wantX = 0, wantZ = 0, x = 0, z = 0;
    if (!transition && !focus && (mode === 'walk' || mode === 'map')) {
      x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      z = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      const length = Math.hypot(x, z) || 1;
      const boostMax = MOVE.walkSpeed * MOVE.boostX;
      boost.speed = boost.on && (x || z)
        ? Math.min(boostMax, Math.max(boost.speed, MOVE.runSpeed) + ((boostMax - MOVE.runSpeed) / MOVE.boostTime) * dt)
        : MOVE.runSpeed;
      const speed = boost.on ? boost.speed : keys.has('ShiftLeft') || keys.has('ShiftRight') ? MOVE.runSpeed : MOVE.walkSpeed;
      const f = mode === 'map' ? { x: 0, z: -1 } : { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const r = mode === 'map' ? { x: 1, z: 0 } : { x: Math.cos(yaw), z: -Math.sin(yaw) };
      wantX = ((r.x * x + f.x * z) / length) * speed;
      wantZ = ((r.z * x + f.z * z) / length) * speed;
    }
    const glide = 3 / MOVE.stopGlide; // damping rate: ~95% of the excess speed gone after stopGlide s
    if ((x || z) && Math.hypot(wantX, wantZ) >= velocity.length()) {
      // Speeding up / turning: linear ramp, full speed rampS seconds after starting from rest.
      const dvx = wantX - velocity.x, dvz = wantZ - velocity.y, gap = Math.hypot(dvx, dvz);
      const step = (Math.hypot(wantX, wantZ) / MOVE.rampS) * dt;
      if (gap <= step) velocity.set(wantX, wantZ); else velocity.set(velocity.x + (dvx / gap) * step, velocity.y + (dvz / gap) * step);
    } else {
      // Slowing down (stopped, or a lower target after run / boost): glide towards the target.
      velocity.set(THREE.MathUtils.damp(velocity.x, wantX, glide, dt), THREE.MathUtils.damp(velocity.y, wantZ, glide, dt));
      if (!(x || z) && velocity.lengthSq() < 1e-4) velocity.set(0, 0);
    }
    if (x || z) player.rotation.y = Math.atan2(-wantX, -wantZ);
    character.move(velocity.x * dt, velocity.y * dt, dt, jumpQueued && !transition);
    jumpQueued = false;
    physics.step(dt);
    Object.assign(player.position, character.feet());
    animateHop(dt, reducedMotion ? 0 : velocity.length(), character.grounded());
    cameraFloor = THREE.MathUtils.damp(cameraFloor, player.position.y, character.grounded() ? 6 : 1.5, dt);

    // Map: the map view (pan / zoom, map2d.js) drives a straight top-down 3D camera, north up.
    // Zooming in, voxels give way to 3D trees around the screen centre; zooming far out, the baked
    // image fades in on top. Once it covers the whole screen the 3D scene is not rendered.
    // Just before the image shows, the live view morphs into the baked look (mapFill), so the
    // crossfade blends two matching pictures. Layers follow the camera height (applyLayers).
    mapFill.value = 0;
    if (mode === 'map' || mode === 'leaving-2d') {
      map2d.update(player.position);
      const view = map2d.view, height = heightAt(view.ppm);
      camera.position.set(view.x, height, view.z);
      camera.rotation.set(-Math.PI / 2, 0, 0);
      target.set(view.x, 0, view.z);
      mapCenter.value.copy(target); // voxels sink / pop in a wave from the screen centre
      flat = applyLayers(height);
      if (map2d.opacity === 1) return;
    }

    let motionX = 0, motionY = 0, zoomBlur = 0;
    if (transition) {
      const progress = reducedMotion ? 1 : Math.min(1, (now - transition.start) / TRANSITION_S);
      haze = reducedMotion ? 0 : Math.sin(progress * Math.PI) * 0.35;
      const k = cinematic(progress);
      pose = shoulderPose();
      // Spiral around the centre: distance (log), polar angle and heading are interpolated on the
      // same ease. Top-down heads north (azimuth 0); the turn takes the short way round.
      // Leaving, the centre glides from the map view point to the player's shoulder view.
      const endCentre = transition.toMap ? transition.destination : pose.focus;
      centre.lerpVectors(transition.destination, endCentre, k);
      if (transition.toMap) endOffset.set(0, transition.height, 0); else endOffset.copy(pose.eye).sub(pose.focus);
      from.setFromVector3(desired.copy(transition.from).sub(transition.destination));
      to.setFromVector3(endOffset);
      if (transition.toMap) to.theta = from.theta + wrapAngle(-from.theta);
      else { from.theta = 0; to.theta = wrapAngle(to.theta); }
      along.set(Math.exp(THREE.MathUtils.lerp(Math.log(from.radius), Math.log(to.radius), k)),
        THREE.MathUtils.lerp(from.phi, to.phi, k), THREE.MathUtils.lerp(from.theta, to.theta, k));
      camera.position.setFromSpherical(along).add(centre);
      target.lerpVectors(transition.target, centre, k);
      // No roll: up = world up tilted towards the heading by the polar angle. Looking level it is
      // world up; looking straight down it is the heading (north at the map end), so lookAt never
      // degenerates.
      camera.up.set(-Math.sin(along.theta) * Math.cos(along.phi), Math.sin(along.phi), -Math.cos(along.theta) * Math.cos(along.phi));
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      // Layers by height: climbing, trees sink and voxels pop; descending, voxels sink and trees
      // regrow as soon as the camera drops below TREE_HEIGHTS (same rule as the map zoom).
      flat = applyLayers(camera.position.y);
      // Motion blur: how far the centre moved on screen since the last frame, and how fast the
      // camera approached / left it (radial smear).
      ndc.copy(centre).project(camera);
      const distance = camera.position.distanceTo(centre);
      if (transition.prevNdc && !reducedMotion) {
        const max = MOTION_BLUR.max;
        motionX = THREE.MathUtils.clamp((ndc.x - transition.prevNdc.x) * 0.5 * MOTION_BLUR.pan, -max, max);
        motionY = THREE.MathUtils.clamp((ndc.y - transition.prevNdc.y) * 0.5 * MOTION_BLUR.pan, -max, max);
        zoomBlur = THREE.MathUtils.clamp(((transition.prevDistance - distance) / distance) * MOTION_BLUR.zoom, -max * 2, max * 2);
      }
      transition.prevNdc = ndc.clone(); transition.prevDistance = distance;
      if (progress === 1) {
        camera.up.set(0, 1, 0);
        if (transition.toMap) {
          // Hand over to the map controls at the same framing (the image is still transparent).
          map2d.show(centre.x, centre.z, ppmAt(transition.height));
          mode = 'map';
        } else {
          mode = 'walk';
          info.hidden = true;
          document.body.classList.remove('map-view');
        }
        transition = null;
        viewToggle.disabled = false;
        setViewLabel();
      }
    } else if (mode === 'walk' && focus) {
      const k = reducedMotion ? 1 : 1 - Math.exp(-5 * dt);
      target.lerp(focus.look, k); camera.position.lerp(focus.eye, k); camera.lookAt(target);
    } else if (mode === 'walk') {
      updateArm(dt);
      pose = shoulderPose();
      const follow = reducedMotion ? 1 : 1 - Math.exp(-12 * dt);
      target.lerp(pose.focus, follow); camera.position.lerp(pose.eye, follow); camera.lookAt(target);
    }
    // Depth precision: the near plane follows the camera height (0.1 m walking, larger when high).
    const near = THREE.MathUtils.clamp(camera.position.y * 0.008, 0.1, 15);
    if (Math.abs(near - camera.near) > camera.near * 0.05) { camera.near = near; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
    // Filler leaves are for the walking view: they dissolve as the camera turns to look down.
    camera.getWorldDirection(projected);
    fillerFade.value = 1 - THREE.MathUtils.smoothstep(-projected.y, 0.45, 0.8);
    barkFade.value = mode === 'walk' ? 1 : fillerFade.value;
    // Leaves between the camera and the character are dropped (character always visible).
    seeThrough.value = mode === 'walk' && !transition && !focus ? camera.position.distanceTo(player.position) : 0;

    nearby = mode === 'walk' && !focus ? plots.find((plot) => plot.entrance.distanceTo(player.position) < 6) || null : null;
    marker.hidden = !nearby;
    if (nearby) {
      projected.copy(nearby.entrance); projected.y = 2.4; projected.project(camera);
      marker.hidden = Math.abs(projected.x) > 0.95 || Math.abs(projected.y) > 0.95 || projected.z > 1 || projected.z < -1;
      marker.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
      marker.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
      marker.querySelector('.marker-label').textContent = `MAP / ${nearby.data.title}`;
      marker.setAttribute('aria-label', `View ${nearby.data.title} from above`);
    }

    // Shadows follow what the camera looks at, snapped to whole shadow-map texels (in the light's
    // own right/up axes) so edges stay still while moving; fog recedes as the camera climbs.
    // Off the walking view the frustum grows with the camera height (in 20 m steps), so a zoomed-out
    // map shows no shadow square; the sun distance and depth range grow with it (the slanted
    // light sees a wider ground area deeper).
    const half = mode === 'walk' ? SHADOW_HALF.walk : Math.max(SHADOW_HALF.map, Math.ceil(camera.position.y / 20) * 20);
    const sunScale = Math.max(1, half / SHADOW_HALF.map);
    if (sun.shadow.camera.right !== half) {
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, far: 160 * sunScale });
      sun.shadow.camera.updateProjectionMatrix();
    }
    const texelSize = (2 * half) / sun.shadow.mapSize.x;
    const snap = (v) => Math.round(v / texelSize) * texelSize;
    desired.set(target.x, 0, target.z);
    const a = snap(desired.dot(sunRight)), b = snap(desired.dot(sunUp)), c = desired.dot(sunDir);
    sun.target.position.copy(sunRight).multiplyScalar(a).addScaledVector(sunUp, b).addScaledVector(sunDir, c);
    sun.position.copy(sun.target.position).addScaledVector(SUN_OFFSET, sunScale);
    scene.fog.near = 90 + camera.position.y * 1.5;
    scene.fog.far = 260 + camera.position.y * 3;
    post.uniforms.uHaze.value = haze;
    post.uniforms.uTilt.value = 0;
    post.uniforms.uMotion.value.set(motionX, motionY);
    post.uniforms.uZoomBlur.value = zoomBlur;

    if (Math.abs(flat - plots[0].flat) > 0.0001) park.setFlat(flat);
    for (const plot of plots) {
      if (Math.abs(flat - plot.flat) > 0.0001) { plot.view.setFlat(flat); plot.flat = flat; }
      // Trees grow around the player, or around the screen centre on the map.
      plot.view.tick(dt, mode === 'map' ? target : player.position, false, reducedMotion, camera);
    }
    park.setPlayer(player.position);
    workArea.update(dt, player.position);
    carnival.update(dt);
    points.update(player.position, camera, mode === 'walk' && !transition && !focus);
    updateWind(dt);
    leafFall.update(dt, player.position, flat < 0.3, velocity);
    windLines.update(dt, player.position, mode === 'walk' && !transition);
    sky.update(dt, camera, mode === 'walk' || Boolean(transition && !transition.toMap));
    post.render(scene, camera);
  });
}
init().catch((error) => { console.error(error); status.textContent = 'Could not load the garden. Please reload or check the console.'; });
