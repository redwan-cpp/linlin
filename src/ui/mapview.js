// World map: a 480x270 pixel world drawn on canvas, with accessible HTML buttons over each quest node.
import { h } from './dom.js';
import { drawSprite, SPRITES } from './sprites.js';
import { mulberry32 } from '../engine/util.js';

const W = 480;
const HT = 270;
const S = 3;

export function nodePositions(zones) {
  const out = [];
  zones.forEach((z) => {
    const n = Math.max(z.levels.length, 6);
    const [cx, cy] = z.at;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = Math.round(cx - 30 + t * 60);
      const y = Math.round(cy + 14 - t * 28 + Math.sin(t * Math.PI * 2.2) * 9);
      out.push({ zone: z.id, idx: i, x, y, boss: i === n - 1, real: i < z.levels.length });
    }
  });
  return out;
}

function blob(g, cx, cy, r, color, rand) {
  g.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const wob = Math.round(Math.sin((y + cx) * 0.35) * 3 + rand() * 2);
    const half = Math.round(Math.sqrt(Math.max(0, r * r - y * y)) * 1.35) + wob;
    g.fillRect(cx - half, cy + y, half * 2, 1);
  }
}

function decorate(g, z, rand) {
  const [cx, cy] = z.at;
  const spots = Array.from({ length: 16 }, () => [cx + Math.round((rand() - 0.5) * 92), cy + Math.round((rand() - 0.5) * 60)]);
  for (const [x, y] of spots) {
    switch (z.id) {
      case 1: g.fillStyle = '#c96a4a'; g.fillRect(x, y, 5, 3); g.fillStyle = '#f3e6c8'; g.fillRect(x, y + 3, 5, 3); g.fillStyle = '#2b1d0e'; g.fillRect(x + 2, y + 4, 1, 2); break;
      case 2: g.fillStyle = '#1f5e35'; g.fillRect(x + 1, y, 3, 2); g.fillRect(x, y + 2, 5, 3); g.fillStyle = '#6b4a2e'; g.fillRect(x + 2, y + 5, 1, 2); break;
      case 3: g.fillStyle = '#3d6e8a'; g.fillRect(x, y, 6, 2); g.fillStyle = '#9ab34a'; g.fillRect(x + 7, y - 3, 1, 4); break;
      case 4: g.fillStyle = '#c98a5a'; g.fillRect(x, y, 8, 2); g.fillRect(x + 6, y - 4, 2, 6); g.fillStyle = '#5a3a26'; g.fillRect(x + 2, y, 1, 2); break;
      case 5: g.fillStyle = '#8a93c2'; for (let i = 0; i < 4; i++) g.fillRect(x - i, y + i, 2 * i + 1, 1); g.fillStyle = '#f4f0ff'; g.fillRect(x, y, 1, 1); break;
      case 6: g.fillStyle = '#1e1428'; g.fillRect(x, y, 5, 4); g.fillStyle = '#6a4a78'; g.fillRect(x - 1, y - 1, 7, 1); break;
      case 7: g.fillStyle = '#d9e4ff'; g.fillRect(x, y - 5, 1, 6); g.fillStyle = '#ff6f91'; g.fillRect(x, y - 6, 1, 1); break;
      default: break;
    }
  }
}

export function drawWorld(canvas, zones, state, tick = 0) {
  const g = canvas.getContext('2d');
  g.setTransform(S, 0, 0, S, 0, 0);
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#16204a';
  g.fillRect(0, 0, W, HT);
  const rw = mulberry32(7);
  g.fillStyle = '#22306a';
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(rw() * W);
    const y = Math.floor(rw() * HT);
    g.fillRect((x + Math.floor(tick / 2)) % W, y, 3, 1);
  }
  zones.forEach((z) => {
    const rand = mulberry32(z.id * 991);
    blob(g, z.at[0], z.at[1], 34, '#0d1433', rand);
    blob(g, z.at[0], z.at[1] - 1, 33, z.ground, mulberry32(z.id * 991));
    const unlocked = state.zoneUnlocked(z.id);
    decorate(g, z, mulberry32(z.id * 37));
    if (!unlocked) { g.fillStyle = '#0b0f26aa'; blob(g, z.at[0], z.at[1] - 1, 33, '#0b0f26b0', mulberry32(z.id * 991)); }
  });
  const nodes = nodePositions(zones);
  g.fillStyle = '#e8dcb5';
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let s = 0; s <= steps; s += 4) {
      const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
      const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
      g.fillRect(x, y, 2, 2);
    }
  }
  let avatarAt = null;
  for (const n of nodes) {
    const z = zones.find((zz) => zz.id === n.zone);
    const lvl = z.levels[n.idx];
    const st = lvl ? state.levelState(lvl.id) : 'void';
    if (n.boss && lvl) {
      drawSprite(g, SPRITES[z.boss], n.x - 8, n.y - 14, 1, st === 'done' ? '#7a7398' : null);
      g.fillStyle = st === 'done' ? '#ffcc4d' : st === 'open' ? '#ff6f91' : '#3a3460';
      g.fillRect(n.x - 6, n.y + 3, 12, 2);
    } else {
      const col = st === 'done' ? '#ffcc4d' : st === 'open' ? (tick % 2 ? '#62e6a4' : '#a8ffd2') : st === 'void' ? '#2a2550' : '#4a4378';
      g.fillStyle = '#0b0918';
      g.fillRect(n.x - 4, n.y - 3, 9, 7);
      g.fillRect(n.x - 3, n.y - 4, 7, 9);
      g.fillStyle = col;
      g.fillRect(n.x - 3, n.y - 2, 7, 5);
      g.fillRect(n.x - 2, n.y - 3, 5, 7);
      if (st === 'done') { g.fillStyle = '#fff4c2'; g.fillRect(n.x, n.y - 1, 1, 3); g.fillRect(n.x - 1, n.y, 3, 1); }
    }
    if (st === 'open' && !avatarAt) avatarAt = n;
  }
  if (avatarAt) drawSprite(g, SPRITES.recruit, avatarAt.x - 8, avatarAt.y - 22 - (tick % 2), 1);
  zones.forEach((z) => {
    g.font = '7px "Silkscreen", monospace';
    const label = z.name.toUpperCase();
    const w = g.measureText(label).width;
    g.fillStyle = '#0b0918cc';
    g.fillRect(Math.round(z.at[0] - w / 2 - 3), z.at[1] + 26, Math.ceil(w) + 6, 10);
    g.fillStyle = state.zoneUnlocked(z.id) ? z.color : '#6f679e';
    g.fillText(label, Math.round(z.at[0] - w / 2), z.at[1] + 34);
  });
}

export function mapScreen({ zones, state, onOpen }) {
  const canvas = h('canvas', { class: 'map-canvas box-term', width: W * S, height: HT * S, role: 'img', 'aria-label': 'World map of the Linux Lands' });
  const stage = h('div', { class: 'map-stage' }, canvas);
  const tip = h('div', { class: 'map-tip', hidden: true });
  stage.append(tip);
  for (const n of nodePositions(zones)) {
    const z = zones.find((zz) => zz.id === n.zone);
    const lvl = z.levels[n.idx];
    if (!lvl) continue;
    const st = state.levelState(lvl.id);
    const label = `${z.name} · ${n.boss ? 'Boss' : `Quest ${n.idx + 1}`}: ${lvl.title}${st === 'done' ? ' (complete)' : st === 'locked' ? ' (locked)' : ''}`;
    const b = h('button', {
      class: 'map-node', type: 'button', 'aria-label': label, disabled: st === 'locked',
      style: { left: `${(n.x / W) * 100}%`, top: `${(n.y / HT) * 100}%` },
      onclick: () => onOpen(lvl.id),
    });
    const show = () => { tip.hidden = false; tip.textContent = label; tip.style.left = b.style.left; tip.style.top = b.style.top; };
    b.addEventListener('mouseenter', show);
    b.addEventListener('focus', show);
    b.addEventListener('mouseleave', () => { tip.hidden = true; });
    b.addEventListener('blur', () => { tip.hidden = true; });
    stage.append(b);
  }
  let tick = 0;
  drawWorld(canvas, zones, state, tick);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const timer = reduced ? null : setInterval(() => {
    if (!canvas.isConnected) { clearInterval(timer); return; }
    drawWorld(canvas, zones, state, ++tick);
  }, 450);
  if (document.fonts?.ready) document.fonts.ready.then(() => drawWorld(canvas, zones, state, tick));

  const list = h('div', { class: 'zone-list' });
  for (const z of zones) {
    const unlocked = state.zoneUnlocked(z.id);
    const done = z.levels.filter((l) => state.levelState(l.id) === 'done').length;
    const card = h('section', { class: `zone-card box${unlocked ? '' : ' locked'}` },
      h('h3', {}, h('span', {}, `${z.id}. ${z.name}`), h('span', { class: 'label', style: { color: z.color } }, z.levels.length ? `${done}/${z.levels.length}` : 'forging')),
      h('p', {}, z.levels.length ? z.blurb : `${z.blurb} This zone is still being forged.`));
    if (unlocked && z.levels.length) {
      for (const [i, l] of z.levels.entries()) {
        const st = state.levelState(l.id);
        card.append(h('button', {
          class: `level-row${st === 'done' ? ' done' : ''}${st === 'open' ? ' next' : ''}`, type: 'button', disabled: st === 'locked',
          onclick: () => onOpen(l.id),
        }, h('i', { class: 'pip' }), h('span', {}, `${i + 1}. ${l.title}`), l.boss ? h('span', { class: 'boss-tag' }, 'BOSS') : null));
      }
    }
    list.append(card);
  }
  return h('div', { class: 'map-wrap' }, stage, list);
}
