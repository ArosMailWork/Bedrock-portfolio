// Low-poly park dressing on the island: paths, plaza + fountain, hedges, bushes, flowers,
// lamps, benches, lodges, beach rocks, fences and swaying 3D grass. Static colliders go to Rapier.
// Natural look (ideas after Townscaper, nothing copied): stepping-stone trails into and across
// the plots, clustered scatter (Poisson-disk cluster centres, noise density) and context rules
// (props chosen by what is around them: tile edges, edge trees, path bends, lodge corners, shore).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addSway, PALETTE } from './tree-mesh.js';
import { mulberry32 } from './shape-tree.js';
import { shoreRadius, groundColor } from './island.js';
import { buildFountain } from './fountain.js';

export const PARK_COLORS = {
  paving: [0xd9d3c6, 0xcdc6b7, 0xe3ddd1], curb: 0xf3efe6,
  hedge: [0x4f8a3a, 0x5a9642], bush: [0x5c9a40, 0x4b8a36, 0x6aa84a],
  flowers: [0x9b7be0, 0xf2d35b, 0xffffff, 0xef8fb2],
  wood: 0x8a6a4a, darkWood: 0x6b4f37, wall: 0xf1e3c4, roof: 0xc4664c, glass: 0x8fc2c9,
  lampPost: 0x3e4a44, lampGlow: 0xffd88a, rock: [0x9a9a96, 0x8a8d8c, 0xaaa79f],
  grassTip: 0xc9e27a, // blades fade from the ground colour at the root to this tint at the tip
  stone: [0xd6cfbf, 0xc6bfaf, 0xe0dacd], fern: [0x4e8c3c, 0x5f9d45, 0x447e35],
  mushroomCap: [0xd2553f, 0xb8774a, 0xe7c48f], mushroomStem: 0xf1e8d6, reed: [0xa9bb5f, 0x93ab52, 0xbcc777],
};
// Stepping stones: spacing along the trail (m), slab radius range (m), zig-zag offset (m).
const STONES = { gap: 0.95, size: [0.32, 0.46], zigzag: 0.22 };
// Clustered scatter: minimum distance between cluster centres (m), max clusters, and the distance
// to the plots / plaza over which the density fades out (m) on the large island.
const SCATTER = { spacing: 11, max: 260, fade: [25, 110] };
// RING_R: ring road centre line round the plaza; LOOKOUT_R: round stops at the ends of the N/S axes.
const PATH_HALF = 1.3, PLAZA_R = 7, RING_R = 13, LOOKOUT_R = 3;
// Grass streaming: square size (m), build radius, free radius, squares built per frame.
export const GRASS = { chunk: 32, radius: 110, keep: 150, perFrame: 2 };
const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

// plots: [{ x, z, view, entrance }], houses: [{ x, z, angle }] (angle: door faces +z rotated).
// keepClear(x, z): true where another area (work-area.js) owns the ground: no grass, no props.
export function buildPark({ scene, physics, R, plots, houses, time, keepClear = () => false }) {
  const rand = mulberry32(7);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
  const color = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const shade = (mesh, cast = true) => { mesh.castShadow = cast; mesh.receiveShadow = true; return mesh; };
  const add = (mesh, x, y, z, ry = 0, cast = true) => { mesh.position.set(x, y, z); mesh.rotation.y = ry; scene.add(shade(mesh, cast)); return mesh; };
  const batches = new Map(); // key -> { geo, mat, items }
  // Instanced batches, created lazily: make() returns [geometry, material].
  const batch = (key, make) => { if (!batches.has(key)) { const [geo, mat] = make(); batches.set(key, { geo, mat, items: [] }); } return batches.get(key).items; };
  const put = (items, x, y, z, ry, sx, sy, sz, hex) => items.push({ matrix: m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, ry), s3.set(sx, sy, sz)).clone(), hex });

  const isFloor = (x, z) => plots.some((p) => Math.abs(x - p.x) <= p.w / 2 + 1 && Math.abs(z - p.z) <= p.h / 2 + 1 && p.view.isFloor(x - p.x, z - p.z));
  const nearFloor = (x, z, r) => [[r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dz]) => isFloor(x + dx, z + dz));

  // ---------- Paths: ring road round the plaza, cross axes, one spur into each plot ----------
  // Like a classic park plan: the ring road and the cross axes (E/W to the lodges, N/S to two
  // lookouts) split the park into four zones, one plot each; a spur leaves the ring for each plot
  // and ends on the plot's walkway spur (tree-mesh.js), which branches round and through the text.
  // Every route is planned first, then drawn: paving ribbons with white curbs, curbs dropped
  // where they would cross another route's paving or the tiles.
  const grid = new Map(), cellOf = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  const routes = [];
  const flowers = [], pathInfos = [], hedges = [], lamps = [];
  const nearHedge = (x, z, r) => hedges.some((h) => Math.hypot(x - h.x, z - h.z) < r);
  // half: paving half width; colors: paving tones; onTiles: keep curbs on plot tiles (walkways).
  // Points may carry y: added to the route height (the walkway spur slopes down to the main path).
  function route(points, { closed = false, decor = false, index = 0, y = 0.035, half = PATH_HALF, colors = PARK_COLORS.paving, onTiles = false, walk = false } = {}) {
    const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
    const n = Math.max(8, Math.ceil(curve.getLength() / 0.9));
    const pts = curve.getSpacedPoints(n);
    const side = (i) => { const t = curve.getTangentAt(Math.min(i, n) / n); return new THREE.Vector3(-t.z, 0, t.x); };
    const id = routes.length;
    routes.push({ id, curve, n, pts, side, decor, index, y, half, colors, onTiles, walk });
    for (const p of pts) {
      const key = cellOf(p.x, p.z);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push({ x: p.x, z: p.z, id, half });
    }
    return routes[id];
  }
  // except: a route id to ignore (its own samples).
  const onPath = (x, z, margin, except = -1) => {
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const p of grid.get(`${cx + i},${cz + j}`) || []) if (p.id !== except && (p.x - x) ** 2 + (p.z - z) ** 2 < (p.half + margin) ** 2) return true;
    }
    return false;
  };
  // A radial path: hidden start under the plaza disc, radial exit, bent middle, straight approach.
  const radialPoints = (from, end, inward, bend) => {
    const out = end.clone().setY(0).normalize();
    const start = out.clone().multiplyScalar(from - 1.2), exit = out.clone().multiplyScalar(from + 2.5);
    const approach = end.clone().addScaledVector(inward, -2.5), finish = end.clone().addScaledVector(inward, 1.5);
    const dir = approach.clone().sub(exit).normalize();
    const mid = exit.clone().lerp(approach, 0.5).add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(bend));
    return [start, exit, mid, approach, finish];
  };
  // Ring road (drawn a little higher, so it covers the radial paths where they cross it).
  const ring = [];
  for (let k = 0; k < 16; k++) ring.push(new THREE.Vector3(Math.cos((k / 16) * Math.PI * 2) * RING_R, 0, Math.sin((k / 16) * Math.PI * 2) * RING_R));
  route(ring, { closed: true, y: 0.045 });
  // E/W axes to the lodge doors.
  houses.forEach((h, i) => {
    const inward = new THREE.Vector3(-Math.sin(h.angle), 0, -Math.cos(h.angle));
    const door = new THREE.Vector3(h.x, 0, h.z).addScaledVector(inward, -4.2);
    route(radialPoints(PLAZA_R, door, inward, i % 2 ? 2 : -2), { decor: true, index: i + plots.length });
  });
  // N/S axes between the plots, each ending at a small round lookout past the plots.
  const lookouts = [-1, 1].map((s, i) => {
    const far = Math.max(...plots.filter((p) => Math.sign(p.z) === s).map((p) => Math.abs(p.z) + p.h / 2), RING_R + 10) + 4;
    const end = new THREE.Vector3(0, 0, s * far);
    route(radialPoints(PLAZA_R, end, new THREE.Vector3(0, 0, s), i ? 1.5 : -1.5), { decor: true, index: i + plots.length + 2 });
    return end;
  });
  // Spurs: from the ring road to each plot's entrance (end of its walkway spur).
  const spurs = plots.map((p, i) => {
    const inward = new THREE.Vector3(Math.sign(p.x), 0, Math.sign(p.z)).normalize();
    return route(radialPoints(RING_R, p.entrance, inward, i % 2 ? 1.5 : -1.5), { decor: true, index: i });
  });
  // Plot walkways (layout from tree-mesh.js): drawn like the main paths but in orange paving and
  // raised over the tiles (paving top 0.09); the spur slopes down to the main path at the entry.
  const WALK_Y = 0.055;
  for (const p of plots) {
    const w = p.view.walkways;
    if (!w) continue;
    const at = (lx, lz, y = WALK_Y) => new THREE.Vector3(p.x + lx, y, p.z + lz);
    const { x0, x1, z0, z1 } = w.box, o = w.offset, ring = [];
    for (const [cx, cz, a0] of [[x0, z0, Math.PI], [x1, z0, Math.PI * 1.5], [x1, z1, 0], [x0, z1, Math.PI / 2]]) {
      for (let k = 0; k <= 6; k++) { const a = a0 + (k / 6) * (Math.PI / 2); ring.push(at(cx + Math.cos(a) * o, cz + Math.sin(a) * o)); }
    }
    const opts = { half: w.ringHalf, colors: PALETTE.tileWalk, onTiles: true, walk: true };
    route(ring, { ...opts, closed: true });
    for (const r of w.rungs) route([at(x0 - o, r.z), at((x0 + x1) / 2, r.z), at(x1 + o, r.z)], { ...opts, half: r.half });
    if (w.spur) {
      const from = at(w.spur.from.x, w.spur.from.z), to = at(w.spur.to.x, w.spur.to.z, 0);
      const dir = to.clone().sub(from).setY(0).normalize();
      const edge = to.clone().addScaledVector(dir, -1.8); edge.y = WALK_Y;
      route([from, from.clone().lerp(edge, 0.5), edge, to, to.clone().addScaledVector(dir, 0.8)], { ...opts, half: w.spur.half });
    }
  }

  const pos = [], col = [];
  const quad = (a, b, c, d, y, hex) => {
    color.setHex(hex);
    for (const p of [a, b, c, b, d, c]) { pos.push(p.x, y + p.y, p.z); col.push(color.r, color.g, color.b); }
  };
  for (const r of routes) {
    const { pts, n, side, y, id, half: H, colors, onTiles } = r;
    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[i + 1], n0 = side(i), n1 = side(i + 1);
      const at = (p, nn, k) => p.clone().addScaledVector(nn, k);
      const paving = () => colors[Math.floor(rand() * colors.length)];
      quad(at(p0, n0, -H), at(p0, n0, 0), at(p1, n1, -H), at(p1, n1, 0), y, paving());
      quad(at(p0, n0, 0), at(p0, n0, H), at(p1, n1, 0), at(p1, n1, H), y, paving());
      for (const s of [-1, 1]) {
        const mid = p0.clone().lerp(p1, 0.5).addScaledVector(n0, s * (H + 0.1));
        if (onPath(mid.x, mid.z, -0.05, id) || (!onTiles && isFloor(mid.x, mid.z)) || Math.hypot(mid.x, mid.z) < PLAZA_R + 0.2) continue;
        const k0 = s < 0 ? -H - 0.2 : H, k1 = k0 + 0.2;
        quad(at(p0, n0, k0), at(p0, n0, k1), at(p1, n1, k0), at(p1, n1, k1), y + 0.035, PARK_COLORS.curb);
      }
    }
  }
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pathGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  pathGeo.computeVertexNormals();
  scene.add(shade(new THREE.Mesh(pathGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })), false));

  // Hedges on one side in alternating stretches, flowers on the other; a lamp half-way. Nothing
  // near another route (junctions stay open) or on the tiles.
  for (const { pts, n, side, curve, index, id, decor } of routes) {
    if (!decor) continue;
    for (let i = 7; i < pts.length - 5; i++) {
      const sideSign = (Math.floor(i / 7) + index) % 2 ? 1 : -1, nn = side(i);
      const t = curve.getTangentAt(Math.min(i, n) / n), angle = Math.atan2(t.x, t.z);
      const h = pts[i].clone().addScaledVector(nn, sideSign * (PATH_HALF + 0.8));
      if (rand() < 0.85 && !nearFloor(h.x, h.z, 0.6) && !onPath(h.x, h.z, 1.2, id) && !lamps.some((l) => Math.hypot(h.x - l.x, h.z - l.z) < 1)) {
        const sy = 0.75 + rand() * 0.2;
        put(batch('hedge', () => [new THREE.BoxGeometry(1, 1, 1), lambert(0xffffff)]), h.x, sy / 2, h.z, angle, 0.95, sy, 1.05, PARK_COLORS.hedge[i % 2]);
        physics.box(h.x, sy / 2, h.z, 0.45, sy / 2, 0.5, angle);
        hedges.push(h);
      }
      for (let k = 0; k < 3; k++) {
        const f = pts[i].clone().addScaledVector(nn, -sideSign * (PATH_HALF + 0.5 + rand() * 0.9));
        f.x += (rand() - 0.5) * 0.6;
        if (!nearFloor(f.x, f.z, 0.3) && !onPath(f.x, f.z, 0.3, id)) flowers.push(f);
      }
    }
    if (pts.length > 14) {
      const lampAt = pts[Math.floor(pts.length / 2)].clone().addScaledVector(side(Math.floor(n / 2)), PATH_HALF + 0.6);
      if (!onPath(lampAt.x, lampAt.z, 0.5, id) && !nearHedge(lampAt.x, lampAt.z, 1)) lamp(lampAt.x, lampAt.z);
    }
    // For the context rules: flowers (and so free space) lie on the side opposite the hedges.
    pathInfos.push({ pts, n, side, flowerSide: (i) => ((Math.floor(i / 7) + index) % 2 ? -1 : 1) });
  }
  // Plot walkways: every ~9 m a lamp or a bench (alternating) beside the path, on the tiles,
  // away from the text trees, other paths and earlier furniture.
  const onText = (x, z) => plots.some((p) => Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.h / 2 && p.view.isText(x - p.x, z - p.z));
  const furniture = [];
  let furnitureKind = 0;
  for (const { pts, side, half: H, walk } of routes) {
    if (!walk) continue;
    for (let i = 5; i < pts.length - 5; i += 10) {
      const nn = side(i), s = (i / 10) % 2 < 1 ? 1 : -1, p = pts[i].clone().addScaledVector(nn, s * (H + 0.9)).setY(0);
      const clear = [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]].every(([dx, dz]) => isFloor(p.x + dx, p.z + dz) && !onText(p.x + dx, p.z + dz));
      if (!clear || onPath(p.x, p.z, 0.5) || furniture.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 6)) continue;
      furniture.push(p);
      if (furnitureKind++ % 2) lamp(p.x, p.z); else bench(p.x, p.z, Math.atan2(-nn.x * s, -nn.z * s));
    }
  }
  function lamp(x, z) {
    lamps.push({ x, z });
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.6, 6), lambert(PARK_COLORS.lampPost)), x, 1.3, z);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.36), new THREE.MeshBasicMaterial({ color: PARK_COLORS.lampGlow })), x, 2.75, z, 0, false);
    add(new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.28, 4), lambert(PARK_COLORS.lampPost)), x, 3.1, z, Math.PI / 4);
    physics.cylinder(x, 1.3, z, 1.3, 0.16);
  }

  // Plaza with fountain; round lookouts (bench facing out, lamp) at the ends of the N/S axes.
  const disc = (x, z, r) => {
    add(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.25, r + 0.25, 0.06, 20), lambert(PARK_COLORS.curb)), x, 0.03, z, 0, false);
    add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.08, 20), lambert(PARK_COLORS.paving[1])), x, 0.04, z, 0, false);
  };
  disc(0, 0, PLAZA_R);
  const fountain = buildFountain(scene, physics, time);
  const onLookout = (x, z, margin) => lookouts.some((e) => Math.hypot(x - e.x, z - e.z) < LOOKOUT_R + margin);
  for (const end of lookouts) {
    const s = Math.sign(end.z);
    disc(end.x, end.z, LOOKOUT_R);
    bench(end.x, end.z + s * 1.2, s > 0 ? 0 : Math.PI);
    lamp(end.x + 2.2, end.z - s * 0.6);
  }

  // ---------- Stepping-stone shortcuts across the lawn between the spurs and the axes ----------
  // New dressing uses its own random stream, so the older props keep their places.
  const rnd = mulberry32(11);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const nearHouse = (x, z, r) => houses.some((h) => Math.hypot(x - h.x, z - h.z) < r);
  // Three slab shapes: a 7-sided prism whose rim is pushed in / out per corner (irregular stone).
  const stoneGeos = [0, 1, 2].map((k) => {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 7, 1).translate(0, 0.5, 0), p = geo.attributes.position;
    const jitter = mulberry32(31 + k), byAngle = new Map();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (Math.hypot(x, z) < 1e-4) continue; // cap centres
      const key = Math.round(Math.atan2(z, x) * 1000);
      if (!byAngle.has(key)) byAngle.set(key, 0.72 + jitter() * 0.38);
      p.setXYZ(i, x * byAngle.get(key), p.getY(i), z * byAngle.get(key));
    }
    geo.computeVertexNormals();
    return geo;
  });
  const stoneGrid = new Map();
  const onStone = (x, z, margin) => {
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const s of stoneGrid.get(`${cx + i},${cz + j}`) || []) if ((s.x - x) ** 2 + (s.z - z) ** 2 < (s.r + margin) ** 2) return true;
    }
    return false;
  };
  // Stones zig-zag along a centripetal Catmull-Rom curve; none on tiles, paths or near lodges.
  function trail(points) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const n = Math.max(2, Math.round(curve.getLength() / STONES.gap));
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt(i / n), t = curve.getTangentAt(i / n);
      const zig = (i % 2 ? 1 : -1) * STONES.zigzag + (rnd() - 0.5) * 0.12;
      const x = p.x - t.z * zig + (rnd() - 0.5) * 0.1, z = p.z + t.x * zig + (rnd() - 0.5) * 0.1;
      if (isFloor(x, z) || onPath(x, z, 0.3) || nearHouse(x, z, 4.4) || keepClear(x, z)) continue;
      const r = STONES.size[0] + rnd() * (STONES.size[1] - STONES.size[0]);
      const key = cellOf(x, z);
      if (!stoneGrid.has(key)) stoneGrid.set(key, []);
      stoneGrid.get(key).push({ x, z, r });
      const k = i % 3;
      put(batch(`stone${k}`, () => [stoneGeos[k], lambert(0xffffff)]), x, -0.01, z, rnd() * 6, r, 0.07, r * (0.78 + rnd() * 0.22), pick(PARK_COLORS.stone));
    }
  }
  // Each spur gets a shortcut to each neighbouring axis (same x side: E/W, same z side: N/S),
  // from about half-way along the spur to the nearest axis point outside the ring road.
  const axes = routes.filter((r) => r.decor && !spurs.includes(r));
  spurs.forEach((spur, i) => {
    const a = spur.pts[Math.floor(spur.pts.length * 0.55)];
    for (const axis of axes) {
      const end = axis.pts[axis.pts.length - 1];
      if (Math.sign(end.x) !== Math.sign(a.x) && Math.sign(end.z) !== Math.sign(a.z)) continue;
      let b = null, best = Infinity;
      for (const p of axis.pts) {
        const d = p.distanceTo(a);
        if (Math.hypot(p.x, p.z) > RING_R + 4 && d < best) { best = d; b = p; }
      }
      if (!b || best < 6 || best > 26) continue;
      const mid = a.clone().lerp(b, 0.5), dir = b.clone().sub(a).normalize();
      mid.add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(i % 2 ? 1.5 : -1.5));
      trail([a.clone(), mid, b.clone()]);
    }
  });

  // ---------- Benches: four on the plaza diagonals (the axes stay open), more from the rules ----------
  function bench(x, z, ry) {
    const group = new THREE.Group();
    const wood = lambert(PARK_COLORS.wood), dark = lambert(PARK_COLORS.darkWood);
    for (const [geo, mat, y, zz] of [[new THREE.BoxGeometry(2.2, 0.12, 0.6), wood, 0.55, 0], [new THREE.BoxGeometry(2.2, 0.5, 0.1), wood, 0.9, -0.3]]) {
      const m = shade(new THREE.Mesh(geo, mat)); m.position.set(0, y, zz); group.add(m);
    }
    for (const lx of [-0.9, 0.9]) { const leg = shade(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.55), dark)); leg.position.set(lx, 0.27, 0); group.add(leg); }
    group.position.set(x, 0.04, z); group.rotation.y = ry; scene.add(group);
    physics.box(x, 0.5, z, 1.1, 0.5, 0.35, ry);
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, x = Math.cos(a) * (PLAZA_R - 1.6), z = Math.sin(a) * (PLAZA_R - 1.6);
    bench(x, z, Math.atan2(-x, -z));
  }

  // ---------- Lodges: cream walls, terracotta pyramid roof, door facing the plaza ----------
  for (const h of houses) {
    const house = new THREE.Group();
    const part = (geo, hex, x, y, z, ry = 0) => { const m = shade(new THREE.Mesh(geo, lambert(hex))); m.position.set(x, y, z); m.rotation.y = ry; house.add(m); };
    part(new THREE.BoxGeometry(6, 3, 5), PARK_COLORS.wall, 0, 1.5, 0);
    const roof = shade(new THREE.Mesh(new THREE.ConeGeometry(4.9, 2.4, 4), lambert(PARK_COLORS.roof)));
    roof.position.y = 4.2; roof.rotation.y = Math.PI / 4; roof.scale.z = 0.86; house.add(roof);
    part(new THREE.BoxGeometry(0.6, 1.4, 0.6), PARK_COLORS.roof, 1.6, 4.6, -0.8);
    part(new THREE.BoxGeometry(1.2, 2, 0.12), PARK_COLORS.darkWood, 0, 1, 2.52);
    for (const wx of [-1.9, 1.9]) part(new THREE.BoxGeometry(1, 0.9, 0.12), PARK_COLORS.glass, wx, 1.8, 2.52);
    house.position.set(h.x, 0, h.z); house.rotation.y = h.angle; scene.add(house);
    physics.box(h.x, 1.5, h.z, 3.05, 1.5, 2.55, h.angle);
    for (let k = 0; k < 6; k++) flowers.push(new THREE.Vector3(h.x + Math.sin(h.angle) * 2.9 + Math.cos(h.angle) * (k < 3 ? -2.2 - k * 0.35 : 2.2 + (k - 3) * 0.35), 0, h.z + Math.cos(h.angle) * 2.9 - Math.sin(h.angle) * (k < 3 ? -2.2 - k * 0.35 : 2.2 + (k - 3) * 0.35)));
  }

  // ---------- Round bushes: flanking path mouths at the plaza, plus lawn clusters ----------
  const bushes = [];
  plots.forEach((p) => {
    const a = Math.atan2(p.entrance.z, p.entrance.x);
    for (const off of [-0.5, 0.5]) {
      const x = Math.cos(a + off) * (PLAZA_R + 1.8), z = Math.sin(a + off) * (PLAZA_R + 1.8);
      if (!onPath(x, z, 1.2)) bushes.push([x, z, 0.8 + rand() * 0.3]);
    }
  });
  // ---------- Small props (low-poly, built here; one instanced batch each) ----------
  const fernGeo = () => {
    const fronds = [];
    for (let k = 0; k < 6; k++) {
      const len = k === 5 ? 0.55 : 0.85; // five spreading fronds + a short upright one
      fronds.push(new THREE.ConeGeometry(0.12, len, 3).translate(0, len / 2, 0).scale(1, 1, 0.35)
        .rotateX(k === 5 ? 0.15 : 0.95).rotateY((k / 5) * Math.PI * 2));
    }
    return mergeGeometries(fronds);
  };
  const reedGeo = () => {
    const blades = [], lean = mulberry32(5);
    for (let k = 0; k < 7; k++) {
      const len = 0.8 + lean() * 0.6;
      blades.push(new THREE.ConeGeometry(0.035, len, 3).translate((lean() - 0.5) * 0.25, len / 2, (lean() - 0.5) * 0.25)
        .rotateX((lean() - 0.5) * 0.4).rotateZ((lean() - 0.5) * 0.4));
    }
    return mergeGeometries(blades);
  };
  const prop = {
    fern: (x, z, s) => put(batch('fern', () => [fernGeo(), lambert(0xffffff)]), x, 0, z, rnd() * 6, s, s * (0.8 + rnd() * 0.4), s, pick(PARK_COLORS.fern)),
    mushroom: (x, z, s) => {
      put(batch('mushroomStem', () => [new THREE.CylinderGeometry(0.045, 0.06, 1, 5).translate(0, 0.5, 0), lambert(0xffffff)]), x, 0, z, 0, s, 0.22 * s, s, PARK_COLORS.mushroomStem);
      put(batch('mushroomCap', () => [new THREE.SphereGeometry(0.15, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1), lambert(0xffffff)]), x, 0.2 * s, z, rnd() * 6, s, s, s, pick(PARK_COLORS.mushroomCap));
    },
    rock: (x, z, s) => put(batch('rock', () => [new THREE.DodecahedronGeometry(1, 0), lambert(0xffffff)]), x, s * 0.15, z, rnd() * 6, s, s * 0.6, s * (0.8 + rnd() * 0.4), pick(PARK_COLORS.rock)),
    wildflowers: (x, z, n) => { for (let k = 0; k < n; k++) flowers.push(new THREE.Vector3(x + (rnd() - 0.5) * 0.9, 0, z + (rnd() - 0.5) * 0.9)); },
    reeds: (x, z, s) => put(batch('reeds', () => [reedGeo(), lambert(0xffffff)]), x, 0, z, rnd() * 6, s, s * (0.8 + rnd() * 0.4), s, pick(PARK_COLORS.reed)),
    stump: (x, z) => {
      const s = 0.8 + rnd() * 0.5;
      put(batch('stump', () => [new THREE.CylinderGeometry(0.34, 0.42, 1, 7).translate(0, 0.5, 0), lambert(0xffffff)]), x, 0, z, rnd() * 6, s, 0.45 * s, s, PARK_COLORS.darkWood);
      physics.cylinder(x, 0.25 * s, z, 0.25 * s, 0.4 * s);
    },
    log: (x, z) => {
      const ry = rnd() * Math.PI, len = 1.8 + rnd() * 0.9;
      put(batch('log', () => [new THREE.CylinderGeometry(0.22, 0.24, 1, 7).rotateZ(Math.PI / 2), lambert(0xffffff)]), x, 0.2, z, ry, len, 1, 1, PARK_COLORS.wood);
      physics.box(x, 0.2, z, len / 2, 0.22, 0.22, ry);
    },
  };

  // ---------- Clustered scatter on the lawn (replaces evenly spread bush clumps) ----------
  // Cluster centres are Poisson-disk samples (no two closer than SCATTER.spacing), accepted with
  // a density from a smooth noise field that fades with distance from the plots and plaza. Each
  // cluster is one kind (bushes, meadow, ferns, rocks, dead wood), members bunched around it.
  const noise = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.043 + Math.sin(z * 0.057) * 1.9) * Math.cos(z * 0.049 - x * 0.021 + Math.sin(x * 0.031) * 1.3);
  const coreDistance = (x, z) => Math.min(Math.hypot(x, z) - PLAZA_R,
    ...plots.map((p) => Math.hypot(Math.max(0, Math.abs(x - p.x) - p.w / 2), Math.max(0, Math.abs(z - p.z) - p.h / 2))));
  const nearEntrance = (x, z, r) => plots.some((p) => Math.hypot(x - p.entrance.x, z - p.entrance.z) < r);
  const free = (x, z, margin) => {
    const a = Math.atan2(z, x);
    return Math.hypot(x, z) > PLAZA_R + 2.5 && Math.hypot(x, z) < 0.86 * shoreRadius(a, R) && !isFloor(x, z) && !onPath(x, z, margin)
      && !onStone(x, z, margin) && !nearHouse(x, z, 4.6) && !nearEntrance(x, z, 3) && !onLookout(x, z, margin + 0.5) && !keepClear(x, z);
  };
  const KINDS = [['bushes', 0.3], ['meadow', 0.25], ['ferns', 0.2], ['rocks', 0.13], ['deadwood', 0.12]];
  const centres = [], centreGrid = new Map(), spacing = SCATTER.spacing;
  const tooClose = (x, z) => {
    const cx = Math.floor(x / spacing), cz = Math.floor(z / spacing);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const c of centreGrid.get(`${cx + i},${cz + j}`) || []) if ((c[0] - x) ** 2 + (c[1] - z) ** 2 < spacing ** 2) return true;
    }
    return false;
  };
  for (let tries = 0; tries < 8000 && centres.length < SCATTER.max; tries++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.84 * shoreRadius(a, R);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const density = (0.25 + 0.75 * noise(x, z)) * (1 - THREE.MathUtils.smoothstep(coreDistance(x, z), SCATTER.fade[0], SCATTER.fade[1]));
    if (rnd() > density || !free(x, z, 1.5) || nearFloor(x, z, 1.8) || tooClose(x, z)) continue;
    const key = `${Math.floor(x / spacing)},${Math.floor(z / spacing)}`;
    if (!centreGrid.has(key)) centreGrid.set(key, []);
    centreGrid.get(key).push([x, z]);
    let roll = rnd(), kind = KINDS[0][0];
    for (const [name, weight] of KINDS) { if ((roll -= weight) < 0) { kind = name; break; } }
    centres.push([x, z, kind]);
  }
  const around = (x, z, spread) => [x + (rnd() + rnd() - 1) * spread, z + (rnd() + rnd() - 1) * spread];
  for (const [x, z, kind] of centres) {
    if (kind === 'bushes') {
      for (let k = 0, n = 2 + Math.floor(rnd() * 4); k < n; k++) { const [bx, bz] = around(x, z, 2.2); if (free(bx, bz, 1.2)) bushes.push([bx, bz, 0.6 + rnd() * 0.8]); }
      for (let k = 0; k < 3; k++) { const [fx, fz] = around(x, z, 3); if (free(fx, fz, 0.4)) prop.fern(fx, fz, 0.5 + rnd() * 0.3); }
    } else if (kind === 'meadow') {
      for (let k = 0, n = 6 + Math.floor(rnd() * 8); k < n; k++) { const [fx, fz] = around(x, z, 3.5); if (free(fx, fz, 0.3)) prop.wildflowers(fx, fz, 2 + Math.floor(rnd() * 3)); }
    } else if (kind === 'ferns') {
      for (let k = 0, n = 4 + Math.floor(rnd() * 5); k < n; k++) { const [fx, fz] = around(x, z, 2.2); if (free(fx, fz, 0.4)) prop.fern(fx, fz, 0.6 + rnd() * 0.5); }
      if (rnd() < 0.5) { const [mx, mz] = around(x, z, 1.5); if (free(mx, mz, 0.3)) prop.mushroom(mx, mz, 0.8 + rnd() * 0.5); }
    } else if (kind === 'rocks') {
      for (let k = 0, n = 2 + Math.floor(rnd() * 3); k < n; k++) { const [rx, rz] = around(x, z, 1.6); if (free(rx, rz, 0.5)) prop.rock(rx, rz, 0.25 + rnd() * 0.5); }
      for (let k = 0; k < 2; k++) { const [fx, fz] = around(x, z, 2); if (free(fx, fz, 0.4)) prop.fern(fx, fz, 0.45 + rnd() * 0.3); }
    } else { // dead wood: a stump or a fallen log, mushrooms and ferns around it
      if (free(x, z, 1.4)) { if (rnd() < 0.5) prop.stump(x, z); else prop.log(x, z); }
      for (let k = 0, n = 2 + Math.floor(rnd() * 3); k < n; k++) { const [mx, mz] = around(x, z, 1.2); if (free(mx, mz, 0.3)) prop.mushroom(mx, mz, 0.7 + rnd() * 0.6); }
      for (let k = 0; k < 2; k++) { const [fx, fz] = around(x, z, 1.8); if (free(fx, fz, 0.4)) prop.fern(fx, fz, 0.5 + rnd() * 0.3); }
    }
  }

  // ---------- Context rules: props chosen by what surrounds a spot ----------
  // Lawn touching the tiles: a clumped band of wildflowers, pebbles and ferns.
  for (const p of plots) {
    for (const cell of p.view.floor) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (p.view.isFloor(cell.x + dx, cell.z + dz)) continue;
        const x = p.x + cell.x + dx * 0.9, z = p.z + cell.z + dz * 0.9;
        if (rnd() > 0.03 + 0.09 * noise(x, z) || !free(x, z, 0.3)) continue;
        const roll = rnd();
        if (roll < 0.55) prop.wildflowers(x, z, 2 + Math.floor(rnd() * 3));
        else if (roll < 0.8) prop.rock(x, z, 0.12 + rnd() * 0.18);
        else prop.fern(x, z, 0.5 + rnd() * 0.25);
      }
    }
    // Trees at the edge of the tiles (lawn within 2.2 m): ferns and the odd mushroom at the base.
    for (const root of p.forest.roots) {
      const x = p.x + root.x, z = p.z + root.z;
      let lawn = false;
      for (let k = 0; k < 8 && !lawn; k++) lawn = !isFloor(x + Math.cos(k * 0.785) * 2.2, z + Math.sin(k * 0.785) * 2.2);
      if (!lawn) continue;
      for (let k = 0, n = 2 + Math.floor(rnd() * 2); k < n; k++) {
        const a = rnd() * Math.PI * 2, d = root.radius + 0.5 + rnd() * 0.8, fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
        if (free(fx, fz, 0.3)) prop.fern(fx, fz, 0.55 + rnd() * 0.3);
      }
      if (rnd() < 0.35) {
        const a = rnd() * Math.PI * 2, d = root.radius + 0.35, mx = x + Math.cos(a) * d, mz = z + Math.sin(a) * d;
        if (free(mx, mz, 0.2)) prop.mushroom(mx, mz, 0.7 + rnd() * 0.5);
      }
    }
    // Trail mouth: a lamp opposite the sign post.
    const side = new THREE.Vector3(-p.entrance.z, 0, p.entrance.x).normalize();
    const lx = p.entrance.x - side.x * 1.8, lz = p.entrance.z - side.z * 1.8;
    if (!isFloor(lx, lz) && !onStone(lx, lz, 0.3) && !onPath(lx, lz, 0.2) && !nearHedge(lx, lz, 1)) lamp(lx, lz);
  }
  // Lodge paths: one bench on the outer side of the strongest bend, on the flower side, facing in.
  for (const { pts, n, side, flowerSide } of pathInfos) {
    let best = null;
    for (let i = 9; i < pts.length - 9; i++) {
      if (Math.abs(i - pts.length / 2) < 4) continue; // the lamp sits half-way
      const t0 = pts[i].clone().sub(pts[i - 3]), t1 = pts[i + 3].clone().sub(pts[i]), nn = side(Math.min(i, n - 1));
      const bend = t1.sub(t0).dot(nn), outer = bend > 0 ? -1 : 1;
      if (outer === flowerSide(i) && (!best || Math.abs(bend) > best.bend)) best = { i, nn, s: outer, bend: Math.abs(bend) };
    }
    if (!best) continue;
    const at = pts[best.i].clone().addScaledVector(best.nn, best.s * (PATH_HALF + 1));
    if (isFloor(at.x, at.z) || onStone(at.x, at.z, 1.2)) continue;
    for (let k = flowers.length - 1; k >= 0; k--) if (Math.hypot(flowers[k].x - at.x, flowers[k].z - at.z) < 1.7) flowers.splice(k, 1);
    bench(at.x, at.z, Math.atan2(-best.nn.x * best.s, -best.nn.z * best.s));
  }
  // Lodge back corners: a bush each (the front corners already have flower beds).
  for (const h of houses) {
    for (const lx of [-3.3, 3.3]) {
      const x = h.x + lx * Math.cos(h.angle) - 2.9 * Math.sin(h.angle), z = h.z - lx * Math.sin(h.angle) - 2.9 * Math.cos(h.angle);
      bushes.push([x, z, 0.8 + rnd() * 0.25]);
    }
  }
  // Shore: reed clumps where the noise allows (not along the fence arcs).
  for (let a = 0; a < Math.PI * 2; a += 16 / (0.88 * R)) {
    if ((a > 0.3 && a < 1) || (a > 3.35 && a < 4)) continue;
    const r = (0.865 + rnd() * 0.025) * shoreRadius(a, R), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (rnd() > noise(x, z) * 0.8) continue;
    for (let k = 0, n = 3 + Math.floor(rnd() * 4); k < n; k++) { const [rx, rz] = around(x, z, 1.4); prop.reeds(rx, rz, 0.8 + rnd() * 0.5); }
  }
  const bushItems = batch('bush', () => [new THREE.IcosahedronGeometry(1, 1), lambert(0xffffff)]);
  for (const [x, z, sc] of bushes) {
    put(bushItems, x, sc * 0.65, z, rand() * 6, sc, sc * 0.85, sc, PARK_COLORS.bush[Math.floor(rand() * 3)]);
    physics.ball(x, sc * 0.65, z, sc * 0.85);
  }

  // ---------- Flowers (no colliders) ----------
  const flowerItems = batch('flower', () => [new THREE.OctahedronGeometry(0.13, 0), lambert(0xffffff)]);
  const stemItems = batch('stem', () => [new THREE.CylinderGeometry(0.02, 0.02, 1, 3).translate(0, 0.5, 0), lambert(0xffffff)]);
  for (const f of flowers) {
    const hgt = 0.25 + rand() * 0.25;
    put(stemItems, f.x, 0, f.z, 0, 1, hgt, 1, 0x4f8a3a);
    put(flowerItems, f.x, hgt, f.z, rand() * 3, 1, 1, 1, PARK_COLORS.flowers[Math.floor(rand() * 4)]);
  }

  // ---------- Beach rocks and broken shoreline fences ----------
  const rockItems = batch('rock', () => [new THREE.DodecahedronGeometry(1, 0), lambert(0xffffff)]);
  for (let i = 0; i < 34; i++) {
    const a = rand() * Math.PI * 2, s = 0.965 + rand() * 0.07, r = s * shoreRadius(a, R), sc = 0.4 + rand() * 1.1;
    put(rockItems, Math.cos(a) * r, -0.45 + sc * 0.2, Math.sin(a) * r, rand() * 6, sc, sc * 0.6, sc * (0.8 + rand() * 0.4), PARK_COLORS.rock[i % 3]);
  }
  const postItems = batch('post', () => [new THREE.BoxGeometry(0.2, 1.2, 0.2), lambert(0xffffff)]);
  const railItems = batch('rail', () => [new THREE.BoxGeometry(1, 0.12, 0.08), lambert(0xffffff)]);
  for (const [a0, a1] of [[0.35, 0.95], [3.4, 3.95]]) {
    let prev = null;
    for (let a = a0; a <= a1; a += 2.2 / (0.88 * R)) {
      const r = 0.88 * shoreRadius(a, R), p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      put(postItems, p.x, 0.6, p.z, a, 1, 1, 1, PARK_COLORS.darkWood);
      if (prev && rand() < 0.85) {
        const mid = prev.clone().lerp(p, 0.5), len = prev.distanceTo(p), ry = Math.atan2(-(p.z - prev.z), p.x - prev.x);
        for (const y of [0.45, 0.9]) put(railItems, mid.x, y, mid.z, ry, len, 1, 1, PARK_COLORS.wood);
        physics.box(mid.x, 0.6, mid.z, len / 2, 0.6, 0.1, ry);
      }
      prev = p;
    }
  }

  for (const { geo, mat, items } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    items.forEach((it, i) => { mesh.setMatrixAt(i, it.matrix); mesh.setColorAt(i, color.setHex(it.hex)); });
    mesh.count = items.length;
    mesh.computeBoundingSphere();
    scene.add(shade(mesh));
  }

  // ---------- Grass: dense thin blades that grow out of the ground colour ----------
  // Single triangles with up-facing normals shade exactly like the lawn, so a field of blades
  // reads as soft fur rather than dark spikes. Dense patches + sparse lawn + tall plot borders.
  // Streamed in GRASS.chunk-metre squares: only squares within GRASS.radius of the player exist
  // (built a few per frame, seeded per square so they come back identical), squares beyond
  // GRASS.keep are freed. Keeps the blade count flat however large the island grows.
  const bladeGeo = new THREE.BufferGeometry();
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.07, 0, 0, 0.07, 0, 0, 0, 1, 0], 3));
  bladeGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const grassGrow = { value: 1 }, grassPlayer = { value: new THREE.Vector3(1e4, 0, 1e4) };
  const tip = new THREE.Color(PARK_COLORS.grassTip);
  const bladeMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  bladeMat.onBeforeCompile = (shader) => {
    // Shared wind (wind.js): blades lean downwind, travelling gusts bend them further and make
    // them a little shorter; a tiny flutter keeps calm blades alive.
    addSway(shader, `
      float k = position.y * position.y;
      float bladeH = length(instanceMatrix[1].xyz);
      mvPosition.xz += windHere * k * bladeH * 1.2;
      mvPosition.y -= dot(windHere, windHere) * k * bladeH * 0.5;
      mvPosition.x += sin(uTime * 7.0 + seed.x * 3.1 + seed.z) * 0.015 * k;
      vec2 away = seed.xz - uPlayer.xz;   // grass bends away from the player
      float push = (1.0 - smoothstep(0.35, 1.5, length(away))) * position.y;
      mvPosition.xz += normalize(away + 1e-4) * push * 0.55;
      mvPosition.y -= push * 0.3;`);
    shader.uniforms.uGrow = grassGrow;
    shader.uniforms.uPlayer = grassPlayer;
    shader.uniforms.uTip = { value: tip };
    shader.vertexShader = 'uniform float uGrow; uniform vec3 uPlayer;\nvarying float vBladeH;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBladeH = position.y;\ntransformed.y *= uGrow;');
    shader.fragmentShader = 'uniform vec3 uTip;\nvarying float vBladeH;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTip, pow(max(vBladeH, 0.0), 1.6) * 0.65);')
      // Both faces use the up normal: no flipped (dark) back faces.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  const tilt = new THREE.Euler();
  function buildGrassChunk(cx, cz) {
    const step = 0.32, size = GRASS.chunk;
    const rand = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x5bd1e995);
    const blades = [];
    for (let x = cx * size; x < (cx + 1) * size; x += step) for (let z = cz * size; z < (cz + 1) * size; z += step) {
      const px = x + rand() * step, pz = z + rand() * step;
      const sNorm = Math.hypot(px, pz) / shoreRadius(Math.atan2(pz, px), R);
      if (sNorm > 0.9 || Math.hypot(px, pz) < PLAZA_R + 0.6) continue;
      const clump = 0.5 + 0.5 * Math.sin(px * 0.13 + Math.sin(pz * 0.11) * 2) * Math.cos(pz * 0.12 - px * 0.05);
      const dense = THREE.MathUtils.smoothstep(clump, 0.45, 0.75);
      if (rand() > 0.08 + 0.85 * dense) continue; // cheap reject before the costly tests
      if (nearHouse(px, pz, 4.4) || onPath(px, pz, 0.12) || onStone(px, pz, -0.05) || onLookout(px, pz, 0.3) || keepClear(px, pz) || isFloor(px, pz)) continue;
      const edge = nearFloor(px, pz, 1.0);
      // Soft edges: short tufts creep over the path curbs and up to the stepping stones.
      const tuft = onPath(px, pz, 0.45) || onStone(px, pz, 0.25);
      const h = tuft ? 0.15 + rand() * 0.18 : edge ? 0.7 + rand() * 0.5 : 0.25 + dense * 0.65 + rand() * 0.25;
      blades.push([px, pz, h, sNorm]);
    }
    if (!blades.length) return null;
    const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, blades.length);
    blades.forEach(([x, z, h, sNorm], i) => {
      q.setFromEuler(tilt.set((rand() - 0.5) * 0.45, rand() * 6.28, (rand() - 0.5) * 0.45));
      grass.setMatrixAt(i, m4.compose(v.set(x, 0, z), q, s3.set(0.8 + rand() * 0.6, h, 1)));
      grass.setColorAt(i, groundColor(x, z, sNorm, color).multiplyScalar(0.92 + rand() * 0.1));
    });
    grass.receiveShadow = true;
    grass.userData.skipExport = true; // scene-export.js: no grass
    grass.computeBoundingSphere();
    grass.visible = grassGrow.value > 0;
    scene.add(grass);
    return grass;
  }
  const grassChunks = new Map(); // "cx,cz" -> InstancedMesh | null (empty square)
  function streamGrass(position) {
    const size = GRASS.chunk, pcx = Math.floor(position.x / size), pcz = Math.floor(position.z / size);
    const reach = Math.ceil(GRASS.radius / size), wanted = [];
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      const cx = pcx + i, cz = pcz + j, key = cx + ',' + cz;
      if (grassChunks.has(key)) continue;
      const d = Math.hypot((cx + 0.5) * size - position.x, (cz + 0.5) * size - position.z);
      if (d < GRASS.radius) wanted.push([d, cx, cz, key]);
    }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz, key] of wanted.slice(0, GRASS.perFrame)) grassChunks.set(key, buildGrassChunk(cx, cz));
    for (const [key, mesh] of grassChunks) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.hypot((cx + 0.5) * size - position.x, (cz + 0.5) * size - position.z) <= GRASS.keep) continue;
      if (mesh) { scene.remove(mesh); mesh.dispose(); }
      grassChunks.delete(key);
    }
  }
  return {
    // 0 = walking view, 1 = minimap: grass shrinks into the ground like the leaves fade.
    setFlat(p) {
      grassGrow.value = 1 - THREE.MathUtils.smoothstep(p, 0.1, 0.5);
      for (const mesh of grassChunks.values()) if (mesh) mesh.visible = grassGrow.value > 0;
    },
    setPlayer(position) { grassPlayer.value.copy(position); streamGrass(position); },
    setViewport: fountain.setViewport,
  };
}
