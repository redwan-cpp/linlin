// find: GNU-style expression parser and evaluator.
import { can, nodeSize } from '../vfs.js';
import { globRegex } from '../expand.js';
import { modeString, lsDate, padL, padR } from '../util.js';
import { UsageError } from '../shell.js';
import { posixRegex } from '../regex.js';
import { parseSymbolicMode } from './perms.js';

const TAKES_ARG = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-type', '-size', '-user', '-group', '-perm', '-mtime', '-mmin', '-atime', '-amin', '-newer', '-maxdepth', '-mindepth', '-links', '-inum', '-uid', '-gid', '-regex', '-iregex']);
const NO_ARG = new Set(['-print', '-print0', '-ls', '-delete', '-quit', '-prune', '-true', '-false', '-empty', '-executable', '-readable', '-writable', '-nouser', '-nogroup', '-depth', '-xdev', '-mount', '-follow']);

function cmpNum(spec, value, label) {
  const m = String(spec).match(/^([+-]?)(\d+)$/);
  if (!m) throw new UsageError(`invalid argument \`${spec}' to \`${label}'`);
  const n = Number(m[2]);
  if (m[1] === '+') return value > n;
  if (m[1] === '-') return value < n;
  return value === n;
}

function parseFind(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const opts = { maxdepth: Infinity, mindepth: 0 };
  let hasAction = false;
  function primary() {
    const t = tokens[i++];
    if (t === '(') {
      const e = orExpr();
      if (tokens[i] !== ')') throw new UsageError("invalid expression; you have too many '('");
      i++;
      return e;
    }
    if (t === '!' || t === '-not') return { op: 'not', e: primary() };
    if (t === '-exec' || t === '-execdir' || t === '-ok') {
      const cmd = [];
      while (i < tokens.length && tokens[i] !== ';' && tokens[i] !== '+') cmd.push(tokens[i++]);
      if (i >= tokens.length) throw new UsageError(`missing argument to \`${t}'`);
      const batch = tokens[i++] === '+';
      hasAction = true;
      return { op: 'exec', cmd, batch };
    }
    if (TAKES_ARG.has(t)) {
      if (i >= tokens.length) throw new UsageError(`missing argument to \`${t}'`);
      const arg = tokens[i++];
      if (t === '-maxdepth' || t === '-mindepth') {
        opts[t.slice(1)] = Number(arg);
        return { op: 'true' };
      }
      return { op: t, arg };
    }
    if (NO_ARG.has(t)) {
      if (['-print', '-print0', '-ls', '-delete', '-quit'].includes(t)) hasAction = true;
      return { op: t };
    }
    if (t === undefined) throw new UsageError('expected an expression');
    if (t.startsWith('-')) throw new UsageError(`unknown predicate \`${t}'`);
    throw new UsageError(`paths must precede expression: \`${t}'`);
  }
  function andExpr() {
    let e = primary();
    for (;;) {
      const t = peek();
      if (t === undefined || t === ')' || t === '-o' || t === '-or' || t === ',') return e;
      if (t === '-a' || t === '-and') i++;
      e = { op: 'and', a: e, b: primary() };
    }
  }
  function orExpr() {
    let e = andExpr();
    while (peek() === '-o' || peek() === '-or') {
      i++;
      e = { op: 'or', a: e, b: andExpr() };
    }
    return e;
  }
  const expr = tokens.length ? orExpr() : { op: 'true' };
  if (i < tokens.length) throw new UsageError(tokens[i] === ')' ? "invalid expression; you have used a binary operator ')' with nothing before it." : `paths must precede expression: \`${tokens[i]}'`);
  return { expr: hasAction ? expr : { op: 'and', a: expr, b: { op: '-print' } }, opts };
}

function parsePerm(spec) {
  let mode = spec;
  let kind = 'exact';
  if (mode[0] === '-') { kind = 'all'; mode = mode.slice(1); } else if (mode[0] === '/' || mode[0] === '+') { kind = 'any'; mode = mode.slice(1); }
  const bits = /^[0-7]+$/.test(mode) ? parseInt(mode, 8) : parseSymbolicMode(mode, 0, false, 0);
  return { kind, bits };
}

export const commands = {
  find: {
    async fn(ctx) {
      const args = ctx.args.slice();
      const starts = [];
      while (args.length && !args[0].startsWith('-') && args[0] !== '(' && args[0] !== '!') starts.push(args.shift());
      if (!starts.length) starts.push('.');
      let parsed;
      try {
        parsed = parseFind(args);
      } catch (e) {
        if (e instanceof UsageError) { ctx.err(`find: ${e.message}\n`); return 1; }
        throw e;
      }
      const { expr, opts } = parsed;
      const fs = ctx.fs;
      const m = ctx.machine;
      const now = ctx.world.now();
      let status = 0;
      let quit = false;
      const batches = new Map();
      const deletions = [];
      const regexCache = new Map();
      const rx = (pat, flags) => {
        const k = pat + '\0' + flags;
        if (!regexCache.has(k)) regexCache.set(k, flags === 're' ? posixRegex(pat, {}) : flags === 'rei' ? posixRegex(pat, { icase: true }) : globRegex(pat, { slashOk: flags === 'path' || flags === 'ipath' }));
        return regexCache.get(k);
      };
      const evalE = async (e, f) => {
        switch (e.op) {
          case 'and': return (await evalE(e.a, f)) && evalE(e.b, f);
          case 'or': return (await evalE(e.a, f)) || evalE(e.b, f);
          case 'not': return !(await evalE(e.e, f));
          case 'true': case '-true': case '-depth': case '-xdev': case '-mount': case '-follow': return true;
          case '-false': return false;
          case '-name': return rx(e.arg).test(f.name);
          case '-iname': return new RegExp(rx(e.arg).source, 'i').test(f.name);
          case '-path': case '-wholename': return rx(e.arg, 'path').test(f.path);
          case '-ipath': return new RegExp(rx(e.arg, 'path').source, 'i').test(f.path);
          case '-regex': return rx(`^${e.arg}$`, 're').test(f.path);
          case '-iregex': return rx(`^${e.arg}$`, 'rei').test(f.path);
          case '-type': return e.arg.split(',').some((t) => ({ f: 'file', d: 'dir', l: 'link', c: 'char' }[t] === f.node.type));
          case '-size': {
            const mm = e.arg.match(/^([+-]?)(\d+)([bckMGw]?)$/);
            if (!mm) throw new UsageError(`invalid -size type in \`${e.arg}'`);
            const unit = { b: 512, c: 1, w: 2, k: 1024, M: 1048576, G: 1073741824, '': 512 }[mm[3]];
            const sz = nodeSize(f.node);
            const v = unit === 1 ? sz : Math.ceil(sz / unit);
            return cmpNum(mm[1] + mm[2], v, '-size');
          }
          case '-empty': return f.node.type === 'dir' ? f.node.children.size === 0 : f.node.type === 'file' && nodeSize(f.node) === 0;
          case '-user': return /^\d+$/.test(e.arg) ? f.node.uid === Number(e.arg) : m.uidName(f.node.uid) === e.arg;
          case '-group': return /^\d+$/.test(e.arg) ? f.node.gid === Number(e.arg) : m.gidName(f.node.gid) === e.arg;
          case '-uid': return cmpNum(e.arg, f.node.uid, '-uid');
          case '-gid': return cmpNum(e.arg, f.node.gid, '-gid');
          case '-nouser': return !m.userByUid(f.node.uid);
          case '-nogroup': return !m.groupByGid(f.node.gid);
          case '-links': return cmpNum(e.arg, f.node.nlink, '-links');
          case '-inum': return cmpNum(e.arg, f.node.ino, '-inum');
          case '-perm': {
            const { kind, bits } = parsePerm(e.arg);
            const mode = f.node.mode & 0o7777;
            if (kind === 'all') return (mode & bits) === bits;
            if (kind === 'any') return bits === 0 || (mode & bits) !== 0;
            return mode === bits;
          }
          case '-mtime': return cmpNum(e.arg, Math.floor((now - f.node.mtime) / 86400000), '-mtime');
          case '-atime': return cmpNum(e.arg, Math.floor((now - f.node.atime) / 86400000), '-atime');
          case '-mmin': return cmpNum(e.arg, Math.floor((now - f.node.mtime) / 60000), '-mmin');
          case '-amin': return cmpNum(e.arg, Math.floor((now - f.node.atime) / 60000), '-amin');
          case '-newer': {
            const ref = fs.tryGet(e.arg, ctx.fsCtx);
            if (!ref) throw new UsageError(`‘${e.arg}’: No such file or directory`);
            return f.node.mtime > ref.mtime;
          }
          case '-executable': return can(f.node, ctx.cred, 'x');
          case '-readable': return can(f.node, ctx.cred, 'r');
          case '-writable': return can(f.node, ctx.cred, 'w');
          case '-print': ctx.out(f.path + '\n'); return true;
          case '-print0': ctx.out(f.path + '\0'); return true;
          case '-ls': {
            const n = f.node;
            ctx.out(`${padL(n.ino, 9)} ${padL(Math.ceil(nodeSize(n) / 4096) * 4, 6)} ${modeString(n.type, n.mode)} ${padL(n.nlink, 3)} ${padR(m.uidName(n.uid), 8)} ${padR(m.gidName(n.gid), 8)} ${padL(nodeSize(n), 8)} ${lsDate(n.mtime, now)} ${f.path}${n.type === 'link' ? ' -> ' + n.target : ''}\n`);
            return true;
          }
          case '-delete': deletions.push(f); return true;
          case '-prune': f.prune = true; return true;
          case '-quit': quit = true; return true;
          case 'exec': {
            if (e.batch) {
              if (!batches.has(e)) batches.set(e, []);
              batches.get(e).push(f.path);
              return true;
            }
            const argv = e.cmd.map((a) => a.split('{}').join(f.path));
            const st = await ctx.run(argv, ctx.io, { via: 'find' });
            return st === 0;
          }
          default: throw new UsageError(`unknown predicate \`${e.op}'`);
        }
      };
      const visit = async (path, node, depth) => {
        if (quit) return;
        const name = depth === 0 ? path.replace(/\/+$/, '').split('/').pop() || path : path.split('/').pop();
        const f = { path, node, name, prune: false };
        if (depth >= opts.mindepth) {
          try {
            await evalE(expr, f);
          } catch (e) {
            if (e instanceof UsageError) { ctx.err(`find: ${e.message}\n`); status = 1; quit = true; return; }
            throw e;
          }
        }
        if (node.type !== 'dir' || f.prune || depth >= opts.maxdepth || quit) return;
        if (!can(node, ctx.cred, 'r') || !can(node, ctx.cred, 'x')) {
          ctx.err(`find: ‘${path}’: Permission denied\n`);
          status = 1;
          return;
        }
        for (const [n, child] of [...node.children]) {
          if (quit) return;
          await visit(path.endsWith('/') ? path + n : `${path}/${n}`, child, depth + 1);
        }
      };
      for (const s of starts) {
        if (quit) break;
        let res;
        try {
          res = fs.get(s, { ...ctx.fsCtx, follow: true });
        } catch (e) {
          ctx.err(`find: ‘${s}’: ${e.message}\n`);
          status = 1;
          continue;
        }
        await visit(s, res.node, 0);
      }
      for (const [e, paths] of batches) {
        const argv = [];
        for (const a of e.cmd) {
          if (a === '{}') argv.push(...paths);
          else argv.push(a);
        }
        await ctx.run(argv, ctx.io, { via: 'find' });
      }
      for (const f of deletions.reverse()) {
        try {
          if (f.node.type === 'dir') fs.rmdir(f.path, ctx.fsCtx);
          else fs.unlink(f.path, ctx.fsCtx);
        } catch (e) {
          ctx.err(`find: cannot delete ‘${f.path}’: ${e.message}\n`);
          status = 1;
        }
      }
      return status;
    },
  },
};
