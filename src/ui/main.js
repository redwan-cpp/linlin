// App shell: top bar, routing between Welcome, Map, Level, Codex and Journal, and progress gating.
import { h, toast } from './dom.js';
import { Save, rankFor } from './save.js';
import { ZONES } from '../content/zones.js';
import { DOCS } from '../content/codex.js';
import { mapScreen } from './mapview.js';
import { levelScreen } from './levelview.js';
import { welcomeScreen, codexScreen, journalScreen } from './screens.js';
import { spriteCanvas } from './sprites.js';
import { setSound, soundOn, sfx } from './sound.js';

const app = document.getElementById('app');
const save = new Save();
let current = { screen: 'map', levelId: null };
let active = null;

const progress = {
  levelState(id) {
    if (!save.data) return 'locked';
    if (save.data.completed[id]) return 'done';
    for (const z of ZONES) {
      const i = z.levels.findIndex((l) => l.id === id);
      if (i < 0) continue;
      if (!progress.zoneUnlocked(z.id)) return 'locked';
      if (i === 0 || save.data.completed[z.levels[i - 1].id]) return 'open';
      return 'locked';
    }
    return 'locked';
  },
  zoneUnlocked(zid) {
    if (zid === 1) return true;
    const prev = ZONES.find((z) => z.id === zid - 1);
    if (!prev || !prev.levels.length) return false;
    return !!save.data?.completed[prev.levels[prev.levels.length - 1].id];
  },
};

function topbar() {
  const d = save.data;
  const rank = rankFor(d.xp);
  const levels = ZONES.flatMap((z) => z.levels);
  const done = levels.filter((l) => d.completed[l.id]).length;
  const nav = (id, label) => h('button', { class: 'btn btn-sm', type: 'button', 'aria-current': current.screen === id ? 'page' : null, onclick: () => go(id) }, label);
  const sound = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-pressed': String(soundOn()), title: 'Sound effects', onclick: () => {
    const on = !soundOn();
    setSound(on);
    save.update((x) => { x.settings.sound = on; });
    sound.textContent = on ? '♪ On' : '♪ Off';
    sound.setAttribute('aria-pressed', String(on));
    if (on) sfx('click');
  } }, soundOn() ? '♪ On' : '♪ Off');
  return h('header', { class: 'topbar' },
    h('button', { class: 'brand', type: 'button', onclick: () => go('map'), 'aria-label': 'Linux Quest home' }, spriteCanvas('scroll', { scale: 2 }), h('span', {}, 'Linux Quest')),
    h('div', { class: 'player' }, spriteCanvas('recruit', { scale: 3 }),
      h('div', { class: 'player-info' },
        h('div', { class: 'player-rank' }, `${d.name} · ${rank.name}`),
        h('div', { class: 'xpbar', role: 'meter', 'aria-label': 'Experience to next rank', 'aria-valuenow': Math.round(rank.pct * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: `${Math.round(rank.pct * 100)}%` } })),
        h('div', { class: 'xpbar-text' }, rank.next ? `${d.xp} XP · ${rank.next - d.xp} to ${rankFor(rank.next).name}` : `${d.xp} XP · max rank`))),
    h('div', { class: 'stats' },
      h('span', { class: 'stat', title: 'Daily streak' }, h('span', { style: { color: 'var(--amber)' } }, '▲'), `${save.streak()}d streak`),
      h('span', { class: 'stat', title: 'Quests complete' }, h('span', { style: { color: 'var(--gold)' } }, '★'), `${done}/${levels.length}`)),
    h('nav', { class: 'nav', 'aria-label': 'Main' }, nav('map', 'Map'), nav('codex', 'Codex'), nav('journal', 'Journal'), sound));
}

function nextLevelId(id) {
  const levels = ZONES.flatMap((z) => z.levels);
  const i = levels.findIndex((l) => l.id === id);
  const n = levels[i + 1];
  return n && progress.levelState(n.id) !== 'locked' ? n.id : null;
}

function render() {
  active?.dispose?.();
  active = null;
  app.textContent = '';
  if (!save.data) {
    app.append(h('main', { class: 'screen' }, welcomeScreen({ onStart: (name) => { save.create(name); sfx('complete'); go('map'); } })));
    return;
  }
  setSound(save.data.settings?.sound !== false);
  const main = h('main', { class: 'screen' });
  if (current.screen === 'level' && current.levelId) {
    const zone = ZONES.find((z) => z.levels.some((l) => l.id === current.levelId));
    const index = zone.levels.findIndex((l) => l.id === current.levelId);
    const level = { ...zone.levels[index], zone: zone.id };
    const next = nextLevelId(level.id) || (index + 1 < zone.levels.length ? zone.levels[index + 1].id : null);
    active = levelScreen({
      level, zone, index, docs: DOCS, save,
      hasNext: !!next,
      onExit: () => go('map'),
      onNext: () => { const n = nextLevelId(level.id); if (n) openLevel(n); else go('map'); },
    });
    main.append(active.el);
  } else if (current.screen === 'codex') {
    main.append(codexScreen({ docs: DOCS, zones: ZONES, save }));
  } else if (current.screen === 'journal') {
    main.append(journalScreen({ save, zones: ZONES, onOpen: openLevel }));
  } else {
    main.append(mapScreen({ zones: ZONES, state: progress, onOpen: openLevel }));
  }
  app.append(topbar(), main);
}

function go(screen) {
  current = { screen, levelId: null };
  render();
  window.scrollTo(0, 0);
}

function openLevel(id) {
  if (progress.levelState(id) === 'locked') { toast('Finish the earlier quests to unlock this one.'); return; }
  current = { screen: 'level', levelId: id };
  render();
  window.scrollTo(0, 0);
}

// A save loaded from another device redraws the screen (unless mid-quest); local changes only refresh the top bar.
save.onChange((d, reason) => {
  if (!d) return;
  if (reason === 'remote' && current.screen !== 'level') { render(); return; }
  const bar = document.querySelector('.topbar');
  if (bar) bar.replaceWith(topbar());
});

function start(snapshot = {}) {
  if (snapshot.screen) current = { screen: snapshot.screen, levelId: snapshot.levelId || null };
  render();
  save.connect();
}

window.claude?.hot?.snapshot?.(() => ({ screen: current.screen, levelId: current.levelId }));
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
