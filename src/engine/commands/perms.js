// chmod, chown, chgrp and the symbolic-mode parser shared with find -perm.
import { FsError } from '../vfs.js';
import { UsageError } from '../shell.js';
import { getopts, q } from './_util.js';

// Apply a chmod mode string (octal or symbolic like u+x,g-w,o=r,+t) to `cur`.
export function parseSymbolicMode(spec, cur, isDir, umask = 0o022) {
  if (/^[0-7]{1,4}$/.test(spec)) {
    const n = parseInt(spec, 8);
    if (spec.length <= 3 && isDir) return (cur & 0o6000) | n;
    return n;
  }
  let mode = cur & 0o7777;
  for (const clause of spec.split(',')) {
    const m = clause.match(/^([ugoa]*)((?:[-+=][rwxXstugo]*)+)$/);
    if (!m) throw new UsageError(`invalid mode: '${spec}'`);
    const whoStr = m[1] || '';
    const who = whoStr === '' || whoStr.includes('a') ? 'ugo' : whoStr;
    const respectUmask = whoStr === '';
    for (const [, op, perms] of m[2].matchAll(/([-+=])([rwxXstugo]*)/g)) {
      let bits = 0;
      const copyFrom = perms.match(/^[ugo]$/);
      for (const w of who) {
        const shift = w === 'u' ? 6 : w === 'g' ? 3 : 0;
        let b = 0;
        if (copyFrom) {
          const src = { u: 6, g: 3, o: 0 }[perms];
          b = (mode >> src) & 7;
        } else {
          if (perms.includes('r')) b |= 4;
          if (perms.includes('w')) b |= 2;
          if (perms.includes('x') || (perms.includes('X') && (isDir || mode & 0o111))) b |= 1;
        }
        bits |= b << shift;
        if (perms.includes('s')) { if (w === 'u') bits |= 0o4000; if (w === 'g') bits |= 0o2000; }
        if (perms.includes('t') && w === 'o') bits |= 0o1000;
      }
      if (respectUmask && op !== '=') bits &= ~umask | 0o7000;
      if (op === '+') mode |= bits;
      else if (op === '-') mode &= ~bits;
      else {
        let clear = 0;
        for (const w of who) clear |= 7 << (w === 'u' ? 6 : w === 'g' ? 3 : 0);
        if (who.includes('u')) clear |= 0o4000;
        if (who.includes('g')) clear |= 0o2000;
        if (who.includes('o')) clear |= 0o1000;
        mode = (mode & ~clear) | bits;
      }
    }
  }
  return mode;
}

function walkTargets(ctx, path, recursive, fn) {
  const node = ctx.fs.get(path, ctx.fsCtx).node;
  fn(path, node);
  if (recursive && node.type === 'dir') {
    for (const [name] of node.children) walkTargets(ctx, `${path.replace(/\/$/, '')}/${name}`, true, fn);
  }
}

export const commands = {
  chmod: {
    fn(ctx) {
      // modes like -x look like options; pull the mode out first
      const raw = ctx.args.slice();
      const flags = raw.filter((a) => /^-[Rvcf]+$/.test(a));
      const rest = raw.filter((a) => !/^-[Rvcf]+$/.test(a));
      if (raw.includes('--help')) { getopts(ctx, {}); return 0; }
      const o = { R: flags.some((f) => f.includes('R')), v: flags.some((f) => f.includes('v')), c: flags.some((f) => f.includes('c')), f: flags.some((f) => f.includes('f')) };
      if (rest.length < 2) {
        ctx.err(rest.length ? `chmod: missing operand after ${q(rest[0])}\nTry 'chmod --help' for more information.\n` : "chmod: missing operand\nTry 'chmod --help' for more information.\n");
        return 1;
      }
      const spec = rest.shift();
      let status = 0;
      for (const f of rest) {
        try {
          walkTargets(ctx, f, o.R, (p, node) => {
            if (node.type === 'link') return;
            const next = parseSymbolicMode(spec, node.mode, node.type === 'dir', ctx.frame.umask);
            if (ctx.cred.uid !== 0 && ctx.cred.uid !== node.uid) {
              if (!o.f) ctx.err(`chmod: changing permissions of ${q(p)}: Operation not permitted\n`);
              status = 1;
              return;
            }
            const before = node.mode & 0o7777;
            node.mode = (node.mode & ~0o7777) | next;
            node.ctime = ctx.world.now();
            ctx.fs.changed('chmod', ctx.resolve(p));
            if (o.v || (o.c && before !== next)) ctx.out(`mode of ${q(p)} changed from ${before.toString(8).padStart(4, '0')} to ${next.toString(8).padStart(4, '0')}\n`);
          });
        } catch (e) {
          if (e instanceof UsageError) { ctx.err(`chmod: ${e.message}\nTry 'chmod --help' for more information.\n`); return 1; }
          if (!(e instanceof FsError)) throw e;
          ctx.err(`chmod: cannot access ${q(f)}: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },
  chown: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'Rvhf', long: { recursive: 'R', verbose: 'v' } });
      if (!r) return 0;
      const { o, rest } = r;
      if (rest.length < 2) { ctx.err(`chown: missing operand\nTry 'chown --help' for more information.\n`); return 1; }
      const spec = rest.shift();
      const [uName, gName] = spec.split(/[:.]/);
      const m = ctx.machine;
      const uid = uName ? (m.user(uName)?.uid ?? (/^\d+$/.test(uName) ? Number(uName) : null)) : null;
      if (uName && uid === null) { ctx.err(`chown: invalid user: ${q(spec)}\n`); return 1; }
      let gid = null;
      if (gName) {
        gid = m.groups.get(gName)?.gid ?? (/^\d+$/.test(gName) ? Number(gName) : null);
        if (gid === null) { ctx.err(`chown: invalid group: ${q(spec)}\n`); return 1; }
      } else if (spec.endsWith(':') && uName) gid = m.user(uName)?.gid ?? null;
      let status = 0;
      for (const f of rest) {
        try {
          walkTargets(ctx, f, o.R, (p, node) => {
            const changingOwner = uid !== null && uid !== node.uid;
            const groupOk = gid === null || ctx.cred.gids.includes(gid);
            if (ctx.cred.uid !== 0 && (changingOwner || node.uid !== ctx.cred.uid || !groupOk)) {
              ctx.err(`chown: changing ownership of ${q(p)}: Operation not permitted\n`);
              status = 1;
              return;
            }
            if (uid !== null) node.uid = uid;
            if (gid !== null) node.gid = gid;
            node.mode &= ctx.cred.uid === 0 ? 0o7777 : 0o1777;
            ctx.fs.changed('chown', ctx.resolve(p));
            if (o.v) ctx.out(`ownership of ${q(p)} retained as ${spec}\n`);
          });
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`chown: cannot access ${q(f)}: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },
  chgrp: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'Rv', long: { recursive: 'R' } });
      if (!r) return 0;
      const { o, rest } = r;
      if (rest.length < 2) { ctx.err("chgrp: missing operand\nTry 'chgrp --help' for more information.\n"); return 1; }
      const g = rest.shift();
      const gid = ctx.machine.groups.get(g)?.gid;
      if (gid === undefined) { ctx.err(`chgrp: invalid group: ${q(g)}\n`); return 1; }
      let status = 0;
      for (const f of rest) {
        try {
          walkTargets(ctx, f, o.R, (p, node) => {
            if (ctx.cred.uid !== 0 && (node.uid !== ctx.cred.uid || !ctx.cred.gids.includes(gid))) {
              ctx.err(`chgrp: changing group of ${q(p)}: Operation not permitted\n`);
              status = 1;
              return;
            }
            node.gid = gid;
            ctx.fs.changed('chgrp', ctx.resolve(p));
          });
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`chgrp: cannot access ${q(f)}: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },
};
