// File and directory commands, matching GNU coreutils output on a Debian/Kali system.
import { FsError, ERR, can, nodeSize, normPath, joinPath, baseName, dirName } from '../vfs.js';
import { BIN_MAGIC } from '../machine.js';
import { lsDate, lsCompare, modeString, humanSize, isoStamp, padL, padR, octal, dateString } from '../util.js';
import { getopts, q, lsQuote, readInputs } from './_util.js';

const C = {
  dir: '\x1b[01;34m', link: '\x1b[01;36m', exec: '\x1b[01;32m', suid: '\x1b[37;41m', sgid: '\x1b[30;43m',
  sticky: '\x1b[30;42m', ow: '\x1b[34;42m', arch: '\x1b[01;31m', dev: '\x1b[40;33;01m', orphan: '\x1b[40;31;01m', reset: '\x1b[0m',
};
const ARCHIVE = /\.(tar|tgz|gz|bz2|xz|zip|7z|rar|zst|deb)$/;

function colorFor(node, name, fs, linkAbs) {
  if (node.type === 'dir') {
    if (node.mode & 0o1000 && node.mode & 0o002) return C.sticky;
    if (node.mode & 0o002) return C.ow;
    return C.dir;
  }
  if (node.type === 'link') return fs.tryGet(linkAbs) ? C.link : C.orphan;
  if (node.type === 'char') return C.dev;
  if (node.mode & 0o4000) return C.suid;
  if (node.mode & 0o2000) return C.sgid;
  if (node.mode & 0o111) return C.exec;
  if (ARCHIVE.test(name)) return C.arch;
  return '';
}

function classify(node) {
  if (node.type === 'dir') return '/';
  if (node.type === 'link') return '@';
  if (node.mode & 0o111) return '*';
  return '';
}

function blocks(node) {
  if (node.type === 'link' || node.type === 'char') return 0;
  return Math.ceil(nodeSize(node) / 4096) * 4;
}

function columns(names, widths, cols) {
  const n = names.length;
  if (!n) return '';
  for (let ncol = Math.min(n, Math.floor(cols / 3) || 1); ncol >= 1; ncol--) {
    const rows = Math.ceil(n / ncol);
    const realCols = Math.ceil(n / rows);
    const colW = [];
    for (let c = 0; c < realCols; c++) {
      let w = 0;
      for (let r = 0; r < rows; r++) {
        const i = c * rows + r;
        if (i < n) w = Math.max(w, widths[i]);
      }
      colW.push(w + 2);
    }
    const total = colW.reduce((a, b) => a + b, 0) - 2;
    if (total <= cols || ncol === 1) {
      let out = '';
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < realCols; c++) {
          const i = c * rows + r;
          if (i >= n) continue;
          const last = c === realCols - 1 || (c + 1) * rows + r >= n;
          line += names[i] + (last ? '' : ' '.repeat(colW[c] - widths[i]));
        }
        out += line + '\n';
      }
      return out;
    }
  }
  return '';
}

export const commands = {
  ls: {
    fn(ctx) {
      const r = getopts(ctx, {
        flags: 'aAlhRrtS1dFiCnUs',
        long: { all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', reverse: 'r', directory: 'd', classify: 'F', inode: 'i', color: 'color' },
        exitCode: 2,
      });
      if (!r) return 0;
      const { o, rest } = r;
      const fs = ctx.fs;
      const tty = ctx.isTTY && o.color !== 'never';
      const long = o.l || o.n;
      let status = 0;
      const now = ctx.world.now();
      const m = ctx.machine;

      const fmtName = (name, node, abs) => {
        let shown = ctx.isTTY ? lsQuote(name) : name;
        if (tty) {
          const col = colorFor(node, name, fs, abs);
          if (col) shown = col + shown + C.reset;
        }
        if (o.F) shown += classify(node);
        return shown;
      };
      const sortEntries = (entries) => {
        if (o.U) return entries;
        entries.sort((a, b) => lsCompare(a.name, b.name));
        if (o.t) entries.sort((a, b) => b.node.mtime - a.node.mtime);
        if (o.S) entries.sort((a, b) => nodeSize(b.node) - nodeSize(a.node));
        if (o.r) entries.reverse();
        return entries;
      };
      const render = (entries, withTotal) => {
        let out = '';
        if (long) {
          if (withTotal) out += `total ${entries.reduce((a, e) => a + blocks(e.node), 0)}\n`;
          const rows = entries.map((e) => {
            const n = e.node;
            const size = n.type === 'char' ? '1, 3' : o.h ? humanSize(nodeSize(n)) : String(nodeSize(n));
            let name = fmtName(e.name, n, e.abs);
            if (n.type === 'link') name += ` -> ${n.target}`;
            return [o.i ? String(n.ino) + ' ' : '', modeString(n.type, n.mode), String(n.nlink), o.n ? String(n.uid) : m.uidName(n.uid), o.n ? String(n.gid) : m.gidName(n.gid), size, lsDate(n.mtime, now), name];
          });
          const w = [1, 2, 3, 4, 5].map((i) => Math.max(...rows.map((r) => r[i].length)));
          for (const r of rows) out += `${r[0]}${r[1]} ${padL(r[2], w[1])} ${padR(r[3], w[2])} ${padR(r[4], w[3])} ${padL(r[5], w[4])} ${r[6]} ${r[7]}\n`;
          return out;
        }
        if (o['1'] || !ctx.isTTY) {
          for (const e of entries) out += (o.i ? e.node.ino + ' ' : '') + fmtName(e.name, e.node, e.abs) + '\n';
          return out;
        }
        const names = entries.map((e) => (o.i ? e.node.ino + ' ' : '') + fmtName(e.name, e.node, e.abs));
        const widths = entries.map((e) => (o.i ? String(e.node.ino).length + 1 : 0) + (ctx.isTTY ? lsQuote(e.name) : e.name).length + (o.F ? classify(e.node).length : 0));
        return columns(names, widths, ctx.cols);
      };
      const listDir = (abs, node) => {
        if (!can(node, ctx.cred, 'r')) throw new FsError('EACCES');
        const entries = [];
        if (o.a) {
          entries.push({ name: '.', node, abs });
          const parent = fs.tryGet(dirName(abs) || '/') || node;
          entries.push({ name: '..', node: parent, abs: dirName(abs) });
        }
        for (const [name, child] of node.children) {
          if (name.startsWith('.') && !o.a && !o.A) continue;
          entries.push({ name, node: child, abs: joinPath(abs, name) });
        }
        return sortEntries(entries);
      };

      const targets = rest.length ? rest : ['.'];
      const files = [];
      const dirs = [];
      for (const t of targets) {
        let res;
        try {
          res = fs.get(t, { ...ctx.fsCtx, follow: false });
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`ls: cannot access ${q(t)}: ${e.message}\n`);
          status = 2;
          continue;
        }
        let node = res.node;
        if (node.type === 'link' && !long && !o.d && !o.F) {
          const tgt = fs.tryGet(t, ctx.fsCtx);
          if (tgt) node = tgt;
        }
        if (node.type === 'dir' && !o.d) dirs.push({ name: t, node, abs: ctx.resolve(t) });
        else files.push({ name: t, node, abs: ctx.resolve(t) });
      }
      let out = render(sortEntries(files), false);
      const showHeaders = targets.length > 1 || o.R;
      const walk = (d, first) => {
        let entries;
        try {
          entries = listDir(d.abs, d.node);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`ls: cannot open directory ${q(d.name)}: ${e.message}\n`);
          status = 2;
          return;
        }
        if (!first || out) out += '\n';
        if (showHeaders) out += `${ctx.isTTY ? lsQuote(d.name) : d.name}:\n`;
        out += render(entries, true);
        if (o.R) {
          for (const e of entries) {
            if (e.node.type === 'dir' && e.name !== '.' && e.name !== '..') {
              walk({ name: d.name === '/' ? '/' + e.name : `${d.name}/${e.name}`, node: e.node, abs: e.abs }, false);
            }
          }
        }
      };
      sortEntries(dirs).forEach((d, i) => walk(d, i === 0));
      ctx.out(out);
      return status;
    },
  },

  tree: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'adfC', args: 'L' });
      if (!r) return 0;
      const { o, rest } = r;
      const maxDepth = o.L ? Number(o.L) : Infinity;
      let dirs = 0;
      let files = 0;
      const root = rest[0] || '.';
      const res = ctx.fs.tryGet(root, ctx.fsCtx);
      if (!res) { ctx.out(`${root}  [error opening dir]\n\n0 directories, 0 files\n`); return 2; }
      const paint = (name, node, abs) => {
        if (!ctx.isTTY) return name;
        const col = colorFor(node, name, ctx.fs, abs);
        return col ? col + name + C.reset : name;
      };
      let out = paint(root, res, ctx.resolve(root)) + '\n';
      const rec = (node, abs, prefix, depth) => {
        if (depth > maxDepth) return;
        if (!can(node, ctx.cred, 'r')) { out += `${prefix}[error opening dir]\n`; return; }
        const entries = [...node.children].filter(([n, c]) => (o.a || !n.startsWith('.')) && (!o.d || c.type === 'dir')).sort((a, b) => lsCompare(a[0], b[0]));
        entries.forEach(([name, child], i) => {
          const last = i === entries.length - 1;
          const cabs = joinPath(abs, name);
          let label = paint(name, child, cabs);
          if (child.type === 'link') label += ` -> ${child.target}`;
          out += `${prefix}${last ? '└── ' : '├── '}${label}\n`;
          if (child.type === 'dir') {
            dirs++;
            rec(child, cabs, prefix + (last ? '    ' : '│   '), depth + 1);
          } else files++;
        });
      };
      rec(res, ctx.resolve(root), '', 1);
      out += `\n${dirs} director${dirs === 1 ? 'y' : 'ies'}${o.d ? '' : `, ${files} file${files === 1 ? '' : 's'}`}\n`;
      ctx.out(out);
      return 0;
    },
  },

  cat: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'nbAETsv', long: { number: 'n', 'show-all': 'A', 'number-nonblank': 'b' } });
      if (!r) return 0;
      const { o, rest } = r;
      const { inputs, status } = await readInputs(ctx, rest, {
        errFmt: (f, e) => `cat: ${f}: ${e.message}\n`,
      });
      let n = 1;
      for (const { data } of inputs) {
        let text = data;
        if (o.A || o.E || o.T || o.v) {
          text = text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) => (c === '\t' && !(o.A || o.T) ? c : '^' + String.fromCharCode(c.charCodeAt(0) ^ 64)));
          if (o.A || o.E) text = text.replace(/\n/g, '$\n');
        }
        if (o.n || o.b) {
          const lines = text.split('\n');
          const tail = lines.pop();
          text = lines.map((l) => (o.b && l === '' ? l : `${String(n++).padStart(6)}\t${l}`)).join('\n') + '\n' + (tail ? `${String(n++).padStart(6)}\t${tail}` : '');
        }
        ctx.out(text);
      }
      return status;
    },
  },

  touch: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'cam' });
      if (!r) return 0;
      const { o, rest } = r;
      if (!rest.length) { ctx.err("touch: missing file operand\nTry 'touch --help' for more information.\n"); return 1; }
      let status = 0;
      for (const f of rest) {
        try {
          const node = ctx.fs.tryGet(f, ctx.fsCtx);
          if (node) {
            if (ctx.cred.uid !== 0 && ctx.cred.uid !== node.uid && !can(node, ctx.cred, 'w')) throw new FsError('EACCES');
            node.mtime = node.atime = ctx.world.now();
            ctx.fs.changed('touch', ctx.resolve(f));
          } else if (!o.c) ctx.fs.write(f, '', ctx.fsCtx, { append: true });
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`touch: cannot touch ${q(f)}: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },

  mkdir: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'pv', args: 'm', long: { parents: 'p', verbose: 'v' }, longArgs: { mode: 'm' } });
      if (!r) return 0;
      const { o, rest } = r;
      if (!rest.length) { ctx.err("mkdir: missing operand\nTry 'mkdir --help' for more information.\n"); return 1; }
      let status = 0;
      for (const d of rest) {
        try {
          const existed = !!ctx.fs.tryGet(d, ctx.fsCtx);
          const node = ctx.fs.mkdir(d, ctx.fsCtx, { parents: !!o.p });
          if (o.m) node.mode = parseInt(o.m, 8);
          if (o.v && !existed) ctx.out(`mkdir: created directory '${d}'\n`);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`mkdir: cannot create directory ‘${d}’: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },

  rmdir: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'pv' });
      if (!r) return 0;
      let status = 0;
      if (!r.rest.length) { ctx.err("rmdir: missing operand\nTry 'rmdir --help' for more information.\n"); return 1; }
      for (const d of r.rest) {
        try {
          ctx.fs.rmdir(d, ctx.fsCtx);
          if (r.o.v) ctx.out(`rmdir: removing directory, '${d}'\n`);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`rmdir: failed to remove ${q(d)}: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },

  rm: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'rRfivd', long: { recursive: 'r', force: 'f', verbose: 'v', 'no-preserve-root': 'npr' } });
      if (!r) return 0;
      const { o, rest } = r;
      const rec = o.r || o.R;
      if (!rest.length) {
        if (o.f) return 0;
        ctx.err("rm: missing operand\nTry 'rm --help' for more information.\n");
        return 1;
      }
      let status = 0;
      for (const f of rest) {
        const abs = ctx.resolve(f);
        if (rec && abs === '/' && !o.npr) {
          ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
          status = 1;
          continue;
        }
        if (/(^|\/)\.\.?$/.test(f)) {
          ctx.err(`rm: refusing to remove '.' or '..' directory: skipping ${q(f)}\n`);
          status = 1;
          continue;
        }
        let res;
        try {
          res = ctx.fs.walk(f, { ...ctx.fsCtx, follow: false });
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          if (!o.f) { ctx.err(`rm: cannot remove ${q(f)}: ${e.message}\n`); status = 1; }
          continue;
        }
        if (!res.node) {
          if (!o.f) { ctx.err(`rm: cannot remove ${q(f)}: No such file or directory\n`); status = 1; }
          continue;
        }
        const node = res.node;
        if (node.type === 'dir' && !rec && !o.d) { ctx.err(`rm: cannot remove ${q(f)}: Is a directory\n`); status = 1; continue; }
        const kind = node.type === 'dir' ? 'directory' : node.type === 'link' ? 'symbolic link' : node.content === '' ? 'regular empty file' : 'regular file';
        const protectedFile = node.type !== 'link' && !can(node, ctx.cred, 'w');
        if (o.i || (protectedFile && !o.f && ctx.isTTY && node.type !== 'dir')) {
          const ans = await ctx.term.prompt(`rm: remove ${protectedFile ? 'write-protected ' : ''}${kind} ${q(f)}? `);
          if (!ans || !/^y/i.test(ans.trim())) continue;
        }
        try {
          if (node.type === 'dir') {
            if (o.d && !rec) ctx.fs.rmdir(f, ctx.fsCtx);
            else {
              const ok = ctx.fs.removeTree(f, ctx.fsCtx, (p, code) => {
                ctx.err(`rm: cannot remove ${q(p)}: ${ERR[code]}\n`);
              });
              if (!ok) { status = 1; continue; }
            }
          } else ctx.fs.unlink(f, ctx.fsCtx);
          if (o.v) ctx.out(`removed ${node.type === 'dir' ? 'directory ' : ''}${q(f)}\n`);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`rm: cannot remove ${q(f)}: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },

  cp: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'rRivpanf', long: { recursive: 'r', verbose: 'v', archive: 'a', interactive: 'i' } });
      if (!r) return 0;
      const { o, rest } = r;
      const rec = o.r || o.R || o.a;
      const keep = o.p || o.a;
      if (rest.length < 2) {
        ctx.err(rest.length ? `cp: missing destination file operand after ${q(rest[0])}\nTry 'cp --help' for more information.\n` : "cp: missing file operand\nTry 'cp --help' for more information.\n");
        return 1;
      }
      const fs = ctx.fs;
      const dest = rest.pop();
      const destNode = fs.tryGet(dest, ctx.fsCtx);
      const intoDir = destNode && destNode.type === 'dir';
      if (rest.length > 1 && !intoDir) { ctx.err(`cp: target ${q(dest)} is not a directory\n`); return 1; }
      let status = 0;
      const copyNode = async (src, node, target) => {
        if (node.type === 'dir') {
          const existing = fs.tryGet(target, ctx.fsCtx);
          if (!existing) {
            const d = fs.mkdir(target, ctx.fsCtx);
            d.mode = keep ? node.mode : node.mode & ~ctx.frame.umask;
          }
          if (!can(node, ctx.cred, 'r')) throw Object.assign(new FsError('EACCES'), { path: src });
          for (const [name, child] of node.children) await copyNode(`${src}/${name}`, child, `${target}/${name}`);
          return;
        }
        if (node.type === 'link' && !rec) node = fs.get(src, ctx.fsCtx).node;
        if (node.type === 'link') { fs.symlink(node.target, target, ctx.fsCtx); return; }
        let data;
        try {
          data = fs.read(src, ctx.fsCtx);
        } catch (e) {
          if (e instanceof FsError) { ctx.err(`cp: cannot open ${q(src)} for reading: ${e.message}\n`); status = 1; return; }
          throw e;
        }
        const existed = fs.tryGet(target, ctx.fsCtx);
        if (existed && o.n) return;
        if (existed && o.i) {
          const ans = await ctx.term.prompt(`cp: overwrite ${q(target)}? `);
          if (!ans || !/^y/i.test(ans.trim())) return;
        }
        try {
          const n = fs.write(target, data, ctx.fsCtx, { mode: node.mode & 0o7777 });
          if (!existed) n.mode = keep ? node.mode : node.mode & ~ctx.frame.umask & 0o777;
          if (keep) { n.mtime = node.mtime; if (ctx.cred.uid === 0) { n.uid = node.uid; n.gid = node.gid; } }
          if (o.v) ctx.out(`'${src}' -> '${target}'\n`);
        } catch (e) {
          if (e instanceof FsError) { ctx.err(`cp: cannot create regular file ${q(target)}: ${e.message}\n`); status = 1; return; }
          throw e;
        }
      };
      for (const src of rest) {
        let node;
        try {
          node = fs.get(src, { ...ctx.fsCtx, follow: !rec }).node;
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`cp: cannot stat ${q(src)}: ${e.message}\n`);
          status = 1;
          continue;
        }
        if (node.type === 'dir' && !rec) { ctx.err(`cp: -r not specified; omitting directory ${q(src)}\n`); status = 1; continue; }
        const target = intoDir ? joinPath(dest, baseName(src)) : dest;
        if (node.type === 'dir' && normPath(ctx.resolve(target)).startsWith(normPath(ctx.resolve(src)) + '/')) {
          ctx.err(`cp: cannot copy a directory, ${q(src)}, into itself, ${q(target)}\n`);
          status = 1;
          continue;
        }
        try {
          await copyNode(src, node, target);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`cp: cannot access ${q(e.path || src)}: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },

  mv: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'ivfn', long: { verbose: 'v', interactive: 'i', force: 'f' } });
      if (!r) return 0;
      const { o, rest } = r;
      if (rest.length < 2) {
        ctx.err(rest.length ? `mv: missing destination file operand after ${q(rest[0])}\nTry 'mv --help' for more information.\n` : "mv: missing file operand\nTry 'mv --help' for more information.\n");
        return 1;
      }
      const dest = rest.pop();
      const destNode = ctx.fs.tryGet(dest, ctx.fsCtx);
      if (rest.length > 1 && !(destNode && destNode.type === 'dir')) { ctx.err(`mv: target ${q(dest)} is not a directory\n`); return 1; }
      let status = 0;
      for (const src of rest) {
        if (!ctx.fs.tryGet(src, { ...ctx.fsCtx, follow: false })) {
          ctx.err(`mv: cannot stat ${q(src)}: No such file or directory\n`);
          status = 1;
          continue;
        }
        const target = destNode && destNode.type === 'dir' ? joinPath(dest, baseName(src)) : dest;
        const exists = ctx.fs.tryGet(target, ctx.fsCtx);
        if (exists && o.n) continue;
        if (exists && o.i && !o.f) {
          const ans = await ctx.term.prompt(`mv: overwrite ${q(target)}? `);
          if (!ans || !/^y/i.test(ans.trim())) continue;
        }
        try {
          ctx.fs.rename(src, dest, ctx.fsCtx);
          if (o.v) ctx.out(`renamed '${src}' -> '${target}'\n`);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          if (e.code === 'EINVAL') ctx.err(`mv: cannot move ${q(src)} to a subdirectory of itself, ${q(target)}\n`);
          else ctx.err(`mv: cannot move ${q(src)} to ${q(target)}: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },

  ln: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'sfvn', long: { symbolic: 's', force: 'f', verbose: 'v' } });
      if (!r) return 0;
      const { o, rest } = r;
      if (!rest.length) { ctx.err("ln: missing file operand\nTry 'ln --help' for more information.\n"); return 1; }
      const target = rest[0];
      let link = rest[1] ?? baseName(target);
      const ln = ctx.fs.tryGet(link, ctx.fsCtx);
      if (ln && ln.type === 'dir') link = joinPath(link, baseName(target));
      try {
        if (o.f && ctx.fs.tryGet(link, { ...ctx.fsCtx, follow: false })) ctx.fs.unlink(link, ctx.fsCtx);
        if (o.s) ctx.fs.symlink(target, link, ctx.fsCtx);
        else ctx.fs.link(target, link, ctx.fsCtx);
        if (o.v) ctx.out(`'${link}' -> '${target}'\n`);
        return 0;
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        if (e.code === 'ENOENT' && !o.s) ctx.err(`ln: failed to access ${q(target)}: ${e.message}\n`);
        else if (e.code === 'EPERM') ctx.err(`ln: ${q(target)}: hard link not allowed for directory\n`);
        else ctx.err(`ln: failed to create ${o.s ? 'symbolic' : 'hard'} link ${q(link)}: ${e.message}\n`);
        return 1;
      }
    },
  },

  stat: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'L', args: 'c', longArgs: { format: 'c' }, long: { dereference: 'L' } });
      if (!r) return 0;
      const { o, rest } = r;
      if (!rest.length) { ctx.err("stat: missing operand\nTry 'stat --help' for more information.\n"); return 1; }
      const m = ctx.machine;
      let status = 0;
      for (const f of rest) {
        let res;
        try {
          res = ctx.fs.get(f, { ...ctx.fsCtx, follow: !!o.L });
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`stat: cannot statx ${q(f)}: ${e.message}\n`);
          status = 1;
          continue;
        }
        const n = res.node;
        const typeName = { dir: 'directory', link: 'symbolic link', char: 'character special file', file: nodeSize(n) ? 'regular file' : 'regular empty file' }[n.type];
        if (o.c) {
          const map = {
            a: n.mode.toString(8), A: modeString(n.type, n.mode), U: m.uidName(n.uid), u: n.uid, G: m.gidName(n.gid), g: n.gid,
            s: nodeSize(n), n: f, F: typeName, i: n.ino, h: n.nlink, y: isoStamp(n.mtime), Y: Math.floor(n.mtime / 1000),
            N: n.type === 'link' ? `'${f}' -> '${n.target}'` : `'${f}'`, '%': '%',
          };
          ctx.out(o.c.replace(/%(.)/g, (mm, c) => (c in map ? String(map[c]) : mm)) + '\n');
          continue;
        }
        const name = n.type === 'link' ? `${f} -> ${n.target}` : f;
        ctx.out(
          `  File: ${name}\n`
          + `  Size: ${padR(nodeSize(n), 15)} Blocks: ${padR(blocks(n) * 2, 10)} IO Block: 4096   ${typeName}\n`
          + `Device: 8,1\tInode: ${padR(n.ino, 11)} Links: ${n.nlink}\n`
          + `Access: (${octal(n.mode & 0o7777)}/${modeString(n.type, n.mode)})  Uid: (${padL(n.uid, 5)}/${padL(m.uidName(n.uid), 8)})   Gid: (${padL(n.gid, 5)}/${padL(m.gidName(n.gid), 8)})\n`
          + `Access: ${isoStamp(n.atime)}\nModify: ${isoStamp(n.mtime)}\nChange: ${isoStamp(n.ctime)}\n Birth: -\n`,
        );
      }
      return status;
    },
  },

  file: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'bL' });
      if (!r) return 0;
      const { o, rest } = r;
      if (!rest.length) { ctx.err('Usage: file [-bL] file ...\n'); return 1; }
      for (const f of rest) {
        const desc = describe(ctx, f, !!o.L);
        ctx.out(o.b ? desc + '\n' : `${f}: ${desc}\n`);
      }
      return 0;
    },
  },

  du: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'shac', args: 'd', longArgs: { 'max-depth': 'd' } });
      if (!r) return 0;
      const { o, rest } = r;
      const fmt = (k) => (o.h ? humanSize(k * 1024).replace(/^(\d)([KMG])$/, '$1.0$2') : String(k));
      let grand = 0;
      for (const t of rest.length ? rest : ['.']) {
        const node = ctx.fs.tryGet(t, ctx.fsCtx);
        if (!node) { ctx.err(`du: cannot access ${q(t)}: No such file or directory\n`); continue; }
        const lines = [];
        const walk = (n, p, depth) => {
          if (n.type !== 'dir') {
            const k = blocks(n);
            if (o.a && depth > 0) lines.push([k, p]);
            return k;
          }
          let total = 4;
          if (can(n, ctx.cred, 'r')) for (const [name, c] of n.children) total += walk(c, `${p}/${name}`, depth + 1);
          else ctx.err(`du: cannot read directory ${q(p)}: Permission denied\n`);
          if (!o.s && (o.d === undefined || depth <= Number(o.d))) lines.push([total, p]);
          return total;
        };
        const total = walk(node, t, 0);
        if (o.s || node.type !== 'dir') lines.push([total, t]);
        grand += total;
        for (const [k, p] of lines) ctx.out(`${fmt(k)}\t${p}\n`);
      }
      if (o.c) ctx.out(`${fmt(grand)}\ttotal\n`);
      return 0;
    },
  },

  df: {
    fn(ctx) {
      const h = ctx.args.includes('-h');
      const rows = [
        ['udev', 4021116, 0, 4021116, '/dev'], ['tmpfs', 812536, 1308, 811228, '/run'],
        ['/dev/sda1', 81000132, 23874412, 52965660, '/'], ['tmpfs', 4062668, 0, 4062668, '/dev/shm'],
      ];
      const f = (k) => (h ? humanSize(k * 1024) : String(k));
      ctx.out(`Filesystem     ${h ? ' Size  Used Avail' : '1K-blocks     Used Available'} Use% Mounted on\n`);
      for (const [fsn, size, used, avail, mnt] of rows) {
        const pct = size ? Math.ceil((used / size) * 100) : 0;
        ctx.out(`${padR(fsn, 14)} ${padL(f(size), h ? 5 : 9)} ${padL(f(used), h ? 5 : 8)} ${padL(f(avail), h ? 5 : 9)} ${padL(pct + '%', 4)} ${mnt}\n`);
      }
      return 0;
    },
  },

  basename: {
    fn(ctx) {
      if (!ctx.args.length) { ctx.err("basename: missing operand\nTry 'basename --help' for more information.\n"); return 1; }
      let b = baseName(ctx.args[0]);
      if (ctx.args[1] && b.endsWith(ctx.args[1]) && b !== ctx.args[1]) b = b.slice(0, -ctx.args[1].length);
      ctx.out(b + '\n');
      return 0;
    },
  },
  dirname: {
    fn(ctx) {
      if (!ctx.args.length) { ctx.err("dirname: missing operand\nTry 'dirname --help' for more information.\n"); return 1; }
      for (const a of ctx.args) ctx.out(dirName(a) + '\n');
      return 0;
    },
  },
  realpath: {
    fn(ctx) {
      let status = 0;
      for (const a of ctx.args.filter((x) => !x.startsWith('-'))) {
        try { ctx.out(ctx.fs.get(a, ctx.fsCtx).path + '\n'); } catch (e) {
          ctx.err(`realpath: ${a}: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },
  readlink: {
    fn(ctx) {
      const canon = ctx.args.includes('-f');
      const files = ctx.args.filter((x) => !x.startsWith('-'));
      let status = 0;
      for (const f of files) {
        if (canon) {
          try { ctx.out(ctx.fs.get(f, ctx.fsCtx).path + '\n'); } catch { status = 1; }
          continue;
        }
        const n = ctx.fs.tryGet(f, { ...ctx.fsCtx, follow: false });
        if (n && n.type === 'link') ctx.out(n.target + '\n');
        else status = 1;
      }
      return status;
    },
  },
};

export function describe(ctx, f, follow = false) {
  let node;
  try {
    node = ctx.fs.get(f, { ...ctx.fsCtx, follow }).node;
  } catch (e) {
    return `cannot open \`${f}' (${e.message})`;
  }
  if (node.type === 'dir') return node.mode & 0o1000 ? 'sticky, directory' : 'directory';
  if (node.type === 'link') return `symbolic link to ${node.target}`;
  if (node.type === 'char') return 'character special (1/3)';
  if (!can(node, ctx.cred, 'r')) return `regular file, no read permission`;
  const d = node.content;
  if (!d.length) return 'empty';
  return describeData(d, node);
}

export function describeData(d, node = null) {
  if (d.startsWith(BIN_MAGIC)) {
    const pre = node && node.mode & 0o4000 ? 'setuid ' : node && node.mode & 0o2000 ? 'setgid ' : '';
    return `${pre}ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, BuildID[sha1]=3c6f1d8e0e2a9b47d1f5a4c2e7b9d0a1c3e5f7a9, for GNU/Linux 3.2.0, stripped`;
  }
  if (d.startsWith('\x1f\x8b')) {
    const named = d.charCodeAt(3) & 0x08;
    const m = named ? d.slice(10).match(/^([^\x00]*)\x00/) : null;
    const secs = (d.charCodeAt(4) | (d.charCodeAt(5) << 8) | (d.charCodeAt(6) << 16) | (d.charCodeAt(7) << 24)) >>> 0;
    const when = secs ? `last modified: ${dateString(secs * 1000).replace(' UTC', '')}, ` : '';
    return `gzip compressed data, ${m && m[1] ? `was "${m[1]}", ` : ''}${when}from Unix, original size modulo 2^32 ${Math.max(0, d.length * 2)}`;
  }
  if (d.startsWith('BZh')) return 'bzip2 compressed data, block size = 900k';
  if (d.length > 262 && d.slice(257, 262) === 'ustar') return 'POSIX tar archive (GNU)';
  if (d.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) return 'OpenSSH private key';
  if (/^ssh-ed25519 /.test(d)) return 'OpenSSH ED25519 public key';
  if (/^ssh-rsa /.test(d)) return 'OpenSSH RSA public key';
  if (d.startsWith('\x89PNG')) return 'PNG image data, 64 x 64, 8-bit/color RGBA, non-interlaced';
  if (d.startsWith('PK\x03\x04')) return 'Zip archive data, at least v2.0 to extract, compression method=deflate';
  const shebang = d.match(/^#!\s*(\S+)/);
  const exec = node && node.mode & 0o111 ? ' executable' : '';
  const ascii = !/[^\x09\x0a\x0d\x20-\x7e]/.test(d);
  let utf8 = false;
  if (!ascii) {
    try { decodeURIComponent(escape(d)); utf8 = !/[\x00-\x08\x0e-\x1f]/.test(d); } catch { utf8 = false; }
  }
  if (!ascii && !utf8) return 'data';
  let kind = ascii ? 'ASCII text' : 'Unicode text, UTF-8 text';
  if (shebang) {
    const interp = shebang[1];
    const name = /bash$/.test(interp) ? 'Bourne-Again shell script' : /sh$/.test(interp) ? 'POSIX shell script' : /python/.test(interp) ? 'Python script' : `a ${interp} script`;
    kind = `${name}, ${kind}${exec}`;
  }
  if (d.includes('\r\n')) kind += ', with CRLF line terminators';
  else if (!d.endsWith('\n') && !d.includes('\n')) kind += ', with no line terminators';
  return kind;
}
