import * as THREE from 'three';
import { maskFromPixelFont, maskFromBody } from './shape-mask.js';
import { planForest } from './shape-tree.js';
import { buildTreeScene, wind, treeSettings, fillerFade, barkFade, seeThrough, mapFill, SUN_OFFSET } from './tree-mesh.js';
import { PLOTS } from './portfolio-data.js';
import { buildGround, buildWater, shoreRadius, WALK_LIMIT } from './island.js';
import { buildPark } from './park.js';
import { createPhysics } from './physics.js';
import { createPost, POST_DEFAULTS, POST_SETTINGS, POST_CONTROLS } from './post.js';
import { createLeafFall } from './leaf-fall.js';
import { updateWind } from './wind.js';
import { createWindLines } from './wind-lines.js';
import { createSky, SKY } from './sky.js';
import { createMapBake, MAP_BAKE } from './map-bake.js';

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
// Lights also shine on the few objects drawn over the baked minimap (layer MAP_BAKE.layer).
hemisphere.layers.enable(MAP_BAKE.layer); sun.layers.enable(MAP_BAKE.layer);
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
let park = null, leafFall = null, mapBake = null;
const status = document.querySelector('#status');
const keys = new Set(), plots = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let mode = 'walk', nearby = null, selected = null, transition = null, islandR = 60;
const target = new THREE.Vector3(), projected = new THREE.Vector3(), desired = new THREE.Vector3();
let cameraFloor = 0; // camera follows height slowly, so jumps read on screen
let armScale = 1;    // 0..1 share of the shoulder arm left after camera collision (smoothed)
let mapHeight = 80, zoomHeight = 80, yaw = 0.25, pitch = 0.1, jumpQueued = false, character = null;
const MAP_MIN_HEIGHT = 34; // closest minimap zoom: stays above the tallest canopy (~12 m)
let mapMaxHeight = 260;    // farthest minimap zoom; grows with the island (init)
const destinationRotation = new THREE.Quaternion();
const orientationCamera = camera.clone();
const TRANSITION_S = 0.5;
// Camera height -> 3D trees (0) / voxel text (1). Wheel zoom moves through this range.
const viewBlend = (height) => THREE.MathUtils.smoothstep(height, 25, 70);
const smooth = (t) => t * t * (3 - 2 * t);
// Movement feel. Speeds in m/s. Starting: the velocity ramps linearly from 0 to full speed in
// RAMP_S seconds. Stopping: it damps at DECEL per second (~95% gone after 3 / DECEL = 0.3 s glide).
const WALK_SPEED = 8, RUN_SPEED = 14, RAMP_S = 0.15, DECEL = 10;
const velocity = new THREE.Vector2(); // horizontal x/z velocity, kept between frames (momentum)
// Camera transitions: the rotation reaches its destination after this share of the transition,
// the position keeps easing over the whole transition.
const ROTATE_SHARE = 0.4;
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
// The player marker stays visible over the baked minimap; it is not baked itself.
player.traverse((o) => o.layers.enable(MAP_BAKE.layer));
player.userData.skipBake = true;
scene.add(player);
let hopPhase = 0, hopAmount = 0;
// Phase advances with distance travelled, so running hops faster. Each hop is half a sine
// period: up, lean to one side, land upright with a short squash; the next hop leans the other way.
function animateHop(dt, speed, grounded) {
  hopAmount = THREE.MathUtils.damp(hopAmount, grounded && speed > 0.5 ? 1 : 0, 10, dt);
  if (hopAmount < 0.01) { hopPhase = 0; visual.position.y = 0; visual.rotation.set(0, 0, 0); visual.scale.set(1, 1, 1); return; }
  hopPhase += dt * Math.PI * HOP.rate * Math.max(speed / WALK_SPEED, 0.6);
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
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (event) => {
  if ((mode !== 'walk' && mode !== 'map') || event.button !== 0) return;
  dragging = true; renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  if (mode === 'walk') {
    yaw -= event.movementX * 0.004;
    pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.003, PITCH_RANGE[0], PITCH_RANGE[1]);
    return;
  }
  if (mode !== 'map') return;
  const units = 2 * camera.position.y * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / renderer.domElement.clientHeight;
  const x = THREE.MathUtils.clamp(target.x - event.movementX * units, -islandR, islandR);
  const z = THREE.MathUtils.clamp(target.z - event.movementY * units, -islandR, islandR);
  camera.position.x += x - target.x; camera.position.z += z - target.z;
  target.x = x; target.z = z; camera.lookAt(target);
});
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('lostpointercapture', () => { dragging = false; });
renderer.domElement.addEventListener('wheel', (event) => {
  if (mode !== 'map') return;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
  zoomHeight = THREE.MathUtils.clamp(zoomHeight * Math.exp(delta * 0.0015), MAP_MIN_HEIGHT, mapMaxHeight);
}, { passive: false });

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
function beginView(toMap, plot = null) {
  if (transition || !plots.length) return;
  if (toMap) {
    selected = plot || plots.reduce((closest, p) =>
      Math.hypot(p.x - player.position.x, p.z - player.position.z) < Math.hypot(closest.x - player.position.x, closest.z - player.position.z) ? p : closest);
    mapHeight = zoomHeight = Math.max(70, plotViewSize(selected));
  }
  keys.clear();
  dragging = false;
  viewToggle.disabled = true;
  transition = {
    start: performance.now() / 1000, toMap, flatFrom: plots[0].flat, flatTo: toMap ? viewBlend(mapHeight) : 0,
    from: camera.position.clone(), rotation: camera.quaternion.clone(), target: target.clone(),
    destination: plot ? new THREE.Vector3(plot.x, 0, plot.z) : new THREE.Vector3(player.position.x, 0, player.position.z),
  };
  mode = toMap ? 'entering' : 'leaving';
  marker.hidden = true;
  document.body.classList.add('map-view'); info.hidden = false;
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
syncPostPanel();
addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
    event.preventDefault();
    if (event.code === 'Space') { if (!event.repeat && (mode === 'walk' || mode === 'map')) jumpQueued = true; }
    else if (event.code === 'Escape' && mode === 'map') beginView(false);
    else if (mode === 'walk' || mode === 'map') keys.add(event.code);
  }
});
addEventListener('keyup', (event) => keys.delete(event.code));
addEventListener('blur', () => keys.clear());
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
  const GAP_X = 16, GAP_Z = 14, JITTER = [[-1.5, 1], [2, -1.2], [1, 1.8], [-2, -0.8]];
  // Island radius: smallest R keeping every tile (and lodge) on the lawn in ITS direction.
  let needR = 0;
  const reach = (px, pz, pad) => { needR = Math.max(needR, (Math.hypot(px, pz) + pad) / (0.86 * shoreRadius(Math.atan2(pz, px), 1))); };
  PLOTS.forEach((data, i) => {
    // Trees are only planned here; their branches and leaves are built when the player comes near.
    const forest = planForest(masks[i], { seed: i * 17 + 3 });
    const view = buildTreeScene(forest, masks[i], { colors: data.colors, bodyColors: data.bodyColors || data.colors.map(darker), seed: i * 1.7 });
    const { w, h } = view.size, sx = i % 2 ? 1 : -1, sz = i < 2 ? -1 : 1;
    const x = sx * (w / 2 + GAP_X / 2) + JITTER[i][0], z = sz * (h / 2 + GAP_Z / 2) + JITTER[i][1];
    view.group.position.set(x, 0, z);
    scene.add(view.group);
    // Entrance: walk from the plot centre towards the plaza until the tiles end.
    const dir = new THREE.Vector3(-x, 0, -z).normalize();
    let t = 0;
    while (view.isFloor(dir.x * t, dir.z * t) && t < 3000) t += 0.5;
    const entrance = new THREE.Vector3(x + dir.x * (t + 1.8), 0, z + dir.z * (t + 1.8));
    for (const root of forest.roots) physics.cylinder(x + root.x, 1.6, z + root.z, 1.6, root.radius * 0.9);
    for (const cell of view.floor) reach(x + cell.x, z + cell.z, 2);
    plots.push({ data, forest, view, x, z, w, h, entrance, flat: -1 });
  });
  const maxW = Math.max(...plots.map((p) => p.w));
  const houses = [-1, 1].map((side) => ({ x: side * (GAP_X / 2 + maxW / 2), z: 0, angle: -side * Math.PI / 2 }));
  for (const h of houses) reach(h.x, h.z, 6);
  islandR = needR;
  // Whole island must fit the farthest minimap zoom; the far plane follows.
  mapMaxHeight = Math.max(260, islandR * 2.2);
  camera.far = Math.max(900, mapMaxHeight * 1.6);
  camera.updateProjectionMatrix();

  // ---------- Island, sea, walls, park ----------
  const ground = buildGround(islandR);
  scene.add(ground.mesh);
  physics.trimesh(ground.vertices, ground.indices);
  const water = buildWater(islandR, wind);
  water.layers.enable(MAP_BAKE.layer); // the live sea stays visible around / under the baked map
  scene.add(water);
  const wallSegments = 96;
  for (let i = 0; i < wallSegments; i++) {
    const a0 = (i / wallSegments) * Math.PI * 2, a1 = ((i + 1) / wallSegments) * Math.PI * 2;
    const r0 = WALK_LIMIT * shoreRadius(a0, islandR), r1 = WALK_LIMIT * shoreRadius(a1, islandR);
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0, x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    physics.box((x0 + x1) / 2, 1.5, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 0.3, 2, 0.3, Math.atan2(-(z1 - z0), x1 - x0));
  }
  park = buildPark({ scene, physics, R: islandR, plots, houses, time: wind });
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

  // ---------- Baked minimap (map-bake.js): one top-down render of the map state ----------
  mapBake = createMapBake(renderer, scene, islandR);
  mapBake.bake((orthoCamera, extent) => {
    scene.fog = null;
    plots.forEach((p) => { p.view.setFlat(1); p.flat = -1; });
    park.setFlat(1);
    fillerFade.value = 0; barkFade.value = 0; mapFill.value = 1;
    // Shadows over the whole island (coarse, only houses / props / bushes cast here).
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.set(0, 0, 0); sun.position.copy(SUN_OFFSET).multiplyScalar(3);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    scene.updateMatrixWorld();
  }, () => {
    scene.fog = fog;
    sun.shadow.camera.far = 160;
    sun.shadow.camera.right = 0; // forces the per-frame frustum update
  });

  character = physics.createCharacter(0, 0.2, 10);
  Object.assign(player.position, character.feet());
  let pose = shoulderPose(); target.copy(pose.focus); camera.position.copy(pose.eye); camera.lookAt(target);
  resize(); status.hidden = true; viewToggle.disabled = false;
  let previous = performance.now() / 1000;

  renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000, dt = Math.min(now - previous, 0.05); previous = now;
    wind.value = now;
    let flat = mode === 'walk' ? 0 : viewBlend(camera.position.y);
    let haze = 0, tilt = 0;

    // Movement (walk + minimap). Screen axes in the minimap, camera-yaw axes when walking.
    // Keys set a target velocity; the real velocity follows it (momentum). Shift runs.
    let wantX = 0, wantZ = 0, x = 0, z = 0;
    if (!transition && (mode === 'walk' || mode === 'map')) {
      x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      z = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      const length = Math.hypot(x, z) || 1;
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
      const f = mode === 'map' ? { x: 0, z: -1 } : { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const r = mode === 'map' ? { x: 1, z: 0 } : { x: Math.cos(yaw), z: -Math.sin(yaw) };
      wantX = ((r.x * x + f.x * z) / length) * speed;
      wantZ = ((r.z * x + f.z * z) / length) * speed;
    }
    if (x || z) {
      // Linear ramp: full speed is reached RAMP_S seconds after starting from rest.
      const dvx = wantX - velocity.x, dvz = wantZ - velocity.y, gap = Math.hypot(dvx, dvz);
      const step = (Math.hypot(wantX, wantZ) / RAMP_S) * dt;
      if (gap <= step) velocity.set(wantX, wantZ); else velocity.set(velocity.x + (dvx / gap) * step, velocity.y + (dvz / gap) * step);
      player.rotation.y = Math.atan2(-wantX, -wantZ);
    } else {
      velocity.set(THREE.MathUtils.damp(velocity.x, 0, DECEL, dt), THREE.MathUtils.damp(velocity.y, 0, DECEL, dt));
      if (velocity.lengthSq() < 1e-4) velocity.set(0, 0);
    }
    character.move(velocity.x * dt, velocity.y * dt, dt, jumpQueued && !transition);
    jumpQueued = false;
    physics.step(dt);
    Object.assign(player.position, character.feet());
    animateHop(dt, reducedMotion ? 0 : velocity.length(), character.grounded());
    cameraFloor = THREE.MathUtils.damp(cameraFloor, player.position.y, character.grounded() ? 6 : 1.5, dt);

    if (transition) {
      const progress = reducedMotion ? 1 : Math.min(1, (now - transition.start) / TRANSITION_S);
      haze = reducedMotion ? 0 : Math.sin(progress * Math.PI);
      tilt = (transition.toMap ? 1 - progress : progress) * 0.35;
      // Trees -> voxel text from 0.2 s to 0.4 s of the 0.5 s transition.
      flat = THREE.MathUtils.lerp(transition.flatFrom, transition.flatTo, smooth(THREE.MathUtils.clamp((progress - 0.4) / 0.4, 0, 1)));
      const k = smooth(progress), turn = smooth(Math.min(1, progress / ROTATE_SHARE));
      pose = shoulderPose();
      const to = transition.toMap ? transition.destination : pose.focus;
      target.lerpVectors(transition.target, to, k);
      desired.copy(transition.toMap ? new THREE.Vector3(to.x, mapHeight, to.z + 0.001) : pose.eye);
      orientationCamera.position.copy(desired); orientationCamera.lookAt(to);
      destinationRotation.copy(orientationCamera.quaternion);
      camera.position.lerpVectors(transition.from, desired, k);
      camera.quaternion.slerpQuaternions(transition.rotation, destinationRotation, turn);
      if (progress === 1) {
        mode = transition.toMap ? 'map' : 'walk'; transition = null;
        viewToggle.disabled = false;
        viewToggle.dataset.view = mode;
        viewToggle.querySelector('.view-label').textContent = mode === 'map' ? 'TPS CAMERA' : 'MINIMAP';
        viewToggle.setAttribute('aria-label', mode === 'map' ? 'Back to the garden view' : 'Open minimap');
        info.hidden = mode === 'walk';
        document.body.classList.toggle('map-view', mode === 'map');
      }
    } else if (mode === 'walk') {
      updateArm(dt);
      pose = shoulderPose();
      const follow = reducedMotion ? 1 : 1 - Math.exp(-12 * dt);
      target.lerp(pose.focus, follow); camera.position.lerp(pose.eye, follow); camera.lookAt(target);
    } else if (mode === 'map') {
      mapHeight = THREE.MathUtils.damp(mapHeight, zoomHeight, 12, dt);
      camera.position.y = mapHeight;
      camera.lookAt(target);
    }
    // Depth precision: the near plane follows the camera height (0.1 m walking, ~10 m at 1 km),
    // otherwise thin floors / the shoreline z-fight at far minimap zoom.
    const near = THREE.MathUtils.clamp(camera.position.y * 0.008, 0.1, 15);
    if (Math.abs(near - camera.near) > camera.near * 0.05) { camera.near = near; camera.updateProjectionMatrix(); }
    // Baked minimap crossfade; fully baked = draw only the bake layer, skip shadows and streaming.
    const baked = mapBake.update(camera.position.y, mode !== 'walk' && !(transition && !transition.toMap));
    if (baked >= 1) camera.layers.set(MAP_BAKE.layer); else camera.layers.set(0);
    renderer.shadowMap.autoUpdate = baked < 1;
    camera.updateMatrixWorld(true);
    // Filler leaves are for the walking view: they dissolve as the camera turns to look down
    // (fully gone once it looks down steeper than ~53 degrees, e.g. the minimap).
    camera.getWorldDirection(projected);
    fillerFade.value = 1 - THREE.MathUtils.smoothstep(-projected.y, 0.45, 0.8);
    barkFade.value = mode === 'walk' ? 1 : fillerFade.value;
    // Leaves between the camera and the character are dropped (character always visible).
    seeThrough.value = mode === 'walk' && !transition ? camera.position.distanceTo(player.position) : 0;
    // Far minimap zoom: close the sub-pixel gaps between voxels / tiles (they flickered).
    mapFill.value = mode === 'walk' ? 0 : THREE.MathUtils.smoothstep(camera.position.y, 90, 160);

    nearby = mode === 'walk' ? plots.find((plot) => plot.entrance.distanceTo(player.position) < 6) || null : null;
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
    const half = mode === 'walk' ? SHADOW_HALF.walk : SHADOW_HALF.map;
    if (sun.shadow.camera.right !== half) {
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
      sun.shadow.camera.updateProjectionMatrix();
    }
    const texelSize = (2 * half) / sun.shadow.mapSize.x;
    const snap = (v) => Math.round(v / texelSize) * texelSize;
    desired.set(target.x, 0, target.z);
    const a = snap(desired.dot(sunRight)), b = snap(desired.dot(sunUp)), c = desired.dot(sunDir);
    sun.target.position.copy(sunRight).multiplyScalar(a).addScaledVector(sunUp, b).addScaledVector(sunDir, c);
    sun.position.copy(sun.target.position).add(SUN_OFFSET);
    scene.fog.near = 90 + camera.position.y * 1.5;
    scene.fog.far = 260 + camera.position.y * 3;
    post.uniforms.uHaze.value = haze;
    post.uniforms.uTilt.value = tilt;

    if (Math.abs(flat - plots[0].flat) > 0.0001) park.setFlat(flat);
    for (const plot of plots) {
      if (Math.abs(flat - plot.flat) > 0.0001) { plot.view.setFlat(flat); plot.flat = flat; }
      const observer = mode === 'map' ? target : player.position;
      const visibleOnMap = mode !== 'walk' && (plot === selected ||
        (Math.abs(plot.x - target.x) < plot.w / 2 + camera.position.y * camera.aspect &&
         Math.abs(plot.z - target.z) < plot.h / 2 + camera.position.y));
      if (baked < 1) plot.view.tick(dt, observer, visibleOnMap, reducedMotion, camera); // nothing 3D to stream under the baked map
    }
    park.setPlayer(player.position);
    updateWind(dt);
    leafFall.update(dt, player.position, flat < 0.3, velocity);
    windLines.update(dt, player.position, mode === 'walk' && !transition);
    sky.update(dt, camera, mode === 'walk' || Boolean(transition && !transition.toMap));
    post.render(scene, camera);
  });
}
init().catch((error) => { console.error(error); status.textContent = 'Could not load the garden. Please reload or check the console.'; });
