// Virtual filesystem: directories, files, symlinks, hard links, char devices,
// Unix permissions with owners/groups, setuid/setgid/sticky bits, timestamps.
import { Emitter } from './util.js';

let INO = 1000;

export const ERR = {
  ENOENT: 'No such file or directory',
  ENOTDIR: 'Not a directory',
  EACCES: 'Permission denied',
  EISDIR: 'Is a directory',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  ELOOP: 'Too many levels of symbolic links',
  EPERM: 'Operation not permitted',
  EINVAL: 'Invalid argument',
  EBUSY: 'Device or resource busy',
};

export class FsError extends Error {
  constructor(code) {
    super(ERR[code] || code);
    this.code = code;
  }
}

// user: { uid, gids: number[] }
export function can(node, user, p) {
  const bit = p === 'r' ? 4 : p === 'w' ? 2 : 1;
  if (user.uid === 0) return p !== 'x' || node.type === 'dir' || (node.mode & 0o111) !== 0;
  let shift = 0;
  if (node.uid === user.uid) shift = 6;
  else if (user.gids.includes(node.gid)) shift = 3;
  return ((node.mode >> shift) & bit) !== 0;
}

export function nodeSize(n) {
  if (n.fakeSize !== undefined) return n.fakeSize;
  if (n.type === 'dir') return 4096;
  if (n.type === 'link') return n.target.length;
  if (n.type === 'char') return 0;
  return n.content.length;
}

export function joinPath(cwd, path) {
  if (path.startsWith('/')) return path;
  return (cwd === '/' ? '' : cwd) + '/' + path;
}

// Lexical normalisation (what the shell does for $PWD): resolves . and .. textually.
export function normPath(path) {
  const out = [];
  for (const p of path.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return '/' + out.join('/');
}

export function baseName(path) {
  const p = path.replace(/\/+$/, '');
  if (!p) return '/';
  return p.slice(p.lastIndexOf('/') + 1);
}

export function dirName(path) {
  const p = path.replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return p.slice(0, i);
}

export class VFS {
  constructor(clock) {
    this.clock = clock || (() => Date.now());
    this.events = new Emitter();
    this.root = this.mkNode('dir', 0o755, 0, 0);
  }

  mkNode(type, mode, uid, gid, extra = {}) {
    const now = this.clock();
    const n = { type, mode, uid, gid, ino: INO++, mtime: now, atime: now, ctime: now, nlink: type === 'dir' ? 2 : 1, ...extra };
    if (type === 'dir') n.children = new Map();
    if (type === 'file' && n.content === undefined) n.content = '';
    return n;
  }

  changed(op, path) { this.events.emit('change', { op, path }); }

  // Walk a path. Returns { node, parent, name, path }. node is null when only the last
  // component is missing (useful for creating). Throws FsError otherwise.
  walk(path, { cwd = '/', user = null, follow = true } = {}) {
    let rem = joinPath(cwd, path).split('/').filter(Boolean);
    const stack = [this.root];
    const names = [];
    let loops = 0;
    while (rem.length) {
      const part = rem.shift();
      const cur = stack[stack.length - 1];
      if (part === '.') continue;
      if (part === '..') {
        if (stack.length > 1) { stack.pop(); names.pop(); }
        continue;
      }
      if (cur.type !== 'dir') throw new FsError('ENOTDIR');
      if (user && !can(cur, user, 'x')) throw new FsError('EACCES');
      const child = cur.children.get(part);
      const isLast = rem.every((r) => r === '.');
      if (!child) {
        if (rem.length === 0) return { node: null, parent: cur, name: part, path: '/' + [...names, part].join('/') };
        throw new FsError('ENOENT');
      }
      if (child.type === 'link' && (!isLast || follow)) {
        if (++loops > 40) throw new FsError('ELOOP');
        if (child.target.startsWith('/')) { stack.length = 1; names.length = 0; }
        rem = child.target.split('/').filter(Boolean).concat(rem);
        continue;
      }
      stack.push(child);
      names.push(part);
      if (rem.length === 0) return { node: child, parent: cur, name: part, path: '/' + names.join('/') };
    }
    const node = stack[stack.length - 1];
    return {
      node,
      parent: stack.length > 1 ? stack[stack.length - 2] : this.root,
      name: names.length ? names[names.length - 1] : '/',
      path: '/' + names.join('/'),
    };
  }

  // Like walk but the node must exist.
  get(path, opts) {
    const r = this.walk(path, opts);
    if (!r.node) throw new FsError('ENOENT');
    return r;
  }

  tryGet(path, opts) {
    try { return this.walk(path, opts).node; } catch { return null; }
  }

  read(path, ctx) {
    const { node } = this.get(path, ctx);
    if (node.type === 'dir') throw new FsError('EISDIR');
    if (ctx.user && !can(node, ctx.user, 'r')) throw new FsError('EACCES');
    node.atime = this.clock();
    if (node.type === 'char') return node.dev === 'urandom' ? randomBytes(64) : '';
    return node.content;
  }

  write(path, data, ctx, { append = false, mode } = {}) {
    const r = this.walk(path, ctx);
    let node = r.node;
    if (node && node.type === 'dir') throw new FsError('EISDIR');
    if (node && node.type === 'char') return node;
    if (!node) {
      if (r.parent.type !== 'dir') throw new FsError('ENOTDIR');
      if (ctx.user && !can(r.parent, ctx.user, 'w')) throw new FsError('EACCES');
      const umask = ctx.umask ?? 0o022;
      // in a setgid folder, new files take the folder's group
      const gid = r.parent.mode & 0o2000 ? r.parent.gid : ctx.user ? ctx.user.gid : 0;
      node = this.mkNode('file', (mode ?? 0o666) & ~umask, ctx.user ? ctx.user.uid : 0, gid, { content: '' });
      r.parent.children.set(r.name, node);
      r.parent.mtime = this.clock();
    } else if (ctx.user && !can(node, ctx.user, 'w')) {
      throw new FsError('EACCES');
    }
    node.content = append ? node.content + data : data;
    delete node.fakeSize;
    node.mtime = node.ctime = this.clock();
    this.changed(append ? 'append' : 'write', r.path);
    return node;
  }

  mkdir(path, ctx, { parents = false, mode } = {}) {
    const umask = ctx.umask ?? 0o022;
    const make = (p) => {
      const r = this.walk(p, ctx);
      if (r.node) {
        if (parents && r.node.type === 'dir') return r.node;
        throw new FsError('EEXIST');
      }
      if (ctx.user && !can(r.parent, ctx.user, 'w')) throw new FsError('EACCES');
      const sgid = r.parent.mode & 0o2000;
      const n = this.mkNode('dir', ((mode ?? 0o777) & ~umask) | (sgid ? 0o2000 : 0), ctx.user ? ctx.user.uid : 0, sgid ? r.parent.gid : ctx.user ? ctx.user.gid : 0);
      r.parent.children.set(r.name, n);
      r.parent.nlink++;
      r.parent.mtime = this.clock();
      this.changed('mkdir', r.path);
      return n;
    };
    if (!parents) return make(path);
    const abs = normPath(joinPath(ctx.cwd || '/', path));
    const parts = abs.split('/').filter(Boolean);
    let n = this.root;
    for (let i = 1; i <= parts.length; i++) n = make('/' + parts.slice(0, i).join('/'));
    return n;
  }

  checkSticky(parent, node, user) {
    if (!user || user.uid === 0) return;
    if (parent.mode & 0o1000 && user.uid !== node.uid && user.uid !== parent.uid) throw new FsError('EPERM');
  }

  unlink(path, ctx) {
    const r = this.walk(path, { ...ctx, follow: false });
    if (!r.node) throw new FsError('ENOENT');
    if (r.node.type === 'dir') throw new FsError('EISDIR');
    if (ctx.user && !can(r.parent, ctx.user, 'w')) throw new FsError('EACCES');
    this.checkSticky(r.parent, r.node, ctx.user);
    r.parent.children.delete(r.name);
    r.node.nlink--;
    r.parent.mtime = this.clock();
    this.changed('unlink', r.path);
  }

  rmdir(path, ctx) {
    const r = this.walk(path, { ...ctx, follow: false });
    if (!r.node) throw new FsError('ENOENT');
    if (r.node.type !== 'dir') throw new FsError('ENOTDIR');
    if (r.node === this.root) throw new FsError('EBUSY');
    if (r.node.children.size) throw new FsError('ENOTEMPTY');
    if (ctx.user && !can(r.parent, ctx.user, 'w')) throw new FsError('EACCES');
    this.checkSticky(r.parent, r.node, ctx.user);
    r.parent.children.delete(r.name);
    r.parent.nlink--;
    this.changed('rmdir', r.path);
  }

  // Remove a whole tree, honouring permissions; returns list of failures.
  removeTree(path, ctx, onError) {
    const r = this.walk(path, { ...ctx, follow: false });
    if (!r.node) throw new FsError('ENOENT');
    const abs = r.path;
    const rec = (node, p) => {
      let ok = true;
      if (node.type === 'dir') {
        if (ctx.user && (!can(node, ctx.user, 'w') || !can(node, ctx.user, 'x') || !can(node, ctx.user, 'r'))) {
          if (node.children.size) { onError(p, 'EACCES'); return false; }
        }
        for (const [name, child] of [...node.children]) {
          if (!rec(child, p + '/' + name)) { ok = false; continue; }
          node.children.delete(name);
          if (child.type === 'dir') node.nlink--; else child.nlink--;
        }
      }
      return ok;
    };
    if (!rec(r.node, abs)) return false;
    if (ctx.user && !can(r.parent, ctx.user, 'w')) { onError(abs, 'EACCES'); return false; }
    try { this.checkSticky(r.parent, r.node, ctx.user); } catch (e) { onError(abs, e.code); return false; }
    r.parent.children.delete(r.name);
    if (r.node.type === 'dir') r.parent.nlink--;
    this.changed('rmtree', abs);
    return true;
  }

  rename(src, dst, ctx) {
    const s = this.walk(src, { ...ctx, follow: false });
    if (!s.node) throw new FsError('ENOENT');
    let d = this.walk(dst, ctx);
    let target = d;
    if (d.node && d.node.type === 'dir') {
      target = this.walk(baseName(s.path), { ...ctx, cwd: d.path });
    }
    if (target.node === s.node) return;
    if (ctx.user && (!can(s.parent, ctx.user, 'w') || !can(target.parent, ctx.user, 'w'))) throw new FsError('EACCES');
    this.checkSticky(s.parent, s.node, ctx.user);
    if (target.node && target.node.type === 'dir' && s.node.type !== 'dir') throw new FsError('EISDIR');
    // refuse moving a directory inside itself
    if (s.node.type === 'dir' && target.path.startsWith(s.path + '/')) throw new FsError('EINVAL');
    s.parent.children.delete(s.name);
    target.parent.children.set(target.name, s.node);
    if (s.node.type === 'dir') { s.parent.nlink--; target.parent.nlink++; }
    s.node.ctime = this.clock();
    this.changed('rename', target.path);
    return target.path;
  }

  symlink(targetText, path, ctx) {
    const r = this.walk(path, { ...ctx, follow: false });
    if (r.node) throw new FsError('EEXIST');
    if (ctx.user && !can(r.parent, ctx.user, 'w')) throw new FsError('EACCES');
    const n = this.mkNode('link', 0o777, ctx.user ? ctx.user.uid : 0, ctx.user ? ctx.user.gid : 0, { target: targetText });
    r.parent.children.set(r.name, n);
    this.changed('symlink', r.path);
    return n;
  }

  link(existing, path, ctx) {
    const s = this.get(existing, ctx);
    if (s.node.type === 'dir') throw new FsError('EPERM');
    const r = this.walk(path, { ...ctx, follow: false });
    if (r.node) throw new FsError('EEXIST');
    if (ctx.user && !can(r.parent, ctx.user, 'w')) throw new FsError('EACCES');
    r.parent.children.set(r.name, s.node);
    s.node.nlink++;
    this.changed('link', r.path);
  }

  list(node) {
    return [...node.children.entries()];
  }

  // Readlink-style absolute physical path of a node reached via path.
  realPath(path, ctx) {
    return this.get(path, ctx).path;
  }
}

function randomBytes(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(Math.floor(Math.random() * 256));
  return s;
}
