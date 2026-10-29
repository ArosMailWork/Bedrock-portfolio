// WORK quadrant: the career road ending in the social circle. Mechanics ported from
// bruno-simon.com's folio-2025 (CareerArea.js, SocialArea.js; MIT, Copyright (c) 2025 Bruno Simon,
// see assets/textures/third-party/LICENSE-folio-2025.md). His world comes from a Blender file;
// here every shape is a placeholder built in code, meant to be swapped for custom models.
//
// Career: a wide road walked northwards (-z), one lane per job painted on it: a glowing line from
// a square start pad to a square end pad, as long as the job lasted (WORK_AREA.yearM metres per
// year). At rest the job's block is sunk at its start pad. While the player is within the job's
// span the block floats up, slides along with the player and its 2D label (always facing the
// camera, so it reads from the minimap too) reveals left to right; past the span the job's
// block sinks into the end pad (the current job's pad sits at this month). A seven-segment
// year-month counter lies beside the road and slides along too.
// Social: links on a half circle round a statue at the end of the road (interactive points).
import * as THREE from 'three';
import { PARK_COLORS } from './park.js';
import { gridMaterial, gridUVs, radialMaterial } from './pavers.js';

export const WORK_AREA = {
  yearM: 2.5,        // metres of road per year (Bruno: 1 m, but his car is faster than our walk)
  laneGap: 1.8,      // between job lanes (m)
  margin: 1.2,       // road beyond the outer lanes (m)
  lead: 4,           // road before the first month and after the last (m)
  block: { w: 0.45, h: 1.1 }, // floating block (m)
  float: 0.55,       // gap under an active block (m)
  label: 1 / 290,    // label size: metres per canvas pixel (walking view)
  labelGrow: 12,     // beyond this camera distance (m) labels keep their on-screen size (minimap zoom)
  pad: { half: 0.48, h: 0.12 }, // raised square pad (plinth) the block rests in (m)
  padding: 0.25,     // span padding before a lane counts as entered (Bruno: 0.25)
  socialR: 6,        // half circle of social links (Bruno: 6)
};
// Everything here lies on the paver surfaces (top 0.033 m).
const FLOOR = 0.04;
const COLORS = { blue: '#5390ff', orange: '#ff8039', purple: '#b65fff', green: '#a2ffab' };
const MASK = new THREE.Color('#251f2b');
// Seven-segment glyphs (Bruno's digit table + a dash). Segment order: top, top right, bottom
// right, bottom, bottom left, top left, middle.
const GLYPHS = { 0: '1111110', 1: '0110000', 2: '1101101', 3: '1111001', 4: '0110011', 5: '1011011', 6: '1011111', 7: '1110000', 8: '1111111', 9: '1111011', '-': '0000001' };
const lambert = (hex) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
// Bruno's ease for the label reveal (gsap power2.inOut).
const power2InOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
const months = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
// Counter text: MMYY (drawn as MM/YY, the slash is a fixed bar).
const formatMonth = (n) => `${String((n % 12) + 1).padStart(2, '0')}${String(Math.floor(n / 12) % 100).padStart(2, '0')}`;
// Colour scaled to luminance 1.7 (Bruno), so it blooms (bloom threshold 1).
const glowColor = (hex, strength = 1.7) => {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(strength / (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b));
};

// Label texture (Bruno style: one dark box per line). Red = title text, green = other text,
// alpha = boxes. Returns the texture and its size in pixels.
function labelTexture(job) {
  const rows = [{ text: job.title, font: '60px Jersey10, VT323, monospace', title: true }, ...(job.lines || []).map((text) => ({ text, font: '44px VT323, monospace' })),
    { text: `${job.start.replace('-', '.')} - ${job.end ? job.end.replace('-', '.') : 'NOW'}`, font: '40px VT323, monospace' }];
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  const padX = 10, rowH = (r) => (r.title ? 62 : 46);
  let width = 0;
  for (const r of rows) { ctx.font = r.font; r.w = Math.ceil(ctx.measureText(r.text).width) + padX * 2; width = Math.max(width, r.w); }
  canvas.width = width; canvas.height = rows.reduce((h, r) => h + rowH(r), 0);
  let y = 0;
  for (const r of rows) {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, y, r.w, rowH(r));
    ctx.font = r.font; ctx.textBaseline = 'middle';
    ctx.fillStyle = r.title ? 'rgb(255,0,0)' : 'rgb(0,255,0)';
    ctx.fillText(r.text, padX, y + rowH(r) / 2 + 2);
    y += rowH(r);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return { texture, w: canvas.width, h: canvas.height };
}

// exits: [{ z, half }] walkways joining the road's east curb (Projects / Lab paths).
export async function createWorkArea({ scene, physics, points, x, zStart, career, social, exits = [] }) {
  await Promise.all([document.fonts.load('60px Jersey10'), document.fonts.load('44px VT323')]).catch(() => {});
  const L = WORK_AREA, today = new Date(), nowM = today.getFullYear() * 12 + today.getMonth();
  const startM = months(career.start), monthM = L.yearM / 12;
  const spanM = (nowM - startM) * monthM;
  const originZ = zStart - L.lead;                        // counter month 0
  const zEnd = originZ - spanM - L.lead;                   // road end
  const jobs = [...career.jobs].sort((a, b) => months(a.start) - months(b.start));
  const halfW = ((jobs.length - 1) * L.laneGap) / 2 + L.margin;
  const discR = L.socialR + 2.5;
  const centre = new THREE.Vector3(x, 0, zEnd - discR + 1);
  const group = new THREE.Group();
  scene.add(group);
  const add = (mesh, px, py, pz, cast = true) => { mesh.position.set(px, py, pz); mesh.castShadow = cast; mesh.receiveShadow = true; group.add(mesh); return mesh; };

  // ---------- Road and social circle: paver surfaces framed by smooth curbs ----------
  const roadLen = zStart - zEnd;
  // The road runs into the circle: its surface reaches the circle's edge at the road sides, its curbs
  // stop at the circle curb, which opens for it; the road's east curb opens for the side paths.
  const meet = centre.z + Math.sqrt(discR ** 2 - halfW ** 2), curbMeet = centre.z + Math.sqrt(discR ** 2 - (halfW + 0.1) ** 2);
  curbStrip(group, x - halfW, meet, x + halfW, zStart, { curbFrom: curbMeet, gaps: { pos: exits.map((e) => [e.z - e.half, e.z + e.half]) } });
  curbRing(group, centre.x, centre.z, discR, [{ angle: Math.PI / 2, half: halfW }], 3);
  // Social circle: curb ring + paving, like the plaza.

  // ---------- Career lanes: glowing line + pads on the road, floating block, 2D label ----------
// Pad: dark raised plinth with a glowing square frame on top (Bruno's start / end pads).
  const P = L.pad, plinthGeo = new THREE.BoxGeometry(P.half * 2, P.h, P.half * 2).translate(0, P.h / 2, 0);
  const frameGeos = [[0, -0.33, 0.73, 0.07], [0, 0.33, 0.73, 0.07], [-0.33, 0, 0.07, 0.59], [0.33, 0, 0.07, 0.59]]
    .map(([fx, fz, w, d]) => new THREE.BoxGeometry(w, 0.02, d).translate(fx, P.h + 0.01, fz));
  const plinthMat = lambert(0x2b2530);
  const restY = FLOOR + P.h + 0.01 - L.block.h; // block top just above the plinth: it sits in the pad
  const labelGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0); // anchored bottom left
  const lines = jobs.map((job, i) => {
    const laneX = x - halfW + L.margin + i * L.laneGap;
    const origin = new THREE.Vector3(laneX, 0, originZ - (months(job.start) - startM) * monthM);
    const size = ((job.end ? months(job.end) : nowM) - months(job.start)) * monthM;
    // Every lane ends in a pad (the current job's at this month), where its block parks once passed.
    const lineEnd = origin.z - size;
    const dim = glowColor(COLORS[job.color] || COLORS.blue, 0.55), bright = glowColor(COLORS[job.color] || COLORS.blue);
    const glow = new THREE.MeshBasicMaterial({ color: dim.clone() });
    // Line (stops short of the pads) and the square pads.
    const lineLen = origin.z - lineEnd - 2 * L.pad.half;
    add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, lineLen), glow), laneX, FLOOR + 0.02, origin.z - L.pad.half - lineLen / 2, false);
    for (const pz of [origin.z, lineEnd]) {
      add(new THREE.Mesh(plinthGeo, plinthMat), laneX, FLOOR, pz);
      for (const geo of frameGeos) add(new THREE.Mesh(geo, glow), laneX, FLOOR, pz, false);
    }
    // Block: dark pillar with a glowing band; at rest it sits sunk in the start pad, top showing.
    const block = new THREE.Group();
    block.position.copy(origin);
    group.add(block);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(L.block.w, L.block.h, L.block.w), lambert(0x3a3440));
    pillar.position.y = L.block.h / 2;
    pillar.castShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(L.block.w + 0.02, 0.07, L.block.w + 0.02), glow);
    band.position.y = L.block.h * 0.55;
    block.add(pillar, band);
    // Label: camera-facing quad (vertex shader billboard) up-left of the block, revealed by
    // uv.x < uReveal (Bruno's shader): mask colour, title in the lane colour, other text pale.
    const { texture, w, h } = labelTexture(job);
    const reveal = { value: 0 };
    const label = new THREE.Mesh(labelGeo, new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uReveal: reveal, uColor: { value: bright }, uMask: { value: MASK }, uSize: { value: new THREE.Vector2(w * L.label, h * L.label) }, uLevel: { value: 0 }, uGrow: { value: L.labelGrow } },
      // Screen-space layout (view space): up-left of the block, lifted by uLevel (stagger), and
      // grown with the camera distance beyond uGrow so the minimap can read it at any zoom.
      vertexShader: `uniform vec2 uSize; uniform float uLevel, uGrow; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float k = clamp(-mv.z / uGrow, 1.0, 40.0); // constant on-screen size beyond uGrow
          mv.xy += (vec2(0.3, 0.35 + uLevel) + position.xy * uSize) * k; // up-right: the counter is on the left
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D uMap; uniform float uReveal; uniform vec3 uColor, uMask; varying vec2 vUv;
        void main() {
          if (vUv.x > uReveal) discard;
          vec4 t = texture2D(uMap, vUv);
          if (t.a < 0.1) discard;
          vec3 c = mix(uMask, uColor, t.r);
          c = mix(c, vec3(1.25), t.g);
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true,
    }));
    label.position.set(0, L.block.h, 0);
    label.frustumCulled = false;
    label.renderOrder = 2;
    block.add(label);
    block.position.y = restY;
    return { label, h: h * L.label, origin, size, block, glow, dim, bright, reveal, tween: null, isIn: false, isUp: false };
  });
  // Stagger (screen space): three label levels, so the labels of neighbouring lanes (also up to two
  // apart) never overlap, whatever the camera angle or zoom.
  const levelStep = Math.max(...lines.map((l) => l.h)) + 0.15;
  lines.forEach((line, i) => { line.label.material.uniforms.uLevel.value = (i % 3) * levelStep; });

  // ---------- Month counter MM/YY: seven-segment glyphs flat on the ground, west of the road (the labels sit up-right of the blocks, so they never cover it) ----------
  const counter = { group: new THREE.Group(), current: '', bars: [] };
  // (placed below, once its plate width is known)
  group.add(counter.group);
  const W = 0.8, H = 1.4, b = 0.16, white = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.7, 1.7) });
  const across = new THREE.BoxGeometry(W - b, 0.1, b), along = new THREE.BoxGeometry(b, 0.1, H / 2 - b);
  const SEGMENTS = [[0, -H / 2, across], [W / 2, -H / 4, along], [W / 2, H / 4, along], [0, H / 2, across], [-W / 2, H / 4, along], [-W / 2, -H / 4, along], [0, 0, across]];
  const step = W + 0.4, slash = 0.9; // digit spacing; extra room for the slash after two digits
  const slotX = [0, 1, 2, 3].map((d) => d * step + (d > 1 ? slash : 0));
  const plateW = slotX[3] + W + 0.9;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, 0.04, H + 0.6), lambert(0x251f2b));
  plate.position.x = slotX[3] / 2;
  plate.position.y = 0.02; plate.receiveShadow = true;
  counter.group.add(plate);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(b, 0.1, H * 1.05), white);
  bar.position.set(slotX[1] + step / 2 + slash / 2, 0.06, 0); bar.rotation.y = -0.45;
  counter.group.add(bar);
  for (let d = 0; d < 4; d++) {
    const dx = slotX[d];
    counter.bars.push(SEGMENTS.map(([sx, sz, geo]) => {
      const bar = new THREE.Mesh(geo, white);
      bar.position.set(dx + sx, -1, sz);
      counter.group.add(bar);
      return bar;
    }));
  }
  counter.group.position.set(x - halfW - 0.45 - plateW / 2 - slotX[3] / 2, 0.02, originZ); // on the lawn, west of the curb
  const counterLeft = x - halfW - 0.45 - plateW;
  const showMonth = (text) => counter.bars.forEach((bars, d) => bars.forEach((bar, s) => { bar.userData.on = GLYPHS[text[d]][s] === '1'; }));

  // ---------- Social: statue and links on a half circle ----------
  const statue = new THREE.Group();
  const stoneMat = lambert(0xc9c2b4);
  const part = (geo, px, py, pz) => { const m = new THREE.Mesh(geo, stoneMat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; statue.add(m); };
  part(new THREE.BoxGeometry(1.4, 1.1, 1.4), 0, 0.55, 0);            // pedestal
  part(new THREE.CylinderGeometry(0.5, 0.75, 1.1, 7), 0, 1.65, 0);    // shoulders
  part(new THREE.IcosahedronGeometry(0.45, 1), 0, 2.55, 0);           // head
  statue.position.copy(centre);
  group.add(statue);
  physics.cylinder(centre.x, 1.4, centre.z, 1.4, 0.8);
  const ringGeo = new THREE.RingGeometry(0.35, 0.5, 20).rotateX(-Math.PI / 2);
  social.forEach((link, i) => {
    const angle = social.length > 1 ? (i * Math.PI) / (social.length - 1) : Math.PI / 2;
    const position = new THREE.Vector3(centre.x + Math.cos(angle) * L.socialR, 1, centre.z - Math.sin(angle) * L.socialR);
    add(new THREE.Mesh(ringGeo, white), position.x, FLOOR + 0.02, position.z, false);
    points.create(position, link.name, link.align, () => window.open(link.url, '_blank', 'noopener'));
  });

  return {
    // Road frame, for the areas placed beside it (showcase.js).
    road: { x, halfW, zStart, zEnd },
    // For the island size and the park dressing (no grass / props here).
    bounds: [{ x, z: (zStart + zEnd) / 2, r: Math.hypot(halfW + 9, roadLen / 2) }, { x: centre.x, z: centre.z, r: discR + 1 }],
    covers(px, pz) {
      if (Math.hypot(px - centre.x, pz - centre.z) < discR + 0.6) return true;
      return pz < zStart + 0.5 && pz > zEnd - 0.5 && px > counterLeft - 0.5 && px < x + halfW + 0.6;
    },
    update(dt, player) {
      // Lanes (Bruno's CareerArea.update; "delta" = how far north of the lane start the player is).
      for (const line of lines) {
        const delta = line.origin.z - player.z;
        const inside = delta > -L.padding && delta < line.size + L.padding * 2;
        if (inside !== line.isIn) {
          line.isIn = inside;
          line.tween = { from: line.reveal.value, to: inside ? 1 : 0, t: inside ? -0.3 : 0 }; // 0.3 s delay in
        }
        if (line.tween) {
          line.tween.t += dt;
          const k = THREE.MathUtils.clamp(line.tween.t, 0, 1);
          line.reveal.value = line.tween.from + (line.tween.to - line.tween.from) * power2InOut(k);
          if (k >= 1) line.tween = null;
        }
        // Up while inside; outside it parks in the start or end pad.
        if (line.isIn) line.isUp = true;
        else line.isUp = false;
        const y = line.isUp ? FLOOR + L.float : restY;
        line.block.position.y += (y - line.block.position.y) * Math.min(1, dt * 3);
        let offset = line.block.position.z - line.origin.z;
        if (line.isIn) { if (line.block.position.y > restY + 0.8) offset = -THREE.MathUtils.clamp(delta, 0, line.size); }
        else offset = delta > line.size ? -line.size : 0;
        line.block.position.z += (line.origin.z + offset - line.block.position.z) * Math.min(1, dt * 10);
        line.glow.color.lerp(line.isUp ? line.bright : line.dim, Math.min(1, dt * 4));
      }
      // Counter follows the player along the span and shows the month at its position.
      const delta = originZ - player.z;
      const offset = THREE.MathUtils.clamp(delta, 0, spanM);
      counter.group.position.z += (originZ - offset - counter.group.position.z) * Math.min(1, dt * 10);
      const text = formatMonth(Math.min(nowM, startM + Math.floor(offset / monthM)));
      if (text !== counter.current) { counter.current = text; showMonth(text); }
      for (const bars of counter.bars) for (const bar of bars) bar.position.y += ((bar.userData.on ? 0.06 : -1) - bar.position.y) * Math.min(1, dt * 18);
    },
  };
}

// Smooth walkways: a paver surface (pavers.js: grid on strips, concentric rings on discs) framed by a
// raised white curb, with openings where another walkway joins.
const CURB = { w: 0.2, h: 0.14 };
// Disc of radius r at (x, z); gaps: [{ angle, half }] openings in the curb (angle = atan2(dz, dx)
// towards the joining walkway, half = its half width in metres).
export function curbRing(group, x, z, r, gaps = [], seed = 1) {
  const cuts = gaps.map((g) => ({ a: g.angle, h: Math.asin(Math.min(1, (g.half + 0.02) / r)) })).sort((p, q) => p.a - q.a);
  const spans = [];
  if (!cuts.length) spans.push([0, Math.PI * 2]);
  else cuts.forEach((g, i) => { const next = cuts[(i + 1) % cuts.length]; spans.push([g.a + g.h, next.a - next.h + (i === cuts.length - 1 ? Math.PI * 2 : 0)]); });
  const material = lambert(PARK_COLORS.curb);
  for (const [a0, a1] of spans) {
    if (a1 <= a0) continue;
    // Shape coordinates (sx, sy) become world (x + sx, z - sy) after rotateX(-90deg): world angle a
    // is shape angle -a.
    const shape = new THREE.Shape();
    shape.absarc(0, 0, r + CURB.w, -a0, -a1, true);
    shape.absarc(0, 0, r, -a1, -a0, false);
    shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: CURB.h, bevelEnabled: false, curveSegments: 48 }).rotateX(-Math.PI / 2), material);
    mesh.position.set(x, 0, z); mesh.receiveShadow = true;
    group.add(mesh);
  }
  const base = new THREE.Mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2), radialMaterial(r, seed));
  base.position.set(x, 0.03, z); base.receiveShadow = true;
  group.add(base);
}
// Axis-aligned strip [x0, x1] x [z0, z1]; curbs along its length on both sides (axis 'z': the strip
// runs along z), minus gaps: { neg: [[a, b]], pos: [[a, b]] } intervals along the axis per side,
// and curbs only within [c0, c1] along the axis (they stop at the curb rings).
export function curbStrip(group, x0, z0, x1, z1, { axis = 'z', gaps = {}, curbFrom, curbTo } = {}) {
  const sx = x1 - x0, sz = z1 - z0;
  const base = new THREE.Mesh(gridUVs(new THREE.PlaneGeometry(sx, sz), sx, sz).rotateX(-Math.PI / 2), gridMaterial());
  base.position.set((x0 + x1) / 2, 0.033, (z0 + z1) / 2); base.receiveShadow = true;
  group.add(base);
  const material = lambert(PARK_COLORS.curb);
  const [lo, hi] = axis === 'z' ? [z0, z1] : [x0, x1];
  for (const [side, edge] of axis === 'z' ? [['neg', x0 - CURB.w / 2], ['pos', x1 + CURB.w / 2]] : [['neg', z0 - CURB.w / 2], ['pos', z1 + CURB.w / 2]]) {
    let pieces = [[curbFrom ?? lo, curbTo ?? hi]];
    for (const [a, b] of gaps[side] || []) pieces = pieces.flatMap(([p, q]) => [[p, Math.min(q, a)], [Math.max(p, b), q]]).filter(([p, q]) => q - p > 0.05);
    for (const [p, q] of pieces) {
      const curb = new THREE.Mesh(axis === 'z' ? new THREE.BoxGeometry(CURB.w, CURB.h, q - p) : new THREE.BoxGeometry(q - p, CURB.h, CURB.w), material);
      if (axis === 'z') curb.position.set(edge, CURB.h / 2, (p + q) / 2); else curb.position.set((p + q) / 2, CURB.h / 2, edge);
      curb.receiveShadow = true;
      group.add(curb);
    }
  }
}
