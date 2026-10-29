// Interactive points (after bruno-simon.com's InteractivePoints): a world position with a label.
// Far away nothing shows; within REVEAL m the label appears next to a small diamond; the nearest
// point within ACTIVE m is highlighted with a key cap, and E / Enter (or a click) triggers it.
// The labels are DOM elements projected onto the screen every frame (under the HUD panels).
import * as THREE from 'three';

// intro: seconds until the label has unrolled; outro: the leave animation (both match garden.css).
export const POINTS = { reveal: 7, active: 2.4, intro: 0.85, outro: 0.25 };

export function createInteractivePoints() {
  const layer = document.createElement('div');
  layer.id = 'interactive-points';
  document.querySelector('#scene').after(layer);
  const items = [], projected = new THREE.Vector3();
  let active = null;

  addEventListener('keydown', (event) => {
    if (!active || event.repeat || (event.code !== 'KeyE' && event.code !== 'Enter')) return;
    event.preventDefault();
    active.onInteract();
  });

  return {
    // align: 'left' | 'right' = side of the diamond the label sits on.
    create(position, label, align, onInteract) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `ipoint ipoint-${align}`;
      el.innerHTML = '<span class="ipoint-body"><span class="ipoint-diamond"></span><span class="ipoint-label"></span><kbd class="ipoint-key">E</kbd></span>';
      el.querySelector('.ipoint-label').textContent = label;
      el.hidden = true;
      el.onclick = () => onInteract();
      layer.append(el);
      const item = { position: position.clone(), el, onInteract, shownAt: 0, leftAt: 0, shift: align === 'left' ? 'translate(-100%, -50%)' : 'translate(0, -50%)' };
      items.push(item);
      return item;
    },
    // enabled = false (map, transitions) hides every point.
    update(player, camera, enabled) {
      const now = performance.now() / 1000;
      active = null;
      let best = POINTS.active;
      for (const item of items) {
        const distance = Math.hypot(item.position.x - player.x, item.position.z - player.z);
        projected.copy(item.position).project(camera);
        const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
        const hidden = !enabled || distance > POINTS.reveal || !onScreen;
        if (hidden) {
          // Leaving: the CSS outro (swell to 1.2, shrink to 0) plays, then the point is hidden.
          if (item.el.hidden) continue;
          if (!item.leftAt) { item.leftAt = now; item.el.classList.add('leaving'); }
          if (now - item.leftAt >= POINTS.outro) { item.el.hidden = true; item.el.classList.remove('leaving', 'active'); item.leftAt = 0; }
          continue;
        }
        // Back before the outro ended: just stop it. Showing again restarts the CSS intro
        // (diamond pop, nudge, label unroll).
        if (item.leftAt) { item.el.classList.remove('leaving'); item.leftAt = 0; }
        if (item.el.hidden) { item.shownAt = now; item.el.hidden = false; }
        item.el.style.transform = `translate(${(projected.x * 0.5 + 0.5) * innerWidth}px, ${(-projected.y * 0.5 + 0.5) * innerHeight}px) ${item.shift}`;
        if (distance < best) { best = distance; active = item; }
      }
      // A leaving point keeps its highlight (and key cap) through the outro.
      for (const item of items) {
        if (item.el.hidden || item.leftAt || item.el.classList.contains('active') === (item === active)) continue;
        // The key cap pops once the label has unrolled (POINTS.intro s after the point showed).
        if (item === active) item.el.querySelector('.ipoint-key').style.animationDelay = `${Math.max(0, POINTS.intro - (now - item.shownAt))}s`;
        item.el.classList.toggle('active', item === active);
      }
    },
  };
}
