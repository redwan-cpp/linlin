// A Machine is one Linux box: its filesystem, users, groups, processes, sudo rules and cron.
// The World holds several machines (for ssh) plus level state and a shared clock.
import { VFS, normPath } from './vfs.js';
import { Emitter, mulberry32, randToken } from './util.js';

export const BIN_MAGIC = '\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00';

export class World {
  constructor({ seed = (Date.now() ^ 0x5eed) >>> 0, clock } = {}) {
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.clock = clock || (() => Date.now());
    this.machines = new Map();
    this.state = {};
    this.events = new Emitter();
    this.cronMinute = 0;
  }

  now() { return this.clock(); }

  token(len = 32) { return randToken(this.rand, len); }

  addMachine(m) {
    this.machines.set(m.hostname, m);
    for (const alias of m.aliases) this.machines.set(alias, m);
    return m;
  }

  machine(name) { return this.machines.get(name) || null; }
}

export class Machine {
  constructor(world, { hostname = 'quest', ip = '10.0.0.5', sshPort = 22, aliases = [], banner = '', motd = '' } = {}) {
    this.world = world;
    this.hostname = hostname;
    this.ip = ip;
    this.aliases = [ip, ...aliases];
    this.sshPort = sshPort;
    this.banner = banner;
    this.motd = motd;
    this.fs = new VFS(() => world.now());
    this.users = new Map();
    this.groups = new Map();
    this.procs = [];
    this.nextPid = 1200 + Math.floor(world.rand() * 400);
    this.sudoers = [];
    this.crontabs = new Map();
    this.sudoStamp = new Map();
    this.bootTime = world.now() - (3 * 3600 + 17 * 60) * 1000;
  }

  // ---------- users & groups ----------
  addGroup(name, gid, members = []) {
    const g = this.groups.get(name) || { name, gid, members: new Set() };
    g.gid = gid;
    for (const m of members) g.members.add(m);
    this.groups.set(name, g);
    return g;
  }

  addUser(name, { uid, gid, home, shell = '/bin/bash', password = null, gecos = '', groups = [], makeHome = true } = {}) {
    if (gid === undefined) gid = uid;
    if (![...this.groups.values()].some((g) => g.gid === gid)) this.addGroup(name, gid);
    home = home ?? (uid === 0 ? '/root' : `/home/${name}`);
    const u = { name, uid, gid, home, shell, password, gecos, authorizedKeys: [] };
    this.users.set(name, u);
    for (const g of groups) {
      const grp = this.groups.get(g);
      if (grp) grp.members.add(name);
    }
    if (makeHome && !this.fs.tryGet(home)) {
      this.dir(home, { mode: uid === 0 ? 0o700 : 0o750, owner: name, group: this.groupByGid(gid).name });
    }
    this.syncEtc();
    return u;
  }

  user(name) { return this.users.get(name) || null; }
  userByUid(uid) { return [...this.users.values()].find((u) => u.uid === uid) || null; }
  groupByGid(gid) { return [...this.groups.values()].find((g) => g.gid === gid) || null; }
  uidName(uid) { const u = this.userByUid(uid); return u ? u.name : String(uid); }
  gidName(gid) { const g = this.groupByGid(gid); return g ? g.name : String(gid); }

  groupsOf(name) {
    const u = this.user(name);
    if (!u) return [];
    const out = [this.groupByGid(u.gid)].filter(Boolean);
    for (const g of this.groups.values()) if (g.members.has(name) && g.gid !== u.gid) out.push(g);
    return out;
  }

  // Permission identity used by the filesystem.
  cred(name) {
    const u = this.user(name);
    if (!u) return { name, uid: 65534, gid: 65534, gids: [65534] };
    return { name, uid: u.uid, gid: u.gid, gids: this.groupsOf(name).map((g) => g.gid) };
  }

  syncEtc() {
    if (!this.fs.tryGet('/etc')) return;
    const users = [...this.users.values()].sort((a, b) => a.uid - b.uid);
    const passwd = users.map((u) => `${u.name}:x:${u.uid}:${u.gid}:${u.gecos || u.name}:${u.home}:${u.shell}`).join('\n') + '\n';
    const groups = [...this.groups.values()].sort((a, b) => a.gid - b.gid);
    const group = groups.map((g) => `${g.name}:x:${g.gid}:${[...g.members].join(',')}`).join('\n') + '\n';
    const shadow = users.map((u) => `${u.name}:${u.password ? '$y$j9T$' + fakeHash(u.name + u.password) : '*'}:20391:0:99999:7:::`).join('\n') + '\n';
    const shadowGid = this.groups.get('shadow')?.gid ?? 42;
    this.file('/etc/passwd', passwd, { mode: 0o644 });
    this.file('/etc/group', group, { mode: 0o644 });
    this.file('/etc/shadow', shadow, { mode: 0o640, groupId: shadowGid });
  }

  // ---------- builders (ignore permissions; used by level setup) ----------
  owner(opts, fallbackUid = 0) {
    const uid = opts.owner !== undefined ? (this.user(opts.owner)?.uid ?? 0) : fallbackUid;
    let gid;
    if (opts.groupId !== undefined) gid = opts.groupId;
    else if (opts.group !== undefined) gid = this.groups.get(opts.group)?.gid ?? 0;
    else gid = opts.owner !== undefined ? (this.user(opts.owner)?.gid ?? 0) : 0;
    return { uid, gid };
  }

  // onlyNew: apply owner/mode only to folders this call creates (used for a file's parents).
  dir(path, opts = {}, onlyNew = false) {
    const parts = normPath(path).split('/').filter(Boolean);
    let cur = this.fs.root;
    for (let i = 0; i < parts.length; i++) {
      let next = cur.children.get(parts[i]);
      if (next && next.type === 'link') next = this.fs.tryGet('/' + parts.slice(0, i + 1).join('/'));
      if (!next) {
        const last = i === parts.length - 1;
        const { uid, gid } = last || onlyNew ? this.owner(opts) : { uid: 0, gid: 0 };
        next = this.fs.mkNode('dir', last ? (opts.mode ?? 0o755) : 0o755, uid, gid);
        cur.children.set(parts[i], next);
        cur.nlink++;
      } else if (i === parts.length - 1 && !onlyNew) {
        if (opts.mode !== undefined) next.mode = opts.mode;
        if (opts.owner !== undefined || opts.group !== undefined) Object.assign(next, this.owner(opts));
      }
      if (opts.mtime !== undefined && i === parts.length - 1 && !onlyNew) next.mtime = opts.mtime;
      cur = next;
    }
    return cur;
  }

  file(path, content = '', opts = {}) {
    const p = normPath(path);
    const parent = this.dir(p.slice(0, p.lastIndexOf('/')) || '/', { owner: opts.owner, group: opts.group }, true);
    const name = p.slice(p.lastIndexOf('/') + 1);
    let node = parent.children.get(name);
    const { uid, gid } = this.owner(opts);
    if (!node || node.type !== 'file') {
      node = this.fs.mkNode('file', opts.mode ?? 0o644, uid, gid, { content });
      parent.children.set(name, node);
    } else {
      node.content = content;
      if (opts.mode !== undefined) node.mode = opts.mode;
      if (opts.owner !== undefined || opts.group !== undefined || opts.groupId !== undefined) Object.assign(node, { uid, gid });
    }
    if (opts.mtime !== undefined) node.mtime = node.atime = node.ctime = opts.mtime;
    if (opts.fakeSize !== undefined) node.fakeSize = opts.fakeSize;
    return node;
  }

  link(path, target, opts = {}) {
    const p = normPath(path);
    const parent = this.dir(p.slice(0, p.lastIndexOf('/')) || '/');
    const { uid, gid } = this.owner(opts);
    const node = this.fs.mkNode('link', 0o777, uid, gid, { target });
    parent.children.set(p.slice(p.lastIndexOf('/') + 1), node);
    return node;
  }

  device(path, dev, mode = 0o666) {
    const p = normPath(path);
    const parent = this.dir(p.slice(0, p.lastIndexOf('/')) || '/');
    const node = this.fs.mkNode('char', mode, 0, 0, { dev });
    parent.children.set(p.slice(p.lastIndexOf('/') + 1), node);
    return node;
  }

  remove(path) {
    const p = normPath(path);
    const parent = this.fs.tryGet(p.slice(0, p.lastIndexOf('/')) || '/');
    if (parent) parent.children.delete(p.slice(p.lastIndexOf('/') + 1));
  }

  binary(name, { dir = '/usr/bin', mode = 0o755, owner, group, impl = name, size } = {}) {
    const body = `${BIN_MAGIC}LQBIN:${impl}\x00/lib64/ld-linux-x86-64.so.2\x00GLIBC_2.34\x00__libc_start_main\x00${impl}\x00Usage: ${impl} [OPTION]...\x00.text\x00.data\x00`;
    return this.file(`${dir}/${name}`, body, { mode, owner, group, fakeSize: size ?? 30000 + Math.floor(this.world.rand() * 120000) });
  }

  // ---------- processes ----------
  spawn(p) {
    const pid = p.pid ?? this.nextPid++;
    const proc = {
      pid, ppid: 1, user: 'root', cmd: '', tty: '?', stat: 'S', cpu: 0, mem: 0.1,
      vsz: 8000 + Math.floor(this.world.rand() * 90000), rss: 2000 + Math.floor(this.world.rand() * 20000),
      start: this.world.now(), cputime: 0, onTerm: 'die', ...p, pid,
    };
    if (proc.pid >= this.nextPid) this.nextPid = proc.pid + 1;
    this.procs.push(proc);
    this.world.events.emit('procs', this);
    return proc;
  }

  proc(pid) { return this.procs.find((p) => p.pid === pid) || null; }

  reap(pid) {
    this.procs = this.procs.filter((p) => p.pid !== pid);
    this.world.events.emit('procs', this);
  }
}

function fakeHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  const r = mulberry32(h >>> 0);
  return randToken(r, 22) + '$' + randToken(r, 43);
}
