// Runs one level: builds its world, wires `submit`, and evaluates objectives through a query API.
import { createWorld, createShell, createRemote, PLAYER } from './setup.js';
import { normPath, joinPath } from './vfs.js';
import { pick, shuffle } from './util.js';

// Short flags (-la → l, a) and long flags (--all) used in a command.
export function flagsOf(argv) {
  const set = new Set();
  for (const a of argv.slice(1)) {
    if (a === '--') break;
    if (/^--[\w-]+/.test(a)) set.add(a.replace(/=.*$/, ''));
    else if (/^-[A-Za-z0-9]/.test(a)) for (const ch of a.slice(1).match(/^[A-Za-z0-9]+/)[0]) set.add(ch);
  }
  return set;
}

export function positional(argv) {
  return argv.slice(1).filter((a) => a === '-' || !a.startsWith('-'));
}

export function makeQuery(run) {
  const { sh, world, state } = run;
  const records = () => sh.log.slice(run.logStart);
  const home = () => sh.getVar(sh.sessions[0], 'HOME') || `/home/${PLAYER}`;
  const abs = (p, cwd = sh.s.cwd) => normPath(joinPath(cwd, p.replace(/^~(?=\/|$)/, home())));
  const machine = (host) => (host ? world.machine(host) : sh.s.machine);
  const matchText = (text, pat) => (pat instanceof RegExp ? pat.test(text) : text.includes(pat));
  const q = {
    sh, world, state, run,
    records,
    // Every simple command the player ran (including inside pipelines and via sudo/xargs/find).
    cmds() {
      return records().flatMap((r) => r.cmds.map((c) => ({ ...c, line: r.line, out: r.out, lineStatus: r.status })));
    },
    ran(name, opts = {}) {
      const names = Array.isArray(name) ? name : [name];
      return q.cmds().some((c) => {
        if (!names.includes(c.name)) return false;
        if (!opts.any && c.depth > 0 && !c.via) return false;
        if (opts.ok !== false && c.status !== 0 && !opts.anyStatus) return false;
        const f = flagsOf(c.argv);
        if (opts.flags && ![...opts.flags].every((ch) => f.has(ch) || (opts.long && opts.long[ch] && f.has(opts.long[ch])))) return false;
        if (opts.noFlags && [...opts.noFlags].some((ch) => f.has(ch))) return false;
        const pos = positional(c.argv);
        if (opts.arg !== undefined) {
          const want = Array.isArray(opts.arg) ? opts.arg : [opts.arg];
          if (!want.every((w) => pos.some((p) => p === w || abs(p, c.cwd) === abs(w, c.cwd) || abs(p, c.cwd) === normPath(w)))) return false;
        }
        if (opts.argMatch && !pos.some((p) => opts.argMatch.test(p))) return false;
        if (opts.argv && !opts.argv(c.argv)) return false;
        if (opts.noArgs && pos.length) return false;
        if (opts.piped && !c.piped) return false;
        if (opts.pipedInto && !(c.piped && c.stage > 0)) return false;
        if (opts.user && c.user !== opts.user) return false;
        if (opts.host && c.host !== opts.host) return false;
        if (opts.via && c.via !== opts.via) return false;
        if (opts.redirect && !c.redirs.some((r) => r.op === opts.redirect || (opts.redirect === '2>' && r.fd === 2))) return false;
        if (opts.output && !matchText(c.out, opts.output)) return false;
        return true;
      });
    },
    count(name) { return q.cmds().filter((c) => c.name === name && c.depth === 0).length; },
    line(pat) { return records().some((r) => matchText(r.line, pat)); },
    output(pat) { return records().some((r) => matchText(r.out, pat)); },
    lastOutput() { const r = records(); return r.length ? r[r.length - 1].out : ''; },
    pipeline(...names) {
      return records().some((r) => r.pipelines.some((p) => {
        const got = p.map((s) => s.cmd.split(' ')[0].split('/').pop());
        return names.every((n) => got.includes(n));
      }));
    },
    cwd() { return sh.s.cwd; },
    cwdIs(p) { return sh.s.cwd === abs(p, '/'); },
    visited(p) { const t = abs(p, '/'); return records().some((r) => r.cwdAfter === t || r.cwdBefore === t) || sh.s.cwd === t; },
    user() { return sh.s.user; },
    euid() { return sh.cred(sh.s).uid; },
    host() { return sh.s.machine.hostname; },
    node(p, host) { return machine(host).fs.tryGet(abs(p, '/'), { follow: false }); },
    exists(p, host) { return !!q.node(p, host); },
    isDir(p, host) { return q.node(p, host)?.type === 'dir'; },
    isFile(p, host) { return q.node(p, host)?.type === 'file'; },
    isLink(p, host) { return q.node(p, host)?.type === 'link'; },
    read(p, host) { const n = machine(host).fs.tryGet(abs(p, '/')); return n && n.type === 'file' ? n.content : null; },
    mode(p, host) { const n = q.node(p, host); return n ? n.mode & 0o7777 : null; },
    owner(p, host) { const n = q.node(p, host); return n ? machine(host).uidName(n.uid) : null; },
    group(p, host) { const n = q.node(p, host); return n ? machine(host).gidName(n.gid) : null; },
    list(p, host) { const n = machine(host).fs.tryGet(abs(p, '/')); return n && n.type === 'dir' ? [...n.children.keys()] : []; },
    submitted() { return !!state.solved; },
    // true once flag number i (in the order setup created them) was accepted
    got(i) { return state.accepted.has(state.flags[i]); },
    // any command matching a predicate over the command record
    any(pred) { return q.cmds().some((c) => (c.depth === 0 || c.via) && pred(c)); },
    env(name) { return sh.getVar(sh.s, name); },
    alias(name) { return sh.s.aliases.get(name) ?? null; },
    proc(test, host) { return machine(host).procs.find((p) => (typeof test === 'function' ? test(p) : p.cmd.includes(test))) || null; },
    jobs() { return sh.jobs; },
    history() { return sh.history.slice(run.historyStart); },
    crontab(user, host) { return machine(host).crontabs.get(user) ?? null; },
  };
  return q;
}

export class LevelRun {
  constructor(level, { term, docs, seed = Math.floor(Math.random() * 2 ** 31), clock } = {}) {
    this.level = level;
    this.world = createWorld({ seed, clock });
    this.m = this.world.machine('quest');
    this.state = { hearts: 3, solved: false, wrong: 0, flags: [], accepted: new Set() };
    const w = {
      world: this.world, m: this.m, state: this.state,
      token: (n = 32) => this.world.token(n),
      rand: () => this.world.rand(),
      pick: (arr) => pick(this.world.rand, arr),
      shuffle: (arr) => shuffle(this.world.rand, arr),
      remote: (opts) => createRemote(this.world, opts),
      flag: (n = 32) => { const f = this.world.token(n); this.state.flags.push(f); return f; },
      now: () => this.world.now(),
      daysAgo: (d) => this.world.now() - d * 86400000,
    };
    level.setup?.(w);
    const start = level.start || {};
    const machine = start.host ? this.world.machine(start.host) : this.m;
    this.sh = createShell(this.world, { term, docs, machine, user: start.user || PLAYER });
    if (start.cwd) this.sh.s.cwd = start.cwd;
    for (const [k, v] of Object.entries(start.env || {})) this.sh.setVar(this.sh.s, k, v, true);
    this.world.hooks = { submit: (flag) => this.submit(flag) };
    this.logStart = this.sh.log.length;
    this.historyStart = 0;
    this.q = makeQuery(this);
    this.done = level.objectives.map(() => false);
  }

  submit(flag) {
    const s = this.state;
    const f = flag.trim();
    if (s.flags.includes(f)) {
      if (s.accepted.has(f)) return { ok: true, message: 'Already accepted. Your quest log is updated.' };
      s.accepted.add(f);
      s.solved = true;
      const n = s.flags.length;
      return { ok: true, message: n > 1 ? `Flag accepted! (${s.accepted.size}/${n})` : 'Flag accepted!' };
    }
    s.wrong++;
    if (this.level.boss) {
      s.hearts = Math.max(0, s.hearts - 1);
      return { ok: false, message: s.hearts ? `Wrong flag. The ${this.level.boss.name} strikes back: ${s.hearts} heart${s.hearts === 1 ? '' : 's'} left.` : `Wrong flag. You have no hearts left. The ${this.level.boss.name} resets the arena.` };
    }
    return { ok: false, message: 'That is not the flag. Check you copied all of it, with no extra spaces.' };
  }

  check() {
    const newly = [];
    this.level.objectives.forEach((o, i) => {
      if (this.done[i]) return;
      let ok = false;
      try { ok = !!o.check(this.q); } catch { ok = false; }
      if (ok) { this.done[i] = true; newly.push(i); }
    });
    return { newly, complete: this.done.every(Boolean), failed: this.state.hearts <= 0 };
  }
}

// Expand a level's solution into concrete steps for this run: [{ cmd, answers }].
export function solutionSteps(level, run) {
  const raw = typeof level.solution === 'function' ? level.solution(run.state, run) : level.solution || [];
  return raw.map((s) => (typeof s === 'string' ? { cmd: s, answers: [] } : { answers: [], ...s }));
}
