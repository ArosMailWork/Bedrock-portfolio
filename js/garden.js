import * as THREE from 'three';
import { maskFromPixelFont } from './shape-mask.js';
import { growTree } from './shape-tree.js';
import { buildTreeScene, wind } from './tree-mesh.js';
import { PLOTS } from './portfolio-data.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setClearColor(0xe8e6d9);
document.querySelector('#scene').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xfff8e8, 0x76846a, 2.3));
const sun = new THREE.DirectionalLight(0xffefd7, 2.1);
sun.position.set(-30, 70, 30); scene.add(sun);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
const marker = document.querySelector('#plot-marker');
const back = document.querySelector('#return');
const minimap = document.querySelector('#minimap');
const info = document.querySelector('#plot-info');
const status = document.querySelector('#status');
const fx = document.querySelector('#fx');
const keys = new Set(), plots = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let mode = 'walk', nearby = null, selected = null, transition = null;
let worldWidth = 0, worldDepth = 0;
const target = new THREE.Vector3();
const projected = new THREE.Vector3(), desired = new THREE.Vector3();
let yaw = 0, pitch = 0.1, mapHeight = 80, zoomHeight = 80;
const destinationRotation = new THREE.Quaternion();
const orientationCamera = camera.clone();
const colliders = [];
const cameraObstacles = [], cameraRay = new THREE.Raycaster();
function shoulderPose() {
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const focus = player.position.clone().addScaledVector(forward, 5);
  focus.y = player.position.y + 2 + Math.tan(pitch) * 9.2;
  const eye = player.position.clone().addScaledVector(forward, -4.2).addScaledVector(right, 0.85);
  eye.y = player.position.y + 2;
  const anchor = player.position.clone(); anchor.y += 1.6;
  const arm = eye.clone().sub(anchor), length = arm.length();
  cameraRay.set(anchor, arm.normalize()); cameraRay.far = length;
  const hit = cameraRay.intersectObjects(cameraObstacles, false)[0];
  if (hit) eye.copy(anchor).addScaledVector(arm, Math.max(0.15, hit.distance - 0.2));
  return { eye, focus };
}
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (event) => {
  if ((mode !== 'walk' && mode !== 'map') || event.button !== 0) return;
  dragging = true; renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  if (mode === 'map') {
    const units = 2 * camera.position.y * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / renderer.domElement.clientHeight;
    const x = THREE.MathUtils.clamp(target.x - event.movementX * units, -worldWidth / 2, worldWidth / 2);
    const z = THREE.MathUtils.clamp(target.z - event.movementY * units, -worldDepth / 2, worldDepth / 2);
    camera.position.x += x - target.x; camera.position.z += z - target.z;
    target.x = x; target.z = z; camera.lookAt(target);
    return;
  }
  if (mode !== 'walk') return;
  yaw -= event.movementX * 0.004;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.003, -0.35, 0.65);
});
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('lostpointercapture', () => { dragging = false; });
renderer.domElement.addEventListener('wheel', (event) => {
  if (mode !== 'map') return;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
  zoomHeight = THREE.MathUtils.clamp(zoomHeight * Math.exp(delta * 0.0015), 16, 260);
}, { passive: false });
const TRANSITION_S = 0.5;
// Camera height -> 3D trees (0) / voxel text (1). Wheel zoom moves through this range.
const viewBlend = (height) => THREE.MathUtils.smoothstep(height, 25, 70);
const smooth = (t) => t * t * (3 - 2 * t);

function box(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(x, y, z); scene.add(mesh); mesh.updateMatrixWorld();
  if (h >= 1.5) cameraObstacles.push(mesh);
  return mesh;
}
function label(text, x, z) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '32px GardenInter, sans-serif'; ctx.fillStyle = '#61745c'; ctx.textAlign = 'center';
  ctx.fillText(text, 256, 59);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.25), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, 0.035, z); scene.add(mesh);
}

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

const player = new THREE.Group();
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.72, 5, 10), new THREE.MeshLambertMaterial({ color: 0xf0b46e }));
body.position.y = 0.78; player.add(body);
const face = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0x35473a }));
face.position.set(-0.14, 1.1, -0.38); player.add(face);
const otherEye = face.clone(); otherEye.position.x = 0.14; player.add(otherEye);
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.66, 24), new THREE.MeshBasicMaterial({ color: 0x536347, transparent: true, opacity: 0.18, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.025; player.add(shadow); scene.add(player);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
function plotViewSize(plot) {
  // Leave room for the title / return controls on small screens.
  return 12 + Math.max(plot.h + 18, (plot.w + 16) / (innerWidth / innerHeight)) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
function beginView(toMap, plot = null) {
  if (transition || !plots.length) return;
  if (toMap) {
    selected = plot || plots.reduce((closest, p) =>
      Math.hypot(p.x - player.position.x, p.z - player.position.z) < Math.hypot(closest.x - player.position.x, closest.z - player.position.z) ? p : closest);
    mapHeight = zoomHeight = plotViewSize(selected);
    info.querySelector('h2').textContent = 'Garden minimap';
    info.querySelector('p').textContent = 'Drag with left mouse to pan · WASD to move';
    const link = info.querySelector('a'); link.hidden = true;
  }
  keys.clear();
  dragging = false;
  minimap.disabled = true;
  const landing = toMap ? plotViewSize(selected) : 0;
  transition = { start: performance.now() / 1000, flatFrom: plots[0].flat, flatTo: toMap ? viewBlend(landing) : 0, toMap, from: camera.position.clone(), rotation: camera.quaternion.clone(), target: target.clone(),
    destination: plot ? new THREE.Vector3(plot.x, 0, plot.z) : new THREE.Vector3(player.position.x, 0, player.position.z) };
  mode = toMap ? 'entering' : 'leaving';
  marker.hidden = true; back.hidden = false;
  document.body.classList.add('map-view'); info.hidden = false;
}
marker.onclick = () => beginView(true, nearby);
minimap.onclick = () => beginView(mode === 'walk');
back.onclick = () => beginView(false);
addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(event.code)) {
    event.preventDefault();
    if (event.code === 'Escape' && mode === 'map') beginView(false);
    else if (mode === 'walk' || mode === 'map') keys.add(event.code);
  }
});
addEventListener('keyup', (event) => keys.delete(event.code));
addEventListener('blur', () => keys.clear());
addEventListener('visibilitychange', () => keys.clear());
addEventListener('resize', () => {
  resize();
});
document.querySelector('#replay').onclick = () => { plots.forEach((p) => p.view.setGrowth(0)); };

function blocked(x, z) {
  if (Math.abs(x) > worldWidth / 2 - 2 || Math.abs(z) > worldDepth / 2 - 2) return true;
  return colliders.some((p) => Math.abs(x - p.x) < p.w / 2 + 0.65 && Math.abs(z - p.z) < p.h / 2 + 0.65);
}

async function init() {
  const masks = await Promise.all(PLOTS.map(plotMask));
  const columnWidth = Math.max(...masks.map((m) => m.w + 6));
  const rowDepth = Math.max(...masks.map((m) => m.h + 6));
  const gap = 12;
  worldWidth = columnWidth * 2 + gap + 18; worldDepth = rowDepth * 2 + gap + 18;
  box(worldWidth, 0.5, worldDepth, 0xc4ccab, 0, -0.65, 0);
  box(worldWidth - 6, 0.25, worldDepth - 6, 0xdfe2ce, 0, -0.27, 0);
  box(gap - 1, 0.06, worldDepth - 7, 0xece8da, 0, -0.08, 0);
  box(worldWidth - 7, 0.06, gap - 1, 0xece8da, 0, -0.07, 0);
  for (let i = 0; i < PLOTS.length; i++) {
    const mask = masks[i], data = PLOTS[i];
    const x = (i % 2 ? 1 : -1) * (columnWidth + gap) / 2;
    const z = (i < 2 ? -1 : 1) * (rowDepth + gap) / 2;
    const tree = growTree(mask, { seed: i * 17 + 3 });
    const view = buildTreeScene(tree, mask, { colors: data.colors, width: columnWidth, depth: rowDepth });
    const w = view.size.w, h = view.size.h;
    view.group.position.set(x, 0.18, z); scene.add(view.group);
    box(w, 0.32, h, 0xb5bfa0, x, -0.02, z);
    box(w - 0.7, 0.12, h - 0.7, 0xd4d9bf, x, 0.17, z);
    const entrance = new THREE.Vector3(x + (i % 2 ? -1 : 1) * (w / 2 + 3), 0, z + h / 2 - 3);
    box(0.32, 1.1, 0.32, 0x53694f, entrance.x, 0.55, entrance.z);
    box(1.15, 0.65, 0.16, 0xf2eddb, entrance.x, 1.2, entrance.z);
    label(`0${i + 1} / ${data.title}`, x, z + h / 2 - 1.4);
    plots.push({ data, tree, view, x, z, w, h, entrance, growth: -1, flat: -1 });
  }
  // Timber perimeter, matching the bark and warm stone palette.
  for (const side of [-1, 1]) {
    for (let x = -worldWidth / 2 + 3; x < worldWidth / 2 - 3; x += 4) {
      const z = side * (worldDepth / 2 - 2);
      box(0.22, 1.8, 0.22, 0x8e775b, x, 0.9, z);
      for (const y of [0.65, 1.3]) box(4, 0.14, 0.12, 0xa39473, x + 2, y, z);
    }
    for (let z = -worldDepth / 2 + 3; z < worldDepth / 2 - 3; z += 4) {
      const x = side * (worldWidth / 2 - 2);
      box(0.22, 1.8, 0.22, 0x8e775b, x, 0.9, z);
      for (const y of [0.65, 1.3]) box(0.12, 0.14, 4, 0xa39473, x, y, z + 2);
    }
  }
  // Two small low-poly park lodges, outside the exhibition beds.
  for (const side of [-1, 1]) {
    const x = side * (worldWidth / 2 - 12), z = 0;
    box(7, 4, 5, 0xe0cfac, x, 2, z);
    for (const offset of [-1.9, 1.9]) {
      const roof = box(4.6, 0.3, 6.5, 0x7b8c72, x + offset, 4.5, z);
      roof.rotation.z = -Math.sign(offset) * 0.5;
    }
    box(1.3, 2.6, 0.14, 0x715e48, x, 1.3, z + 2.57);
    for (const offset of [-2.3, 2.3]) box(1.1, 1.15, 0.16, 0x92b1aa, x + offset, 2.1, z + 2.6);
    colliders.push({ x, z, w: 8, h: 6 });
  }
  for (let z = -worldDepth / 2 + 10; z < worldDepth / 2 - 8; z += 22) {
    for (const x of [-4.6, 4.6]) {
      box(0.18, 3.5, 0.18, 0x59684f, x, 1.75, z);
      box(0.7, 0.55, 0.7, 0xf6d99a, x, 3.6, z);
      box(0.85, 0.15, 0.85, 0x59684f, x, 3.95, z);
      colliders.push({ x, z, w: 0.5, h: 0.5 });
    }
  }
  // Benches mark the central crossing.
  for (const x of [-4, 4]) {
    box(1, 0.22, 3.2, 0x8e775b, x, 0.7, 0);
    colliders.push({ x, z: 0, w: 1, h: 3.2 });
    for (const z of [-1, 1]) box(0.7, 0.7, 0.2, 0x65705b, x, 0.3, z);
  }
  player.position.set(-2, 0, plots[0].entrance.z + 2);
  yaw = 0.25;
  const pose = shoulderPose(); target.copy(pose.focus); camera.position.copy(pose.eye); camera.lookAt(target);
  resize(); status.hidden = true; minimap.disabled = false;
  let previous = performance.now() / 1000;
  renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000, dt = Math.min(now - previous, 0.05); previous = now;
    wind.value = now;
    let flat = mode === 'walk' ? 0 : viewBlend(camera.position.y);
    if (transition) {
      const elapsed = now - transition.start;
      const progress = reducedMotion ? 1 : Math.min(1, elapsed / TRANSITION_S);
      const haze = reducedMotion ? 0 : Math.sin(progress * Math.PI);
      renderer.domElement.style.filter = haze > 0.01 ? `blur(${(haze * 2.4).toFixed(2)}px)` : '';
      fx.style.opacity = haze.toFixed(3);
      flat = THREE.MathUtils.lerp(transition.flatFrom, transition.flatTo, smooth(THREE.MathUtils.clamp((progress - 0.4) / 0.4, 0, 1)));
      const cameraProgress = smooth(progress);
      const pose = shoulderPose();
      const to = transition.toMap ? transition.destination : pose.focus;
      target.lerpVectors(transition.target, to, cameraProgress);
      desired.copy(transition.toMap ? new THREE.Vector3(to.x, plotViewSize(selected), to.z + 0.001) : pose.eye);
      orientationCamera.position.copy(desired); orientationCamera.lookAt(to);
      destinationRotation.copy(orientationCamera.quaternion);
      camera.position.lerpVectors(transition.from, desired, cameraProgress);
      camera.quaternion.slerpQuaternions(transition.rotation, destinationRotation, cameraProgress);
      if (progress === 1) {
        renderer.domElement.style.filter = '';
        fx.style.opacity = '0';
        mode = transition.toMap ? 'map' : 'walk'; transition = null;
        minimap.disabled = false;
        minimap.textContent = mode === 'map' ? 'Back to TPS' : 'Minimap';
        back.hidden = mode === 'walk'; info.hidden = mode === 'walk';
        document.body.classList.toggle('map-view', mode === 'map');
      }
    } else if (mode === 'walk' || mode === 'map') {
      const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
      const length = Math.hypot(x, z) || 1, speed = 8 * dt;
      const movementYaw = mode === 'map' ? 0 : yaw;
      const dx = (x * Math.cos(movementYaw) + z * Math.sin(movementYaw)) / length;
      const dz = (-x * Math.sin(movementYaw) + z * Math.cos(movementYaw)) / length;
      const nx = player.position.x + dx * speed;
      const nz = player.position.z + dz * speed;
      if (!blocked(nx, player.position.z)) player.position.x = nx;
      if (!blocked(player.position.x, nz)) player.position.z = nz;
      if (x || z) player.rotation.y = Math.atan2(-dx, -dz);
      const bed = plots.find((p) => Math.abs(player.position.x - p.x) < p.w / 2 && Math.abs(player.position.z - p.z) < p.h / 2);
      player.position.y = THREE.MathUtils.damp(player.position.y, bed ? 0.34 : 0, 14, dt);
      body.position.y = 0.78;
      if (mode === 'walk') {
        const pose = shoulderPose();
        const follow = reducedMotion ? 1 : 1 - Math.exp(-12 * dt);
        target.lerp(pose.focus, follow); camera.position.lerp(pose.eye, follow); camera.lookAt(target);
      } else {
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
    }
    camera.updateMatrixWorld(true);
    for (const plot of plots) {
      if (Math.abs(flat - plot.flat) > 0.0001) { plot.view.setFlat(flat); plot.flat = flat; }
      const observer = mode === 'map' ? target : player.position;
      const visibleOnMap = mode !== 'walk' && (plot === selected ||
        (Math.abs(plot.x - target.x) < plot.w / 2 + camera.position.y * camera.aspect &&
         Math.abs(plot.z - target.z) < plot.h / 2 + camera.position.y));
      plot.view.tick(dt, observer, visibleOnMap, reducedMotion, camera);
    }
    renderer.render(scene, camera);
  });
}
init().catch((error) => { console.error(error); status.textContent = 'Could not load the garden. Please reload or check the console.'; });
