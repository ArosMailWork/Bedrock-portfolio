// Falling leaves: a small pooled InstancedMesh. Leaves drop from fully grown crowns near the
// player, flutter down, rest flat on the ground for a few seconds, then shrink away.
import * as THREE from 'three';
import { LEAF_TEXTURE_URL } from './tree-mesh.js';

const POOL = 384, RATE = 18;          // max live leaves, spawns per second
const SPAWN_RADIUS = 35;             // only trees this close to the player shed leaves
const REST = [3, 6], FADE = 0.8;     // seconds lying on the ground, seconds to vanish

export function createLeafFall(scene, plots) {
  const texture = new THREE.TextureLoader().load(LEAF_TEXTURE_URL);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.45, side: THREE.DoubleSide }), POOL);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < POOL; i++) mesh.setMatrixAt(i, zero);

  const crowns = plots.flatMap((p) => p.view.crowns.map((c) => ({ plot: p, cluster: c.cluster, box: c.box })));
  const leaves = Array.from({ length: POOL }, () => ({ alive: false }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const color = new THREE.Color();
  let budget = 0;

  function spawn(player) {
    const near = [];
    for (const c of crowns) {
      const cx = c.plot.x + (c.box.min.x + c.box.max.x) / 2, cz = c.plot.z + (c.box.min.z + c.box.max.z) / 2;
      if (Math.hypot(cx - player.x, cz - player.z) < SPAWN_RADIUS && c.plot.view.isGrown(c.cluster)) near.push(c);
    }
    const slot = leaves.findIndex((l) => !l.alive);
    if (!near.length || slot < 0) return;
    const c = near[Math.floor(Math.random() * near.length)], b = c.box, leaf = leaves[slot];
    leaf.alive = true; leaf.state = 'fall'; leaf.t = 0; leaf.rest = REST[0] + Math.random() * (REST[1] - REST[0]);
    leaf.pos = new THREE.Vector3(
      c.plot.x + THREE.MathUtils.lerp(b.min.x, b.max.x, Math.random()),
      THREE.MathUtils.lerp(b.min.y, (b.min.y + b.max.y) / 2, Math.random()),
      c.plot.z + THREE.MathUtils.lerp(b.min.z, b.max.z, Math.random()));
    leaf.speed = 0.7 + Math.random() * 0.5;
    leaf.phase = Math.random() * 6.28;
    leaf.spin = new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    leaf.rot = new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const palette = c.plot.data.colors;
    mesh.setColorAt(slot, color.setHex(palette[Math.floor(Math.random() * palette.length)]));
    mesh.instanceColor.needsUpdate = true;
  }

  return {
    // active = false in the minimap: no new leaves and the layer is hidden.
    update(dt, player, active) {
      mesh.visible = active;
      if (!active) return;
      budget += dt * RATE;
      while (budget >= 1) { budget -= 1; spawn(player); }
      leaves.forEach((leaf, i) => {
        if (!leaf.alive) return;
        leaf.t += dt;
        let s = 1;
        if (leaf.state === 'fall') {
          // Flutter: sideways sway and tumbling while sinking.
          leaf.pos.y -= leaf.speed * dt;
          leaf.pos.x += Math.sin(leaf.t * 2.3 + leaf.phase) * 0.9 * dt;
          leaf.pos.z += Math.cos(leaf.t * 1.7 + leaf.phase) * 0.7 * dt;
          leaf.rot.x += leaf.spin.x * dt; leaf.rot.y += leaf.spin.y * dt; leaf.rot.z += leaf.spin.z * dt;
          if (leaf.pos.y <= 0.09) { leaf.state = 'rest'; leaf.t = 0; leaf.pos.y = 0.09; leaf.rot.set(-Math.PI / 2, 0, leaf.rot.z); }
        } else {
          s = 1 - THREE.MathUtils.clamp((leaf.t - leaf.rest) / FADE, 0, 1);
          if (s <= 0) { leaf.alive = false; mesh.setMatrixAt(i, zero); return; }
        }
        mesh.setMatrixAt(i, m.compose(pos.copy(leaf.pos), q.setFromEuler(e.copy(leaf.rot)), sc.setScalar(s)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
