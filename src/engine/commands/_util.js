// Helpers shared by command implementations: GNU-style option parsing, input reading, quoting.
import { UsageError } from '../shell.js';
import { FsError } from '../vfs.js';

// spec: { flags: 'abc', args: 'nf' (flags taking a value), long: { all: 'a' }, longArgs: { lines: 'n' },
//         stopAtFirst: false, numeric: 'n' (allow -5 as -n 5), exitCode: 1 }
// Returns { o: {flag: true|value|[values]}, rest: [] } or null when --help was printed.
export function getopts(ctx, spec = {}) {
  const flags = spec.flags || '';
  const withArg = spec.args || '';
  const long = spec.long || {};
  const longArgs = spec.longArgs || {};
  const multi = spec.multi || '';
  const o = {};
  const rest = [];
  const args = ctx.args;
  const bad = (msg) => {
    throw new UsageError(`${msg}\nTry '${ctx.name} --help' for more information.`, spec.exitCode ?? (ctx.name === 'ls' ? 2 : 1));
  };
  const setOpt = (k, v) => {
    if (multi.includes(k)) (o[k] ||= []).push(v);
    else o[k] = v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { rest.push(...args.slice(i + 1)); break; }
    if (a === '--help') { ctx.out(helpText(ctx)); return null; }
    if (a.startsWith('--') && a.length > 2) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (k in longArgs) {
        if (v !== undefined) setOpt(longArgs[k], v);
        else if (i + 1 < args.length) setOpt(longArgs[k], args[++i]);
        else bad(`option '--${k}' requires an argument`);
      } else if (k in long) setOpt(long[k], v === undefined ? true : v);
      else if (spec.ignoreUnknownLong) continue;
      else bad(`unrecognized option '${a}'`);
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (spec.numeric && /^-\d+$/.test(a)) { setOpt(spec.numeric, a.slice(1)); continue; }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (withArg.includes(c)) {
          const v = a.slice(j + 1) || args[++i];
          if (v === undefined) bad(`option requires an argument -- '${c}'`);
          setOpt(c, v);
          break;
        }
        if (!flags.includes(c)) bad(`invalid option -- '${c}'`);
        o[c] = true;
      }
      continue;
    }
    rest.push(a);
    if (spec.stopAtFirst) { rest.push(...args.slice(i + 1)); break; }
  }
  return { o, rest };
}

export function helpText(ctx) {
  const doc = ctx.sh.docs?.[ctx.name];
  if (!doc) return `Usage: ${ctx.name} [OPTION]... [FILE]...\n(Type 'man ${ctx.name}' for the full manual.)\n`;
  let s = `Usage: ${doc.synopsis || ctx.name}\n${doc.summary}\n`;
  if (doc.flags?.length) {
    s += '\n';
    for (const [f, d] of doc.flags) s += `  ${f.padEnd(22)} ${d}\n`;
  }
  s += `\nFull manual: man ${ctx.name}\n`;
  return s;
}

// Quote a name for error messages the way GNU coreutils does.
export function q(name) {
  if (/'/.test(name)) return `"${name}"`;
  return `'${name}'`;
}

// Shell-escape style quoting used by ls on a terminal.
export function lsQuote(name) {
  if (!/[\s'"\\$`!*?&;|<>(){}[\]#~]/.test(name)) return name;
  if (!name.includes("'")) return `'${name}'`;
  return `"${name.replace(/(["\\$`])/g, '\\$1')}"`;
}

// Read each named input (or stdin for none / "-"). Returns [{ name, data }] and reports errors.
export async function readInputs(ctx, files, { label = ctx.name, errFmt } = {}) {
  const out = [];
  let status = 0;
  const list = files.length ? files : ['-'];
  for (const f of list) {
    if (f === '-') {
      out.push({ name: '-', data: await ctx.readStdin(), stdin: true });
      continue;
    }
    try {
      out.push({ name: f, data: ctx.fs.read(f, ctx.fsCtx) });
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      ctx.err(errFmt ? errFmt(f, e) : `${label}: ${f}: ${e.message}\n`);
      status = 1;
    }
  }
  return { inputs: out, status };
}

export function splitLines(data) {
  if (!data) return [];
  const lines = data.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function joinLines(lines) {
  return lines.length ? lines.join('\n') + '\n' : '';
}

// Interpret backslash escapes (echo -e, printf).
export function escapes(s, { stopOnC = false } = {}) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\' || i + 1 >= s.length) { out += c; continue; }
    const n = s[++i];
    switch (n) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'a': out += '\x07'; break;
      case 'b': out += '\b'; break;
      case 'e': out += '\x1b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '\\': out += '\\'; break;
      case 'c': if (stopOnC) return { text: out, stop: true }; out += '\\c'; break;
      case 'x': {
        const m = s.slice(i + 1).match(/^[0-9a-fA-F]{1,2}/);
        if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += m[0].length; } else out += '\\x';
        break;
      }
      case '0': {
        const m = s.slice(i + 1).match(/^[0-7]{0,3}/);
        out += String.fromCharCode(parseInt(m[0] || '0', 8));
        i += m[0].length;
        break;
      }
      default: out += '\\' + n;
    }
  }
  return stopOnC ? { text: out, stop: false } : out;
}

// Parse a list like "1,3-5,7-" into a predicate over 1-based positions.
export function rangeList(spec) {
  const ranges = spec.split(',').map((r) => {
    const m = r.match(/^(\d*)-(\d*)$/);
    if (m) return [m[1] ? Number(m[1]) : 1, m[2] ? Number(m[2]) : Infinity];
    if (/^\d+$/.test(r)) return [Number(r), Number(r)];
    throw new UsageError(`invalid field value '${r}'`);
  });
  return (n) => ranges.some(([a, b]) => n >= a && n <= b);
}
