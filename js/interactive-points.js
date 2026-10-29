// Interactive points (after bruno-simon.com's InteractivePoints): a world position with a label.
// Far away nothing shows; within REVEAL m the label appears next to a small diamond; the nearest
// point within ACTIVE m is highlighted with a key cap, and E / Enter (or a click) triggers it.
// The labels are DOM elements projected onto the screen every frame (under the HUD panels).
import * as THREE from 'three';

export const POINTS = { reveal: 7, active: 2.4 };

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
      el.innerHTML = '<span class="ipoint-diamond"></span><span class="ipoint-label"></span><kbd class="ipoint-key">E</kbd>';
      el.querySelector('.ipoint-label').textContent = label;
      el.hidden = true;
      el.onclick = () => onInteract();
      layer.append(el);
      const item = { position: position.clone(), el, onInteract, shift: align === 'left' ? 'translate(-100%, -50%)' : 'translate(0, -50%)' };
      items.push(item);
      return item;
    },
    // enabled = false (map, transitions) hides every point.
    update(player, camera, enabled) {
      active = null;
      let best = POINTS.active;
      for (const item of items) {
        const distance = Math.hypot(item.position.x - player.x, item.position.z - player.z);
        projected.copy(item.position).project(camera);
        const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
        item.el.hidden = !enabled || distance > POINTS.reveal || !onScreen;
        item.el.classList.remove('active');
        if (item.el.hidden) continue;
        item.el.style.transform = `translate(${(projected.x * 0.5 + 0.5) * innerWidth}px, ${(-projected.y * 0.5 + 0.5) * innerHeight}px) ${item.shift}`;
        if (distance < best) { best = distance; active = item; }
      }
      active?.el.classList.add('active');
    },
  };
}
