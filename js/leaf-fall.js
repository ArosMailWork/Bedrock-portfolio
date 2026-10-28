// Falling leaves (pooled InstancedMesh), blown by the shared wind (wind.js), after the leaves of
// bruno-simon.com (folio-2025, MIT, sources/Game/World/Leaves.js): they drop from grown crowns near
// the player, drift downwind while falling, then lie on the ground where passing gusts slide and
// lift them; the player kicks them up. After their rest time they shrink away.
import * as THREE from 'three';
import { windAt } from './wind.js';

const POOL = 384, RATE = 18;          // max live leaves, spawns per second
const SPAWN_RADIUS = 35;             // only trees this close to the player shed leaves
const REST = [4, 8], FADE = 0.8;     // seconds lying on the ground, seconds to vanish
const SIZE = 0.35;                   // leaf size (m)
const GROUND = 0.09;                 // resting height (just above the tiles)
const AIR_SPEED = 4, GROUND_SPEED = 5; // horizontal speed per unit of wind push, in the air / on the ground
const GUST = 0.22;                   // wind push needed to move a resting leaf
const KICK_RADIUS = 1.1;             // player kicks leaves within this distance (m)

export function createLeafFall(scene, plots) {
  // Low-poly leaf: a unit quad sheared into a parallelogram (as Bruno's), no texture.
  const geometry = new THREE.PlaneGeometry(1, 1);
  const p = geometry.attributes.position.array;
  p[0] += 0.15; p[3] += 0.15; p[6] -= 0.15; p[9] -= 0.15;
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), POOL);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.userData.skipBake = true;
  scene.add(mesh);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < POOL; i++) { mesh.setMatrixAt(i, zero); mesh.setColorAt(i, new THREE.Color(1, 1, 1)); }

  const crowns = plots.flatMap((p) => p.view.crowns.map((c) => ({ plot: p, cluster: c.cluster, box: c.box })));
  const leaves = Array.from({ length: POOL }, () => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler() }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), color = new THREE.Color();
  const wind = { x: 0, z: 0 };
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
    leaf.alive = true; leaf.grounded = false; leaf.t = 0; leaf.rest = REST[0] + Math.random() * (REST[1] - REST[0]);
    leaf.pos.set(
      c.plot.x + THREE.MathUtils.lerp(b.min.x, b.max.x, Math.random()),
      THREE.MathUtils.lerp(b.min.y, (b.min.y + b.max.y) / 2, Math.random()),
      c.plot.z + THREE.MathUtils.lerp(b.min.z, b.max.z, Math.random()));
    leaf.vel.set(0, 0, 0);
    leaf.fall = 0.7 + Math.random() * 0.5;   // terminal fall speed (m/s)
    leaf.phase = Math.random() * 6.28;
    leaf.size = SIZE * (0.6 + Math.random() * 0.6);
    leaf.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    const palette = c.plot.data.colors;
    mesh.setColorAt(slot, color.setHex(palette[Math.floor(Math.random() * palette.length)]));
    mesh.instanceColor.needsUpdate = true;
  }

  return {
    // active = false in the minimap: no new leaves and the layer is hidden.
    // player: feet position, playerVelocity: { x, y } = horizontal x/z velocity (m/s).
    update(dt, player, active, playerVelocity) {
      mesh.visible = active;
      if (!active) return;
      budget += dt * RATE;
      while (budget >= 1) { budget -= 1; spawn(player); }
      const playerSpeed = Math.hypot(playerVelocity.x, playerVelocity.y);
      leaves.forEach((leaf, i) => {
        if (!leaf.alive) return;
        leaf.t += dt;
        const push = windAt(leaf.pos.x, leaf.pos.z, wind);
        const v = leaf.vel;
        // Kick: walking through leaves throws them up and away.
        const dx = leaf.pos.x - player.x, dz = leaf.pos.z - player.z, d = Math.hypot(dx, dz);
        if (d < KICK_RADIUS && playerSpeed > 1 && leaf.pos.y < 1) {
          const k = (1 - d / KICK_RADIUS) * Math.min(playerSpeed, 8);
          v.x += (dx / (d || 1)) * k * 0.5 + playerVelocity.x * 0.25;
          v.z += (dz / (d || 1)) * k * 0.5 + playerVelocity.y * 0.25;
          v.y = Math.max(v.y, 1.2 + k * 0.25);
          leaf.grounded = false;
        }
        let spin = 1;
        if (!leaf.grounded) {
          // Air: horizontal velocity follows the wind, gravity limited to a flutter-y fall.
          const follow = 1 - Math.exp(-1.5 * dt);
          v.x += (wind.x * AIR_SPEED - v.x) * follow;
          v.z += (wind.z * AIR_SPEED - v.z) * follow;
          v.y = Math.max(v.y - 9.8 * dt, -leaf.fall);
          leaf.pos.x += (v.x + Math.sin(leaf.t * 2.3 + leaf.phase) * 0.8) * dt;
          leaf.pos.z += (v.z + Math.cos(leaf.t * 1.7 + leaf.phase) * 0.6) * dt;
          leaf.pos.y += v.y * dt;
          if (leaf.pos.y <= GROUND) { leaf.grounded = true; leaf.pos.y = GROUND; leaf.t = 0; leaf.rot.x = -Math.PI / 2; leaf.rot.y = 0; }
          spin = 2.5;
        } else {
          // Ground: only gusts above GUST move the leaf; it slides, hops a little, and settles.
          const gust = Math.max(0, push - GUST) / Math.max(push, 1e-3);
          const follow = 1 - Math.exp(-3 * dt);
          v.x += (wind.x * gust * GROUND_SPEED - v.x) * follow;
          v.z += (wind.z * gust * GROUND_SPEED - v.z) * follow;
          const speed = Math.hypot(v.x, v.z);
          leaf.pos.x += v.x * dt; leaf.pos.z += v.z * dt;
          leaf.pos.y = GROUND + Math.min(speed, 2) * 0.1 * Math.abs(Math.sin(leaf.t * 9 + leaf.phase));
          spin = speed * 0.6;
          if (speed < 0.2) leaf.rot.x += (-Math.PI / 2 - leaf.rot.x) * Math.min(1, dt * 4);
        }
        leaf.rot.x += (leaf.grounded ? 0 : 3.1) * spin * dt;
        leaf.rot.z += 2.3 * spin * dt;
        let s = leaf.size;
        if (leaf.grounded && leaf.t > leaf.rest) {
          s *= 1 - THREE.MathUtils.clamp((leaf.t - leaf.rest) / FADE, 0, 1);
          if (s <= 0) { leaf.alive = false; mesh.setMatrixAt(i, zero); return; }
        }
        mesh.setMatrixAt(i, m.compose(leaf.pos, q.setFromEuler(leaf.rot), sc.setScalar(s)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
