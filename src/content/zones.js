// Stage 1: The Linux Lands. Zone order is the quest order; each zone ends in a boss.
import zone1 from './levels/zone1.js';
import zone2 from './levels/zone2.js';
import zone3 from './levels/zone3.js';
import zone4 from './levels/zone4.js';
import zone5 from './levels/zone5.js';
import zone6 from './levels/zone6.js';
import zone7 from './levels/zone7.js';

export const ZONES = [
  { id: 1, name: 'Terminal Town', blurb: 'Who you are, where you are, and how to look around.', color: '#62e6a4', ground: '#3f9e5a', boss: 'warden', at: [62, 196], levels: zone1 },
  { id: 2, name: 'File Forest', blurb: 'Create, copy, move and destroy. Tame strange file names.', color: '#7fd86a', ground: '#2f7a46', boss: 'hoarder', at: [132, 108], levels: zone2 },
  { id: 3, name: 'Search Swamp', blurb: 'find anything by name, size, owner or age. grep through it all.', color: '#c7d36a', ground: '#5d6a33', boss: 'bandit', at: [205, 200], levels: zone3 },
  { id: 4, name: 'Pipe Works', blurb: 'Chain small tools into machines: pipes, redirection, sort, awk, sed.', color: '#ffae57', ground: '#7a4a2e', boss: 'golem', at: [272, 104], levels: zone4 },
  { id: 5, name: 'Permission Peaks', blurb: 'Users, groups, rwx, sudo, and the setuid secrets hackers hunt.', color: '#a9b4e8', ground: '#59618f', boss: 'vault', at: [340, 186], levels: zone5 },
  { id: 6, name: 'Process Caves', blurb: 'Processes, signals, jobs, and the environment that shapes them.', color: '#e08cff', ground: '#4a3552', boss: 'daemon', at: [396, 82], levels: zone6 },
  { id: 7, name: 'Remote Reaches', blurb: 'Scripts, ssh, keys, archives and cron. The road to OverTheWire.', color: '#5fe3e3', ground: '#2a7f80', boss: 'king', at: [444, 196], levels: zone7 },
];

export const ALL_LEVELS = ZONES.flatMap((z) => z.levels.map((l) => ({ ...l, zone: z.id })));

export function zoneOf(levelId) {
  return ZONES.find((z) => z.levels.some((l) => l.id === levelId));
}
