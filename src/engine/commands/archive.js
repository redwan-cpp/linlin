// tar (real ustar layout), gzip and bzip2 (simulated compression with real magic bytes).
import { FsError, can, joinPath, baseName } from '../vfs.js';
import { modeString } from '../util.js';

const scramble = (s, key) => {
  let out = '';
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ ((key + i * 7) & 255));
  return out;
};
const u32be = (n) => String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const readU32be = (s, i) => ((s.charCodeAt(i) << 24) | (s.charCodeAt(i + 1) << 16) | (s.charCodeAt(i + 2) << 8) | s.charCodeAt(i + 3)) >>> 0;
const u32le = (n) => String.fromCharCode(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);

export function gzipData(data, name = null, mtime = 0) {
  const flags = name ? '\x08' : '\x00';
  return '\x1f\x8b\x08' + flags + u32le(Math.floor(mtime / 1000)) + '\x00\x03' + (name ? name + '\x00' : '') + u32be(data.length) + scramble(data, 0x5a) + u32le(data.length * 2654435761) + u32le(data.length);
}

export function gunzipData(d) {
  if (!d.startsWith('\x1f\x8b')) return null;
  let i = 10;
  if (d.charCodeAt(3) & 0x08) { while (i < d.length && d[i] !== '\x00') i++; i++; }
  const len = readU32be(d, i);
  if (i + 4 + len > d.length) return null;
  return scramble(d.slice(i + 4, i + 4 + len), 0x5a);
}

export function bzipData(data) {
  return 'BZh91AY&SY' + u32be(data.length) + scramble(data, 0x33) + u32be(data.length * 40503);
}

export function bunzipData(d) {
  if (!d.startsWith('BZh')) return null;
  const len = readU32be(d, 10);
  if (14 + len > d.length) return null;
  return scramble(d.slice(14, 14 + len), 0x33);
}

const oct = (n, w) => n.toString(8).padStart(w, '0');

function tarHeader(name, { mode, uid, gid, size, mtime, type, uname, gname, linkname = '' }) {
  const h = Array(512).fill('\x00');
  const put = (off, s, len) => { for (let i = 0; i < Math.min(s.length, len); i++) h[off + i] = s[i]; };
  put(0, name, 100);
  put(100, oct(mode & 0o7777, 7), 8);
  put(108, oct(uid, 7), 8);
  put(116, oct(gid, 7), 8);
  put(124, oct(size, 11), 12);
  put(136, oct(Math.floor(mtime / 1000), 11), 12);
  put(148, '        ', 8);
  put(156, type, 1);
  put(157, linkname, 100);
  put(257, 'ustar  \x00', 8);
  put(265, uname, 32);
  put(297, gname, 32);
  let sum = 0;
  for (const c of h) sum += c.charCodeAt(0);
  put(148, oct(sum, 6) + '\x00 ', 8);
  return h.join('');
}

export function tarPack(entries) {
  let out = '';
  for (const e of entries) {
    const body = e.type === '0' ? e.data : '';
    out += tarHeader(e.name, { ...e, size: body.length });
    out += body + '\x00'.repeat((512 - (body.length % 512)) % 512);
  }
  return out + '\x00'.repeat(1024);
}

export function tarUnpack(d) {
  const entries = [];
  let i = 0;
  while (i + 512 <= d.length) {
    const h = d.slice(i, i + 512);
    if (/^\x00*$/.test(h)) break;
    const field = (off, len) => h.slice(off, off + len).replace(/\x00.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const e = {
      name: field(0, 100), mode: parseInt(field(100, 8) || '644', 8), uid: parseInt(field(108, 8) || '0', 8), gid: parseInt(field(116, 8) || '0', 8),
      mtime: parseInt(field(136, 12) || '0', 8) * 1000, type: h[156] === '\x00' ? '0' : h[156], linkname: field(157, 100),
      uname: field(265, 32), gname: field(297, 32), size,
    };
    i += 512;
    e.data = d.slice(i, i + size);
    i += Math.ceil(size / 512) * 512;
    entries.push(e);
  }
  if (!entries.length && d.length) return null;
  return entries;
}

function readFile(ctx, f) {
  return ctx.fs.read(f, ctx.fsCtx);
}

async function compressCmd(ctx, { kind, decompress, toStdout }) {
  const ext = kind === 'gzip' ? '.gz' : '.bz2';
  const label = ctx.name;
  const args = ctx.args.slice();
  let keep = false;
  let verbose = false;
  let force = false;
  const files = [];
  for (const a of args) {
    if (/^-[a-zA-Z]+$/.test(a)) {
      if (a.includes('d')) decompress = true;
      if (a.includes('c')) toStdout = true;
      if (a.includes('k')) keep = true;
      if (a.includes('v')) verbose = true;
      if (a.includes('f')) force = true;
      continue;
    }
    if (a === '--decompress') { decompress = true; continue; }
    if (a === '--stdout') { toStdout = true; continue; }
    if (a === '--keep') { keep = true; continue; }
    files.push(a);
  }
  const pack = kind === 'gzip' ? (d, n) => gzipData(d, n, ctx.world.now()) : (d) => bzipData(d);
  const unpack = kind === 'gzip' ? gunzipData : bunzipData;
  if (!files.length) {
    if (!decompress && ctx.isTTY && !force) {
      ctx.err(`${label}: compressed data not written to a terminal. Use -f to force compression.\nFor help, type: ${label} -h\n`);
      return 1;
    }
    const data = await ctx.readStdin();
    if (decompress) {
      const out = unpack(data);
      if (out === null) { ctx.err(kind === 'gzip' ? `${label}: stdin: not in gzip format\n` : `${label}: (stdin) is not a bzip2 file.\n`); return 1; }
      ctx.out(out);
    } else ctx.out(pack(data, null));
    return 0;
  }
  let status = 0;
  for (const f of files) {
    let data;
    try {
      const node = ctx.fs.get(f, ctx.fsCtx).node;
      if (node.type === 'dir') { ctx.err(`${label}: ${f} is a directory -- ignored\n`); status = 1; continue; }
      data = readFile(ctx, f);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      ctx.err(kind === 'gzip' ? `${label}: ${f}: ${e.message}\n` : `${label}: Can't open input file ${f}: ${e.message}.\n`);
      status = 1;
      continue;
    }
    try {
      if (decompress) {
        let outName;
        if (f.endsWith(ext)) outName = f.slice(0, -ext.length);
        else if (kind === 'gzip' && f.endsWith('.tgz')) outName = f.slice(0, -4) + '.tar';
        else if (kind === 'gzip' && !toStdout) { ctx.err(`${label}: ${f}: unknown suffix -- ignored\n`); status = 1; continue; }
        else {
          outName = `${f}.out`;
          if (!toStdout) ctx.err(`${label}: Can't guess original name for ${f} -- using ${outName}\n`);
        }
        const out = unpack(data);
        if (out === null) {
          ctx.err(kind === 'gzip' ? `${label}: ${f}: not in gzip format\n` : `${label}: ${f} is not a bzip2 file.\n`);
          status = kind === 'gzip' ? 1 : 2;
          continue;
        }
        if (toStdout) { ctx.out(out); continue; }
        if (ctx.fs.tryGet(outName, ctx.fsCtx) && !force) {
          ctx.err(`${label}: ${outName} already exists; not overwritten\n`);
          status = 2;
          continue;
        }
        ctx.fs.write(outName, out, ctx.fsCtx);
        if (!keep) ctx.fs.unlink(f, ctx.fsCtx);
        if (verbose) ctx.err(`${f}:\t 61.4% -- replaced with ${outName}\n`);
      } else {
        if (f.endsWith(ext)) { ctx.err(`${label}: ${f} already has ${ext} suffix -- unchanged\n`); status = 2; continue; }
        const out = pack(data, baseName(f));
        if (toStdout) { ctx.out(out); continue; }
        ctx.fs.write(f + ext, out, ctx.fsCtx);
        if (!keep) ctx.fs.unlink(f, ctx.fsCtx);
        if (verbose) ctx.err(`${f}:\t 61.4% -- replaced with ${f}${ext}\n`);
      }
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      ctx.err(`${label}: ${f}: ${e.message}\n`);
      status = 1;
    }
  }
  return status;
}

export const commands = {
  gzip: { fn: (ctx) => compressCmd(ctx, { kind: 'gzip', decompress: false, toStdout: false }) },
  gunzip: { fn: (ctx) => compressCmd(ctx, { kind: 'gzip', decompress: true, toStdout: false }) },
  zcat: { fn: (ctx) => compressCmd(ctx, { kind: 'gzip', decompress: true, toStdout: true }) },
  bzip2: { fn: (ctx) => compressCmd(ctx, { kind: 'bzip2', decompress: false, toStdout: false }) },
  bunzip2: { fn: (ctx) => compressCmd(ctx, { kind: 'bzip2', decompress: true, toStdout: false }) },
  bzcat: { fn: (ctx) => compressCmd(ctx, { kind: 'bzip2', decompress: true, toStdout: true }) },
  tar: {
    async fn(ctx) {
      const args = ctx.args.slice();
      const o = {};
      const names = [];
      let pendingF = false;
      let first = true;
      while (args.length) {
        const a = args.shift();
        if (pendingF) { o.f = a; pendingF = false; continue; }
        if (a === '-C' || a === '--directory') { o.C = args.shift(); continue; }
        if (a.startsWith('--')) {
          const map = { '--create': 'c', '--extract': 'x', '--list': 't', '--gzip': 'z', '--bzip2': 'j', '--verbose': 'v' };
          if (a.startsWith('--file=')) o.f = a.slice(7);
          else if (map[a]) o[map[a]] = true;
          continue;
        }
        const cluster = a.startsWith('-') ? a.slice(1) : first && /^[cxtzjvfpC]+$/.test(a) ? a : null;
        first = false;
        if (cluster === null) { names.push(a); continue; }
        for (const c of cluster) {
          if (c === 'f') pendingF = true;
          else if (c === 'C') o.C = args.shift();
          else if ('cxtzjvpaJ'.includes(c)) o[c] = true;
          else { ctx.err(`tar: invalid option -- '${c}'\nTry 'tar --help' or 'tar --usage' for more information.\n`); return 2; }
        }
      }
      const modes = ['c', 'x', 't'].filter((k) => o[k]);
      if (modes.length !== 1) {
        ctx.err(`tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information.\n`);
        return 2;
      }
      const m = ctx.machine;
      let status = 0;
      if (o.c) {
        if (!names.length) { ctx.err('tar: Cowardly refusing to create an empty archive\nTry \'tar --help\' or \'tar --usage\' for more information.\n'); return 2; }
        if (!o.f && ctx.isTTY) { ctx.err('tar: Refusing to write archive contents to terminal (missing -f option?)\ntar: Error is not recoverable: exiting now\n'); return 2; }
        const entries = [];
        let warnedSlash = false;
        const add = (p, node) => {
          let name = p.replace(/^\/+/, '');
          if (name !== p && !warnedSlash) { ctx.err("tar: Removing leading `/' from member names\n"); warnedSlash = true; }
          const meta = { mode: node.mode, uid: node.uid, gid: node.gid, mtime: node.mtime, uname: m.uidName(node.uid), gname: m.gidName(node.gid) };
          if (node.type === 'dir') {
            entries.push({ name: name.replace(/\/?$/, '/'), type: '5', data: '', ...meta });
            if (o.v) ctx.out(name.replace(/\/?$/, '/') + '\n');
            if (!can(node, ctx.cred, 'r')) { ctx.err(`tar: ${p}: Cannot open: Permission denied\n`); status = 2; return; }
            for (const [n, c] of node.children) add(`${p.replace(/\/$/, '')}/${n}`, c);
            return;
          }
          if (node.type === 'link') { entries.push({ name, type: '2', data: '', linkname: node.target, ...meta }); if (o.v) ctx.out(name + '\n'); return; }
          let data;
          try { data = ctx.fs.read(p, ctx.fsCtx); } catch (e) { ctx.err(`tar: ${p}: Cannot open: ${e.message}\n`); status = 2; return; }
          entries.push({ name, type: '0', data, ...meta });
          if (o.v) ctx.out(name + '\n');
        };
        for (const nm of names) {
          const node = ctx.fs.tryGet(nm, { ...ctx.fsCtx, follow: false });
          if (!node) { ctx.err(`tar: ${nm}: Cannot stat: No such file or directory\n`); status = 2; continue; }
          add(nm, node);
        }
        let archive = tarPack(entries);
        if (o.z) archive = gzipData(archive, null, ctx.world.now());
        if (o.j) archive = bzipData(archive);
        if (o.f && o.f !== '-') ctx.fs.write(o.f, archive, ctx.fsCtx);
        else ctx.out(archive);
        if (status) ctx.err('tar: Exiting with failure status due to previous errors\n');
        return status;
      }
      // read archive
      let raw;
      try {
        raw = !o.f || o.f === '-' ? await ctx.readStdin() : ctx.fs.read(o.f, ctx.fsCtx);
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        ctx.err(`tar: ${o.f}: Cannot open: ${e.message}\ntar: Error is not recoverable: exiting now\n`);
        return 2;
      }
      // like GNU tar, detect one compression layer (gzip or bzip2) around the archive
      let data = raw;
      const g = gunzipData(raw);
      const b = g === null ? bunzipData(raw) : null;
      if (g !== null) data = g;
      else if (b !== null) data = b;
      const entries = tarUnpack(data);
      if (!entries) { ctx.err('tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n'); return 2; }
      const wanted = names.length ? entries.filter((e) => names.some((n) => e.name === n || e.name.startsWith(n.replace(/\/?$/, '/')))) : entries;
      if (o.t) {
        for (const e of wanted) {
          if (o.v) {
            const d = new Date(e.mtime);
            const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
            const type = e.type === '5' ? 'dir' : e.type === '2' ? 'link' : 'file';
            ctx.out(`${modeString(type, e.mode)} ${`${e.uname}/${e.gname}`.padEnd(15)} ${String(e.size).padStart(6)} ${date} ${e.name}${e.type === '2' ? ' -> ' + e.linkname : ''}\n`);
          } else ctx.out(e.name + '\n');
        }
        return 0;
      }
      const base = o.C ? ctx.resolve(o.C) : ctx.cwd;
      if (o.C && !ctx.fs.tryGet(o.C, ctx.fsCtx)) { ctx.err(`tar: ${o.C}: Cannot open: No such file or directory\ntar: Error is not recoverable: exiting now\n`); return 2; }
      for (const e of wanted) {
        const p = joinPath(base, e.name.replace(/\/$/, ''));
        try {
          if (e.type === '5') {
            if (!ctx.fs.tryGet(p, ctx.fsCtx)) ctx.fs.mkdir(p, ctx.fsCtx, { parents: true });
          } else if (e.type === '2') {
            if (!ctx.fs.tryGet(p, { ...ctx.fsCtx, follow: false })) ctx.fs.symlink(e.linkname, p, ctx.fsCtx);
          } else {
            const dir = p.slice(0, p.lastIndexOf('/')) || '/';
            if (!ctx.fs.tryGet(dir, ctx.fsCtx)) ctx.fs.mkdir(dir, ctx.fsCtx, { parents: true });
            const n = ctx.fs.write(p, e.data, ctx.fsCtx);
            n.mode = e.mode & (ctx.cred.uid === 0 ? 0o7777 : 0o777) & ~ctx.frame.umask;
            n.mtime = e.mtime;
          }
          if (o.v) ctx.out(e.name + '\n');
        } catch (err) {
          if (!(err instanceof FsError)) throw err;
          ctx.err(`tar: ${e.name}: Cannot open: ${err.message}\n`);
          status = 2;
        }
      }
      if (status) ctx.err('tar: Exiting with failure status due to previous errors\n');
      return status;
    },
  },
};

