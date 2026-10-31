// Identity, processes, signals, privilege (sudo/su), and interactive sub-shells.
import { normPath, joinPath, FsError } from '../vfs.js';
import { InterruptSignal, DEFAULT_PATH } from '../shell.js';
import { dateString, padL, padR } from '../util.js';
import { getopts } from './_util.js';
import { globRegex } from '../expand.js';

// The name ps/pgrep/top show: "[kworker/0:2]" → "kworker/0:2", "/usr/sbin/cron -f" → "cron", "-bash" → "bash".
export function procName(cmd) {
  const k = cmd.match(/^\[([^\]]+)\]/);
  if (k) return k[1];
  return cmd.split(' ')[0].split('/').pop().replace(/^-/, '').replace(/:$/, '');
}

const SIGNALS = ['HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'BUS', 'FPE', 'KILL', 'USR1', 'SEGV', 'USR2', 'PIPE', 'ALRM', 'TERM', 'STKFLT', 'CHLD', 'CONT', 'STOP', 'TSTP', 'TTIN', 'TTOU', 'URG', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'POLL', 'PWR', 'SYS'];

export function signalNumber(s) {
  if (s === undefined) return 15;
  const t = String(s).toUpperCase().replace(/^SIG/, '');
  if (/^\d+$/.test(t)) return Number(t) >= 1 && Number(t) <= 64 ? Number(t) : null;
  const i = SIGNALS.indexOf(t);
  return i >= 0 ? i + 1 : null;
}

// Deliver a signal. Returns null on success, or an error string.
export function deliver(ctx, machine, pid, sig) {
  const p = machine.proc(pid);
  if (!p) return 'No such process';
  const owner = machine.user(p.user);
  if (ctx.cred.uid !== 0 && (!owner || (owner.uid !== ctx.cred.uid && owner.uid !== ctx.cred.ruid))) return 'Operation not permitted';
  const sh = ctx.sh;
  const die = () => {
    machine.reap(pid);
    for (const j of sh.jobs) if (j.pid === pid && j.host === machine) j.state = 'killed';
    if (p.respawnBy && machine.proc(p.respawnBy)) {
      machine.spawn({ ...p, pid: undefined, start: ctx.world.now(), cputime: 0 });
    }
    // a parent that dies takes its watchdog role with it; children are re-parented to init
    for (const c of machine.procs) if (c.ppid === pid) c.ppid = 1;
  };
  if (pid === 1) return null;
  if (pid === ctx.frame.pid && (sig === 15 || sig === 2)) return null;
  switch (sig) {
    case 0: return null;
    case 9: die(); return null;
    case 19: case 20:
      p.stat = 'T';
      for (const j of sh.jobs) {
        if (j.pid !== pid || j.state === 'stopped') continue;
        j.remaining = j.endAt ? Math.max(0, j.endAt - ctx.world.now()) : 0;
        j.state = 'stopped';
      }
      ctx.world.events.emit('procs', machine);
      return null;
    case 18:
      p.stat = 'S';
      for (const j of sh.jobs) {
        if (j.pid !== pid || j.state !== 'stopped') continue;
        j.state = 'running';
        j.endAt = ctx.world.now() + (j.remaining || 0);
      }
      ctx.world.events.emit('procs', machine);
      return null;
    case 10: case 12: case 17: case 28: return null;
    default:
      if (p.onTerm === 'ignore') return null;
      die();
      return null;
  }
}

function cpuTime(p, nowMs) {
  const secs = Math.floor((p.cputime || 0) + (p.cpu || 0) / 100 * ((nowMs - p.start) / 1000));
  return secs;
}

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

function procRows(ctx) {
  const m = ctx.machine;
  const list = m.procs.slice();
  const self = { pid: m.nextPid, ppid: ctx.frame.pid, user: ctx.cred.name, cmd: ctx.argv.join(' '), tty: 'pts/0', stat: 'R+', cpu: 0, mem: 0.1, vsz: 11100, rss: 4600, start: ctx.world.now(), cputime: 0 };
  list.push(self);
  return list.sort((a, b) => a.pid - b.pid);
}

function topText(ctx) {
  const m = ctx.machine;
  const now = ctx.world.now();
  const up = Math.floor((now - m.bootTime) / 60000);
  const procs = m.procs.slice().sort((a, b) => (b.cpu || 0) - (a.cpu || 0));
  const load = Math.min(9.99, procs.reduce((a, p) => a + (p.cpu || 0), 0) / 100).toFixed(2);
  const total = procs.length;
  const stopped = procs.filter((p) => p.stat.startsWith('T')).length;
  const running = procs.filter((p) => (p.cpu || 0) > 20).length || 1;
  const usedCpu = Math.min(100, procs.reduce((a, p) => a + (p.cpu || 0), 0));
  let s = `top - ${dateString(now, '%H:%M:%S')} up ${Math.floor(up / 60)}:${String(up % 60).padStart(2, '0')},  1 user,  load average: ${load}, ${load}, ${(load * 0.8).toFixed(2)}\n`;
  s += `Tasks: ${padL(total, 3)} total, ${padL(running, 3)} running, ${padL(total - running - stopped, 3)} sleeping, ${padL(stopped, 3)} stopped,   0 zombie\n`;
  s += `%Cpu(s): ${padL((usedCpu * 0.8).toFixed(1), 4)} us, ${padL((usedCpu * 0.2).toFixed(1), 4)} sy,  0.0 ni, ${padL((100 - usedCpu).toFixed(1), 4)} id,  0.0 wa,  0.0 hi,  0.1 si,  0.0 st\n`;
  s += 'MiB Mem :   7936.2 total,   5123.4 free,   1456.7 used,   1356.1 buff/cache\n';
  s += 'MiB Swap:   1024.0 total,   1024.0 free,      0.0 used.   6245.8 avail Mem\n\n';
  s += '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n';
  for (const p of procs) {
    const t = cpuTime(p, now);
    const time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}.${String(p.pid % 100).padStart(2, '0')}`;
    const jitter = p.cpu ? Math.max(0, p.cpu + (Math.random() * 4 - 2)) : 0;
    s += `${padL(p.pid, 7)} ${padR(p.user.slice(0, 8), 8)}  20   0 ${padL(p.vsz, 7)} ${padL(p.rss, 6)} ${padL(Math.floor(p.rss / 3), 6)} ${p.stat[0]} ${padL(jitter.toFixed(1), 5)} ${padL((p.mem || 0).toFixed(1), 5)} ${padL(time, 9)} ${procName(p.cmd)}\n`;
  }
  return s;
}

function sudoRules(m, user) {
  const groups = m.groupsOf(user).map((g) => g.name);
  return m.sudoers.filter((r) => r.who === user || (r.who.startsWith('%') && groups.includes(r.who.slice(1))));
}

function ruleAllows(rule, path, args, runas) {
  if (rule.runas !== 'ALL' && rule.runas !== runas) return false;
  return rule.cmds.some((c) => {
    if (c === 'ALL') return true;
    const [cp, ...cargs] = c.split(' ');
    if (cp !== path) return false;
    if (!cargs.length) return true;
    return globRegex(cargs.join(' '), { slashOk: true }).test(args.join(' '));
  });
}

async function authenticate(ctx, m, user, label) {
  const u = m.user(user);
  for (let attempt = 0; attempt < 3; attempt++) {
    const pw = await ctx.term.prompt(label, { hidden: true });
    if (pw === null) throw new InterruptSignal();
    if (u && u.password !== null && pw === u.password) return true;
    if (attempt < 2) ctx.err('Sorry, try again.\n');
  }
  ctx.err('sudo: 3 incorrect password attempts\n');
  return false;
}

export const commands = {
  whoami: { fn(ctx) { ctx.out(ctx.cred.name + '\n'); return 0; } },
  id: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'ugGnr' });
      if (!r) return 0;
      const { o, rest } = r;
      const m = ctx.machine;
      let c = ctx.cred;
      if (rest[0]) {
        if (!m.user(rest[0])) { ctx.err(`id: ‘${rest[0]}’: no such user\n`); return 1; }
        c = { ...m.cred(rest[0]), ruid: m.user(rest[0]).uid };
      }
      const groups = c.gids.map((g) => [g, m.gidName(g)]);
      if (o.u) { ctx.out((o.n ? m.uidName(o.r ? c.ruid : c.uid) : String(o.r ? c.ruid : c.uid)) + '\n'); return 0; }
      if (o.g) { ctx.out((o.n ? m.gidName(c.gid) : String(c.gid)) + '\n'); return 0; }
      if (o.G) { ctx.out(groups.map(([g, n]) => (o.n ? n : g)).join(' ') + '\n'); return 0; }
      const real = c.ruid ?? c.uid;
      let s = `uid=${real}(${m.uidName(real)}) gid=${c.gid}(${m.gidName(c.gid)})`;
      if (real !== c.uid) s += ` euid=${c.uid}(${m.uidName(c.uid)})`;
      s += ` groups=${groups.map(([g, n]) => `${g}(${n})`).join(',')}\n`;
      ctx.out(s);
      return 0;
    },
  },
  groups: {
    fn(ctx) {
      const m = ctx.machine;
      if (ctx.args[0]) {
        if (!m.user(ctx.args[0])) { ctx.err(`groups: ‘${ctx.args[0]}’: no such user\n`); return 1; }
        ctx.out(`${ctx.args[0]} : ${m.groupsOf(ctx.args[0]).map((g) => g.name).join(' ')}\n`);
        return 0;
      }
      ctx.out(ctx.cred.gids.map((g) => m.gidName(g)).join(' ') + '\n');
      return 0;
    },
  },
  hostname: {
    fn(ctx) {
      if (ctx.args.includes('-I') || ctx.args.includes('-i')) ctx.out(ctx.machine.ip + ' \n');
      else ctx.out(ctx.machine.hostname + '\n');
      return 0;
    },
  },
  uname: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'asnrvmpio', long: { all: 'a' } });
      if (!r) return 0;
      const { o } = r;
      const parts = {
        s: 'Linux', n: ctx.machine.hostname, r: '6.12.38+kali-amd64', v: '#1 SMP PREEMPT_DYNAMIC Kali 6.12.38-1kali1 (2025-08-12)', m: 'x86_64', o: 'GNU/Linux',
      };
      const keys = o.a ? ['s', 'n', 'r', 'v', 'm', 'o'] : ['s', 'n', 'r', 'v', 'm', 'o'].filter((k) => o[k]);
      ctx.out((keys.length ? keys : ['s']).map((k) => parts[k]).join(' ') + '\n');
      return 0;
    },
  },
  date: {
    fn(ctx) {
      const fmt = ctx.args.find((a) => a.startsWith('+'));
      ctx.out(dateString(ctx.world.now(), fmt ? fmt.slice(1) : null) + '\n');
      return 0;
    },
  },
  uptime: {
    fn(ctx) {
      const now = ctx.world.now();
      const up = Math.floor((now - ctx.machine.bootTime) / 60000);
      const load = Math.min(9.99, ctx.machine.procs.reduce((a, p) => a + (p.cpu || 0), 0) / 100).toFixed(2);
      if (ctx.args.includes('-p')) { ctx.out(`up ${Math.floor(up / 60)} hours, ${up % 60} minutes\n`); return 0; }
      ctx.out(` ${dateString(now, '%H:%M:%S')} up ${padL(Math.floor(up / 60), 2)}:${String(up % 60).padStart(2, '0')},  1 user,  load average: ${load}, ${load}, ${(load * 0.8).toFixed(2)}\n`);
      return 0;
    },
  },
  who: {
    fn(ctx) {
      const m = ctx.machine;
      ctx.out(`${padR(ctx.sh.sessions[0].user, 8)} pts/0        ${dateString(m.bootTime + 600000, '%F %H:%M')} (10.0.0.2)\n`);
      return 0;
    },
  },
  which: {
    fn(ctx) {
      const all = ctx.args.includes('-a');
      let status = 0;
      for (const name of ctx.args.filter((a) => !a.startsWith('-'))) {
        if (name.includes('/')) {
          const n = ctx.fs.tryGet(name, ctx.fsCtx);
          if (n && n.type === 'file' && n.mode & 0o111) ctx.out(name + '\n'); else status = 1;
          continue;
        }
        const PATH = ctx.env('PATH') || '';
        let found = false;
        for (const dir of PATH.split(':')) {
          const p = normPath(joinPath(ctx.cwd, (dir || '.') + '/' + name));
          const n = ctx.fs.tryGet(p, ctx.fsCtx);
          if (n && n.type === 'file' && n.mode & 0o111) {
            ctx.out(`${(dir || '.').replace(/\/$/, '')}/${name}\n`);
            found = true;
            if (!all) break;
          }
        }
        if (!found) status = 1;
      }
      return status;
    },
  },
  ps: {
    fn(ctx) {
      const args = ctx.args;
      const bsd = args.length && !args[0].startsWith('-') && /^[auxwef]+$/.test(args[0]);
      const flags = bsd ? args[0] : args.filter((a) => a.startsWith('-')).join('').replace(/-/g, '');
      const valOf = (opt) => { const i = args.indexOf(opt); return i >= 0 ? args[i + 1] : undefined; };
      let rows = procRows(ctx);
      const now = ctx.world.now();
      const userFilter = valOf('-u') || valOf('-U');
      const pidFilter = valOf('-p');
      const fmtList = valOf('-o');
      if (userFilter) rows = rows.filter((p) => p.user === userFilter || String(ctx.machine.user(p.user)?.uid) === userFilter);
      if (pidFilter) rows = rows.filter((p) => pidFilter.split(',').map(Number).includes(p.pid));
      const time8 = (p) => { const t = cpuTime(p, now); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
      const comm = (p) => procName(p.cmd);
      if (fmtList) {
        const cols = fmtList.split(',');
        const head = { pid: '    PID', ppid: '   PPID', user: 'USER    ', comm: 'COMMAND', cmd: 'CMD', args: 'COMMAND', '%cpu': '%CPU', '%mem': '%MEM', stat: 'STAT', tty: 'TT      ' };
        const cell = (p, c) => ({ pid: padL(p.pid, 7), ppid: padL(p.ppid, 7), user: padR(p.user, 8), comm: comm(p), cmd: p.cmd, args: p.cmd, '%cpu': padL((p.cpu || 0).toFixed(1), 4), '%mem': padL((p.mem || 0).toFixed(1), 4), stat: padR(p.stat, 4), tty: padR(p.tty, 8) }[c] ?? '');
        ctx.out(cols.map((c) => head[c] ?? c.toUpperCase()).join(' ') + '\n');
        for (const p of rows) ctx.out(cols.map((c) => cell(p, c)).join(' ') + '\n');
        return 0;
      }
      if (bsd && flags.includes('u')) {
        if (!flags.includes('a') || !flags.includes('x')) rows = rows.filter((p) => p.user === ctx.cred.name && (flags.includes('x') || p.tty !== '?'));
        ctx.out('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n');
        for (const p of rows) {
          const t = cpuTime(p, now);
          ctx.out(`${padR(p.user.length > 8 ? p.user.slice(0, 7) + '+' : p.user, 8)} ${padL(p.pid, 7)} ${padL((p.cpu || 0).toFixed(1), 4)} ${padL((p.mem || 0).toFixed(1), 4)} ${padL(p.vsz, 6)} ${padL(p.rss, 5)} ${padR(p.tty, 8)} ${padR(p.stat, 4)} ${padL(hhmm(p.start), 5)} ${padL(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, 6)} ${p.cmd}\n`);
        }
        return 0;
      }
      if (flags.includes('e') || flags.includes('A') || (bsd && flags.includes('a') && flags.includes('x'))) {
        if (flags.includes('f')) {
          ctx.out('UID          PID    PPID  C STIME TTY          TIME CMD\n');
          for (const p of rows) ctx.out(`${padR(p.user.length > 8 ? p.user.slice(0, 7) + '+' : p.user, 8)} ${padL(p.pid, 7)} ${padL(p.ppid, 7)}  ${Math.min(99, Math.round(p.cpu || 0))} ${hhmm(p.start)} ${padR(p.tty, 8)} ${time8(p)} ${p.cmd}\n`);
          return 0;
        }
        ctx.out('    PID TTY          TIME CMD\n');
        for (const p of rows) ctx.out(`${padL(p.pid, 7)} ${padR(p.tty, 8)} ${time8(p)} ${comm(p)}\n`);
        return 0;
      }
      if (!userFilter && !pidFilter) rows = rows.filter((p) => p.tty === 'pts/0' && (p.user === ctx.cred.name || p.user === ctx.cred.rname));
      if (flags.includes('f')) {
        ctx.out('UID          PID    PPID  C STIME TTY          TIME CMD\n');
        for (const p of rows) ctx.out(`${padR(p.user, 8)} ${padL(p.pid, 7)} ${padL(p.ppid, 7)}  0 ${hhmm(p.start)} ${padR(p.tty, 8)} ${time8(p)} ${p.cmd}\n`);
        return 0;
      }
      ctx.out('    PID TTY          TIME CMD\n');
      for (const p of rows) ctx.out(`${padL(p.pid, 7)} ${padR(p.tty, 8)} ${time8(p)} ${comm(p)}\n`);
      return 0;
    },
  },
  top: {
    async fn(ctx) {
      const batch = ctx.args.includes('-b') || !ctx.isTTY;
      if (batch) { ctx.out(topText(ctx)); return 0; }
      await ctx.term.overlay({ type: 'top', title: 'top', render: () => topText(ctx) });
      return 0;
    },
  },
  htop: { fn: (ctx) => commands.top.fn(ctx) },
  pgrep: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'laf', args: 'u' });
      if (!r) return 0;
      const pat = r.rest[0];
      if (!pat) { ctx.err('pgrep: no matching criteria specified\nTry `pgrep --help\' for more information.\n'); return 2; }
      const re = new RegExp(pat);
      const hits = ctx.machine.procs.filter((p) => (r.o.f ? re.test(p.cmd) : re.test(procName(p.cmd))) && (!r.o.u || p.user === r.o.u));
      for (const p of hits) ctx.out(r.o.a ? `${p.pid} ${p.cmd}\n` : r.o.l ? `${p.pid} ${procName(p.cmd)}\n` : `${p.pid}\n`);
      return hits.length ? 0 : 1;
    },
  },
  pkill: { fn: (ctx) => killByName(ctx, 'pkill') },
  killall: { fn: (ctx) => killByName(ctx, 'killall') },
  kill: {
    builtin: true,
    fn(ctx) {
      const args = ctx.args.slice();
      if (args[0] === '-l' || args[0] === '-L') {
        let s = '';
        SIGNALS.forEach((n, i) => { s += `${padL(i + 1, 2)}) SIG${padR(n, 8)}${(i + 1) % 5 === 0 ? '\n' : '\t'}`; });
        ctx.out(s.trimEnd() + '\n');
        return 0;
      }
      let sig = 15;
      if (args[0] === '-s' || args[0] === '-n') { args.shift(); sig = signalNumber(args.shift()); }
      else if (args[0] && /^-/.test(args[0]) && args[0] !== '--') sig = signalNumber(args.shift().slice(1));
      if (sig === null) { ctx.err(`bash: kill: ${ctx.args[0].replace(/^-/, '')}: invalid signal specification\n`); return 1; }
      if (!args.length) { ctx.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n'); return 2; }
      let status = 0;
      for (const a of args) {
        let pid;
        if (a.startsWith('%')) {
          const job = ctx.sh.findJob(a);
          if (!job) { ctx.err(`bash: kill: ${a}: no such job\n`); status = 1; continue; }
          pid = job.pid;
        } else if (/^-?\d+$/.test(a)) pid = Number(a);
        else { ctx.err(`bash: kill: ${a}: arguments must be process or job IDs\n`); status = 1; continue; }
        const err = deliver(ctx, ctx.machine, pid, sig);
        if (err) { ctx.err(`bash: kill: (${pid}) - ${err}\n`); status = 1; }
      }
      ctx.sh.checkJobs();
      return status;
    },
  },
  nohup: {
    async fn(ctx) {
      if (!ctx.args.length) { ctx.err("nohup: missing operand\nTry 'nohup --help' for more information.\n"); return 125; }
      if (ctx.isTTY) {
        ctx.err("nohup: ignoring input and appending output to 'nohup.out'\n");
        const w = ctx.sh.fileWriter('nohup.out', ctx.frame, true);
        return ctx.run(ctx.args, { ...ctx.io, stdout: w, stdin: '' });
      }
      return ctx.run(ctx.args);
    },
  },
  bash: { fn: (ctx) => subShell(ctx) },
  sh: { fn: (ctx) => subShell(ctx) },
  sudo: {
    async fn(ctx) {
      const args = ctx.args.slice();
      let list = false;
      let login = false;
      let shell = false;
      let runas = 'root';
      while (args.length && args[0].startsWith('-')) {
        const a = args.shift();
        if (a === '--') break;
        if (a === '-l') list = true;
        else if (a === '-i') login = true;
        else if (a === '-s') shell = true;
        else if (a === '-k' || a === '-K') { ctx.machine.sudoStamp.delete(ctx.cred.rname); if (!args.length) return 0; }
        else if (a === '-u') runas = args.shift();
        else if (a.startsWith('-u')) runas = a.slice(2);
        else if (a === '-h' || a === '--help') { ctx.out('usage: sudo -h | -K | -k | -V\nusage: sudo [-u user] [-i | -s] [command [arg ...]]\nusage: sudo -l\n'); return 0; }
        else { ctx.err(`sudo: invalid option -- '${a.replace(/^-+/, '')}'\n`); return 1; }
      }
      const m = ctx.machine;
      const me = ctx.cred.rname ?? ctx.frame.user;
      const realRoot = (ctx.cred.ruid ?? ctx.cred.uid) === 0;
      if (!list && !login && !shell && !args.length) {
        ctx.err('usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-ABkNnS] [-g group] [-h host] [-p prompt] [-U user] [-u user] [command [arg ...]]\nusage: sudo [-ABbEHkNnPS] [-r role] [-t type] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R] [-T timeout] [-u user] [VAR=value] [-i | -s] [command [arg ...]]\n');
        return 1;
      }
      if (!m.user(runas)) { ctx.err(`sudo: unknown user ${runas}\nsudo: error initializing audit plugin sudoers_audit\n`); return 1; }
      const rules = realRoot ? [{ runas: 'ALL', cmds: ['ALL'], nopasswd: true }] : sudoRules(m, me);
      const stamp = m.sudoStamp.get(me);
      const fresh = stamp && ctx.world.now() - stamp < 15 * 60 * 1000;
      const needPw = !realRoot && !fresh && !(rules.length && rules.every((r) => r.nopasswd));
      if (needPw && !(await authenticate(ctx, m, me, `[sudo] password for ${me}: `))) return 1;
      if (!rules.length) { ctx.err(`${me} is not in the sudoers file.\n`); return 1; }
      if (needPw) m.sudoStamp.set(me, ctx.world.now());
      if (list) {
        ctx.out(`Matching Defaults entries for ${me} on ${m.hostname}:\n    env_reset, mail_badpass, secure_path=${DEFAULT_PATH}, use_pty\n\nUser ${me} may run the following commands on ${m.hostname}:\n`);
        for (const r of rules) ctx.out(`    (${r.runas === 'ALL' ? 'ALL : ALL' : r.runas}) ${r.nopasswd ? 'NOPASSWD: ' : ''}${r.cmds.join(', ')}\n`);
        return 0;
      }
      const target = { ...m.cred(runas), ruid: m.user(runas).uid, rname: runas };
      if (login || shell) {
        if (!rules.some((r) => ruleAllows(r, '/bin/bash', [], runas) || ruleAllows(r, '/usr/bin/bash', [], runas))) {
          ctx.err(`Sorry, user ${me} is not allowed to execute '/bin/bash' as ${runas} on ${m.hostname}.\n`);
          return 1;
        }
        ctx.sh.pushSession({ machine: m, user: runas, kind: 'sudo', login, cwd: login ? undefined : ctx.cwd });
        return 0;
      }
      const name = args[0];
      let path = name.includes('/') ? normPath(joinPath(ctx.cwd, name)) : null;
      if (!path) {
        for (const dir of DEFAULT_PATH.split(':')) {
          const p = `${dir}/${name}`;
          const n = ctx.fs.tryGet(p);
          if (n && n.type === 'file' && n.mode & 0o111) { path = p; break; }
        }
      }
      if (!path || !ctx.fs.tryGet(path)) { ctx.err(`sudo: ${name}: command not found\n`); return 1; }
      const realPath = ctx.fs.realPath(path, {});
      const allowed = rules.some((r) => ruleAllows(r, path, args.slice(1), runas) || ruleAllows(r, realPath, args.slice(1), runas));
      if (!allowed) {
        ctx.err(`Sorry, user ${me} is not allowed to execute '${[path, ...args.slice(1)].join(' ')}' as ${runas} on ${m.hostname}.\n`);
        return 1;
      }
      const frame = { ...ctx.frame, user: runas, euid: null };
      return ctx.sh.invoke([path, ...args.slice(1)], frame, ctx.io, { cred: target, via: 'sudo' });
    },
  },
  su: {
    async fn(ctx) {
      const args = ctx.args.slice();
      let login = false;
      let command = null;
      const rest = [];
      while (args.length) {
        const a = args.shift();
        if (a === '-' || a === '-l' || a === '--login') login = true;
        else if (a === '-c') command = args.shift();
        else rest.push(a);
      }
      const target = rest[0] || 'root';
      const m = ctx.machine;
      const u = m.user(target);
      if (!u) { ctx.err(`su: user ${target} does not exist or the user entry does not contain all the required fields\n`); return 1; }
      if ((ctx.cred.ruid ?? ctx.cred.uid) !== 0) {
        const pw = await ctx.term.prompt('Password: ', { hidden: true });
        if (pw === null) throw new InterruptSignal();
        if (u.password === null || pw !== u.password) {
          ctx.err('su: Authentication failure\n');
          return 1;
        }
      }
      if (command !== null) {
        const frame = { ...ctx.frame, user: target, euid: null, cwd: login ? u.home : ctx.cwd };
        return ctx.sh.runLine(command, frame, ctx.io);
      }
      ctx.sh.pushSession({ machine: m, user: target, kind: 'su', login, cwd: login ? undefined : ctx.cwd });
      return 0;
    },
  },
};

async function killByName(ctx, label) {
  const args = ctx.args.slice();
  let sig = 15;
  let user = null;
  let full = false;
  while (args.length && args[0].startsWith('-')) {
    const a = args.shift();
    if (a === '-u') user = args.shift();
    else if (a === '-f') full = true;
    else if (a === '-s' || a === '--signal') sig = signalNumber(args.shift());
    else sig = signalNumber(a.slice(1));
  }
  if (!args.length) { ctx.err(`${label}: no process name specified\n`); return 2; }
  const name = args[0];
  const m = ctx.machine;
  const matches = m.procs.filter((p) => {
    const base = procName(p.cmd);
    const ok = label === 'killall' ? base === name : full ? new RegExp(name).test(p.cmd) : new RegExp(name).test(base);
    return ok && (!user || p.user === user);
  });
  if (!matches.length) {
    if (label === 'killall') ctx.err(`${name}: no process found\n`);
    return 1;
  }
  let status = 0;
  for (const p of matches) {
    const err = deliver(ctx, m, p.pid, sig);
    if (err) { ctx.err(`${label}: killing pid ${p.pid} failed: ${err}\n`); status = 1; }
  }
  return status;
}

async function subShell(ctx) {
  const args = ctx.args.slice();
  let keepPriv = false;
  let command = null;
  while (args.length && args[0].startsWith('-')) {
    const a = args.shift();
    if (a === '-p') keepPriv = true;
    else if (a === '-c') { command = args.shift(); break; }
    else if (a === '-i' || a === '-l' || a === '--login') continue;
  }
  const c = ctx.cred;
  const dropped = c.uid !== c.ruid && !keepPriv;
  const frame = { ...ctx.sh.childFrame(ctx.frame, { name0: ctx.name }), user: c.rname ?? c.name, euid: dropped ? null : c.uid !== c.ruid ? c.uid : null };
  if (command !== null) return ctx.sh.runLine(command, frame, ctx.io);
  if (args.length) {
    try {
      const content = ctx.fs.read(args[0], ctx.fsCtx);
      return ctx.sh.runScript(content, args, frame, ctx.io, { path: args[0], cred: ctx.sh.cred(frame) });
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      ctx.err(`${ctx.name}: ${args[0]}: ${e.message}\n`);
      return 127;
    }
  }
  if (ctx.stdin !== null && ctx.stdin !== undefined) return ctx.sh.runLine(await ctx.readStdin(), frame, { ...ctx.io, stdin: '' });
  const cur = ctx.sh.current;
  if (cur && cur.spawnedShell) return 0;
  if (cur) cur.spawnedShell = true;
  ctx.sh.pushSession({ machine: ctx.machine, user: frame.user, euid: frame.euid, kind: 'bash', cwd: ctx.cwd });
  return 0;
}
