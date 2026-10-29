// Showcase boards for the WORK quadrant: Projects and Lab. After bruno-simon.com's folio-2025
// (ProjectsArea.js, LabArea.js; MIT, Copyright (c) 2025 Bruno Simon, see
// assets/textures/third-party/LICENSE-folio-2025.md): an interactive point in front of a big board;
// E takes the camera to the board (stage.focus), the board shows one entry at a time and the
// arrows browse. Projects: left / right walk through a project's images, then on to the next
// project (Bruno's order). Lab: up / down pick an experiment from the list, left / right its images.
// Enter opens the link, Esc goes back. His boards, forge and cauldron are Blender models; here
// everything is a code-built placeholder (board, posts, anvil + furnace, cauldron + candles).
import * as THREE from 'three';
import { PARK_COLORS } from './park.js';
import { curbRing, curbStrip } from './work-area.js';

export const PATH_W = 2.4; // connector path width (m)
export const SHOWCASE = {
  patioR: 5.5,             // paved round patio (m)
  board: { w: 4.6, h: 2.8, y: 2.1 }, // screen size and centre height (m)
  viewDistance: 4.4,       // focused camera distance from the board (m)
  canvas: [1024, 624],     // board texture (px)
};
const lambert = (hex) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
const INK = '#f3efe6', DIM = '#b8a88a', PANEL = '#1d1a24', ACCENT = { projects: '#ff8039', lab: '#a2ffab' };

// Word wrap for canvas text; returns the lines.
function wrap(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
// Placeholder picture: a two-tone gradient from the title, with the title on it.
function placeholder(ctx, item, x, y, w, h, accent) {
  let hash = 0;
  for (const ch of item.title) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, `hsl(${hash}, 45%, 38%)`); g.addColorStop(1, `hsl(${(hash + 70) % 360}, 50%, 22%)`);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let k = 0; k < 9; k++) ctx.fillRect(x + ((k * 97) % w), y, 18, h);
  ctx.fillStyle = accent; ctx.font = '64px Jersey10, VT323, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [i, line] of wrap(ctx, item.title, w - 60).entries()) ctx.fillText(line, x + w / 2, y + h / 2 + i * 64 - 20);
  ctx.font = '30px VT323, monospace'; ctx.fillStyle = INK;
  ctx.fillText('IMAGE PLACEHOLDER', x + w / 2, y + h - 34);
  ctx.textAlign = 'left';
}
// Draws an image "cover" style into the box.
function cover(ctx, image, x, y, w, h) {
  const s = Math.max(w / image.width, h / image.height), iw = w / s, ih = h / s;
  ctx.drawImage(image, (image.width - iw) / 2, (image.height - ih) / 2, iw, ih, x, y, w, h);
}

// kind: 'projects' | 'lab'. x, z: patio centre; facing: unit vector from the board towards the
// visitor (the board stands on the far side). entryX: road curb the connector path runs to.
export function createShowcase({ scene, physics, points, stage, kind, title, items, x, z, facing, entryX }) {
  const S = SHOWCASE, group = new THREE.Group();
  scene.add(group);
  const add = (mesh, px, py, pz, ry = 0, cast = true) => { mesh.position.set(px, py, pz); mesh.rotation.y = ry; mesh.castShadow = cast; mesh.receiveShadow = true; group.add(mesh); return mesh; };
  const yaw = Math.atan2(facing.x, facing.z); // board front (+z of its local frame) faces the visitor
  const side = new THREE.Vector3(facing.z, 0, -facing.x); // board's local +x
  const at = (along, across) => new THREE.Vector3(x, 0, z).addScaledVector(facing, along).addScaledVector(side, across);

  // ---------- Patio + connector path to the road ----------
  // Smooth patio (radial pavers) opening towards the road; the path (grid pavers) runs from the
  // road curb into the patio edge, its curbs stopping at the patio curb.
  const toRoad = Math.sign(entryX - x), w = PATH_W / 2;
  curbRing(group, x, z, S.patioR, [{ angle: toRoad < 0 ? Math.PI : 0, half: w }], kind === 'lab' ? 7 : 5);
  const inner = x + toRoad * Math.sqrt(S.patioR ** 2 - w ** 2), curbInner = x + toRoad * Math.sqrt(S.patioR ** 2 - (w + 0.1) ** 2);
  const [px0, px1] = [Math.min(entryX, inner), Math.max(entryX, inner)];
  curbStrip(group, px0, z - w, px1, z + w, { axis: 'x', curbFrom: Math.min(entryX, curbInner), curbTo: Math.max(entryX, curbInner) });

  // ---------- Board: posts, dark frame, screen ----------
  const boardAt = at(-S.patioR + 1.6, 0);
  const [cw, ch] = S.canvas, canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  for (const s of [-1, 1]) {
    const post = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, S.board.y + S.board.h / 2 + 0.3, 0.22), lambert(PARK_COLORS.darkWood)), 0, 0, 0);
    post.position.copy(boardAt).addScaledVector(side, s * (S.board.w / 2 + 0.2)); post.position.y = (S.board.y + S.board.h / 2 + 0.3) / 2;
  }
  add(new THREE.Mesh(new THREE.BoxGeometry(S.board.w + 0.3, S.board.h + 0.3, 0.16), lambert(0x2b2530)), boardAt.x, S.board.y, boardAt.z, yaw);
  // Slightly below 1 so the white text does not bloom.
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(S.board.w, S.board.h), new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(0.92, 0.92, 0.92) }));
  screen.position.copy(boardAt).addScaledVector(facing, 0.09); screen.position.y = S.board.y; screen.rotation.y = yaw;
  group.add(screen);
  physics.box(boardAt.x, S.board.y / 2 + 0.6, boardAt.z, (S.board.w + 0.7) / 2, S.board.y / 2 + 0.6, 0.2, yaw);

  // ---------- Decor: forge (projects) or cauldron + candles (lab) ----------
  const glow = (hex) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2.2) });
  if (kind === 'projects') {
    const anvil = at(-0.4, 3.2);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.4), lambert(0x4a4450)), anvil.x, 0.3, anvil.z, yaw);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.42), lambert(0x5a5560)), anvil.x, 0.72, anvil.z, yaw);
    physics.box(anvil.x, 0.42, anvil.z, 0.55, 0.42, 0.25, yaw);
    const furnace = at(-1.8, -3.4);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.3), lambert(0x8a6a4a)), furnace.x, 0.75, furnace.z, yaw);
    const mouth = add(new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), glow(0xff8039)), furnace.x, 0.65, furnace.z, yaw, false);
    mouth.position.addScaledVector(facing, 0.66);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.2, 6), lambert(0x6b4f37)), furnace.x, 2.0, furnace.z, 0);
    physics.box(furnace.x, 0.75, furnace.z, 0.8, 0.75, 0.7, yaw);
  } else {
    const pot = at(-0.6, 3.1);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.45, 0.8, 10), lambert(0x2f2b36)), pot.x, 0.4, pot.z);
    add(new THREE.Mesh(new THREE.CircleGeometry(0.55, 14).rotateX(-Math.PI / 2), glow(0x7dff8a)), pot.x, 0.78, pot.z, 0, false);
    physics.cylinder(pot.x, 0.4, pot.z, 0.4, 0.62);
    for (const [along, across, hgt] of [[-1.5, -3.1, 0.5], [-1.2, -3.6, 0.8], [-1.9, -3.7, 0.35]]) {
      const c = at(along, across);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, hgt, 8), lambert(0xf1e3c4)), c.x, hgt / 2, c.z);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), glow(0xffd88a)), c.x, hgt + 0.1, c.z, 0, false);
    }
  }

  // ---------- Board content ----------
  let index = 0, image = 0;
  const pictures = items.map((item) => (item.images || []).map((url) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => draw();
    img.src = url;
    return img;
  }));
  const accent = ACCENT[kind];
  // Clickable regions of the board (canvas px), rebuilt by draw(): { x, y, w, h, act }.
  let hot = [];
  function button(x, y, w, h, label, act) {
    ctx.fillStyle = '#2b2733'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.fillStyle = INK; ctx.font = '30px VT323, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = 'left';
    hot.push({ x, y, w, h, act });
  }
  function draw() {
    const item = items[index], pics = pictures[index], pic = pics[image];
    hot = [];
    ctx.fillStyle = PANEL; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = accent; ctx.fillRect(0, 0, cw, 8);
    let left = 28;
    if (kind === 'lab') { // experiment list
      ctx.font = '30px VT323, monospace'; ctx.textBaseline = 'middle';
      items.forEach((it, i) => {
        const y = 60 + i * 52;
        if (i === index) { ctx.fillStyle = accent; ctx.fillRect(20, y - 22, 300, 44); }
        ctx.fillStyle = i === index ? PANEL : DIM;
        ctx.fillText(`${String(i + 1).padStart(2, '0')} ${it.title}`, 32, y, 280);
        hot.push({ x: 20, y: y - 22, w: 300, h: 44, act: `item:${i}` });
      });
      left = 344;
    }
    const picW = kind === 'lab' ? cw - left - 28 : 600, picH = kind === 'lab' ? 300 : 420;
    if (pic?.complete && pic.naturalWidth) cover(ctx, pic, left, 32, picW, picH); else placeholder(ctx, item, left, 32, picW, picH, accent);
    hot.push({ x: left, y: 32, w: picW, h: picH, act: 'next' }); // click the picture: next
    if (pics.length > 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(left + picW - 96, 40, 84, 34);
      ctx.fillStyle = INK; ctx.font = '28px VT323, monospace'; ctx.fillText(`${image + 1} / ${pics.length}`, left + picW - 86, 58);
    }
    // Text column (projects: right of the picture; lab: under it).
    const tx = kind === 'lab' ? left : left + picW + 28, tw = kind === 'lab' ? picW : cw - tx - 28;
    let ty = kind === 'lab' ? 32 + picH + 40 : 64;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent; ctx.font = '50px Jersey10, VT323, monospace';
    for (const line of wrap(ctx, item.title, tw)) { ctx.fillText(line, tx, ty); ty += 46; }
    ctx.fillStyle = DIM; ctx.font = '28px VT323, monospace';
    ctx.fillText(item.year || '', tx, ty); ty += 40;
    // Tags as chips.
    let cx = tx;
    ctx.font = '24px VT323, monospace';
    for (const tag of item.tags || []) {
      const w = ctx.measureText(tag).width + 18;
      if (cx + w > tx + tw) { cx = tx; ty += 34; }
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(cx, ty - 14, w, 28);
      ctx.fillStyle = INK; ctx.fillText(tag, cx + 9, ty);
      cx += w + 8;
    }
    ty += 44;
    ctx.fillStyle = INK; ctx.font = '28px VT323, monospace';
    for (const line of wrap(ctx, item.text || '', tw).slice(0, kind === 'lab' ? 3 : 7)) { ctx.fillText(line, tx, ty); ty += 32; }
    // Footer: position in the list and the link.
    ctx.fillStyle = DIM; ctx.font = '26px VT323, monospace';
    ctx.fillText(`${kind === 'lab' ? 'EXPERIMENT' : 'PROJECT'} ${index + 1} / ${items.length}`, 28, ch - 30);
    if (item.url) {
      ctx.fillStyle = accent; ctx.fillText(`${item.url.replace(/^https?:\/\//, '')} ↗`, cw / 2 - 120, ch - 30, cw / 2 - 40);
      hot.push({ x: cw / 2 - 130, y: ch - 52, w: cw / 2 - 20, h: 44, act: 'open' });
    }
    button(cw - 160, ch - 56, 60, 44, '◀', 'prev');
    button(cw - 90, ch - 56, 60, 44, '▶', 'next');
    texture.needsUpdate = true;
  }
  draw();

  // ---------- Focus, navigation, HUD ----------
  let open = false;
  const hud = () => stage.hud(`<p class="eyebrow">◆ ${title}</p>
    <div class="focus-actions">
      ${kind === 'lab' ? '<button data-act="up" type="button">▲</button><button data-act="down" type="button">▼</button>' : ''}
      <button data-act="prev" type="button">◀</button><button data-act="next" type="button">▶</button>
      <button data-act="open" type="button">OPEN ↗</button><button data-act="exit" type="button">ESC</button>
    </div>
    <p class="hint">${kind === 'lab' ? '↑ ↓ experiments · ← → images' : '← → images and projects'} · Enter open · Esc back</p>`);
  // Bruno's order for projects: next image, then the next project's first image (and back).
  const step = (dir) => {
    const count = pictures[index].length;
    if (kind === 'projects') {
      if (image + dir >= 0 && image + dir < count) image += dir;
      else { index = (index + dir + items.length) % items.length; image = dir > 0 ? 0 : Math.max(0, pictures[index].length - 1); }
    } else if (count) image = (image + dir + count) % count;
    draw();
  };
  const pick = (dir) => { index = (index + dir + items.length) % items.length; image = 0; draw(); };
  const act = (name) => {
    if (name === 'prev') step(-1); else if (name === 'next') step(1);
    else if (name === 'up') pick(-1); else if (name === 'down') pick(1);
    else if (name.startsWith('item:')) { index = Number(name.slice(5)); image = 0; draw(); }
    else if (name === 'open' && items[index].url) window.open(items[index].url, '_blank', 'noopener');
    else if (name === 'exit') stage.release();
  };
  document.querySelector('#focus-hud').addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (open && button) act(button.dataset.act);
  });
  addEventListener('keydown', (event) => {
    if (!open || event.repeat) return;
    const name = { ArrowLeft: 'prev', ArrowRight: 'next', ArrowUp: 'up', ArrowDown: 'down', Enter: 'open', KeyA: 'prev', KeyD: 'next', KeyW: 'up', KeyS: 'down' }[event.code];
    if (name && (kind === 'lab' || (name !== 'up' && name !== 'down'))) { event.preventDefault(); act(name); }
  });
  const point = at(-S.patioR + 4.6, 0);
  const eye = at(-S.patioR + 1.6 + S.viewDistance, 0); eye.y = S.board.y + 0.15;
  const look = boardAt.clone(); look.y = S.board.y;
  const enter = () => { if (stage.focus(eye, look, () => { open = false; })) { open = true; hud(); } };
  points.create(new THREE.Vector3(point.x, 1, point.z), title, 'right', enter);
  // Clicking the board itself: from nearby (walking) it opens the board; when open, it presses
  // whatever is under the cursor (list rows, the picture, the arrows, the link). A drag (look
  // around) is not a click.
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let press = null;
  stage.dom.addEventListener('pointerdown', (event) => { if (event.button === 0) press = { x: event.clientX, y: event.clientY }; });
  stage.dom.addEventListener('pointerup', (event) => {
    if (!press || event.button !== 0 || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) { press = null; return; }
    press = null;
    if (stage.active && !open) return; // another area has the camera
    const rect = stage.dom.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    const hit = raycaster.intersectObject(screen)[0];
    if (!hit || hit.distance > 14) return;
    if (!open) { enter(); return; }
    const px = hit.uv.x * cw, py = (1 - hit.uv.y) * ch;
    const spot = [...hot].reverse().find((h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
    if (spot) act(spot.act);
  });

  return {
    bounds: [{ x, z, r: S.patioR + 1 }],
    covers: (px, pz) => Math.hypot(px - x, pz - z) < S.patioR + 0.8 || (Math.abs(pz - z) < 1.6 && (px - entryX) * (px - x) < 0),
  };
}
