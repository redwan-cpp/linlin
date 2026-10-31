// Player progress: kept in the artifact's db (players/<viewer id>) with a localStorage backup.
import { store } from './dom.js';

const KEY = 'linux-quest-save-v1';

export const RANKS = [
  [0, 'Recruit'], [300, 'Script Kiddie'], [900, 'Operator'], [1800, 'Shellwalker'], [3000, 'Root'],
];

export function rankFor(xp) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i][0]) idx = i;
  const floor = RANKS[idx][0];
  const next = RANKS[idx + 1]?.[0] ?? null;
  return { idx, name: RANKS[idx][1], floor, next, pct: next ? (xp - floor) / (next - floor) : 1 };
}

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function blankSave(name) {
  return {
    v: 1, name, createdAt: Date.now(), updatedAt: Date.now(), xp: 0,
    completed: {}, quiz: {}, codex: [], journal: [], realWorld: {}, days: {},
    streak: { last: null, count: 0 }, settings: { sound: true },
  };
}

export class Save {
  constructor() {
    this.data = store.get(KEY);
    this.ref = null;
    this.status = 'local';
    this.writing = null;
    this.dirty = false;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason = 'local') { for (const fn of this.listeners) fn(this.data, reason); }

  // Connect to the shared db when running inside claude.ai. Never blocks the first render.
  async connect() {
    try {
      const c = window.claude;
      if (!c?.use) return;
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db || !user) return;
      const id = await user.id();
      if (!id) return;
      this.ref = db.doc(`players/${id}`);
      const snap = await this.ref.get();
      const remote = snap.exists ? snap.data() : null;
      if (remote && (!this.data || (remote.xp ?? 0) > (this.data.xp ?? 0) || ((remote.xp ?? 0) === (this.data.xp ?? 0) && (remote.updatedAt ?? 0) > (this.data.updatedAt ?? 0)))) {
        this.data = remote;
        store.set(KEY, this.data);
        this.emit('remote');
      } else if (this.data) {
        this.flush();
      }
      this.status = 'synced';
    } catch {
      this.status = 'local';
    }
  }

  create(name) {
    this.data = blankSave(name);
    this.commit();
  }

  update(fn) {
    fn(this.data);
    this.commit();
  }

  commit() {
    this.data.updatedAt = Date.now();
    store.set(KEY, this.data);
    this.emit();
    this.flush();
  }

  // One write at a time; coalesce bursts.
  async flush() {
    if (!this.ref) return;
    if (this.writing) { this.dirty = true; return; }
    this.writing = (async () => {
      do {
        this.dirty = false;
        try { await this.ref.set(JSON.parse(JSON.stringify(this.data))); this.status = 'synced'; } catch { this.status = 'local'; }
      } while (this.dirty);
    })();
    await this.writing;
    this.writing = null;
  }

  markPlayed(minutes) {
    const d = this.data;
    const t = today();
    d.days[t] = (d.days[t] || 0) + minutes;
    if (d.streak.last !== t) {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      d.streak.count = d.streak.last === today(y) ? d.streak.count + 1 : 1;
      d.streak.last = t;
    }
  }

  streak() {
    const d = this.data;
    if (!d?.streak.last) return 0;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return d.streak.last === today() || d.streak.last === today(y) ? d.streak.count : 0;
  }
}
