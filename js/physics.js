// Rapier world: static scene colliders + a kinematic capsule character controller.
import * as RAPIER from '../vendor/rapier/rapier.mjs';

export const CAPSULE = { halfHeight: 0.36, radius: 0.42 }; // centre sits 0.78 above the feet
export const GRAVITY = 22; // game-feel gravity (m/s²), snappier than 9.81
const JUMP_SPEED = 8;    // ≈ 1.45 m jump

export async function createPhysics() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const yaw = (angle) => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });
  const add = (desc, x, y, z, rotY = 0) => world.createCollider(desc.setTranslation(x, y, z).setRotation(yaw(rotY)), fixed);

  return {
    box: (x, y, z, hx, hy, hz, rotY) => add(RAPIER.ColliderDesc.cuboid(hx, hy, hz), x, y, z, rotY),
    cylinder: (x, y, z, halfHeight, radius) => add(RAPIER.ColliderDesc.cylinder(halfHeight, radius), x, y, z),
    ball: (x, y, z, radius) => add(RAPIER.ColliderDesc.ball(radius), x, y, z),
    trimesh: (vertices, indices) => world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), fixed),
    // Dynamic body (carnival cans and balls). kind: 'ball' [r] | 'cylinder' [halfHeight, r].
    // Returns the Rapier body (translation(), rotation(), setTranslation(), setRotation(),
    // setLinvel(), setAngvel(), isSleeping()). ccd: continuous collision for fast throws.
    dynamic(kind, dims, x, y, z, { density = 1, friction = 0.6, restitution = 0.2, ccd = false } = {}) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(ccd));
      const desc = kind === 'ball' ? RAPIER.ColliderDesc.ball(dims[0]) : RAPIER.ColliderDesc.cylinder(dims[0], dims[1]);
      world.createCollider(desc.setDensity(density).setFriction(friction).setRestitution(restitution), body);
      return body;
    },
    // Feet position in, feet position out. Slides along walls, steps over curbs, snaps to slopes, jumps.
    createCharacter(x, y, z) {
      const centre = CAPSULE.halfHeight + CAPSULE.radius;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + centre, z));
      const collider = world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE.halfHeight, CAPSULE.radius), body);
      const controller = world.createCharacterController(0.02);
      controller.enableAutostep(0.35, 0.2, true);
      controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
      controller.setSlideEnabled(true);
      let vy = 0, grounded = false;
      return {
        move(dx, dz, dt, jump = false) {
          if (jump && grounded) vy = JUMP_SPEED;
          vy = Math.max(vy - GRAVITY * dt, -30);
          // Snapping would cancel the take-off, so it is only on while not rising.
          if (vy > 0) controller.disableSnapToGround(); else controller.enableSnapToGround(0.35);
          controller.computeColliderMovement(collider, { x: dx, y: vy * dt, z: dz });
          const m = controller.computedMovement();
          grounded = controller.computedGrounded();
          if (grounded && vy < 0) vy = 0;
          if (vy > 0 && m.y < vy * dt * 0.5) vy = 0; // bumped the head
          const t = body.translation();
          body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
        },
        feet() { const t = body.translation(); return { x: t.x, y: t.y - centre, z: t.z }; },
        grounded: () => grounded,
        // Distance from `from` towards `to` until the first static obstacle (camera collision).
        clearDistance(from, to) {
          const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.hypot(dx, dy, dz) || 1;
          const ray = new RAPIER.Ray(from, { x: dx / len, y: dy / len, z: dz / len });
          const hit = world.castRay(ray, len, true, undefined, undefined, undefined, body);
          return hit ? (hit.timeOfImpact ?? hit.toi) : len;
        },
      };
    },
    step(dt) { world.timestep = dt; world.step(); },
  };
}
