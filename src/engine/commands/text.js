// Text tools: viewers, filters, search, editors.
import { FsError, can } from '../vfs.js';
import { InterruptSignal, UsageError } from '../shell.js';
import { posixRegex, RegexError } from '../regex.js';
import { md5, sha256, sha1 } from '../hash.js';
import { fromBytes } from '../util.js';
import { getopts, q, readInputs, splitLines, joinLines, escapes, rangeList } from './_util.js';
import { runAwk, AwkError } from '../awk.js';

const RED = '\x1b[01;31m\x1b[K';
const MAG = '\x1b[35m\x1b[K';
const GRN = '\x1b[32m\x1b[K';
const CYN = '\x1b[36m\x1b[K';
const RST = '\x1b[m\x1b[K';

function headTail(ctx) {
  return getopts(ctx, { flags: 'qvf', args: 'nc', numeric: 'n', longArgs: { lines: 'n', bytes: 'c' }, long: { follow: 'f' } });
}

async function viewText(ctx, text, title) {
  if (!ctx.isTTY) { ctx.out(text); return 0; }
  await ctx.term.overlay({ type: 'pager', title, text });
  return 0;
}

function trSet(spec) {
  const classes = {
    lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digit: '0123456789',
    space: ' \t\n\r\f\v', blank: ' \t', punct: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  };
  classes.alpha = classes.lower + classes.upper;
  classes.alnum = classes.alpha + classes.digit;
  let s = spec.replace(/\[:(\w+):\]/g, (m, k) => {
    if (!classes[k]) throw new UsageError(`invalid character class '${k}'`);
    return classes[k].replace(/[-\\]/g, '\\$&');
  });
  s = escapes(s.replace(/\\-/g, '')).replace(//g, '\\-');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { out.push(s[++i]); continue; }
    if (s[i + 1] === '-' && i + 2 < s.length) {
      const a = s.charCodeAt(i);
      const b = s.charCodeAt(i + 2);
      if (b < a) throw new UsageError(`range-endpoints of '${s[i]}-${s[i + 2]}' are in reverse collating sequence order`);
      for (let c = a; c <= b; c++) out.push(String.fromCharCode(c));
      i += 2;
      continue;
    }
    out.push(s[i]);
  }
  return out;
}

function lcsDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push(['=', i, j]); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { ops.push(['+', i, j]); j++; }
    else { ops.push(['-', i, j]); i++; }
  }
  // group into hunks of consecutive changes
  const hunks = [];
  let cur = null;
  for (const op of ops) {
    if (op[0] === '=') { if (cur) { hunks.push(cur); cur = null; } continue; }
    if (!cur) cur = { a0: op[1], b0: op[2], del: [], add: [] };
    if (op[0] === '-') cur.del.push(op[1]); else cur.add.push(op[2]);
  }
  if (cur) hunks.push(cur);
  return hunks;
}

function rng(start, count) {
  if (count === 0) return String(start);
  return count === 1 ? String(start + 1) : `${start + 1},${start + count}`;
}

// ---------- sed ----------
function parseSed(script, extended) {
  const cmds = [];
  let i = 0;
  const s = script;
  const skipWs = () => { while (i < s.length && /[\s;]/.test(s[i])) i++; };
  const readDelim = (delim) => {
    let out = '';
    while (i < s.length && s[i] !== delim) {
      if (s[i] === '\\' && i + 1 < s.length) {
        if (s[i + 1] === delim) { out += delim; i += 2; continue; }
        out += s[i] + s[i + 1];
        i += 2;
        continue;
      }
      if (s[i] === '\n') throw new UsageError(`-e expression #1, char ${i + 1}: unterminated \`s' command`);
      out += s[i++];
    }
    if (i >= s.length) throw new UsageError(`-e expression #1, char ${i}: unterminated \`s' command`);
    i++;
    return out;
  };
  const readAddr = () => {
    if (/\d/.test(s[i])) { let n = ''; while (/\d/.test(s[i])) n += s[i++]; return { line: Number(n) }; }
    if (s[i] === '$') { i++; return { last: true }; }
    if (s[i] === '/' || s[i] === '\\') {
      const d = s[i] === '\\' ? s[++i] : '/';
      i++;
      return { re: posixRegex(readDelim(d), { extended }) };
    }
    return null;
  };
  skipWs();
  while (i < s.length) {
    const cmd = { a1: readAddr(), a2: null, neg: false, active: false };
    if (cmd.a1 && s[i] === ',') { i++; cmd.a2 = readAddr(); }
    while (s[i] === ' ') i++;
    if (s[i] === '!') { cmd.neg = true; i++; }
    const c = s[i++];
    cmd.c = c;
    if (c === 's') {
      const d = s[i++];
      const re = readDelim(d);
      const rep = readDelim(d);
      let flags = '';
      while (i < s.length && /[gpiI0-9]/.test(s[i])) flags += s[i++];
      cmd.re = posixRegex(re, { extended, icase: /[iI]/.test(flags), global: flags.includes('g') });
      cmd.rep = rep;
      cmd.print = flags.includes('p');
      cmd.nth = Number((flags.match(/\d+/) || [0])[0]);
    } else if (c === 'y') {
      const d = s[i++];
      cmd.src = escapes(readDelim(d));
      cmd.dst = escapes(readDelim(d));
      if (cmd.src.length !== cmd.dst.length) throw new UsageError("-e expression #1: strings for `y' command are different lengths");
    } else if ('aic'.includes(c)) {
      while (s[i] === ' ' || s[i] === '\\') i++;
      let t = '';
      while (i < s.length && s[i] !== '\n') t += s[i++];
      cmd.text = t;
    } else if (!'dpq=n'.includes(c)) {
      throw new UsageError(`-e expression #1, char ${i}: unknown command: \`${c}'`);
    }
    cmds.push(cmd);
    skipWs();
  }
  return cmds;
}

function sedReplace(m, rep) {
  return rep.replace(/\\(\d)|\\n|\\t|\\&|\\\\|&/g, (t, d) => {
    if (d !== undefined) return m[Number(d)] ?? '';
    if (t === '\\n') return '\n';
    if (t === '\\t') return '\t';
    if (t === '\\&') return '&';
    if (t === '\\\\') return '\\';
    return m[0];
  });
}

function runSed(cmds, text, quiet) {
  const lines = splitLines(text);
  let out = '';
  const matchAddr = (a, ln, line, last) => (a.line !== undefined ? ln === a.line : a.last ? last : a.re.test(line));
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    const ln = li + 1;
    const last = li === lines.length - 1;
    let deleted = false;
    let quit = false;
    const before = [];
    const after = [];
    for (const cmd of cmds) {
      let sel = true;
      if (cmd.a1) {
        if (cmd.a2) {
          if (!cmd.active) {
            if (matchAddr(cmd.a1, ln, line, last)) {
              cmd.active = true;
              if (cmd.a2.line !== undefined && cmd.a2.line <= ln) cmd.active = false;
              sel = true;
            } else sel = false;
          } else {
            sel = true;
            if (matchAddr(cmd.a2, ln, line, last)) cmd.active = false;
          }
        } else sel = matchAddr(cmd.a1, ln, line, last);
      }
      if (cmd.neg) sel = !sel;
      if (!sel) continue;
      switch (cmd.c) {
        case 's': {
          let count = 0;
          let did = false;
          const re = new RegExp(cmd.re.source, cmd.re.flags.includes('g') || cmd.nth ? cmd.re.flags.replace('g', '') + 'g' : cmd.re.flags);
          line = line.replace(re, (...m) => {
            count++;
            const groups = m.slice(0, -2);
            if (cmd.nth && count !== cmd.nth) return m[0];
            if (!cmd.re.flags.includes('g') && !cmd.nth && count > 1) return m[0];
            did = true;
            return sedReplace(groups, cmd.rep);
          });
          if (did && cmd.print) out += line + '\n';
          break;
        }
        case 'y': line = line.split('').map((ch) => { const k = cmd.src.indexOf(ch); return k >= 0 ? cmd.dst[k] : ch; }).join(''); break;
        case 'd': deleted = true; break;
        case 'p': out += line + '\n'; break;
        case '=': out += ln + '\n'; break;
        case 'q': quit = true; break;
        case 'a': after.push(cmd.text); break;
        case 'i': before.push(cmd.text); break;
        case 'c': deleted = true; after.push(cmd.text); break;
        default: break;
      }
      if (deleted || quit) break;
    }
    for (const b of before) out += b + '\n';
    if (!deleted && !quiet) out += line + '\n';
    for (const a of after) out += a + '\n';
    if (quit) break;
  }
  return out;
}

export const commands = {
  head: {
    async fn(ctx) {
      const r = headTail(ctx);
      if (!r) return 0;
      const { o, rest } = r;
      const { inputs, status } = await readInputs(ctx, rest, { errFmt: (f, e) => `head: cannot open ${q(f)} for reading: ${e.message}\n` });
      const multi = inputs.length > 1 || o.v;
      inputs.forEach(({ name, data }, i) => {
        if (multi && !o.q) ctx.out(`${i ? '\n' : ''}==> ${name === '-' ? 'standard input' : name} <==\n`);
        if (o.c !== undefined) { const n = Number(o.c); ctx.out(n < 0 ? data.slice(0, n) : data.slice(0, n)); return; }
        const n = Number(o.n ?? 10);
        const lines = splitLines(data);
        ctx.out(joinLines(n < 0 ? lines.slice(0, n) : lines.slice(0, n)));
      });
      return status;
    },
  },
  tail: {
    async fn(ctx) {
      const r = headTail(ctx);
      if (!r) return 0;
      const { o, rest } = r;
      const { inputs, status } = await readInputs(ctx, rest, { errFmt: (f, e) => `tail: cannot open ${q(f)} for reading: ${e.message}\n` });
      const multi = inputs.length > 1 || o.v;
      inputs.forEach(({ name, data }, i) => {
        if (multi && !o.q) ctx.out(`${i ? '\n' : ''}==> ${name === '-' ? 'standard input' : name} <==\n`);
        if (o.c !== undefined) { ctx.out(data.slice(-Number(o.c))); return; }
        const spec = String(o.n ?? '10');
        const lines = splitLines(data);
        if (spec.startsWith('+')) ctx.out(joinLines(lines.slice(Math.max(0, Number(spec.slice(1)) - 1))));
        else { const n = Math.abs(Number(spec)); ctx.out(joinLines(n ? lines.slice(-n) : [])); }
      });
      if (o.f && ctx.isTTY) {
        const res = await ctx.term.sleep(3600 * 1000);
        if (res === 'int') throw new InterruptSignal();
      }
      return status;
    },
  },
  wc: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'lwcmL', long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm' } });
      if (!r) return 0;
      const { o, rest } = r;
      const { inputs, status } = await readInputs(ctx, rest);
      const which = o.l || o.w || o.c || o.m ? ['l', 'w', 'm', 'c'].filter((k) => o[k]) : ['l', 'w', 'c'];
      const count = (d) => ({
        l: (d.match(/\n/g) || []).length,
        w: (d.match(/[^\s]+/g) || []).length,
        c: d.length,
        m: fromBytes(d).length,
      });
      const rows = inputs.map((i) => ({ name: i.stdin ? (rest.length ? '-' : '') : i.name, c: count(i.data), stdin: i.stdin }));
      if (rows.length > 1) {
        const t = { l: 0, w: 0, c: 0, m: 0 };
        for (const row of rows) for (const k of Object.keys(t)) t[k] += row.c[k];
        rows.push({ name: 'total', c: t });
      }
      const anyStdin = rows.some((x) => x.stdin);
      const maxVal = Math.max(1, ...rows.flatMap((x) => which.map((k) => x.c[k])));
      const width = anyStdin && (which.length > 1) ? 7 : which.length === 1 && rows.length === 1 ? 0 : String(maxVal).length;
      for (const row of rows) ctx.out(which.map((k) => String(row.c[k]).padStart(width)).join(' ') + (row.name ? ' ' + row.name : '') + '\n');
      return status;
    },
  },
  sort: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'nruhfcbVR', args: 'ktTo', multi: 'k', long: { numeric: 'n', reverse: 'r', unique: 'u', 'human-numeric-sort': 'h', 'ignore-case': 'f' } });
      if (!r) return 0;
      const { o, rest } = r;
      const { inputs, status } = await readInputs(ctx, rest, { errFmt: (f, e) => `sort: cannot read: ${f}: ${e.message}\n` });
      let lines = inputs.flatMap((i) => splitLines(i.data));
      const keys = (o.k || []).map((spec) => {
        const m = spec.match(/^(\d+)(?:\.\d+)?([a-z]*)(?:,(\d+)(?:\.\d+)?([a-z]*))?$/);
        if (!m) throw new UsageError(`invalid number at field start: invalid count at start of '${spec}'`);
        return { from: Number(m[1]), to: m[3] ? Number(m[3]) : null, n: (m[2] + (m[4] || '')).includes('n'), r: (m[2] + (m[4] || '')).includes('r') };
      });
      const sep = o.t;
      const fields = (line) => (sep ? line.split(sep) : line.trim().split(/\s+/));
      const keyOf = (line, k) => {
        if (!k) return line;
        const f = fields(line);
        return f.slice(k.from - 1, k.to ? k.to : f.length).join(sep || ' ');
      };
      const hnum = (s) => {
        const m = s.trim().match(/^(-?\d+(?:\.\d+)?)([KMGTkmgt]?)/);
        if (!m) return 0;
        return Number(m[1]) * 1024 ** ' KMGT'.indexOf((m[2] || ' ').toUpperCase());
      };
      const num = (s) => { const m = s.trim().match(/^-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : 0; };
      const cmpBy = (numeric, human) => (a, b) => {
        if (human) return hnum(a) - hnum(b);
        if (numeric) return num(a) - num(b) || (a < b ? -1 : a > b ? 1 : 0);
        const x = o.f ? a.toLowerCase() : a;
        const y = o.f ? b.toLowerCase() : b;
        return x.localeCompare(y, 'en') || (x < y ? -1 : x > y ? 1 : 0);
      };
      if (o.c) {
        for (let i = 1; i < lines.length; i++) {
          if (cmpBy(o.n, o.h)(lines[i - 1], lines[i]) > 0) { ctx.err(`sort: ${rest[0] || '-'}:${i + 1}: disorder: ${lines[i]}\n`); return 1; }
        }
        return 0;
      }
      if (o.R) lines = lines.map((l) => [ctx.world.rand(), l]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      else if (keys.length) {
        lines.sort((a, b) => {
          for (const k of keys) {
            const c = cmpBy(k.n || o.n, o.h)(keyOf(a, k), keyOf(b, k));
            if (c) return k.r ? -c : c;
          }
          return cmpBy(false, false)(a, b);
        });
      } else lines.sort(cmpBy(o.n, o.h));
      if (o.r) lines.reverse();
      if (o.u) lines = lines.filter((l, i) => i === 0 || cmpBy(o.n, o.h)(lines[i - 1], l) !== 0);
      const text = joinLines(lines);
      if (o.o) { ctx.fs.write(o.o, text, ctx.fsCtx); return status; }
      ctx.out(text);
      return status;
    },
  },
  uniq: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'cdui', long: { count: 'c', repeated: 'd', unique: 'u', 'ignore-case': 'i' } });
      if (!r) return 0;
      const { o, rest } = r;
      const { inputs, status } = await readInputs(ctx, rest.slice(0, 1));
      const lines = splitLines(inputs[0]?.data || '');
      const groups = [];
      for (const l of lines) {
        const last = groups[groups.length - 1];
        if (last && (o.i ? last.line.toLowerCase() === l.toLowerCase() : last.line === l)) last.n++;
        else groups.push({ line: l, n: 1 });
      }
      let out = '';
      for (const g of groups) {
        if (o.d && g.n < 2) continue;
        if (o.u && g.n > 1) continue;
        out += (o.c ? `${String(g.n).padStart(7)} ` : '') + g.line + '\n';
      }
      if (rest[1]) ctx.fs.write(rest[1], out, ctx.fsCtx);
      else ctx.out(out);
      return status;
    },
  },
  cut: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 's', args: 'dfcb', longArgs: { delimiter: 'd', fields: 'f', characters: 'c', bytes: 'b' } });
      if (!r) return 0;
      const { o, rest } = r;
      if (!o.f && !o.c && !o.b) { ctx.err("cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.\n"); return 1; }
      const delim = o.d ?? '\t';
      if (delim.length !== 1) { ctx.err('cut: the delimiter must be a single character\n'); return 1; }
      const sel = rangeList(o.f || o.c || o.b);
      const { inputs, status } = await readInputs(ctx, rest);
      let out = '';
      for (const { data } of inputs) {
        for (const line of splitLines(data)) {
          if (o.f) {
            if (!line.includes(delim)) { if (!o.s) out += line + '\n'; continue; }
            out += line.split(delim).filter((_, i) => sel(i + 1)).join(delim) + '\n';
          } else out += line.split('').filter((_, i) => sel(i + 1)).join('') + '\n';
        }
      }
      ctx.out(out);
      return status;
    },
  },
  tr: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'dscC', long: { delete: 'd', 'squeeze-repeats': 's', complement: 'c' } });
      if (!r) return 0;
      const { o, rest } = r;
      if (!rest.length) { ctx.err("tr: missing operand\nTry 'tr --help' for more information.\n"); return 1; }
      if (!o.d && !o.s && rest.length < 2) { ctx.err(`tr: missing operand after ${q(rest[0])}\nTwo strings must be given when translating.\nTry 'tr --help' for more information.\n`); return 1; }
      const maxOps = o.d && !o.s ? 1 : 2;
      if (rest.length > maxOps) { ctx.err(`tr: extra operand ${q(rest[maxOps])}\nTry 'tr --help' for more information.\n`); return 1; }
      const set1 = trSet(rest[0]);
      const set2 = rest[1] !== undefined ? trSet(rest[1]) : [];
      const data = await ctx.readStdin();
      const in1 = (ch) => (o.c || o.C ? !set1.includes(ch) : set1.includes(ch));
      let out = '';
      let prev = null;
      for (const ch of data) {
        let c = ch;
        if (o.d && in1(ch)) continue;
        if (!o.d && set2.length && in1(ch)) {
          const k = set1.indexOf(ch);
          c = set2[Math.min(k, set2.length - 1)];
        }
        const squeezeSet = o.d ? set2 : set2.length ? set2 : set1;
        if (o.s && c === prev && squeezeSet.includes(c)) continue;
        out += c;
        prev = c;
      }
      ctx.out(out);
      return 0;
    },
  },
  tee: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'a', long: { append: 'a' } });
      if (!r) return 0;
      const data = await ctx.readStdin();
      let status = 0;
      for (const f of r.rest) {
        try { ctx.fs.write(f, data, ctx.fsCtx, { append: !!r.o.a }); } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`tee: ${f}: ${e.message}\n`);
          status = 1;
        }
      }
      ctx.out(data);
      return status;
    },
  },
  rev: {
    async fn(ctx) {
      const { inputs, status } = await readInputs(ctx, ctx.args);
      for (const { data } of inputs) ctx.out(joinLines(splitLines(data).map((l) => [...l].reverse().join(''))));
      return status;
    },
  },
  tac: {
    async fn(ctx) {
      const { inputs, status } = await readInputs(ctx, ctx.args.filter((a) => !a.startsWith('-')));
      for (const { data } of inputs) ctx.out(joinLines(splitLines(data).reverse()));
      return status;
    },
  },
  paste: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 's', args: 'd', longArgs: { delimiters: 'd' } });
      if (!r) return 0;
      const delims = escapes(r.o.d ?? '\t');
      const { inputs, status } = await readInputs(ctx, r.rest);
      const cols = inputs.map((i) => splitLines(i.data));
      const join = (parts) => parts.map((p, i) => (i ? delims[(i - 1) % delims.length] : '') + p).join('');
      if (r.o.s) { for (const c of cols) ctx.out(join(c) + '\n'); return status; }
      const n = Math.max(0, ...cols.map((c) => c.length));
      for (let i = 0; i < n; i++) ctx.out(join(cols.map((c) => c[i] ?? '')) + '\n');
      return status;
    },
  },
  column: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 't', args: 's' });
      if (!r) return 0;
      const { inputs, status } = await readInputs(ctx, r.rest);
      const lines = inputs.flatMap((i) => splitLines(i.data));
      if (!r.o.t) { ctx.out(joinLines(lines)); return status; }
      const sep = r.o.s ? new RegExp(`[${r.o.s.replace(/[\]\\^-]/g, '\\$&')}]+`) : /\s+/;
      const rows = lines.filter((l) => l.trim()).map((l) => l.trim().split(sep));
      const w = [];
      for (const row of rows) row.forEach((c, i) => { w[i] = Math.max(w[i] || 0, c.length); });
      for (const row of rows) ctx.out(row.map((c, i) => (i === row.length - 1 ? c : c.padEnd(w[i] + 2))).join('') + '\n');
      return status;
    },
  },
  nl: {
    async fn(ctx) {
      const { inputs, status } = await readInputs(ctx, ctx.args.filter((a) => !a.startsWith('-')));
      let n = 1;
      for (const { data } of inputs) for (const l of splitLines(data)) ctx.out(l.trim() ? `${String(n++).padStart(6)}\t${l}\n` : '       \n');
      return status;
    },
  },
  seq: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'w', args: 's', numeric: null });
      if (!r) return 0;
      const nums = r.rest.map(Number);
      if (!nums.length || nums.some(Number.isNaN)) { ctx.err("seq: missing operand\nTry 'seq --help' for more information.\n"); return 1; }
      let [a, inc, b] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
      const out = [];
      for (let v = a; inc > 0 ? v <= b : v >= b; v += inc) { out.push(String(v)); if (out.length > 100000) break; }
      const w = r.o.w ? Math.max(...out.map((x) => x.length)) : 0;
      ctx.out(out.map((x) => x.padStart(w, '0')).join(r.o.s ?? '\n') + (out.length ? '\n' : ''));
      return 0;
    },
  },
  diff: {
    fn(ctx) {
      const r = getopts(ctx, { flags: 'uqsy' });
      if (!r) return 0;
      const { o, rest } = r;
      if (rest.length !== 2) { ctx.err(`diff: missing operand after '${rest[0] || 'diff'}'\ndiff: Try 'diff --help' for more information.\n`); return 2; }
      let A;
      let B;
      try {
        A = ctx.fs.read(rest[0], ctx.fsCtx);
        B = ctx.fs.read(rest[1], ctx.fsCtx);
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        ctx.err(`diff: ${!ctx.fs.tryGet(rest[0], ctx.fsCtx) ? rest[0] : rest[1]}: ${e.message}\n`);
        return 2;
      }
      if (A === B) { if (o.s) ctx.out(`Files ${rest[0]} and ${rest[1]} are identical\n`); return 0; }
      if (o.q) { ctx.out(`Files ${rest[0]} and ${rest[1]} differ\n`); return 1; }
      const a = splitLines(A);
      const b = splitLines(B);
      const hunks = lcsDiff(a, b);
      let out = '';
      if (o.u) {
        out += `--- ${rest[0]}\n+++ ${rest[1]}\n`;
        for (const h of hunks) {
          const a0 = h.del.length ? h.del[0] : h.a0;
          const b0 = h.add.length ? h.add[0] : h.b0;
          const ctxStart = Math.max(0, a0 - 3);
          const preCtx = a.slice(ctxStart, a0);
          const aEnd = h.del.length ? h.del[h.del.length - 1] + 1 : a0;
          const postCtx = a.slice(aEnd, aEnd + 3);
          out += `@@ -${ctxStart + 1},${preCtx.length + h.del.length + postCtx.length} +${Math.max(1, b0 - preCtx.length + 1)},${preCtx.length + h.add.length + postCtx.length} @@\n`;
          out += preCtx.map((l) => ` ${l}\n`).join('') + h.del.map((i) => `-${a[i]}\n`).join('') + h.add.map((j) => `+${b[j]}\n`).join('') + postCtx.map((l) => ` ${l}\n`).join('');
        }
      } else {
        for (const h of hunks) {
          const aStart = h.del.length ? h.del[0] : h.a0;
          const bStart = h.add.length ? h.add[0] : h.b0;
          if (h.del.length && h.add.length) out += `${rng(aStart, h.del.length)}c${rng(bStart, h.add.length)}\n`;
          else if (h.del.length) out += `${rng(aStart, h.del.length)}d${bStart}\n`;
          else out += `${aStart}a${rng(bStart, h.add.length)}\n`;
          out += h.del.map((i) => `< ${a[i]}\n`).join('');
          if (h.del.length && h.add.length) out += '---\n';
          out += h.add.map((j) => `> ${b[j]}\n`).join('');
        }
      }
      ctx.out(out);
      return 1;
    },
  },
  grep: {
    async fn(ctx) {
      const r = getopts(ctx, {
        flags: 'ivncowxlLrRhHqsEFPaZz',
        args: 'eABCmf',
        multi: 'e',
        long: {
          'ignore-case': 'i', 'invert-match': 'v', 'line-number': 'n', count: 'c', 'only-matching': 'o', 'word-regexp': 'w', 'line-regexp': 'x',
          'files-with-matches': 'l', 'files-without-match': 'L', recursive: 'r', 'no-filename': 'h', 'with-filename': 'H', quiet: 'q', silent: 'q',
          'no-messages': 's', 'extended-regexp': 'E', 'fixed-strings': 'F', text: 'a', color: 'color', colour: 'color',
        },
        longArgs: { regexp: 'e', 'max-count': 'm', 'after-context': 'A', 'before-context': 'B', context: 'C' },
        exitCode: 2,
      });
      if (!r) return 0;
      const { o, rest } = r;
      let patterns = o.e;
      if (!patterns) {
        if (!rest.length) { ctx.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n"); return 2; }
        patterns = [rest.shift()];
      }
      patterns = patterns.flatMap((p) => p.split('\n'));
      let regexes;
      try {
        regexes = patterns.map((p) => posixRegex(p, { extended: o.E || o.P, icase: o.i, fixed: o.F, word: o.w, line: o.x, global: true }));
      } catch (e) {
        if (e instanceof RegexError) { ctx.err(`grep: ${e.message}\n`); return 2; }
        throw e;
      }
      const color = ctx.isTTY && o.color !== 'never';
      const recursive = o.r || o.R;
      let files = rest.length ? rest : recursive ? ['.'] : ['-'];
      const expanded = [];
      let status = 1;
      let errors = false;
      const addTree = (path, node) => {
        if (node.type === 'dir') {
          if (!can(node, ctx.cred, 'r') || !can(node, ctx.cred, 'x')) {
            if (!o.s) ctx.err(`grep: ${path}: Permission denied\n`);
            errors = true;
            return;
          }
          for (const [name, child] of node.children) {
            if (child.type === 'link' && !o.R) continue;
            const p = path === '.' && !rest.length ? name : `${path.replace(/\/$/, '')}/${name}`;
            const c = child.type === 'link' ? ctx.fs.tryGet(p, ctx.fsCtx) : child;
            if (c) addTree(p, c);
          }
          return;
        }
        expanded.push(path);
      };
      for (const f of files) {
        if (f === '-') { expanded.push('-'); continue; }
        const node = ctx.fs.tryGet(f, ctx.fsCtx);
        if (node && node.type === 'dir') {
          if (recursive) addTree(f, node);
          else { if (!o.s) ctx.err(`grep: ${f}: Is a directory\n`); }
          continue;
        }
        expanded.push(f);
      }
      files = expanded;
      const showName = o.H || (!o.h && (files.length > 1 || recursive));
      const ctxA = Number(o.A ?? o.C ?? 0);
      const ctxB = Number(o.B ?? o.C ?? 0);
      const max = o.m !== undefined ? Number(o.m) : Infinity;
      const nameOut = (f) => (color ? `${MAG}${f}${RST}${CYN}:${RST}` : `${f}:`);
      let out = '';
      for (const f of files) {
        let data;
        if (f === '-') data = await ctx.readStdin();
        else {
          try { data = ctx.fs.read(f, ctx.fsCtx); } catch (e) {
            if (!(e instanceof FsError)) throw e;
            if (!o.s) ctx.err(`grep: ${f}: ${e.message}\n`);
            errors = true;
            continue;
          }
        }
        const label = f === '-' ? '(standard input)' : f;
        const binary = !o.a && data.includes('\x00');
        const lines = splitLines(data);
        let count = 0;
        let lastPrinted = -1;
        let pendingAfter = 0;
        const matches = (line) => regexes.some((re) => { re.lastIndex = 0; return re.test(line); });
        for (let i = 0; i < lines.length && count < max; i++) {
          const line = lines[i];
          const hit = matches(line) !== !!o.v;
          if (!hit) {
            if (pendingAfter > 0 && !o.c && !o.l && !o.L && !o.q && !binary) {
              out += (showName ? (color ? `${MAG}${label}${RST}${CYN}-${RST}` : `${label}-`) : '') + (o.n ? `${i + 1}-` : '') + line + '\n';
              lastPrinted = i;
              pendingAfter--;
            }
            continue;
          }
          count++;
          status = 0;
          if (o.q || o.l || o.L || o.c || binary) continue;
          if ((ctxA || ctxB) && lastPrinted >= 0 && i - ctxB > lastPrinted + 1) out += color ? `${CYN}--${RST}\n` : '--\n';
          for (let b = Math.max(lastPrinted + 1, i - ctxB); b < i; b++) {
            out += (showName ? `${label}-` : '') + (o.n ? `${b + 1}-` : '') + lines[b] + '\n';
          }
          const prefix = (showName ? nameOut(label) : '') + (o.n ? (color ? `${GRN}${i + 1}${RST}${CYN}:${RST}` : `${i + 1}:`) : '');
          if (o.o && !o.v) {
            for (const re of regexes) {
              re.lastIndex = 0;
              let m;
              while ((m = re.exec(line))) {
                if (!m[0]) { re.lastIndex++; continue; }
                out += prefix + (color ? RED + m[0] + RST : m[0]) + '\n';
              }
            }
          } else if (color && !o.v) {
            let painted = line;
            for (const re of regexes) { re.lastIndex = 0; painted = painted.replace(re, (m0) => (m0 ? RED + m0 + RST : m0)); }
            out += prefix + painted + '\n';
          } else out += prefix + line + '\n';
          lastPrinted = i;
          pendingAfter = ctxA;
        }
        if (o.q && count) { ctx.out(out); return 0; }
        if (o.c) out += (showName ? nameOut(label) : '') + count + '\n';
        else if (o.l && count) out += (color ? `${MAG}${label}${RST}` : label) + '\n';
        else if (o.L && !count) out += label + '\n';
        else if (binary && count && !o.l) out += `grep: ${label}: binary file matches\n`;
      }
      if (!o.q) ctx.out(out);
      if (o.L) status = out ? 0 : 1;
      return errors && status !== 0 ? 2 : status;
    },
  },
  sed: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'nErsz', args: 'ei', multi: 'e', long: { quiet: 'n', silent: 'n', 'regexp-extended': 'E' }, longArgs: { expression: 'e', 'in-place': 'i' } });
      if (!r) return 0;
      const { o, rest } = r;
      // -i takes an optional suffix glued to it; treat a following word as a file
      let inPlace = false;
      if (o.i !== undefined) { inPlace = true; if (!/^\./.test(o.i)) rest.unshift(o.i); }
      let script;
      if (o.e) script = o.e.join('\n');
      else {
        if (!rest.length) { ctx.err('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n'); return 1; }
        script = rest.shift();
      }
      let cmds;
      try { cmds = parseSed(script, o.E || o.r); } catch (e) {
        if (e instanceof UsageError || e instanceof RegexError) { ctx.err(`sed: ${e.message}\n`); return 1; }
        throw e;
      }
      if (inPlace) {
        let status = 0;
        for (const f of rest) {
          try {
            const data = ctx.fs.read(f, ctx.fsCtx);
            if (o.i && o.i.startsWith('.')) ctx.fs.write(f + o.i, data, ctx.fsCtx);
            for (const c of cmds) c.active = false;
            ctx.fs.write(f, runSed(cmds, data, o.n), ctx.fsCtx);
          } catch (e) {
            if (!(e instanceof FsError)) throw e;
            ctx.err(`sed: can't read ${f}: ${e.message}\n`);
            status = 2;
          }
        }
        return status;
      }
      const { inputs, status } = await readInputs(ctx, rest, { errFmt: (f, e) => `sed: can't read ${f}: ${e.message}\n` });
      ctx.out(runSed(cmds, inputs.map((i) => i.data).join(''), o.n));
      return status ? 2 : 0;
    },
  },
  awk: {
    async fn(ctx) {
      const args = ctx.args.slice();
      let fs = null;
      const vars = {};
      let prog = null;
      while (args.length) {
        const a = args[0];
        if (a === '--') { args.shift(); break; }
        if (a.startsWith('-F')) { args.shift(); fs = a.length > 2 ? a.slice(2) : args.shift(); continue; }
        if (a === '-v') { args.shift(); const kv = args.shift() || ''; const i = kv.indexOf('='); vars[kv.slice(0, i)] = kv.slice(i + 1); continue; }
        if (a === '--help') { ctx.out("Usage: awk [-F fs] [-v var=value] 'program' [file ...]\n"); return 0; }
        break;
      }
      prog = args.shift();
      if (prog === undefined) { ctx.err("usage: awk [-F fs][-v var=value]['prog' | -f progfile][file ...]\n"); return 2; }
      const files = args;
      try {
        const out = await runAwk(prog, {
          fs: fs === 't' ? '\t' : fs,
          vars,
          files,
          read: async (f) => (f === '-' ? ctx.readStdin() : ctx.fs.read(f, ctx.fsCtx)),
          stdin: () => ctx.readStdin(),
        });
        ctx.out(out);
        return 0;
      } catch (e) {
        if (e instanceof AwkError) { ctx.err(`awk: ${e.message}\n`); return 2; }
        if (e instanceof FsError) { ctx.err(`awk: cannot open "${e.path || ''}" (${e.message})\n`); return 2; }
        throw e;
      }
    },
  },
  xargs: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'tr0', args: 'nId', stopAtFirst: true, longArgs: { 'max-args': 'n', 'replace': 'I' } });
      if (!r) return 0;
      const { o, rest } = r;
      const cmd = rest.length ? rest : ['echo'];
      const data = await ctx.readStdin();
      let items;
      if (o['0']) items = data.split('\0').filter(Boolean);
      else if (o.d) items = data.split(escapes(o.d)).filter(Boolean);
      else if (o.I) items = splitLines(data).filter((l) => l.trim());
      else items = (data.match(/"[^"]*"|'[^']*'|(?:\\.|[^\s])+/g) || []).map((t) => t.replace(/^["']|["']$/g, '').replace(/\\(.)/g, '$1'));
      if (!items.length && o.r) return 0;
      const batches = [];
      if (o.I) for (const it of items) batches.push(cmd.map((c) => c.split(o.I).join(it)));
      else {
        const n = o.n ? Number(o.n) : Infinity;
        if (!items.length) batches.push(cmd.slice());
        for (let i = 0; i < items.length; i += n === Infinity ? items.length : n) batches.push([...cmd, ...items.slice(i, i + (n === Infinity ? items.length : n))]);
      }
      let status = 0;
      for (const argv of batches) {
        if (o.t) ctx.err(argv.join(' ') + '\n');
        const st = await ctx.run(argv, { ...ctx.io, stdin: '' }, { via: 'xargs' });
        if (st === 127) return 127;
        if (st !== 0) status = 123;
      }
      return status;
    },
  },
  strings: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'a', args: 'n', numeric: 'n' });
      if (!r) return 0;
      const min = Number(r.o.n ?? 4);
      const { inputs, status } = await readInputs(ctx, r.rest, { errFmt: (f, e) => `strings: '${f}': ${e.message}\n` });
      for (const { data } of inputs) {
        const re = new RegExp(`[\\x20-\\x7e\\t]{${min},}`, 'g');
        for (const m of data.match(re) || []) ctx.out(m + '\n');
      }
      return status;
    },
  },
  base64: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'di', args: 'w', long: { decode: 'd', 'ignore-garbage': 'i' }, longArgs: { wrap: 'w' } });
      if (!r) return 0;
      const { o, rest } = r;
      const { inputs, status } = await readInputs(ctx, rest.slice(0, 1), { errFmt: (f, e) => `base64: ${f}: ${e.message}\n` });
      if (status) return status;
      const data = inputs[0].data;
      if (o.d) {
        const clean = data.replace(/\s+/g, '');
        if (/[^A-Za-z0-9+/=]/.test(clean) && !o.i) { ctx.err('base64: invalid input\n'); return 1; }
        try { ctx.out(atob(clean.replace(/[^A-Za-z0-9+/=]/g, ''))); } catch { ctx.err('base64: invalid input\n'); return 1; }
        return 0;
      }
      const enc = btoa(data);
      const w = o.w !== undefined ? Number(o.w) : 76;
      ctx.out((w ? enc.match(new RegExp(`.{1,${w}}`, 'g')) || [] : [enc]).join('\n') + '\n');
      return 0;
    },
  },
  xxd: {
    async fn(ctx) {
      const r = getopts(ctx, { flags: 'rpu', args: 'lcs' });
      if (!r) return 0;
      const { o, rest } = r;
      const { inputs, status } = await readInputs(ctx, rest.slice(0, 1), { errFmt: (f, e) => `xxd: ${f}: ${e.message}\n` });
      if (status) return 2;
      let data = inputs[0].data;
      if (o.r) {
        let bytes = '';
        if (o.p) {
          const hex = data.replace(/[^0-9a-fA-F]/g, '');
          for (let i = 0; i + 1 < hex.length; i += 2) bytes += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        } else {
          for (const line of splitLines(data)) {
            const m = line.match(/^\s*([0-9a-fA-F]+):\s?(.*)$/);
            if (!m) continue;
            const off = parseInt(m[1], 16);
            const hex = m[2].slice(0, 40).replace(/[^0-9a-fA-F]/g, '');
            while (bytes.length < off) bytes += '\0';
            let chunk = '';
            for (let i = 0; i + 1 < hex.length; i += 2) chunk += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
            bytes = bytes.slice(0, off) + chunk + bytes.slice(off + chunk.length);
          }
        }
        if (rest[1]) ctx.fs.write(rest[1], bytes, ctx.fsCtx);
        else ctx.out(bytes);
        return 0;
      }
      if (o.s) data = data.slice(Number(o.s));
      if (o.l) data = data.slice(0, Number(o.l));
      const hx = (c) => c.charCodeAt(0).toString(16).padStart(2, '0');
      let out = '';
      if (o.p) {
        const all = [...data].map(hx).join('');
        out = (all.match(/.{1,60}/g) || []).join('\n') + (all ? '\n' : '');
      } else {
        const cols = Number(o.c || 16);
        for (let i = 0; i < data.length; i += cols) {
          const chunk = data.slice(i, i + cols);
          let hex = '';
          for (let j = 0; j < chunk.length; j++) hex += hx(chunk[j]) + (j % 2 === 1 && j < cols - 1 ? ' ' : '');
          const ascii = chunk.replace(/[^\x20-\x7e]/g, '.');
          out += `${i.toString(16).padStart(8, '0')}: ${hex.padEnd(cols * 2 + Math.floor(cols / 2) - 1)}  ${ascii}\n`;
        }
      }
      if (rest[1]) ctx.fs.write(rest[1], out, ctx.fsCtx);
      else ctx.out(o.u ? out.toUpperCase() : out);
      return 0;
    },
  },
  md5sum: { fn: (ctx) => hashCmd(ctx, md5) },
  sha1sum: { fn: (ctx) => hashCmd(ctx, sha1) },
  sha256sum: { fn: (ctx) => hashCmd(ctx, sha256) },
  less: { fn: (ctx) => pager(ctx) },
  more: { fn: (ctx) => pager(ctx) },
  man: {
    async fn(ctx) {
      const name = ctx.args.filter((a) => !/^\d$/.test(a) && !a.startsWith('-'))[0];
      if (!name) { ctx.err('What manual page do you want?\nFor example, try \'man man\'.\n'); return 1; }
      const doc = ctx.sh.docs?.[name];
      if (!doc) { ctx.err(`No manual entry for ${name}\n`); return 16; }
      return viewText(ctx, manPage(name, doc, Math.min(ctx.cols, 100)), `${name.toUpperCase()}(1)`);
    },
  },
  nano: { fn: (ctx) => editor(ctx) },
  pico: { hidden: true, fn: (ctx) => editor(ctx) },
  vi: { fn: (ctx) => editor(ctx, 'vi') },
  vim: { fn: (ctx) => editor(ctx, 'vim') },
};

async function hashCmd(ctx, fn) {
  const { inputs, status } = await readInputs(ctx, ctx.args.filter((a) => !a.startsWith('-')), { errFmt: (f, e) => `${ctx.name}: ${f}: ${e.message}\n` });
  for (const { name, data } of inputs) ctx.out(`${fn(data)}  ${name}\n`);
  return status;
}

async function pager(ctx) {
  const files = ctx.args.filter((a) => !a.startsWith('-'));
  if (!files.length) {
    const data = await ctx.readStdin();
    return viewText(ctx, data, 'standard input');
  }
  let status = 0;
  const parts = [];
  for (const f of files) {
    try {
      const node = ctx.fs.get(f, ctx.fsCtx).node;
      if (node.type === 'dir') { ctx.err(`${f} is a directory\n`); status = 1; continue; }
      parts.push({ f, data: ctx.fs.read(f, ctx.fsCtx) });
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      ctx.err(`${f}: ${e.message}\n`);
      status = 1;
    }
  }
  if (!parts.length) return status;
  if (!ctx.isTTY) { for (const p of parts) ctx.out(p.data); return status; }
  for (const p of parts) {
    const text = p.data.includes('\x00') ? `"${p.f}" may be a binary file.  See it anyway?\n\n${p.data.replace(/[\x00-\x08\x0e-\x1f]/g, '·')}` : p.data;
    await ctx.term.overlay({ type: 'pager', title: p.f, text });
  }
  return status;
}

export function manPage(name, doc, cols = 80) {
  const head = `${name.toUpperCase()}(1)`;
  const ind = (t, n = 7) => t.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
  const bar = (mid) => {
    const w = Math.max(cols, head.length * 2 + mid.length + 2);
    const gap = w - head.length * 2 - mid.length;
    return head + ' '.repeat(Math.floor(gap / 2)) + mid + ' '.repeat(Math.ceil(gap / 2)) + head;
  };
  let s = `${cols < 50 ? head : bar('User Commands')}\n\nNAME\n${ind(`${name} - ${doc.summary}`)}\n\nSYNOPSIS\n${ind(doc.synopsis || name)}\n\nDESCRIPTION\n${ind(doc.desc || doc.summary)}\n`;
  if (doc.flags?.length) {
    s += '\nOPTIONS\n';
    for (const [f, d] of doc.flags) s += `${ind(f)}\n${ind(d, 14)}\n\n`;
  }
  if (doc.examples?.length) {
    s += 'EXAMPLES\n';
    for (const [c, d] of doc.examples) s += `${ind(c)}\n${ind(d, 14)}\n\n`;
  }
  if (doc.hacker) s += `HACKER'S NOTE\n${ind(doc.hacker)}\n\n`;
  s += `${cols < 50 ? 'Linux Quest, October 2026' : bar('Linux Quest, October 2026')}\n`;
  return s;
}

async function editor(ctx, asked) {
  if (asked) ctx.out(`(${asked} is a mountain for a later stage. Opening nano, the beginner-friendly editor, instead.)\n`);
  const file = ctx.args.filter((a) => !a.startsWith('-') && !a.startsWith('+'))[0];
  let content = '';
  let note = '';
  let readonly = false;
  if (file) {
    const node = ctx.fs.tryGet(file, ctx.fsCtx);
    if (node) {
      if (node.type === 'dir') { note = `"${file}" is a directory`; readonly = true; }
      else if (!can(node, ctx.cred, 'r')) { note = `Error reading ${file}: Permission denied`; }
      else {
        content = fromBytes(node.content);
        if (!can(node, ctx.cred, 'w')) note = `${file} is meant to be read-only`;
      }
    } else note = 'New File';
  }
  const fsCtx = ctx.fsCtx;
  const fs = ctx.fs;
  await ctx.term.overlay({
    type: 'editor',
    path: file || null,
    content,
    note,
    readonly,
    save(text, name) {
      const target = name || file;
      if (!target) return { ok: false, msg: 'No file name' };
      // like nano, end a non-empty file with a newline
      if (text && !text.endsWith('\n')) text += '\n';
      try {
        fs.write(target, unescape(encodeURIComponent(text)), fsCtx);
        return { ok: true, msg: `Wrote ${text.split('\n').length - (text.endsWith('\n') ? 1 : 0)} lines` };
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        return { ok: false, msg: `Error writing ${target}: ${e.message}` };
      }
    },
  });
  return 0;
}

