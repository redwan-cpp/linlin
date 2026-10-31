// The shell: executes parsed programs against a Machine, tracks sessions (su/ssh/sudo -i),
// jobs, history and a log of everything the player ran (used by level objectives).
import { parse, lex, IncompleteInput, ShellSyntaxError } from './parser.js';
import { expandArgs, expandOne, ExpansionError, globPaths } from './expand.js';
import { FsError, ERR, can, normPath, joinPath } from './vfs.js';
import { BIN_MAGIC } from './machine.js';
import { Emitter, stripAnsi, padR } from './util.js';

export const DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

export class ExitSignal { constructor(status) { this.status = status; } }
export class InterruptSignal {}
export class BreakSignal { constructor(n = 1) { this.n = n; } }
export class ContinueSignal { constructor(n = 1) { this.n = n; } }
export class RedirError extends Error {}
export class UsageError extends Error {
  constructor(msg, status = 1) { super(msg); this.status = status; }
}

export const headlessTerm = {
  cols: 80,
  write() {},
  async prompt() { return null; },
  async readStdin() { return ''; },
  async sleep() { return 'done'; },
  async overlay() { return null; },
  clear() {},
};

// Piped or redirected input: a cursor over text, so `read` can consume one line at a time.
export class StdinBuf {
  constructor(text) { this.text = text; this.pos = 0; }
  readAll() { const r = this.text.slice(this.pos); this.pos = this.text.length; return r; }
  readLine() {
    if (this.pos >= this.text.length) return null;
    let i = this.text.indexOf('\n', this.pos);
    if (i < 0) i = this.text.length;
    const line = this.text.slice(this.pos, i);
    this.pos = i + 1;
    return line;
  }
}

export function captureWriter() {
  const w = { isTTY: false, buf: '', write(s) { w.buf += s; } };
  return w;
}

const nullWriter = { isTTY: false, write() {} };

const DEFAULT_ALIASES = [['ll', 'ls -alF'], ['la', 'ls -A'], ['l', 'ls -CF']];

export class Shell {
  constructor(world, { machine, user = 'recruit', term = headlessTerm, commands = {}, cwd } = {}) {
    this.world = world;
    this.term = term;
    this.commands = commands;
    this.events = new Emitter();
    this.sessions = [];
    this.history = [];
    this.log = [];
    this.jobs = [];
    this.jobSeq = 1;
    this.depth = 0;
    this.current = null;
    this.pid = 4000 + Math.floor(world.rand() * 900);
    this.pushSession({ machine: machine || world.machine('quest'), user, cwd, kind: 'base', login: true });
  }

  get s() { return this.sessions[this.sessions.length - 1]; }

  // ---------- sessions & frames ----------
  makeSession({ machine, user, cwd, parent = null, login = false, euid = null, kind = 'bash' }) {
    const u = machine.user(user);
    const home = u ? u.home : '/';
    const inherit = parent && !login && parent.machine === machine;
    const vars = new Map(inherit ? [...parent.vars] : []);
    const exported = new Set(inherit ? [...parent.exported] : []);
    const set = (k, v) => { vars.set(k, v); exported.add(k); };
    if (!inherit) {
      set('PATH', DEFAULT_PATH);
      set('TERM', 'xterm-256color');
      set('LANG', 'en_US.UTF-8');
    }
    set('HOME', home);
    set('USER', user);
    set('LOGNAME', user);
    set('SHELL', u?.shell || '/bin/bash');
    vars.set('HOSTNAME', machine.hostname);
    let start = cwd ?? (login || !parent ? home : parent.cwd);
    if (!machine.fs.tryGet(start)) start = '/';
    return {
      machine, user, euid, kind, cwd: start, oldpwd: start, vars, exported,
      aliases: new Map(inherit ? [...parent.aliases] : DEFAULT_ALIASES),
      positional: [], status: 0, umask: 0o022, lastBg: '', name0: '-bash', interactive: true,
      pid: machine.nextPid++,
    };
  }

  pushSession(opts) {
    const s = this.makeSession({ ...opts, parent: this.sessions.length ? this.s : null });
    this.sessions.push(s);
    const parent = this.sessions[this.sessions.length - 2];
    s.machine.spawn({ pid: s.pid, user: s.user, cmd: '-bash', tty: 'pts/0', stat: 'Ss', ppid: parent && parent.machine === s.machine ? parent.pid : 1101 });
    this.events.emit('session', s);
    return s;
  }

  popSession() {
    if (this.sessions.length <= 1) return false;
    const s = this.sessions.pop();
    s.machine.reap(s.pid);
    this.events.emit('session', this.s);
    return s;
  }

  childFrame(frame, { positional = [], name0 = 'bash', cred = null } = {}) {
    const vars = new Map();
    for (const k of frame.exported) if (frame.vars.has(k)) vars.set(k, frame.vars.get(k));
    let user = frame.user;
    let euid = frame.euid;
    if (cred) {
      user = cred.rname ?? cred.name;
      euid = cred.uid !== cred.ruid ? cred.uid : null;
    }
    return {
      ...frame, user, euid, vars, exported: new Set(frame.exported), aliases: new Map(),
      positional, name0, interactive: false, status: 0,
    };
  }

  cloneFrame(frame) {
    return {
      ...frame, vars: new Map(frame.vars), exported: new Set(frame.exported), aliases: new Map(frame.aliases),
      positional: frame.positional.slice(), interactive: false,
    };
  }

  cred(frame) {
    const m = frame.machine;
    const real = m.cred(frame.user);
    if (frame.euid !== null && frame.euid !== undefined && frame.euid !== real.uid) {
      const eu = m.userByUid(frame.euid);
      return { ...real, name: eu ? eu.name : 'root', uid: frame.euid, ruid: real.uid, rname: real.name };
    }
    return { ...real, ruid: real.uid, rname: real.name };
  }

  // ---------- variables ----------
  getVar(frame, name) {
    switch (name) {
      case '?': return String(frame.status);
      case '$': return String(frame.pid);
      case '#': return String(frame.positional.length);
      case '@': case '*': return frame.positional.join(' ');
      case '!': return frame.lastBg;
      case '0': return frame.name0;
      case '-': return 'himBHs';
      case 'RANDOM': return String(Math.floor(this.world.rand() * 32768));
      case 'PWD': return frame.cwd;
      case 'OLDPWD': return frame.oldpwd;
      case 'UID': return String(this.cred(frame).ruid);
      case 'EUID': return String(this.cred(frame).uid);
      default: break;
    }
    if (/^\d+$/.test(name)) return frame.positional[Number(name) - 1];
    return frame.vars.get(name);
  }

  setVar(frame, name, value, exportIt = false) {
    if (name === 'PWD') { frame.cwd = value; return; }
    frame.vars.set(name, value);
    if (exportIt) frame.exported.add(name);
    this.events.emit('env', frame);
  }

  envFor(frame) {
    return {
      get: (name) => this.getVar(frame, name),
      set: (name, v) => this.setVar(frame, name, v),
      positional: () => frame.positional,
      home: (user) => {
        if (!user) return this.getVar(frame, 'HOME') ?? '/';
        const u = frame.machine.user(user);
        return u ? u.home : null;
      },
      sub: (src) => this.captureSubshell(src, frame),
      glob: (pat) => this.glob(pat, frame),
    };
  }

  glob(pat, frame) {
    const fs = frame.machine.fs;
    const user = this.cred(frame);
    return globPaths(pat, {
      cwd: frame.cwd,
      list: (abs) => {
        const n = fs.tryGet(abs, { user });
        if (!n || n.type !== 'dir' || !can(n, user, 'r')) return null;
        return [...n.children.keys()];
      },
      isDir: (abs) => {
        const n = fs.tryGet(abs, { user });
        return !!n && n.type === 'dir';
      },
      exists: (abs) => !!fs.tryGet(abs, { user, follow: false }),
    });
  }

  // ---------- top level ----------
  termWriter(stream, rec) {
    return {
      isTTY: true,
      write: (s) => {
        if (rec) rec.out += stripAnsi(s);
        this.term.write(s, stream);
      },
    };
  }

  async run(line, { record = true } = {}) {
    let src = line;
    if (src.includes('!')) {
      const r = this.historyExpand(src);
      if (r.error) {
        this.term.write(`bash: ${r.error}\n`, 'err');
        this.s.status = 1;
        return { status: 1 };
      }
      if (r.changed) {
        src = r.line;
        this.term.write(src + '\n', 'echo');
      }
    }
    let ast;
    try {
      ast = parse(src);
    } catch (e) {
      if (e instanceof IncompleteInput) return { incomplete: true };
      if (e instanceof ShellSyntaxError) {
        this.term.write(`bash: ${e.message}\n`, 'err');
        if (src.trim()) this.history.push(src);
        if (record) this.log.push({ line: src, cmds: [], status: 2, out: e.message, time: this.world.now() });
        this.s.status = 2;
        return { status: 2 };
      }
      throw e;
    }
    if (src.trim()) this.history.push(src);
    const frame = this.s;
    const rec = {
      line: src, cmds: [], pipelines: [], status: 0, out: '', time: this.world.now(),
      cwdBefore: frame.cwd, user: frame.user, host: frame.machine.hostname,
    };
    this.current = rec;
    const io = { stdin: null, stdout: this.termWriter('out', rec), stderr: this.termWriter('err', rec) };
    let status = 0;
    try {
      status = await this.execList(ast, frame, io);
    } catch (e) {
      if (e instanceof ExitSignal) status = this.handleExit(e.status, io);
      else if (e instanceof InterruptSignal) status = 130;
      else if (e instanceof BreakSignal || e instanceof ContinueSignal) status = 0;
      else throw e;
    }
    frame.status = status;
    this.current = null;
    rec.status = status;
    rec.cwdAfter = this.s.cwd;
    rec.userAfter = this.s.user;
    rec.hostAfter = this.s.machine.hostname;
    if (record) this.log.push(rec);
    this.checkJobs();
    this.events.emit('line', rec);
    return { status };
  }

  handleExit(status, io) {
    const s = this.s;
    if (this.sessions.length > 1) {
      this.popSession();
      if (s.kind === 'ssh') io.stdout.write(`logout\nConnection to ${s.machine.hostname} closed.\n`);
      else if (s.kind !== 'bash') io.stdout.write('logout\n');
      else io.stdout.write('exit\n');
      return status;
    }
    io.stdout.write('logout\n');
    io.stderr.write('(The realm keeps you here. exit only closes shells you opened with su, ssh, sudo -i or bash.)\n');
    return 0;
  }

  // ---------- execution ----------
  async execList(list, frame, io) {
    let status = frame.status;
    for (const item of list.items) {
      status = item.async ? await this.execAsync(item.node, frame, io) : await this.execAndOr(item.node, frame, io);
      frame.status = status;
    }
    return status;
  }

  async execAndOr(node, frame, io) {
    let status = await this.execPipeline(node.first, frame, io);
    frame.status = status;
    for (const { op, node: p } of node.rest) {
      if ((op === '&&' && status !== 0) || (op === '||' && status === 0)) continue;
      status = await this.execPipeline(p, frame, io);
      frame.status = status;
    }
    return status;
  }

  async execPipeline(p, frame, io) {
    const n = p.cmds.length;
    let input = io.stdin;
    let status = 0;
    const stages = [];
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const sink = last ? io.stdout : captureWriter();
      const stage = { cmd: '', out: '' };
      const tracked = {
        isTTY: sink.isTTY,
        write: (s) => {
          if (stage.out.length < 4000) stage.out += s;
          sink.write(s);
        },
      };
      const cio = { stdin: i === 0 ? io.stdin : input, stdout: tracked, stderr: io.stderr, piped: n > 1, stageIndex: i, stageCount: n };
      status = await this.execCommand(p.cmds[i], frame, cio, stage);
      if (!last) input = new StdinBuf(sink.buf);
      stages.push(stage);
    }
    if (n > 1 && this.current && this.depth === 0) {
      const pipe = stages.map((s) => ({ cmd: s.cmd, out: stripAnsi(s.out) }));
      this.current.pipelines.push(pipe);
      this.events.emit('pipeline', pipe);
    }
    return p.negate ? (status ? 0 : 1) : status;
  }

  async execCommand(node, frame, io, stage) {
    if (node.type === 'simple') return this.execSimple(node, frame, io, stage);
    let cio;
    try {
      cio = await this.applyRedirs(node.redirs || [], frame, io);
    } catch (e) {
      if (e instanceof RedirError) { io.stderr.write(e.message + '\n'); return 1; }
      throw e;
    }
    if (stage) stage.cmd = node.type;
    switch (node.type) {
      case 'subshell': {
        const child = this.cloneFrame(frame);
        try { return await this.execList(node.body, child, cio); } catch (e) {
          if (e instanceof ExitSignal) return e.status;
          throw e;
        }
      }
      case 'group': return this.execList(node.body, frame, cio);
      case 'if': {
        for (const cl of node.clauses) {
          if ((await this.execList(cl.cond, frame, cio)) === 0) return this.execList(cl.body, frame, cio);
        }
        return node.else ? this.execList(node.else, frame, cio) : 0;
      }
      case 'for': {
        const items = node.words ? await expandArgs(node.words, this.envFor(frame)) : frame.positional.slice();
        let status = 0;
        for (const it of items) {
          this.setVar(frame, node.name, it);
          try {
            status = await this.execList(node.body, frame, cio);
          } catch (e) {
            if (e instanceof BreakSignal) { if (--e.n > 0) throw e; break; }
            if (e instanceof ContinueSignal) { if (--e.n > 0) throw e; continue; }
            throw e;
          }
        }
        return status;
      }
      case 'while': {
        let status = 0;
        for (let guard = 0; ; guard++) {
          if (guard >= 10000) {
            cio.stderr.write('bash: loop stopped after 10000 rounds (the realm protects you from infinite loops)\n');
            return 1;
          }
          const c = await this.execList(node.cond, frame, cio);
          if (node.until ? c === 0 : c !== 0) break;
          try {
            status = await this.execList(node.body, frame, cio);
          } catch (e) {
            if (e instanceof BreakSignal) { if (--e.n > 0) throw e; break; }
            if (e instanceof ContinueSignal) { if (--e.n > 0) throw e; continue; }
            throw e;
          }
        }
        return status;
      }
      default: return 0;
    }
  }

  expandAliases(words, frame) {
    let out = words;
    const seen = new Set();
    for (let i = 0; i < 10; i++) {
      const w = out[0];
      const name = w && w.parts.length === 1 && w.parts[0].k === 'lit' && w.parts[0].q === 0 ? w.parts[0].v : null;
      if (!name || seen.has(name) || !frame.aliases.has(name)) break;
      seen.add(name);
      const toks = lex(frame.aliases.get(name)).filter((t) => t.t === 'word');
      out = [...toks, ...out.slice(1)];
    }
    return out;
  }

  async execSimple(node, frame, io, stage) {
    const env = this.envFor(frame);
    const words = frame.interactive && node.words.length ? this.expandAliases(node.words, frame) : node.words;
    let argv;
    const assigns = [];
    try {
      argv = await expandArgs(words, env);
      for (const a of node.assigns) {
        const prev = a.append ? this.getVar(frame, a.name) ?? '' : '';
        assigns.push([a.name, prev + (await expandOne(a.value, env))]);
      }
    } catch (e) {
      if (e instanceof ExpansionError) { io.stderr.write(`bash: ${e.message}\n`); return 1; }
      throw e;
    }
    let cio;
    try {
      cio = await this.applyRedirs(node.redirs, frame, io);
    } catch (e) {
      if (e instanceof RedirError) { io.stderr.write(e.message + '\n'); return 1; }
      throw e;
    }
    if (!argv.length) {
      for (const [k, v] of assigns) this.setVar(frame, k, v);
      return 0;
    }
    if (stage) stage.cmd = argv.join(' ');
    const rec = this.record(argv, frame, io, node.redirs);
    const status = await this.invoke(argv, frame, cio, { tmpEnv: assigns.length ? new Map(assigns) : null });
    if (rec) rec.status = status;
    return status;
  }

  record(argv, frame, io, redirs = [], via = null) {
    if (!this.current) return null;
    const rec = {
      name: argv[0].includes('/') ? argv[0].slice(argv[0].lastIndexOf('/') + 1) : argv[0],
      argv, depth: this.depth, via, status: 0,
      piped: !!io.piped, stage: io.stageIndex ?? 0, stages: io.stageCount ?? 1,
      redirs: redirs.map((r) => ({ op: r.op, fd: r.fd, target: r.target.raw })),
      user: frame.user, host: frame.machine.hostname, cwd: frame.cwd,
    };
    this.current.cmds.push(rec);
    return rec;
  }

  async applyRedirs(redirs, frame, io) {
    if (!redirs.length) return io;
    const env = this.envFor(frame);
    const fds = { 0: io.stdin, 1: io.stdout, 2: io.stderr };
    for (const r of redirs) {
      const target = await expandOne(r.target, env);
      if (!target && r.op !== '<<<') throw new RedirError(`bash: ${r.target.raw}: ambiguous redirect`);
      const fd = r.fd ?? (r.op === '<' || r.op === '<&' || r.op === '<<<' ? 0 : 1);
      if (r.op === '>&' || r.op === '<&') {
        if (/^\d+$/.test(target)) {
          const src = Number(target);
          if (!(src in fds)) throw new RedirError(`bash: ${target}: Bad file descriptor`);
          fds[fd] = fds[src];
          continue;
        }
        if (target === '-') { fds[fd] = fd === 0 ? new StdinBuf('') : nullWriter; continue; }
        const w = this.fileWriter(target, frame, false);
        fds[1] = w;
        fds[2] = w;
        continue;
      }
      if (r.op === '<') { fds[0] = new StdinBuf(this.readForRedirect(target, frame)); continue; }
      if (r.op === '<<<') { fds[0] = new StdinBuf(target + '\n'); continue; }
      if (r.op === '&>' || r.op === '&>>') {
        const w = this.fileWriter(target, frame, r.op === '&>>');
        fds[1] = w;
        fds[2] = w;
        continue;
      }
      fds[fd] = this.fileWriter(target, frame, r.op === '>>');
    }
    return { ...io, stdin: fds[0], stdout: fds[1], stderr: fds[2] };
  }

  fileWriter(path, frame, append) {
    const fs = frame.machine.fs;
    const ctx = { cwd: frame.cwd, user: this.cred(frame), umask: frame.umask };
    let node;
    try {
      node = fs.write(path, '', ctx, { append: true });
      if (!append && node.type === 'file') {
        node.content = '';
        fs.changed('write', path);
      }
    } catch (e) {
      if (e instanceof FsError) throw new RedirError(`bash: ${path}: ${e.message}`);
      throw e;
    }
    return {
      isTTY: false,
      write: (s) => {
        if (node.type !== 'file') return;
        node.content += s;
        node.mtime = node.ctime = this.world.now();
        fs.changed('append', path);
      },
    };
  }

  readForRedirect(path, frame) {
    try {
      return frame.machine.fs.read(path, { cwd: frame.cwd, user: this.cred(frame) });
    } catch (e) {
      if (e instanceof FsError) throw new RedirError(`bash: ${path}: ${e.message}`);
      throw e;
    }
  }

  which(name, frame) {
    const PATH = this.getVar(frame, 'PATH') ?? '';
    const c = this.cred(frame);
    for (const dir of PATH.split(':')) {
      const p = normPath(joinPath(frame.cwd, (dir || '.') + '/' + name));
      const n = frame.machine.fs.tryGet(p, { user: c });
      if (n && n.type === 'file' && can(n, c, 'x')) return p;
    }
    return null;
  }

  async invoke(argv, frame, io, { tmpEnv = null, cred = null, via = null } = {}) {
    const name = argv[0];
    if (via) this.record(argv, frame, io, [], via);
    const impl = this.commands[name];
    if (!name.includes('/') && impl && impl.builtin) {
      return this.callImpl(impl, name, argv, frame, io, { tmpEnv, cred });
    }
    let path;
    if (name.includes('/')) path = normPath(joinPath(frame.cwd, name));
    else {
      path = this.which(name, frame);
      if (!path) {
        const hint = this.suggest(name);
        io.stderr.write(`${name}: command not found${hint ? `\n  (did you mean: ${hint}?)` : ''}\n`);
        return 127;
      }
    }
    return this.execPath(path, argv, frame, io, { tmpEnv, cred, display: name });
  }

  suggest(name) {
    let best = null;
    let bestD = 3;
    for (const c of Object.keys(this.commands)) {
      if (this.commands[c].hidden) continue;
      const d = editDistance(name, c);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best && bestD <= (name.length > 3 ? 2 : 1) ? best : null;
  }

  async execPath(path, argv, frame, io, { tmpEnv, cred, display }) {
    const fs = frame.machine.fs;
    const c = cred || this.cred(frame);
    let r;
    try {
      r = fs.get(path, { user: c });
    } catch (e) {
      io.stderr.write(`bash: ${display}: ${ERR[e.code] || e.message}\n`);
      return e.code === 'ENOENT' ? 127 : 126;
    }
    const node = r.node;
    if (node.type === 'dir') { io.stderr.write(`bash: ${display}: Is a directory\n`); return 126; }
    if (!can(node, c, 'x')) { io.stderr.write(`bash: ${display}: Permission denied\n`); return 126; }
    const content = node.content || '';
    if (content.startsWith(BIN_MAGIC)) {
      const m = content.match(/LQBIN:([^\x00]+)/);
      const impl = m && this.commands[m[1]];
      if (!impl) { io.stderr.write(`bash: ${display}: cannot execute binary file: Exec format error\n`); return 126; }
      let runCred = c;
      if (node.mode & 0o4000 && node.uid !== c.uid) {
        const owner = frame.machine.uidName(node.uid);
        runCred = { ...c, name: owner, uid: node.uid, ruid: c.ruid, rname: c.rname, suid: true };
      }
      return this.callImpl(impl, m[1], argv, frame, io, { tmpEnv, cred: runCred, path: r.path });
    }
    if (!can(node, c, 'r')) { io.stderr.write(`/bin/bash: ${display}: Permission denied\n`); return 126; }
    return this.runScript(content, argv, frame, io, { path: display, cred: c, tmpEnv });
  }

  makeCtx(name, argv, frame, io, { tmpEnv = null, cred = null, path = null } = {}) {
    const sh = this;
    const c = cred || this.cred(frame);
    return {
      sh, name, argv, args: argv.slice(1), path,
      world: this.world, frame, machine: frame.machine, fs: frame.machine.fs,
      cred: c, cwd: frame.cwd, fsCtx: { cwd: frame.cwd, user: c, umask: frame.umask },
      stdin: io.stdin, isTTY: !!io.stdout.isTTY, piped: !!io.piped, io,
      cols: this.term.cols || 80, term: this.term,
      out: (s) => io.stdout.write(s),
      err: (s) => io.stderr.write(s),
      error: (msg) => io.stderr.write(`${name}: ${msg}\n`),
      env: (k) => (tmpEnv && tmpEnv.has(k) ? tmpEnv.get(k) : sh.getVar(frame, k)),
      envList() {
        const m = new Map();
        for (const k of frame.exported) if (frame.vars.has(k)) m.set(k, frame.vars.get(k));
        m.set('PWD', frame.cwd);
        if (tmpEnv) for (const [k, v] of tmpEnv) m.set(k, v);
        return m;
      },
      resolve: (p) => normPath(joinPath(frame.cwd, p)),
      async readStdin() {
        if (io.stdin instanceof StdinBuf) return io.stdin.readAll();
        if (io.stdin !== null && io.stdin !== undefined) return io.stdin;
        const r = await sh.term.readStdin();
        if (r === null) throw new InterruptSignal();
        return r;
      },
      run: (argv2, io2 = io, opts = {}) => sh.invoke(argv2, frame, io2, { cred: c, ...opts }),
    };
  }

  async callImpl(impl, name, argv, frame, io, opts = {}) {
    const ctx = this.makeCtx(name, argv, frame, io, opts);
    try {
      const st = await impl.fn(ctx);
      return typeof st === 'number' ? st : 0;
    } catch (e) {
      if (e instanceof FsError) { io.stderr.write(`${name}: ${e.message}\n`); return 1; }
      if (e instanceof UsageError) { io.stderr.write(`${name}: ${e.message}\n`); return e.status; }
      throw e;
    }
  }

  async runScript(content, argv, frame, io, { path, cred, tmpEnv }) {
    let ast;
    try {
      ast = parse(content);
    } catch (e) {
      if (e instanceof IncompleteInput) { io.stderr.write(`${path}: syntax error: unexpected end of file\n`); return 2; }
      if (e instanceof ShellSyntaxError) { io.stderr.write(`${path}: ${e.message}\n`); return 2; }
      throw e;
    }
    const child = this.childFrame(frame, { positional: argv.slice(1), name0: argv[0], cred });
    if (tmpEnv) for (const [k, v] of tmpEnv) { child.vars.set(k, v); child.exported.add(k); }
    this.depth++;
    try {
      return await this.execList(ast, child, { ...io, piped: false });
    } catch (e) {
      if (e instanceof ExitSignal) return e.status;
      throw e;
    } finally {
      this.depth--;
    }
  }

  async runSource(content, frame, io, name) {
    let ast;
    try { ast = parse(content); } catch (e) {
      io.stderr.write(`bash: ${name}: ${e instanceof IncompleteInput ? 'syntax error: unexpected end of file' : e.message}\n`);
      return 2;
    }
    const wasInteractive = frame.interactive;
    this.depth++;
    try {
      return await this.execList(ast, frame, io);
    } finally {
      this.depth--;
      frame.interactive = wasInteractive;
    }
  }

  async captureSubshell(src, frame) {
    let ast;
    try {
      ast = parse(src);
    } catch (e) {
      this.term.write(`bash: command substitution: ${e.message}\n`, 'err');
      return '';
    }
    const child = this.cloneFrame(frame);
    const buf = captureWriter();
    this.depth++;
    try {
      await this.execList(ast, child, { stdin: null, stdout: buf, stderr: this.termWriter('err', this.current) });
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    } finally {
      this.depth--;
    }
    frame.status = child.status;
    return buf.buf;
  }

  // Run a full command line non-interactively (cron, ssh host cmd, xargs-free helpers).
  async runLine(line, frame, io) {
    let ast;
    try { ast = parse(line); } catch (e) { io.stderr.write(`bash: ${e.message}\n`); return 2; }
    const child = this.cloneFrame(frame);
    this.depth++;
    try { return await this.execList(ast, child, io); } catch (e) {
      if (e instanceof ExitSignal) return e.status;
      throw e;
    } finally { this.depth--; }
  }

  // ---------- jobs ----------
  async execAsync(node, frame, io) {
    const first = node.rest.length === 0 && node.first.cmds.length === 1 && node.first.cmds[0].type === 'simple' ? node.first.cmds[0] : null;
    let argv = null;
    if (first) {
      try { argv = await expandArgs(first.words, this.envFor(frame)); } catch { argv = null; }
    }
    const cmdText = argv ? argv.join(' ') : 'job';
    const proc = frame.machine.spawn({ user: frame.user, cmd: cmdText, tty: 'pts/0', stat: 'S', ppid: frame.pid });
    const job = { id: this.jobSeq++, pid: proc.pid, cmd: cmdText, state: 'running', host: frame.machine };
    frame.lastBg = String(proc.pid);
    this.jobs.push(job);
    io.stdout.write(`[${job.id}] ${proc.pid}\n`);
    const sleepArgs = argv && (argv[0] === 'sleep' ? argv : argv[0] === 'nohup' && argv[1] === 'sleep' ? argv.slice(1) : null);
    if (sleepArgs) {
      job.endAt = this.world.now() + parseDuration(sleepArgs[1]) * 1000;
      this.events.emit('jobs', this.jobs);
      return 0;
    }
    if (first) this.record(argv || ['?'], frame, io, first.redirs, null);
    const st = await this.execAndOr(node, frame, io);
    job.state = 'done';
    job.status = st;
    frame.machine.reap(proc.pid);
    return 0;
  }

  stopForeground(cmd, remainingMs, frame) {
    const proc = frame.machine.spawn({ user: frame.user, cmd, tty: 'pts/0', stat: 'T', ppid: frame.pid });
    const job = { id: this.jobSeq++, pid: proc.pid, cmd, state: 'stopped', remaining: remainingMs, host: frame.machine };
    this.jobs.push(job);
    this.events.emit('jobs', this.jobs);
    return job;
  }

  jobLine(job, label) {
    const idx = this.jobs.indexOf(job);
    const mark = idx === this.jobs.length - 1 ? '+' : idx === this.jobs.length - 2 ? '-' : ' ';
    return `[${job.id}]${mark}  ${padR(label, 24)}${job.cmd}${label === 'Running' ? ' &' : ''}`;
  }

  checkJobs() {
    const now = this.world.now();
    const lines = [];
    for (const job of this.jobs) {
      if (job.state === 'running' && job.endAt && now >= job.endAt) {
        job.state = 'done';
        job.host.reap(job.pid);
      }
      if (job.state === 'done') lines.push(this.jobLine(job, 'Done'));
      if (job.state === 'killed') lines.push(this.jobLine(job, 'Terminated'));
    }
    if (lines.length) this.term.write(lines.join('\n') + '\n', 'out');
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.state === 'running' || j.state === 'stopped');
    if (this.jobs.length !== before) this.events.emit('jobs', this.jobs);
    if (!this.jobs.length) this.jobSeq = 1;
  }

  findJob(spec) {
    if (!spec || spec === '%' || spec === '%+' || spec === '%%') return this.jobs[this.jobs.length - 1] || null;
    if (spec === '%-') return this.jobs[this.jobs.length - 2] || null;
    const n = Number(spec.replace(/^%/, ''));
    return this.jobs.find((j) => j.id === n) || null;
  }

  // ---------- history ----------
  historyExpand(line) {
    let changed = false;
    let out = '';
    let inSingle = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "'") inSingle = !inSingle;
      if (c !== '!' || inSingle || i + 1 >= line.length || /[\s=(]/.test(line[i + 1])) { out += c; continue; }
      const rest = line.slice(i + 1);
      let m;
      let ev = null;
      let len = 0;
      if (rest[0] === '!') { ev = this.history[this.history.length - 1]; len = 1; if (!ev) return { error: '!!: event not found' }; }
      else if (rest[0] === '$') {
        const last = this.history[this.history.length - 1];
        if (!last) return { error: '!$: event not found' };
        const words = last.trim().split(/\s+/);
        ev = words[words.length - 1];
        len = 1;
      } else if ((m = rest.match(/^-?\d+/))) {
        const n = Number(m[0]);
        ev = n < 0 ? this.history[this.history.length + n] : this.history[n - 1];
        len = m[0].length;
        if (!ev) return { error: `!${m[0]}: event not found` };
      } else if ((m = rest.match(/^[A-Za-z_][\w.-]*/))) {
        ev = [...this.history].reverse().find((h) => h.startsWith(m[0]));
        len = m[0].length;
        if (!ev) return { error: `!${m[0]}: event not found` };
      } else { out += c; continue; }
      out += ev;
      i += len;
      changed = true;
    }
    return { line: out, changed };
  }

  // ---------- prompt & completion ----------
  promptInfo() {
    const s = this.s;
    const home = this.getVar(s, 'HOME');
    let path = s.cwd;
    if (home && home !== '/' && (path === home || path.startsWith(home + '/'))) path = '~' + path.slice(home.length);
    const c = this.cred(s);
    return { user: s.user, host: s.machine.hostname, path, root: c.uid === 0 };
  }

  complete(line) {
    const m = line.match(/(?:^|[\s|;&<>])((?:\\.|[^\s|;&<>])*)$/);
    const token = m ? m[1] : '';
    const before = line.slice(0, line.length - token.length);
    const isCmd = /^\s*(?:sudo\s+)?$/.test(before) || /[|;&]\s*$/.test(before);
    const raw = token.replace(/\\(.)/g, '$1');
    const frame = this.s;
    const esc = (s) => s.replace(/([ '"\\$&;|()<>*?!])/g, '\\$1');
    let options = [];
    if (isCmd && !raw.includes('/')) {
      const names = new Set([...frame.aliases.keys()]);
      for (const [k, v] of Object.entries(this.commands)) if (v.builtin && !v.hidden) names.add(k);
      const c = this.cred(frame);
      for (const dir of (this.getVar(frame, 'PATH') || '').split(':')) {
        const d = frame.machine.fs.tryGet(dir || '.', { cwd: frame.cwd, user: c });
        if (d && d.type === 'dir' && can(d, c, 'r')) for (const [n, node] of d.children) if (node.type === 'file' && node.mode & 0o111) names.add(n);
      }
      options = [...names].filter((n) => n.startsWith(raw)).sort().map((n) => ({ insert: n, label: n, dir: false }));
    } else {
      const slash = raw.lastIndexOf('/');
      const dirPart = slash >= 0 ? raw.slice(0, slash + 1) : '';
      const base = slash >= 0 ? raw.slice(slash + 1) : raw;
      let dirAbs = dirPart || '.';
      if (dirAbs.startsWith('~')) dirAbs = (this.getVar(frame, 'HOME') || '/') + dirAbs.slice(1);
      const c = this.cred(frame);
      const d = frame.machine.fs.tryGet(dirAbs, { cwd: frame.cwd, user: c });
      if (d && d.type === 'dir' && can(d, c, 'r')) {
        for (const [n, node] of d.children) {
          if (!n.startsWith(base)) continue;
          if (n.startsWith('.') && !base.startsWith('.')) continue;
          let isDir = node.type === 'dir';
          if (node.type === 'link') {
            const t = frame.machine.fs.tryGet(joinPath(dirAbs === '.' ? frame.cwd : normPath(joinPath(frame.cwd, dirAbs)), n), { user: c });
            isDir = !!t && t.type === 'dir';
          }
          options.push({ insert: dirPart + n, label: n + (isDir ? '/' : ''), dir: isDir });
        }
      }
      options.sort((a, b) => (a.label < b.label ? -1 : 1));
    }
    if (!options.length) return { token, replacement: null, options: [] };
    let common = options[0].insert;
    for (const o of options) while (!o.insert.startsWith(common)) common = common.slice(0, -1);
    if (options.length === 1) {
      const o = options[0];
      return { token, replacement: esc(o.insert) + (o.dir ? '/' : ' '), options };
    }
    return { token, replacement: common.length > raw.length ? esc(common) : null, options };
  }
}

export function parseDuration(s) {
  const m = String(s ?? '').match(/^(\d+(?:\.\d+)?)([smhd]?)$/);
  if (!m) return NaN;
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2]] || 1);
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
