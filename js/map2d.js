// Map mode: a plain DOM layer that pans (drag) and zooms (wheel) like any web map. Its view also
// drives the top-down 3D camera (garden.js); the baked island image (map-bake.js) on top only
// shows when zoomed far out, its opacity following the zoom (see MAP2D.imageFade).
// View state: world point at the screen centre (x, z) and scale in CSS px per metre (ppm).
export const MAP2D = {
  maxPpm: 80,             // closest zoom (CSS px per metre; ~13 m camera height on a 1080 px screen)
  imageFade: [1.6, 0.9],  // image magnification (screen px per image px): transparent at >= 1.6, opaque at <= 0.9
  // Before the image shows, the live 3D view morphs into the baked look (garden.js mapFill: flat
  // tile colours, gaps filled, voxels flattened), so the crossfade blends two matching pictures.
  fill: [3.2, 1.6],       // magnification: live look at >= 3.2, baked look at <= 1.6
  wheelStep: 0.0008,      // zoom per wheel delta unit: one 100-unit notch = ~8% (exp(-0.08))
  zoomEase: 10,           // per second: the view closes ~95% of the gap to the target in 0.3 s
};

export function createMap2D({ canvas, extent }) {
  const root = document.createElement('div');
  root.id = 'map2d';
  root.hidden = true;
  canvas.className = 'map2d-image';
  const dot = document.createElement('div');
  dot.className = 'map2d-player';
  root.append(canvas, dot);
  document.querySelector('#scene').after(root);
  // Outside the image: the sea colour of its corner.
  const corner = canvas.getContext('2d').getImageData(2, 2, 1, 1).data;
  root.style.background = `rgb(${corner[0]}, ${corner[1]}, ${corner[2]})`;

  const imagePpm = canvas.width / (2 * extent); // image px per metre
  const view = { x: 0, z: 0, ppm: 4 };
  const minPpm = () => Math.min(innerWidth, innerHeight) / (2 * extent);
  const clampView = () => {
    view.ppm = Math.min(MAP2D.maxPpm, Math.max(minPpm(), view.ppm));
    view.x = Math.max(-extent, Math.min(extent, view.x));
    view.z = Math.max(-extent, Math.min(extent, view.z));
  };
  const screenX = (x) => innerWidth / 2 + (x - view.x) * view.ppm;
  const screenY = (z) => innerHeight / 2 + (z - view.z) * view.ppm;
  let playerAt = { x: 0, z: 0 }, opacity = 0, fill = 0;
  // 0 at magnification >= from, 1 at <= to (smoothstep).
  const ramp = ([from, to], scale) => { const t = Math.min(1, Math.max(0, (from - scale) / (from - to))); return t * t * (3 - 2 * t); };
  function apply() {
    const scale = view.ppm / imagePpm;
    canvas.style.transform = `translate(${screenX(-extent)}px, ${screenY(-extent)}px) scale(${scale})`;
    // Magnified beyond the image resolution: crisp pixels (pixel-art look) instead of blur.
    canvas.style.imageRendering = scale > 1 ? 'pixelated' : 'auto';
    dot.style.transform = `translate(${screenX(playerAt.x)}px, ${screenY(playerAt.z)}px)`;
    // Zoomed in, the image would be blurry: it fades out and the live 3D view underneath shows.
    opacity = ramp(MAP2D.imageFade, scale);
    fill = ramp(MAP2D.fill, scale);
    root.style.opacity = opacity;
  }

  // zoom: wheel target { ppm, cursor offset dx/dy from the screen centre, world point wx/wz under it }.
  let drag = null, flight = null, zoom = null, lastFrame = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    flight = null; zoom = null;
    drag = { x: event.clientX, y: event.clientY };
    root.setPointerCapture(event.pointerId);
    root.classList.add('dragging');
  });
  root.addEventListener('pointermove', (event) => {
    if (!drag) return;
    view.x -= (event.clientX - drag.x) / view.ppm;
    view.z -= (event.clientY - drag.y) / view.ppm;
    drag = { x: event.clientX, y: event.clientY };
    clampView(); apply();
  });
  const endDrag = () => { drag = null; root.classList.remove('dragging'); };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('lostpointercapture', endDrag);
  // Zoom around the cursor: the world point under it stays under it. Each wheel step only moves
  // the target scale (MAP2D.wheelStep); update() eases the view towards it (MAP2D.zoomEase).
  root.addEventListener('wheel', (event) => {
    event.preventDefault();
    flight = null;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    const dx = event.clientX - innerWidth / 2, dy = event.clientY - innerHeight / 2;
    const ppm = Math.min(MAP2D.maxPpm, Math.max(minPpm(), (zoom ? zoom.ppm : view.ppm) * Math.exp(-delta * MAP2D.wheelStep)));
    zoom = { ppm, dx, dy, wx: view.x + dx / view.ppm, wz: view.z + dy / view.ppm };
  }, { passive: false });
  function stepZoom(dt) {
    const k = reducedMotion.matches ? 1 : 1 - Math.exp(-MAP2D.zoomEase * dt);
    const done = Math.abs(Math.log(zoom.ppm / view.ppm)) < 0.002;
    view.ppm = done ? zoom.ppm : Math.exp(Math.log(view.ppm) + (Math.log(zoom.ppm) - Math.log(view.ppm)) * k);
    view.x = zoom.wx - zoom.dx / view.ppm; view.z = zoom.wz - zoom.dy / view.ppm;
    clampView();
    if (done) zoom = null;
  }
  addEventListener('resize', () => { clampView(); apply(); });

  return {
    view,
    // Image opacity (1 = it covers the whole screen, the 3D view need not be drawn).
    get opacity() { return opacity; },
    // 0..1: how far the live 3D view has morphed into the baked look (see MAP2D.fill).
    get fill() { return fill; },
    fillAt: (ppm) => ramp(MAP2D.fill, ppm / imagePpm),
    // Closest zoom at which the live 3D view shows unchanged (image transparent, no fill).
    clearPpm: imagePpm * MAP2D.fill[0],
    // Take over input at a view that matches the 3D camera's last frame.
    show(x, z, ppm) {
      Object.assign(view, { x, z, ppm }); zoom = null; clampView(); apply();
      root.hidden = false;
    },
    hide() { root.hidden = true; },
    // Animate the view (ease in-out); resolves when it arrives.
    flyTo(x, z, ppm, seconds) {
      zoom = null;
      const from = { ...view }, to = { x, z, ppm: Math.min(MAP2D.maxPpm, ppm) }, start = performance.now();
      return new Promise((done) => {
        flight = () => {
          const k = Math.min(1, (performance.now() - start) / (seconds * 1000)), e = k * k * (3 - 2 * k);
          view.x = from.x + (to.x - from.x) * e; view.z = from.z + (to.z - from.z) * e;
          view.ppm = Math.exp(Math.log(from.ppm) + (Math.log(to.ppm) - Math.log(from.ppm)) * e);
          apply();
          if (k >= 1) { flight = null; done(); }
        };
      });
    },
    // Called every frame while the map is shown.
    update(player) {
      playerAt = { x: player.x, z: player.z };
      const now = performance.now() / 1000, dt = Math.min(now - lastFrame, 0.05); lastFrame = now;
      if (zoom) stepZoom(dt);
      if (flight) flight(); else apply();
    },
  };
}
