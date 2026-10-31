// Word expansion in bash order: brace → tilde → parameter/command/arithmetic → word splitting → globbing.
// `env` is supplied by the shell: { get, set, positional, home, sub, glob }.
import { lexWord } from './parser.js';
import { lsCompare } from './util.js';

export class ExpansionError extends Error {}

const PH_OPEN = '';
const PH_CLOSE = '';

// ---------- brace expansion ----------
export function braceExpand(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0;
    let j = i;
    const commas = [];
    for (; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') {
        depth--;
        if (depth === 0) break;
      } else if (s[j] === ',' && depth === 1) commas.push(j);
    }
    if (j >= s.length) return [s];
    const pre = s.slice(0, i);
    const body = s.slice(i + 1, j);
    const post = s.slice(j + 1);
    let alts = null;
    if (commas.length) {
      alts = [];
      let last = i + 1;
      for (const c of commas) { alts.push(s.slice(last, c)); last = c + 1; }
      alts.push(s.slice(last, j));
    } else {
      const m = body.match(/^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/);
      const ml = body.match(/^([a-zA-Z])\.\.([a-zA-Z])$/);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        const step = Math.abs(Number(m[3] || 1)) || 1;
        const width = /^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2]) ? Math.max(m[1].length, m[2].length) : 0;
        alts = [];
        for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? step : -step) {
          alts.push(width ? String(v).padStart(width, '0') : String(v));
          if (alts.length > 5000) break;
        }
      } else if (ml) {
        const a = ml[1].charCodeAt(0);
        const b = ml[2].charCodeAt(0);
        alts = [];
        for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? 1 : -1) alts.push(String.fromCharCode(v));
      }
    }
    if (!alts) continue;
    const out = [];
    for (const a of alts) for (const r of braceExpand(pre + a + post)) out.push(r);
    return out;
  }
  return [s];
}

function braceWords(parts) {
  if (!parts.some((p) => p.k === 'lit' && p.q === 0 && p.v.includes('{'))) return [parts];
  let s = '';
  parts.forEach((p, idx) => { s += p.k === 'lit' && p.q === 0 ? p.v : PH_OPEN + idx + PH_CLOSE; });
  const results = braceExpand(s);
  if (results.length === 1) return [parts];
  return results.map((r) => {
    const out = [];
    const re = /(\d+)/g;
    let last = 0;
    let m;
    while ((m = re.exec(r))) {
      if (m.index > last) out.push({ k: 'lit', v: r.slice(last, m.index), q: 0 });
      out.push(parts[Number(m[1])]);
      last = re.lastIndex;
    }
    if (last < r.length) out.push({ k: 'lit', v: r.slice(last), q: 0 });
    return out;
  });
}

// ---------- tilde ----------
function tilde(parts, env) {
  const first = parts[0];
  // assignment-like words (X=~/a:~/b, export PATH=~/bin:$PATH) expand ~ after = and :
  if (first && first.k === 'lit' && first.q === 0 && /^[A-Za-z_]\w*=/.test(first.v) && first.v.includes('~')) {
    const home = env.home();
    const v = first.v.replace(/([=:])~(?=\/|:|$)/g, `$1${home}`);
    return [{ k: 'lit', v, q: 0 }, ...parts.slice(1)];
  }
  if (!first || first.k !== 'lit' || first.q !== 0 || !first.v.startsWith('~')) return parts;
  const m = first.v.match(/^~([A-Za-z_][\w-]*)?(?=\/|$)/);
  if (!m) return parts;
  const home = env.home(m[1]);
  if (home === null) return parts;
  return [{ k: 'lit', v: home, q: 1 }, { k: 'lit', v: first.v.slice(m[0].length), q: 0 }, ...parts.slice(1)];
}

// ---------- arithmetic ----------
export function evalArith(expr, env) {
  const toks = expr.match(/0x[0-9a-fA-F]+|\d+|[A-Za-z_]\w*|\*\*|<=|>=|==|!=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|%=|<<|>>|[-+*/%()<>!~&|^=?:]/g) || [];
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const num = (v) => {
    if (v === undefined || v === '') return 0;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  };
  const prec = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '**': 11 };
  function unary() {
    const t = next();
    if (t === undefined) throw new ExpansionError('arithmetic syntax error: operand expected');
    if (t === '(') {
      const v = expr0();
      if (next() !== ')') throw new ExpansionError('arithmetic syntax error: missing )');
      return v;
    }
    if (t === '-') return -unary();
    if (t === '+') return unary();
    if (t === '!') return unary() ? 0 : 1;
    if (t === '~') return ~unary();
    if (t === '++' || t === '--') {
      const name = next();
      const v = num(env.get(name)) + (t === '++' ? 1 : -1);
      env.set(name, String(v));
      return v;
    }
    if (/^0x/i.test(t)) return parseInt(t, 16);
    if (/^\d+$/.test(t)) return t.length > 1 && t.startsWith('0') ? parseInt(t, 8) : parseInt(t, 10);
    if (/^[A-Za-z_]\w*$/.test(t)) {
      const op = peek();
      if (['=', '+=', '-=', '*=', '/=', '%='].includes(op)) {
        next();
        const rhs = expr0();
        const cur = num(env.get(t));
        const v = op === '=' ? rhs : op === '+=' ? cur + rhs : op === '-=' ? cur - rhs : op === '*=' ? cur * rhs : op === '/=' ? Math.trunc(cur / rhs) : cur % rhs;
        env.set(t, String(v));
        return v;
      }
      if (op === '++' || op === '--') {
        next();
        const cur = num(env.get(t));
        env.set(t, String(cur + (op === '++' ? 1 : -1)));
        return cur;
      }
      return num(env.get(t));
    }
    throw new ExpansionError(`arithmetic syntax error: invalid arithmetic operator (error token is "${t}")`);
  }
  function binary(minPrec) {
    let left = unary();
    for (;;) {
      const op = peek();
      const p = prec[op];
      if (!p || p < minPrec) break;
      next();
      const right = binary(op === '**' ? p : p + 1);
      switch (op) {
        case '+': left += right; break;
        case '-': left -= right; break;
        case '*': left *= right; break;
        case '/': if (right === 0) throw new ExpansionError('division by 0 (error token is "0")'); left = Math.trunc(left / right); break;
        case '%': if (right === 0) throw new ExpansionError('division by 0 (error token is "0")'); left %= right; break;
        case '**': left = left ** right; break;
        case '==': left = +(left === right); break;
        case '!=': left = +(left !== right); break;
        case '<': left = +(left < right); break;
        case '>': left = +(left > right); break;
        case '<=': left = +(left <= right); break;
        case '>=': left = +(left >= right); break;
        case '&&': left = +(!!left && !!right); break;
        case '||': left = +(!!left || !!right); break;
        case '&': left &= right; break;
        case '|': left |= right; break;
        case '^': left ^= right; break;
        case '<<': left <<= right; break;
        case '>>': left >>= right; break;
        default: break;
      }
    }
    return left;
  }
  function expr0() {
    const c = binary(1);
    if (peek() === '?') {
      next();
      const a = expr0();
      if (next() !== ':') throw new ExpansionError('arithmetic syntax error: expected :');
      const b = expr0();
      return c ? a : b;
    }
    return c;
  }
  if (!toks.length) return 0;
  const v = expr0();
  if (i < toks.length) throw new ExpansionError(`arithmetic syntax error in expression (error token is "${toks.slice(i).join(' ')}")`);
  return v;
}

// ---------- glob ----------
const CLASS = {
  alpha: 'A-Za-z', digit: '0-9', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', blank: ' \\t',
};
const escRe = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export function hasGlob(pat) {
  for (let i = 0; i < pat.length; i++) {
    if (pat[i] === '\\') { i++; continue; }
    if (pat[i] === '*' || pat[i] === '?') return true;
    if (pat[i] === '[' && pat.indexOf(']', i + 2) > i) return true;
  }
  return false;
}

export function unescapeGlob(pat) { return pat.replace(/\\(.)/g, '$1'); }
export const escGlob = (s) => s.replace(/[*?[\]\\]/g, '\\$&');

export function globRegex(pat, { anchored = true, slashOk = false } = {}) {
  let re = anchored ? '^' : '';
  const any = slashOk ? '.' : '[^/]';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '\\') { i++; re += escRe(pat[i] ?? '\\'); continue; }
    if (c === '*') { re += any + '*'; continue; }
    if (c === '?') { re += any; continue; }
    if (c === '[') {
      let j = i + 1;
      let neg = false;
      if (pat[j] === '!' || pat[j] === '^') { neg = true; j++; }
      const bodyStart = j;
      if (pat[j] === ']') j++;
      while (j < pat.length && pat[j] !== ']') {
        if (pat[j] === '[' && pat[j + 1] === ':') {
          const k = pat.indexOf(':]', j + 2);
          if (k > 0) { j = k + 2; continue; }
        }
        j++;
      }
      if (j >= pat.length) { re += '\\['; continue; }
      let body = pat.slice(bodyStart, j);
      body = body.replace(/\\/g, '\\\\').replace(/\[:(\w+):\]/g, (m, k) => CLASS[k] || m);
      if (body.startsWith(']')) body = '\\' + body;
      re += '[' + (neg ? '^' : '') + body + ']';
      i = j;
      continue;
    }
    re += escRe(c);
  }
  return new RegExp(re + (anchored ? '$' : ''));
}

// api: { cwd, list(absDir) -> names[] | null, isDir(abs), exists(abs) }
export function globPaths(pat, api) {
  const abs = pat.startsWith('/');
  const wantDir = pat.endsWith('/');
  const segs = pat.split('/').filter(Boolean);
  const joinReal = (a, b) => (a === '/' ? '/' + b : a + '/' + b);
  const joinDisp = (a, b) => (a === null ? b : a === '' ? '/' + b : a + '/' + b);
  let results = [{ disp: abs ? '' : null, real: abs ? '/' : api.cwd }];
  segs.forEach((seg, si) => {
    const last = si === segs.length - 1;
    const next = [];
    for (const r of results) {
      if (!hasGlob(seg)) {
        const lit = unescapeGlob(seg);
        const real = lit === '..' || lit === '.' ? normJoin(r.real, lit) : joinReal(r.real, lit);
        if (api.exists(real) && ((last && !wantDir) || api.isDir(real))) next.push({ disp: joinDisp(r.disp, lit), real });
        continue;
      }
      const names = api.list(r.real);
      if (!names) continue;
      const re = globRegex(seg);
      const dotOk = seg.startsWith('.') || seg.startsWith('\\.');
      for (const name of names) {
        if (name.startsWith('.') && !dotOk) continue;
        if (!re.test(name)) continue;
        const real = joinReal(r.real, name);
        if ((!last || wantDir) && !api.isDir(real)) continue;
        next.push({ disp: joinDisp(r.disp, name), real });
      }
    }
    results = next;
  });
  return results.map((r) => (wantDir ? r.disp + '/' : r.disp)).sort(lsCompare);
}

function normJoin(a, b) {
  if (b === '.') return a;
  const i = a.lastIndexOf('/');
  return i <= 0 ? '/' : a.slice(0, i);
}

// ---------- main expansion ----------
async function valueOf(p, env) {
  switch (p.k) {
    case 'var': return env.get(p.name) ?? '';
    case 'len': return String((env.get(p.name) ?? '').length);
    case 'cmd': return (await env.sub(p.src)).replace(/\n+$/, '');
    case 'arith': {
      const src = p.src.replace(/\$\{?(\w+|[?#$!])\}?/g, (m, n) => env.get(n) ?? '0');
      return String(evalArith(src, env));
    }
    case 'param': {
      const v = env.get(p.name);
      const empty = v === undefined || (p.op.startsWith(':') && v === '');
      const arg = async () => expandOne(lexWord(p.arg), env);
      switch (p.op) {
        case ':-': case '-': return empty ? arg() : v;
        case ':=': case '=': {
          if (!empty) return v;
          const a = await arg();
          env.set(p.name, a);
          return a;
        }
        case ':+': case '+': return empty ? '' : arg();
        case ':?': case '?':
          if (empty) throw new ExpansionError(`${p.name}: ${p.arg || 'parameter null or not set'}`);
          return v;
        default: return v ?? '';
      }
    }
    default: return '';
  }
}

async function fieldsOf(parts, env) {
  const fields = [];
  let cur = null;
  const ensure = () => (cur ||= { text: '', pat: '', quoted: false });
  const end = () => { if (cur) fields.push(cur); cur = null; };
  const addLit = (s, quoted) => {
    const f = ensure();
    f.text += s;
    f.pat += quoted ? escGlob(s) : s;
    if (quoted) f.quoted = true;
  };
  for (const p of parts) {
    if (p.k === 'lit') { addLit(p.v, p.q !== 0); continue; }
    if (p.k === 'var' && p.name === '@' && p.q === 2) {
      env.positional().forEach((a, idx) => {
        if (idx > 0) end();
        addLit(a, true);
      });
      continue;
    }
    const val = await valueOf(p, env);
    if (p.q === 2) { addLit(val, true); continue; }
    val.split(/[ \t\n]+/).forEach((piece, idx) => {
      if (idx > 0) end();
      if (piece) {
        const f = ensure();
        f.text += piece;
        f.pat += piece;
      }
    });
  }
  end();
  return fields;
}

// Full expansion of command words → argv.
export async function expandArgs(words, env) {
  const out = [];
  for (const w of words) {
    for (const parts of braceWords(tilde(w.parts, env))) {
      for (const f of await fieldsOf(tilde(parts, env), env)) {
        if (!f.text && !f.quoted) continue;
        if (hasGlob(f.pat)) {
          const matches = env.glob(f.pat);
          if (matches.length) { out.push(...matches); continue; }
        }
        out.push(f.text);
      }
    }
  }
  return out;
}

// Expansion without splitting or globbing (assignments, redirect targets).
export async function expandOne(word, env) {
  let s = '';
  for (const p of tilde(word.parts, env)) s += p.k === 'lit' ? p.v : await valueOf(p, env);
  return s;
}
