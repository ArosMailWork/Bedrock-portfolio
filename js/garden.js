import * as THREE from 'three';
import { maskFromPixelFont } from './shape-mask.js';
import { growTree } from './shape-tree.js';
import { buildTreeScene, wind, treeSettings } from './tree-mesh.js';
import { PLOTS } from './portfolio-data.js';
import { buildGround, buildWater, shoreRadius, WALK_LIMIT } from './island.js';
import { buildPark } from './park.js';
import { createPhysics } from './physics.js';
import { createPost } from './post.js';
import { createLeafFall } from './leaf-fall.js';

// ---------- Renderer, light and atmosphere ----------
const renderer = new THREE.WebGLRenderer({ antialias: false }); // MSAA happens in the post target
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.querySelector('#scene').appendChild(renderer.domElement);
const post = createPost(renderer);
const scene = new THREE.Scene();
const SKY = 0xcfe5e6;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 90, 260);
// Warm sun + cool violet bounce: shadowed areas read blue/violet instead of black.
scene.add(new THREE.HemisphereLight(0xfff0d8, 0x5d6fb0, 1.5));
const sun = new THREE.DirectionalLight(0xffdcae, 2.8);
const SUN_OFFSET = new THREE.Vector3(-28, 55, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 900);
const marker = document.querySelector('#plot-marker');
const viewToggle = document.querySelector('#view-toggle');
const info = document.querySelector('#plot-info');
const settingsToggle = document.querySelector('#settings-toggle');
const settingsPanel = document.querySelector('#settings');
const growRange = document.querySelector('#grow-range');
const growRangeValue = document.querySelector('#grow-range-value');
let park = null, leafFall = null;
const status = document.querySelector('#status');
const keys = new Set(), plots = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let mode = 'walk', nearby = null, selected = null, transition = null, islandR = 60;
const target = new THREE.Vector3(), projected = new THREE.Vector3(), desired = new THREE.Vector3();
let cameraFloor = 0; // camera follows height slowly, so jumps read on screen
let armScale = 1;    // 0..1 share of the shoulder arm left after camera collision (smoothed)
let mapHeight = 80, zoomHeight = 80, yaw = 0.25, pitch = 0.1, jumpQueued = false, character = null;
const MAP_MIN_HEIGHT = 34; // closest minimap zoom: stays above the tallest canopy (~12 m)
const destinationRotation = new THREE.Quaternion();
const orientationCamera = camera.clone();
const TRANSITION_S = 0.5;
// Camera height -> 3D trees (0) / voxel text (1). Wheel zoom moves through this range.
const viewBlend = (height) => THREE.MathUtils.smoothstep(height, 25, 70);
const smooth = (t) => t * t * (3 - 2 * t);

const player = new THREE.Group();
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.72, 5, 10), new THREE.MeshLambertMaterial({ color: 0xf0b46e }));
body.position.y = 0.78; body.castShadow = true; player.add(body);
const face = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0x35473a }));
face.position.set(-0.14, 1.1, -0.38); player.add(face);
const otherEye = face.clone(); otherEye.position.x = 0.14; player.add(otherEye);
scene.add(player);

// Over-the-shoulder camera. Vertical drag changes the aim only; Rapier shortens the arm
// when something solid sits between the shoulder and the camera.
function shoulderPose() {
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const focus = player.position.clone().addScaledVector(forward, 5);
  focus.y = cameraFloor + 2 + Math.tan(pitch) * 9.2;
  const eye = player.position.clone().addScaledVector(forward, -4.2).addScaledVector(right, 0.85);
  eye.y = cameraFloor + 2;
  const anchor = player.position.clone(); anchor.y = cameraFloor + 1.6;
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
    pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.003, -0.35, 0.65);
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
  zoomHeight = THREE.MathUtils.clamp(zoomHeight * Math.exp(delta * 0.0015), MAP_MIN_HEIGHT, 260);
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
addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Space'].includes(event.code)) {
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

async function plotMask(data) {
  const masks = await Promise.all([data.title, ...data.lines].map((line) => maskFromPixelFont(line)));
  const w = Math.max(...masks.map((m) => m.w));
  const h = masks.reduce((sum, m) => sum + m.h + 3, -3);
  const cells = new Uint8Array(w * h);
  let row = 0;
  for (const m of masks) {
    const left = Math.floor((w - m.w) / 2);
    for (let z = 0; z < m.h; z++) for (let x = 0; x < m.w; x++) cells[(row + z) * w + left + x] = m.cells[z * m.w + x];
    row += m.h + 3;
  }
  return { w, h, cells };
}

async function init() {
  const [physics, masks] = await Promise.all([createPhysics(), Promise.all(PLOTS.map(plotMask))]);

  // ---------- Plots: four quadrants around the plaza, slightly offset ----------
  const GAP_X = 16, GAP_Z = 14, JITTER = [[-1.5, 1], [2, -1.2], [1, 1.8], [-2, -0.8]];
  // Island radius: smallest R keeping every tile (and lodge) on the lawn in ITS direction.
  let needR = 0;
  const reach = (px, pz, pad) => { needR = Math.max(needR, (Math.hypot(px, pz) + pad) / (0.86 * shoreRadius(Math.atan2(pz, px), 1))); };
  PLOTS.forEach((data, i) => {
    const tree = growTree(masks[i], { seed: i * 17 + 3 });
    const view = buildTreeScene(tree, masks[i], { colors: data.colors, seed: i * 1.7 });
    const { w, h } = view.size, sx = i % 2 ? 1 : -1, sz = i < 2 ? -1 : 1;
    const x = sx * (w / 2 + GAP_X / 2) + JITTER[i][0], z = sz * (h / 2 + GAP_Z / 2) + JITTER[i][1];
    view.group.position.set(x, 0, z);
    scene.add(view.group);
    // Entrance: walk from the plot centre towards the plaza until the tiles end.
    const dir = new THREE.Vector3(-x, 0, -z).normalize();
    let t = 0;
    while (view.isFloor(dir.x * t, dir.z * t) && t < 300) t += 0.5;
    const entrance = new THREE.Vector3(x + dir.x * (t + 1.8), 0, z + dir.z * (t + 1.8));
    tree.roots.forEach((root, k) => {
      const base = tree.nodes.find((n) => n.cluster === k && n.parent < 0);
      physics.cylinder(x + root.x, 1.6, z + root.z, 1.6, base.radius * 0.9);
    });
    for (const cell of view.floor) reach(x + cell.x, z + cell.z, 2);
    plots.push({ data, tree, view, x, z, w, h, entrance, flat: -1 });
  });
  const maxW = Math.max(...plots.map((p) => p.w));
  const houses = [-1, 1].map((side) => ({ x: side * (GAP_X / 2 + maxW / 2), z: 0, angle: -side * Math.PI / 2 }));
  for (const h of houses) reach(h.x, h.z, 6);
  islandR = needR;

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
    let mx = 0, mz = 0;
    if (!transition && (mode === 'walk' || mode === 'map')) {
      const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const z = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      const length = Math.hypot(x, z) || 1, speed = 8 * dt;
      const f = mode === 'map' ? { x: 0, z: -1 } : { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const r = mode === 'map' ? { x: 1, z: 0 } : { x: Math.cos(yaw), z: -Math.sin(yaw) };
      mx = ((r.x * x + f.x * z) / length) * speed;
      mz = ((r.z * x + f.z * z) / length) * speed;
      if (x || z) player.rotation.y = Math.atan2(-mx, -mz);
    }
    character.move(mx, mz, dt, jumpQueued && !transition);
    jumpQueued = false;
    physics.step(dt);
    Object.assign(player.position, character.feet());
    cameraFloor = THREE.MathUtils.damp(cameraFloor, player.position.y, character.grounded() ? 6 : 1.5, dt);

    if (transition) {
      const progress = reducedMotion ? 1 : Math.min(1, (now - transition.start) / TRANSITION_S);
      haze = reducedMotion ? 0 : Math.sin(progress * Math.PI);
      tilt = (transition.toMap ? 1 - progress : progress) * 0.35;
      // Trees -> voxel text from 0.2 s to 0.4 s of the 0.5 s transition.
      flat = THREE.MathUtils.lerp(transition.flatFrom, transition.flatTo, smooth(THREE.MathUtils.clamp((progress - 0.4) / 0.4, 0, 1)));
      const k = smooth(progress);
      pose = shoulderPose();
      const to = transition.toMap ? transition.destination : pose.focus;
      target.lerpVectors(transition.target, to, k);
      desired.copy(transition.toMap ? new THREE.Vector3(to.x, mapHeight, to.z + 0.001) : pose.eye);
      orientationCamera.position.copy(desired); orientationCamera.lookAt(to);
      destinationRotation.copy(orientationCamera.quaternion);
      camera.position.lerpVectors(transition.from, desired, k);
      camera.quaternion.slerpQuaternions(transition.rotation, destinationRotation, k);
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
    camera.updateMatrixWorld(true);

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

    // Shadows follow what the camera looks at; fog recedes as the camera climbs.
    sun.target.position.set(target.x, 0, target.z);
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
      plot.view.tick(dt, observer, visibleOnMap, reducedMotion, camera);
    }
    park.setPlayer(player.position);
    leafFall.update(dt, player.position, flat < 0.3);
    post.render(scene, camera);
  });
}
init().catch((error) => { console.error(error); status.textContent = 'Could not load the garden. Please reload or check the console.'; });
