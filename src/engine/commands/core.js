// Shell builtins and job control.
import { ExitSignal, InterruptSignal, BreakSignal, ContinueSignal, StdinBuf, parseDuration } from '../shell.js';
import { FsError, can, normPath, joinPath } from '../vfs.js';
import { escapes, getopts } from './_util.js';

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', '{', '}', '!']);

function sprintf(fmt, args) {
  let ai = 0;
  let out = '';
  const take = () => (ai < args.length ? args[ai++] : undefined);
  do {
    out += fmt.replace(/%([-+ 0#]*)(\d+|\*)?(?:\.(\d+|\*))?([sdiouxXfeEgGcb%])/g, (m, flags, width, prec, conv) => {
      if (conv === '%') return '%';
      if (width === '*') width = take();
      if (prec === '*') prec = take();
      let v = take();
      let s;
      switch (conv) {
        case 's': s = v ?? ''; if (prec !== undefined) s = s.slice(0, Number(prec)); break;
        case 'b': s = escapes(v ?? ''); break;
        case 'c': s = (v ?? '').charAt(0); break;
        case 'd': case 'i': { const n = parseInt(v ?? '0', 10); s = String(Number.isNaN(n) ? 0 : n); if (flags.includes('+') && n >= 0) s = '+' + s; break; }
        case 'u': s = String(Math.abs(parseInt(v ?? '0', 10)) || 0); break;
        case 'o': s = (parseInt(v ?? '0', 10) || 0).toString(8); break;
        case 'x': s = (parseInt(v ?? '0', 10) || 0).toString(16); break;
        case 'X': s = (parseInt(v ?? '0', 10) || 0).toString(16).toUpperCase(); break;
        case 'f': case 'F': s = (parseFloat(v ?? '0') || 0).toFixed(prec !== undefined ? Number(prec) : 6); break;
        case 'e': case 'E': s = (parseFloat(v ?? '0') || 0).toExponential(prec !== undefined ? Number(prec) : 6); break;
        default: s = String(parseFloat(v ?? '0') || 0);
      }
      if (width !== undefined) {
        const w = Number(width);
        if (flags.includes('-')) s = s.padEnd(w);
        else s = s.padStart(w, flags.includes('0') && /[dioxXfeE]/.test(conv) ? '0' : ' ');
      }
      return s;
    });
  } while (ai > 0 && ai < args.length);
  return out;
}

function testExpr(ctx, args) {
  const fs = ctx.fs;
  const st = (p, follow = true) => fs.tryGet(p, { ...ctx.fsCtx, follow });
  const int = (v) => {
    if (!/^\s*-?\d+\s*$/.test(v)) throw new Error(`${v}: integer expression expected`);
    return parseInt(v, 10);
  };
  const unary = {
    '-e': (p) => !!st(p), '-f': (p) => st(p)?.type === 'file', '-d': (p) => st(p)?.type === 'dir',
    '-L': (p) => st(p, false)?.type === 'link', '-h': (p) => st(p, false)?.type === 'link',
    '-s': (p) => { const n = st(p); return !!n && n.type === 'file' && n.content.length > 0; },
    '-r': (p) => { const n = st(p); return !!n && can(n, ctx.cred, 'r'); },
    '-w': (p) => { const n = st(p); return !!n && can(n, ctx.cred, 'w'); },
    '-x': (p) => { const n = st(p); return !!n && can(n, ctx.cred, 'x'); },
    '-c': (p) => st(p)?.type === 'char', '-z': (s) => s.length === 0, '-n': (s) => s.length > 0,
  };
  const binary = {
    '=': (a, b) => a === b, '==': (a, b) => a === b, '!=': (a, b) => a !== b,
    '-eq': (a, b) => int(a) === int(b), '-ne': (a, b) => int(a) !== int(b), '-lt': (a, b) => int(a) < int(b),
    '-le': (a, b) => int(a) <= int(b), '-gt': (a, b) => int(a) > int(b), '-ge': (a, b) => int(a) >= int(b),
    '<': (a, b) => a < b, '>': (a, b) => a > b,
  };
  let i = 0;
  const primary = () => {
    if (args[i] === '!') { i++; return !primary(); }
    if (args[i] === '(') {
      i++;
      const v = orExpr();
      if (args[i] !== ')') throw new Error("missing `)'");
      i++;
      return v;
    }
    if (i + 2 < args.length + 0 && binary[args[i + 1]] && args.length - i >= 3) {
      const a = args[i];
      const op = args[i + 1];
      const b = args[i + 2];
      i += 3;
      return binary[op](a, b);
    }
    if (unary[args[i]] && i + 1 < args.length) {
      const op = args[i];
      const v = args[i + 1];
      i += 2;
      return unary[op](v);
    }
    const v = args[i++];
    return v !== undefined && v !== '';
  };
  const andExpr = () => {
    let v = primary();
    while (args[i] === '-a') { i++; const r = primary(); v = v && r; }
    return v;
  };
  function orExpr() {
    let v = andExpr();
    while (args[i] === '-o') { i++; const r = andExpr(); v = v || r; }
    return v;
  }
  if (!args.length) return false;
  const v = orExpr();
  if (i < args.length) throw new Error(`${args[i]}: unexpected operator`);
  return v;
}

async function runTest(ctx, args, label) {
  try {
    return testExpr(ctx, args) ? 0 : 1;
  } catch (e) {
    ctx.err(`bash: ${label}: ${e.message}\n`);
    return 2;
  }
}

export const commands = {
  cd: {
    builtin: true,
    fn(ctx) {
      const { frame, sh } = ctx;
      const args = ctx.args.filter((a) => !['-L', '-P', '--'].includes(a));
      if (args.length > 1) { ctx.err('bash: cd: too many arguments\n'); return 1; }
      let dest = args[0];
      let printIt = false;
      if (dest === undefined) dest = sh.getVar(frame, 'HOME') || '/';
      if (dest === '') return 0;
      if (dest === '-') { dest = frame.oldpwd; printIt = true; }
      const abs = normPath(joinPath(frame.cwd, dest));
      let r;
      try {
        r = ctx.fs.get(abs, { user: ctx.cred });
      } catch (e) {
        ctx.err(`bash: cd: ${dest}: ${e.message}\n`);
        return 1;
      }
      if (r.node.type !== 'dir') { ctx.err(`bash: cd: ${dest}: Not a directory\n`); return 1; }
      if (!can(r.node, ctx.cred, 'x')) { ctx.err(`bash: cd: ${dest}: Permission denied\n`); return 1; }
      frame.oldpwd = frame.cwd;
      frame.cwd = abs;
      sh.events.emit('cwd', frame);
      if (printIt) ctx.out(abs + '\n');
      return 0;
    },
  },
  pwd: {
    builtin: true,
    fn(ctx) {
      if (ctx.args.includes('-P')) ctx.out(ctx.fs.get(ctx.cwd, { user: ctx.cred }).path + '\n');
      else ctx.out(ctx.cwd + '\n');
      return 0;
    },
  },
  echo: {
    builtin: true,
    fn(ctx) {
      const args = ctx.args.slice();
      let newline = true;
      let esc = false;
      while (args.length && /^-[neE]+$/.test(args[0])) {
        const f = args.shift();
        if (f.includes('n')) newline = false;
        if (f.includes('e')) esc = true;
        if (f.includes('E')) esc = false;
      }
      let text = args.join(' ');
      if (esc) {
        const r = escapes(text, { stopOnC: true });
        text = r.text;
        if (r.stop) newline = false;
      }
      ctx.out(text + (newline ? '\n' : ''));
      return 0;
    },
  },
  printf: {
    builtin: true,
    fn(ctx) {
      if (!ctx.args.length) { ctx.err('printf: usage: printf format [arguments]\n'); return 2; }
      ctx.out(sprintf(escapes(ctx.args[0]), ctx.args.slice(1)));
      return 0;
    },
  },
  export: {
    builtin: true,
    fn(ctx) {
      const { frame, sh } = ctx;
      let args = ctx.args;
      let unexport = false;
      if (args[0] === '-n') { unexport = true; args = args.slice(1); }
      if (args[0] === '-p') args = args.slice(1);
      if (!args.length) {
        const names = [...frame.exported].filter((k) => frame.vars.has(k) || k === 'PWD').sort();
        for (const k of names) ctx.out(`declare -x ${k}="${sh.getVar(frame, k)}"\n`);
        return 0;
      }
      let status = 0;
      for (const a of args) {
        const m = a.match(/^([A-Za-z_]\w*)(?:=([\s\S]*))?$/);
        if (!m) { ctx.err(`bash: export: \`${a}': not a valid identifier\n`); status = 1; continue; }
        if (unexport) { frame.exported.delete(m[1]); continue; }
        if (m[2] !== undefined) sh.setVar(frame, m[1], m[2], true);
        else frame.exported.add(m[1]);
      }
      sh.events.emit('env', frame);
      return status;
    },
  },
  unset: {
    builtin: true,
    fn(ctx) {
      for (const a of ctx.args) {
        if (a.startsWith('-')) continue;
        ctx.frame.vars.delete(a);
        ctx.frame.exported.delete(a);
      }
      ctx.sh.events.emit('env', ctx.frame);
      return 0;
    },
  },
  set: {
    builtin: true,
    fn(ctx) {
      if (ctx.args.length) return 0;
      const names = [...ctx.frame.vars.keys()].sort();
      for (const k of names) ctx.out(`${k}=${ctx.frame.vars.get(k)}\n`);
      return 0;
    },
  },
  env: {
    fn(ctx) {
      const args = ctx.args.slice();
      const extra = new Map();
      while (args.length && /^[A-Za-z_]\w*=/.test(args[0])) {
        const a = args.shift();
        const i = a.indexOf('=');
        extra.set(a.slice(0, i), a.slice(i + 1));
      }
      if (!args.length) {
        const m = ctx.envList();
        for (const [k, v] of extra) m.set(k, v);
        for (const [k, v] of m) ctx.out(`${k}=${v}\n`);
        return 0;
      }
      return ctx.sh.invoke(args, { ...ctx.frame, vars: new Map([...ctx.frame.vars, ...extra]), exported: new Set([...ctx.frame.exported, ...extra.keys()]) }, ctx.io);
    },
  },
  printenv: {
    fn(ctx) {
      const m = ctx.envList();
      if (!ctx.args.length) {
        for (const [k, v] of m) ctx.out(`${k}=${v}\n`);
        return 0;
      }
      let status = 0;
      for (const a of ctx.args) {
        if (m.has(a)) ctx.out(m.get(a) + '\n');
        else status = 1;
      }
      return status;
    },
  },
  alias: {
    builtin: true,
    fn(ctx) {
      const { aliases } = ctx.frame;
      if (!ctx.args.length || ctx.args[0] === '-p') {
        for (const [k, v] of [...aliases].sort()) ctx.out(`alias ${k}='${v}'\n`);
        return 0;
      }
      let status = 0;
      for (const a of ctx.args) {
        const i = a.indexOf('=');
        if (i > 0) aliases.set(a.slice(0, i), a.slice(i + 1));
        else if (aliases.has(a)) ctx.out(`alias ${a}='${aliases.get(a)}'\n`);
        else { ctx.err(`bash: alias: ${a}: not found\n`); status = 1; }
      }
      return status;
    },
  },
  unalias: {
    builtin: true,
    fn(ctx) {
      if (ctx.args[0] === '-a') { ctx.frame.aliases.clear(); return 0; }
      let status = 0;
      for (const a of ctx.args) {
        if (!ctx.frame.aliases.delete(a)) { ctx.err(`bash: unalias: ${a}: not found\n`); status = 1; }
      }
      return status;
    },
  },
  source: {
    builtin: true,
    async fn(ctx) {
      const file = ctx.args[0];
      if (!file) { ctx.err('bash: source: filename argument required\nsource: usage: source filename [arguments]\n'); return 2; }
      let content;
      try {
        content = ctx.fs.read(file, ctx.fsCtx);
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        ctx.err(`bash: ${file}: ${e.message}\n`);
        return 1;
      }
      return ctx.sh.runSource(content, ctx.frame, ctx.io, file);
    },
  },
  '.': { builtin: true, hidden: true, fn: (ctx) => commands.source.fn(ctx) },
  exit: {
    builtin: true,
    fn(ctx) {
      const n = ctx.args[0] !== undefined ? parseInt(ctx.args[0], 10) & 255 : ctx.frame.status;
      throw new ExitSignal(Number.isNaN(n) ? 2 : n);
    },
  },
  history: {
    builtin: true,
    fn(ctx) {
      const h = ctx.sh.history;
      if (ctx.args[0] === '-c') { h.length = 0; return 0; }
      const n = ctx.args[0] ? Number(ctx.args[0]) : h.length;
      const start = Math.max(0, h.length - n);
      for (let i = start; i < h.length; i++) ctx.out(`${String(i + 1).padStart(5)}  ${h[i]}\n`);
      return 0;
    },
  },
  type: {
    builtin: true,
    fn(ctx) {
      let args = ctx.args;
      const short = args[0] === '-t';
      if (short) args = args.slice(1);
      let status = 0;
      for (const name of args) {
        if (ctx.frame.aliases.has(name)) {
          ctx.out(short ? 'alias\n' : `${name} is aliased to \`${ctx.frame.aliases.get(name)}'\n`);
        } else if (KEYWORDS.has(name)) {
          ctx.out(short ? 'keyword\n' : `${name} is a shell keyword\n`);
        } else if (ctx.sh.commands[name]?.builtin) {
          ctx.out(short ? 'builtin\n' : `${name} is a shell builtin\n`);
        } else {
          const p = ctx.sh.which(name, ctx.frame);
          if (p) ctx.out(short ? 'file\n' : `${name} is ${p}\n`);
          else { if (!short) ctx.err(`bash: type: ${name}: not found\n`); status = 1; }
        }
      }
      return status;
    },
  },
  command: {
    builtin: true,
    async fn(ctx) {
      if (ctx.args[0] === '-v' || ctx.args[0] === '-V') {
        let status = 0;
        for (const name of ctx.args.slice(1)) {
          if (ctx.sh.commands[name]?.builtin) ctx.out(name + '\n');
          else {
            const p = ctx.sh.which(name, ctx.frame);
            if (p) ctx.out(p + '\n');
            else status = 1;
          }
        }
        return status;
      }
      if (!ctx.args.length) return 0;
      return ctx.sh.invoke(ctx.args, ctx.frame, ctx.io);
    },
  },
  help: {
    builtin: true,
    fn(ctx) {
      ctx.out([
        'GNU bash, version 5.2.37(1)-release (x86_64-pc-linux-gnu) — Linux Quest edition',
        'These shell commands are defined internally. Type `man NAME` for any command.',
        '',
        '  cd [dir]              change directory        echo [arg ...]        print text',
        '  pwd                   print working directory export NAME=value     set an env variable',
        '  alias name=value      create a shortcut       history               show past commands',
        '  type name             what is this command?   source file           run file in this shell',
        '  jobs / fg / bg        manage background jobs  kill PID              send a signal',
        '  exit                  close this shell        submit FLAG           hand in a quest flag',
        '',
        'Keys: Tab completes · ↑/↓ browse history · Ctrl+C cancels · Ctrl+L clears · Ctrl+D ends input',
        '',
      ].join('\n'));
      return 0;
    },
  },
  test: { builtin: true, fn: (ctx) => runTest(ctx, ctx.args, 'test') },
  '[': {
    builtin: true,
    hidden: true,
    fn(ctx) {
      if (ctx.args[ctx.args.length - 1] !== ']') { ctx.err("bash: [: missing `]'\n"); return 2; }
      return runTest(ctx, ctx.args.slice(0, -1), '[');
    },
  },
  true: { builtin: true, fn: () => 0 },
  false: { builtin: true, fn: () => 1 },
  read: {
    builtin: true,
    async fn(ctx) {
      const { o, rest } = getopts(ctx, { flags: 'rs', args: 'p' });
      let line;
      if (ctx.stdin instanceof StdinBuf) {
        line = ctx.stdin.readLine();
        if (line === null) return 1;
      } else if (ctx.stdin !== null && ctx.stdin !== undefined) {
        return 1;
      } else {
        line = await ctx.term.prompt(o.p || '', { hidden: !!o.s });
        if (line === null) return 1;
      }
      const names = rest.length ? rest : ['REPLY'];
      const parts = line.trim().split(/[ \t]+/);
      names.forEach((n, i) => {
        const v = i === names.length - 1 ? parts.slice(i).join(' ') : parts[i] ?? '';
        ctx.sh.setVar(ctx.frame, n, v);
      });
      return 0;
    },
  },
  umask: {
    builtin: true,
    fn(ctx) {
      const f = ctx.frame;
      if (ctx.args[0] === '-S') {
        const m = ~f.umask & 0o777;
        const p = (s) => (m >> s & 4 ? 'r' : '') + (m >> s & 2 ? 'w' : '') + (m >> s & 1 ? 'x' : '');
        ctx.out(`u=${p(6)},g=${p(3)},o=${p(0)}\n`);
        return 0;
      }
      if (!ctx.args.length) { ctx.out(f.umask.toString(8).padStart(4, '0') + '\n'); return 0; }
      if (!/^[0-7]{1,4}$/.test(ctx.args[0])) { ctx.err(`bash: umask: ${ctx.args[0]}: octal number out of range\n`); return 1; }
      f.umask = parseInt(ctx.args[0], 8) & 0o777;
      return 0;
    },
  },
  clear: { fn(ctx) { if (ctx.isTTY) ctx.term.clear(); else ctx.out('\x1b[H\x1b[2J'); return 0; } },
  reset: { fn(ctx) { ctx.term.clear(); return 0; } },
  break: { builtin: true, fn(ctx) { throw new BreakSignal(Number(ctx.args[0] || 1)); } },
  continue: { builtin: true, fn(ctx) { throw new ContinueSignal(Number(ctx.args[0] || 1)); } },
  submit: {
    builtin: true,
    fn(ctx) {
      const flag = ctx.args.join(' ').trim();
      const hook = ctx.world.hooks?.submit;
      if (!flag) { ctx.err('submit: usage: submit FLAG\n'); return 2; }
      if (!hook) { ctx.out('There is no quest waiting for a flag right now.\n'); return 1; }
      const r = hook(flag, ctx);
      ctx.out((r.ok ? '\x1b[1;33m★ ' : '\x1b[1;31m✗ ') + r.message + '\x1b[0m\n');
      return r.ok ? 0 : 1;
    },
  },
  sleep: {
    async fn(ctx) {
      if (!ctx.args.length) { ctx.err("sleep: missing operand\nTry 'sleep --help' for more information.\n"); return 1; }
      const secs = ctx.args.reduce((a, s) => a + parseDuration(s), 0);
      if (Number.isNaN(secs)) { ctx.err(`sleep: invalid time interval '${ctx.args.find((s) => Number.isNaN(parseDuration(s)))}'\n`); return 1; }
      const started = ctx.world.now();
      const r = await ctx.term.sleep(secs * 1000);
      if (r === 'int') throw new InterruptSignal();
      if (r === 'stop') {
        const remaining = Math.max(0, secs * 1000 - (ctx.world.now() - started));
        const job = ctx.sh.stopForeground(ctx.argv.join(' '), remaining, ctx.frame);
        ctx.out(`\n${ctx.sh.jobLine(job, 'Stopped')}\n`);
        return 148;
      }
      return 0;
    },
  },
  jobs: {
    builtin: true,
    fn(ctx) {
      const long = ctx.args.includes('-l');
      ctx.sh.checkJobs();
      for (const j of ctx.sh.jobs) {
        const label = j.state === 'stopped' ? 'Stopped' : 'Running';
        const line = ctx.sh.jobLine(j, label);
        ctx.out((long ? line.replace(/^(\[\d+\][+ -])  /, `$1 ${j.pid} `) : line) + '\n');
      }
      return 0;
    },
  },
  fg: {
    builtin: true,
    async fn(ctx) {
      const sh = ctx.sh;
      const job = sh.findJob(ctx.args[0]);
      if (!job) { ctx.err(`bash: fg: ${ctx.args[0] || 'current'}: no such job\n`); return 1; }
      ctx.out(job.cmd + '\n');
      const remaining = job.state === 'stopped' ? job.remaining : Math.max(0, job.endAt - ctx.world.now());
      sh.jobs = sh.jobs.filter((j) => j !== job);
      const proc = job.host.proc(job.pid);
      if (proc) proc.stat = 'S+';
      ctx.world.events.emit('procs', job.host);
      const started = ctx.world.now();
      const r = await ctx.term.sleep(remaining);
      if (r === 'stop') {
        job.state = 'stopped';
        job.remaining = Math.max(0, remaining - (ctx.world.now() - started));
        if (proc) proc.stat = 'T';
        sh.jobs.push(job);
        ctx.out(`\n${sh.jobLine(job, 'Stopped')}\n`);
        return 148;
      }
      job.host.reap(job.pid);
      if (r === 'int') throw new InterruptSignal();
      return 0;
    },
  },
  bg: {
    builtin: true,
    fn(ctx) {
      const job = ctx.sh.findJob(ctx.args[0]);
      if (!job) { ctx.err(`bash: bg: ${ctx.args[0] || 'current'}: no such job\n`); return 1; }
      if (job.state !== 'stopped') { ctx.err(`bash: bg: job ${job.id} already in background\n`); return 0; }
      job.state = 'running';
      job.endAt = ctx.world.now() + job.remaining;
      const proc = job.host.proc(job.pid);
      if (proc) proc.stat = 'S';
      ctx.world.events.emit('procs', job.host);
      ctx.out(`[${job.id}]+ ${job.cmd} &\n`);
      return 0;
    },
  },
  wait: {
    builtin: true,
    async fn(ctx) {
      const running = ctx.sh.jobs.filter((j) => j.state === 'running' && j.endAt);
      if (!running.length) return 0;
      const ms = Math.max(...running.map((j) => j.endAt)) - ctx.world.now();
      const r = await ctx.term.sleep(Math.max(0, ms));
      if (r === 'int') throw new InterruptSignal();
      return 0;
    },
  },
  timeout: {
    async fn(ctx) {
      const args = ctx.args.slice();
      while (args[0]?.startsWith('-')) { const a = args.shift(); if (a === '-s' || a === '-k') args.shift(); }
      const limit = parseDuration(args.shift());
      if (Number.isNaN(limit) || !args.length) { ctx.err("timeout: missing operand\nTry 'timeout --help' for more information.\n"); return 125; }
      return ctx.run(args);
    },
  },
};
