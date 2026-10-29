// SKILLS quadrant: a little fair — big carnival booths standing on the lawn in a gentle arc (like
// the social circle's links), each facing the arc centre, one minigame each (just for fun).
// E at a booth takes the camera to it (stage.focus); the mouse plays; Esc goes back.
//   cans  — click to throw a ball (real physics) at a 10-can pyramid; clear the shelf with 5 balls.
//   ducks — two rows of ducks glide opposite ways; click to shoot; 12 hits in 20 s.
//   rings — aim with the mouse, hold to charge (fast ping-pong), release; ring 3 bottles with 6.
//   moles — moles pop out of 9 holes for a moment; click to whack, a miss costs 1 s; 15 in 30 s.
// Booths and targets are code-built placeholders, meant to be swapped for custom models.
// Booth frame: counter front at local z 0 facing local -z (towards the plaza centre), back wall
// at local z = booth depth; w(lx, ly, lz) turns booth-local points into world points.
import * as THREE from 'three';
import { GRAVITY } from './physics.js';
import { PARK_COLORS } from './park.js';

export const CARNIVAL_AREA = {
  arc: 26,                          // arc centre -> counter front (m)
  spacing: 10.5,                    // between booth centres along the arc (m)
  booth: { w: 5.2, d: 3.6, h: 3.5 }, // stall size (m)
  view: { back: 3.5, y: 2.3 },      // focused camera: metres in front of the counter, height
  rules: {
    cans: { balls: 5, speed: 15 },
    ducks: { time: 20, goal: 12, speeds: [1.7, -1.2] },
    rings: { rings: 6, goal: 3, charge: 0.7, reach: [1.2, 3.6], catch: 0.12 }, // catch: hit radius (m)
    moles: { time: 30, goal: 15, up: 0.6, every: [0.3, 0.6], miss: 1 },
  },
};
const NAMES = { cans: 'CAN TOSS', ducks: 'DUCK SHOOT', rings: 'RING TOSS', moles: 'WHACK-A-MOLE' };
const R0 = CARNIVAL_AREA.rules;
const HINTS = {
  cans: 'Click to throw · clear the whole shelf',
  ducks: `Click the ducks · ${R0.ducks.goal} hits in ${R0.ducks.time} s`,
  rings: 'Aim with the mouse · hold to charge, release to throw',
  moles: `Click the moles · ${R0.moles.goal} in ${R0.moles.time} s · a miss costs ${R0.moles.miss} s`,
};
const STRIPES = [[0xd9443c, 0xf3efe6], [0x3b6fd1, 0xf3efe6], [0xf2b632, 0xd9443c], [0x4e9a52, 0xf3efe6]];
const lambert = (hex) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
const glow = (hex, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });

function signTexture(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 140;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#251f2b'; ctx.fillRect(0, 0, 512, 140);
  ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, 500, 128);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f5c542'; ctx.font = '84px Jersey10, VT323, monospace'; ctx.fillText(name, 256, 74, 470);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// x0, z0: plaza centre.
export async function createCarnival({ scene, physics, points, stage, booths, x0, z0 }) {
  await document.fonts.load('84px Jersey10').catch(() => {});
  const C = CARNIVAL_AREA, B = C.booth, group = new THREE.Group();
  scene.add(group);
  const add = (mesh, px, py, pz, cast = true, parent = group) => { mesh.position.set(px, py, pz); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let active = null, refresh = 0;

  // ---------- Booth: counter, posts, side + back walls, striped canopy, sign, bulbs ----------
  function buildBooth(data, i, dir) {
    const [c1, c2] = STRIPES[i % STRIPES.length], booth = new THREE.Group();
    const yaw = Math.atan2(dir.x, dir.z); // local +z (towards the back wall) points outwards
    booth.position.set(x0 + dir.x * C.arc, 0, z0 + dir.z * C.arc);
    booth.rotation.y = yaw;
    group.add(booth);
    booth.updateMatrixWorld(true);
    const w = (lx, ly, lz) => booth.localToWorld(new THREE.Vector3(lx, ly, lz));
    const part = (geo, mat, px, py, pz, cast = true) => add(new THREE.Mesh(geo, mat), px, py, pz, cast, booth);
    const place = (object, px, py, pz) => { object.position.set(px, py, pz); booth.add(object); return object; };
    const box = (lx, ly, lz, hx, hy, hz) => { const p = w(lx, ly, lz); physics.box(p.x, p.y, p.z, hx, hy, hz, yaw); };
    for (let k = 0; k < 10; k++) part(new THREE.BoxGeometry(B.w / 10, 1, 0.5), lambert(k % 2 ? c2 : c1), -B.w / 2 + B.w / 20 + (k * B.w) / 10, 0.5, 0.25);
    part(new THREE.BoxGeometry(B.w + 0.1, 0.08, 0.62), lambert(PARK_COLORS.wood), 0, 1.04, 0.25);
    part(new THREE.BoxGeometry(B.w, B.h - 0.3, 0.1), lambert(0x6c4b8c), 0, (B.h - 0.3) / 2, B.d);
    for (let k = 0; k < 10; k++) part(new THREE.BoxGeometry(B.w / 10, 1.2, 0.04), lambert(k % 2 ? c2 : c1), -B.w / 2 + B.w / 20 + (k * B.w) / 10, 0.6, B.d + 0.07); // outside skirt
    for (const s of [-1, 1]) {
      part(new THREE.BoxGeometry(0.1, 1.4, B.d), lambert(c1), (s * B.w) / 2, 0.7, B.d / 2);
      for (const pz of [0, B.d]) part(new THREE.CylinderGeometry(0.08, 0.08, B.h, 6), lambert(PARK_COLORS.darkWood), (s * (B.w + 0.1)) / 2, B.h / 2, pz);
    }
    // Canopy: alternating stripes sloping down to the front, with a scalloped valance.
    const canopy = new THREE.Group(), cw = B.w + 0.7;
    canopy.position.set(0, B.h + 0.2, B.d / 2 - 0.2); canopy.rotation.x = -0.16;
    booth.add(canopy);
    for (let k = 0; k < 12; k++) {
      const x = -cw / 2 + cw / 24 + (k * cw) / 12;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(cw / 12, 0.06, B.d + 1.1), lambert(k % 2 ? c2 : c1));
      stripe.position.x = x; stripe.castShadow = true;
      canopy.add(stripe);
      const flap = new THREE.Mesh(new THREE.CylinderGeometry(cw / 24, cw / 24, 0.05, 10, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), lambert(k % 2 ? c2 : c1));
      flap.position.set(x, -0.02, -(B.d + 1.1) / 2);
      canopy.add(flap);
    }
    for (let k = 0; k < 11; k++) part(new THREE.SphereGeometry(0.07, 6, 4), glow(0xffd88a), -B.w / 2 + (k * B.w) / 10, B.h - 0.05, -0.55, false);
    // Sign on top, readable from the front and the back (two back-to-back planes).
    const map = signTexture(NAMES[data.game]);
    for (const back of [false, true]) {
      const sign = part(new THREE.PlaneGeometry(3.4, 0.93), new THREE.MeshBasicMaterial({ map }), 0, B.h + 1.15, back ? 0.03 : -0.03, false);
      sign.rotation.y = back ? 0 : Math.PI;
    }
    part(new THREE.BoxGeometry(3.5, 1.0, 0.04), lambert(0x251f2b), 0, B.h + 1.15, 0);
    // Colliders: counter, back wall, side walls.
    box(0, 0.55, 0.25, B.w / 2, 0.55, 0.3);
    box(0, B.h / 2, B.d, B.w / 2, B.h / 2, 0.1);
    for (const s of [-1, 1]) box((s * B.w) / 2, 0.7, B.d / 2, 0.08, 0.7, B.d / 2);

    const game = GAMES[data.game]({ booth, part, place, w, box, yaw });
    const entry = { data, game, score: 0, over: false };
    const eye = w(0, C.view.y, -C.view.back), look = w(0, 1.3, 2.2);
    points.create(w(0, 1, -1.7), NAMES[data.game], 'right', () => {
      if (!stage.focus(eye, look, () => { active = null; })) return;
      active = entry;
      start(entry);
    });
    return entry;
  }

  // ---------- Round flow + HUD ----------
  function start(entry) { entry.over = false; entry.won = false; entry.game.reset(entry); hud(entry); }
  function finish(entry, won) {
    if (entry.over) return;
    entry.over = true; entry.won = won;
    hud(entry);
  }
  function hud(entry) {
    const { data, game } = entry;
    const status = entry.over
      ? (entry.won ? `<p class="focus-win">★ YOU WIN!</p><p class="hint">${game.status(entry)}</p>` : `<p class="focus-lose">So close! Try again.</p><p class="hint">${game.status(entry)}</p>`)
      : `<p class="focus-score">${game.status(entry)}</p><p class="hint">${HINTS[data.game]} · Esc back</p>`;
    stage.hud(`<p class="eyebrow">◆ ${NAMES[data.game]}</p>${status}
      ${game.power ? '<div class="focus-power"><span></span></div>' : ''}
      <div class="focus-actions"><button data-act="retry" type="button">RETRY</button><button data-act="exit" type="button">ESC</button></div>`);
  }
  document.querySelector('#focus-hud').addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!active || !button) return;
    if (button.dataset.act === 'retry') start(active); else if (button.dataset.act === 'exit') stage.release();
  });
  const rayFrom = (event) => {
    const rect = stage.dom.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    return raycaster;
  };
  stage.dom.addEventListener('pointerdown', (event) => {
    if (!active || active.over || event.button !== 0) return;
    active.game.down?.(rayFrom(event), active);
    hud(active);
  });
  stage.dom.addEventListener('pointerup', (event) => {
    if (!active || active.over || event.button !== 0) return;
    active.game.up?.(rayFrom(event), active);
    hud(active);
  });

  // ---------- Minigames ----------
  // Each: reset(entry), status(entry), update(dt, entry) -> 'win' | 'lose' | undefined, and pointer
  // handlers down / up(raycaster, entry). Built in booth-local coordinates.
  function cans({ part, w, box }) {
    const R = C.rules.cans, shelfTop = 1.3, shelfZ = 2.3;
    part(new THREE.BoxGeometry(2.2, 0.1, 0.55), lambert(PARK_COLORS.wood), 0, shelfTop - 0.05, shelfZ);
    part(new THREE.BoxGeometry(0.12, shelfTop - 0.1, 0.12), lambert(PARK_COLORS.darkWood), 0, (shelfTop - 0.1) / 2, shelfZ);
    box(0, shelfTop - 0.05, shelfZ, 1.1, 0.05, 0.275);
    // Pyramid 4-3-2-1.
    const spots = [];
    for (let row = 0; row < 4; row++) for (let k = 0; k < 4 - row; k++) spots.push([(k - (3 - row) / 2) * 0.235, row]);
    const canGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.3, 12);
    const list = spots.map(([cx, row], k) => {
      const mesh = add(new THREE.Mesh(canGeo, lambert([0xd9443c, 0x3b6fd1, 0xf2b632][k % 3])), 0, 0, 0);
      const home = w(cx, shelfTop + 0.151 + row * 0.302, shelfZ);
      return { mesh, home, body: physics.dynamic('cylinder', [0.15, 0.11], home.x, home.y, home.z, { density: 0.7, friction: 0.6 }) };
    });
    const ballGeo = new THREE.SphereGeometry(0.09, 10, 8);
    const balls = Array.from({ length: R.balls }, () => {
      const mesh = add(new THREE.Mesh(ballGeo, lambert(0xf3efe6)), 0, -10, 0);
      const body = physics.dynamic('ball', [0.09], 0, -20, 0, { density: 3, restitution: 0.3, ccd: true });
      body.setEnabled(false); mesh.visible = false;
      return { mesh, body };
    });
    let thrown = 0, settle = 0;
    const sync = (o) => { const p = o.body.translation(), q = o.body.rotation(); o.mesh.position.set(p.x, p.y, p.z); o.mesh.quaternion.set(q.x, q.y, q.z, q.w); };
    const down = () => list.filter((c) => c.body.translation().y < shelfTop - 0.2).length;
    list.forEach(sync);
    const shelf = w(0, 0, shelfZ), normal = w(0, 0, 1).sub(w(0, 0, 0));
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, shelf), target = new THREE.Vector3();
    return {
      reset() {
        thrown = 0; settle = 0;
        for (const c of list) { c.body.setTranslation(c.home, true); c.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true); c.body.setLinvel({ x: 0, y: 0, z: 0 }, true); c.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        for (const b of balls) { b.body.setEnabled(false); b.mesh.visible = false; }
      },
      status: () => `Cans down ${down()} / ${list.length} · Balls ${R.balls - thrown}`,
      // Throw: aimed at where the click ray meets the shelf plane, with gravity compensated so
      // the ball lands where you clicked (flight time = distance / speed).
      down(ray) {
        if (thrown >= R.balls || !ray.ray.intersectPlane(plane, target)) return;
        const ball = balls[thrown++], from = ray.ray.origin.clone().addScaledVector(ray.ray.direction, 0.8);
        const time = from.distanceTo(target) / R.speed;
        ball.body.setEnabled(true);
        ball.body.setTranslation(from, true);
        ball.body.setLinvel({ x: (target.x - from.x) / time, y: (target.y - from.y) / time + 0.5 * GRAVITY * time, z: (target.z - from.z) / time }, true);
        ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        ball.mesh.visible = true;
        settle = 0;
      },
      update(dt) {
        list.forEach(sync); balls.forEach((b) => b.mesh.visible && sync(b));
        if (down() === list.length) return 'win';
        if (thrown >= R.balls && (settle += dt) > 2.5) return 'lose';
        return undefined;
      },
    };
  }

  function ducks({ part, place }) {
    const R = C.rules.ducks, span = B.w - 0.6, rows = [{ y: 1.35, z: 2.6 }, { y: 1.95, z: 2.9 }];
    const list = [];
    rows.forEach((row, r) => {
      part(new THREE.BoxGeometry(B.w - 0.2, 0.08, 0.1), lambert(PARK_COLORS.darkWood), 0, row.y - 0.05, row.z);
      for (let k = 0; k < 9; k++) part(new THREE.BoxGeometry(B.w / 9, 0.25, 0.06), lambert(k % 2 ? 0x3b6fd1 : 0x5390ff), -B.w / 2 + B.w / 18 + (k * B.w) / 9, row.y - 0.15, row.z - 0.08);
      const holder = place(new THREE.Group(), 0, row.y, row.z), speed = R.speeds[r];
      for (let k = 0; k < 6; k++) {
        const duck = new THREE.Group(), tint = r ? 0xffffff : 0xf2d35b, size = r ? 0.8 : 1;
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.14 * size, 8, 6).scale(1.2, 0.85, 0.8), lambert(tint));
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.09 * size, 8, 6), lambert(tint)); head.position.set(0.1 * size * Math.sign(speed), 0.15 * size, 0);
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 6).rotateZ(-Math.PI / 2 * Math.sign(speed)), lambert(0xff8039)); beak.position.set(0.21 * size * Math.sign(speed), 0.14 * size, 0);
        for (const m of [body, head, beak]) { m.castShadow = true; duck.add(m); }
        const pivot = new THREE.Group(); pivot.add(duck); duck.position.y = 0.11;
        holder.add(pivot);
        list.push({ pivot, duck, speed, x: -span / 2 + (k * span) / 6, hit: false, flip: 0 });
      }
    });
    let time = 0;
    return {
      reset(entry) { time = R.time; entry.score = 0; for (const d of list) { d.hit = false; d.flip = 0; } },
      status: (entry) => `Hits ${entry.score} / ${R.goal} · ${Math.max(0, Math.ceil(time))} s`,
      down(ray, entry) {
        const hits = ray.intersectObjects(list.filter((d) => !d.hit && d.pivot.visible).map((d) => d.duck), true);
        if (!hits.length) return;
        const d = list.find((it) => hits[0].object.parent === it.duck);
        if (d) { d.hit = true; entry.score++; }
      },
      update(dt, entry) {
        time -= dt;
        for (const d of list) {
          d.x += d.speed * dt;
          if (d.x > span / 2) { d.x -= span; d.hit = false; } // back up on the next lap
          if (d.x < -span / 2) { d.x += span; d.hit = false; }
          d.flip += ((d.hit ? 1 : 0) - d.flip) * Math.min(1, dt * 12);
          d.pivot.position.set(d.x, 0, 0);
          d.pivot.rotation.x = d.flip * Math.PI / 2;
          d.duck.position.y = 0.11 + Math.sin(time * 6 + d.x * 3) * 0.02;
          d.pivot.visible = Math.abs(d.x) < span / 2 - 0.02;
        }
        if (entry.score >= R.goal) return 'win';
        return time <= 0 ? 'lose' : undefined;
      },
    };
  }

  function rings({ booth, part, place }) {
    const R = C.rules.rings, tableY = 0.9;
    part(new THREE.BoxGeometry(2.4, 0.08, 2.1), lambert(0x6c4b8c), 0, tableY - 0.04, 2.1);
    part(new THREE.BoxGeometry(2.2, tableY - 0.08, 1.9), lambert(PARK_COLORS.darkWood), 0, (tableY - 0.08) / 2, 2.1);
    const bottles = [];
    for (const lz of [1.45, 2.1, 2.75]) for (const lx of [-0.7, 0, 0.7]) {
      const glass = lambert([0x4e9a52, 0x8fc2c9, 0xd9443c][(bottles.length + Math.floor(bottles.length / 3)) % 3]);
      part(new THREE.CylinderGeometry(0.09, 0.1, 0.32, 10), glass, lx, tableY + 0.16, lz);
      part(new THREE.CylinderGeometry(0.035, 0.05, 0.2, 8), glass, lx, tableY + 0.42, lz);
      bottles.push(new THREE.Vector3(lx, tableY + 0.4, lz));
    }
    // Rings fly in booth-local space; the click ray is brought into it.
    const ringGeo = new THREE.TorusGeometry(0.1, 0.022, 6, 16).rotateX(Math.PI / 2);
    const list = Array.from({ length: R.rings }, (_, k) => ({ mesh: place(new THREE.Mesh(ringGeo, glow([0xf2d35b, 0xef8fb2, 0x7dff8a][k % 3], 1.2)), 0, -5, 0), flight: null }));
    const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(tableY + 0.4)), aim = new THREE.Vector3();
    const toLocal = new THREE.Matrix4().copy(booth.matrixWorld).invert(), local = new THREE.Ray();
    let thrown = 0, charging = null, power = 0;
    return {
      power: true,
      reset(entry) { thrown = 0; entry.score = 0; charging = null; for (const r of list) { r.mesh.visible = false; r.flight = null; } },
      status: (entry) => `Ringed ${entry.score} / ${R.goal} · Rings ${R.rings - thrown}`,
      down() { if (thrown < R.rings) charging = 0; },
      // Release: direction from the mouse, landing depth from the charge (power ping-pongs 0..1).
      up(ray) {
        local.copy(ray.ray).applyMatrix4(toLocal);
        if (charging == null || !local.intersectPlane(aimPlane, aim)) { charging = null; return; }
        const from = local.origin.clone().addScaledVector(local.direction, 0.6); from.y -= 0.4;
        const dir = new THREE.Vector3(aim.x - from.x, 0, aim.z - from.z).normalize();
        const reach = R.reach[0] + (R.reach[1] - R.reach[0]) * power;
        const land = new THREE.Vector3(from.x, tableY + 0.02, from.z).addScaledVector(dir, (reach - from.z) / Math.max(0.2, dir.z));
        const ring = list[thrown++];
        const target = bottles.find((b) => Math.hypot(b.x - land.x, b.z - land.z) < R.catch);
        ring.flight = { from, to: target ? new THREE.Vector3(target.x, target.y - 0.12, target.z) : land, t: 0, scored: Boolean(target) };
        ring.mesh.visible = true;
        charging = null;
      },
      update(dt, entry) {
        if (charging != null) { charging += dt; const p = (charging / R.charge) % 2; power = p > 1 ? 2 - p : p; }
        const bar = document.querySelector('#focus-hud .focus-power span');
        if (bar) bar.style.width = `${Math.round((charging != null ? power : 0) * 100)}%`;
        let flying = false;
        for (const r of list) {
          const f = r.flight;
          if (!f || f.t >= 1) continue;
          f.t = Math.min(1, f.t + dt / 0.75); flying = true;
          r.mesh.position.lerpVectors(f.from, f.to, f.t);
          r.mesh.position.y += Math.sin(f.t * Math.PI) * 0.9;
          r.mesh.rotation.y += dt * 12;
          if (f.t === 1 && f.scored) entry.score++;
        }
        if (entry.score >= R.goal) return 'win';
        return thrown >= R.rings && !flying ? 'lose' : undefined;
      },
    };
  }

  function moles({ part, place }) {
    const R = C.rules.moles, boardY = 1.0, boardZ = 1.8;
    part(new THREE.BoxGeometry(2.8, 0.1, 2.3), lambert(0x4e9a52), 0, boardY - 0.05, boardZ);
    const list = [];
    for (const lz of [-0.75, 0, 0.75]) for (const lx of [-0.9, 0, 0.9]) {
      part(new THREE.CircleGeometry(0.22, 14).rotateX(-Math.PI / 2), lambert(0x1d1a24), lx, boardY + 0.006, boardZ + lz, false);
      const mole = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.4, 10), lambert(0x8a6a4a)); body.position.y = 0.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), lambert(0x9b7a58)); head.position.y = 0.42;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), lambert(0xef8fb2)); nose.position.set(0, 0.42, -0.16);
      for (const m of [body, head, nose]) { m.castShadow = true; mole.add(m); }
      place(mole, lx, boardY - 0.62, boardZ + lz);
      list.push({ mole, rise: 0, up: 0, hit: false });
    }
    let time = 0, next = 0;
    return {
      reset(entry) { time = R.time; next = 0.5; entry.score = 0; for (const m of list) { m.up = 0; m.hit = false; } },
      status: (entry) => `Whacked ${entry.score} / ${R.goal} · ${Math.max(0, Math.ceil(time))} s`,
      down(ray, entry) {
        const hits = ray.intersectObjects(list.filter((m) => m.up > 0 && !m.hit).map((m) => m.mole), true);
        const m = hits.length && list.find((it) => hits[0].object.parent === it.mole);
        if (m) { m.hit = true; m.up = Math.min(m.up, 0.15); entry.score++; } else time -= R.miss;
      },
      update(dt, entry) {
        time -= dt; next -= dt;
        if (next <= 0) {
          const idle = list.filter((m) => m.up <= 0);
          if (idle.length) { const m = idle[Math.floor(Math.random() * idle.length)]; m.up = R.up; m.hit = false; }
          next = R.every[0] + Math.random() * (R.every[1] - R.every[0]);
        }
        for (const m of list) {
          m.up = Math.max(0, m.up - dt);
          m.rise += ((m.up > 0 ? 1 : 0) - m.rise) * Math.min(1, dt * 16);
          m.mole.position.y = boardY - 0.62 + m.rise * 0.6;
          m.mole.scale.y = m.hit ? 0.55 : 1;
        }
        if (entry.score >= R.goal) return 'win';
        return time <= 0 ? 'lose' : undefined;
      },
    };
  }
  const GAMES = { cans, ducks, rings, moles };
  // Arc south of its centre (x0, z0), booths facing it.
  const step = C.spacing / C.arc;
  const dirs = booths.map((_, i) => { const a = (i - (booths.length - 1) / 2) * step; return new THREE.Vector3(Math.sin(a), 0, Math.cos(a)); });
  booths.forEach((data, i) => buildBooth(data, i, dirs[i]));
  const centres = dirs.map((d) => new THREE.Vector3(x0 + d.x * (C.arc + B.d / 2), 0, z0 + d.z * (C.arc + B.d / 2)));
  const footprint = Math.hypot(B.w / 2, B.d / 2) + 1.2;

  return {
    bounds: centres.map((c) => ({ x: c.x, z: c.z, r: footprint + 1 })),
    covers: (px, pz) => centres.some((c) => Math.hypot(px - c.x, pz - c.z) < footprint),
    update(dt) {
      if (!active || active.over) return;
      const result = active.game.update(dt, active);
      if (result) finish(active, result === 'win');
      else if ((refresh += dt) > 0.1) { refresh = 0; hud(active); } // timers / counters
    },
  };
}
