// A compact AWK interpreter: patterns, ranges, BEGIN/END, fields, associative arrays,
// if/while/for/for-in, print/printf (with > and >> redirection), and the common builtins.
import { posixRegex } from './regex.js';

export class AwkError extends Error {}

const KEYWORDS = new Set(['BEGIN', 'END', 'if', 'else', 'while', 'for', 'in', 'print', 'printf', 'next', 'exit', 'delete', 'do', 'break', 'continue', 'getline', 'function', 'return']);
const BUILTINS = new Set(['length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf', 'tolower', 'toupper', 'int', 'sqrt', 'exp', 'log', 'sin', 'cos', 'atan2', 'rand', 'srand', 'system']);

function tokenize(src) {
  const toks = [];
  let i = 0;
  const prevIsValue = () => {
    const t = toks[toks.length - 1];
    if (!t) return false;
    if (t.t === 'num' || t.t === 'str' || t.t === 'name' || t.t === 're') return true;
    return t.t === 'op' && (t.v === ')' || t.v === ']' || t.v === '++' || t.v === '--' || t.v === '$');
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '\n') { toks.push({ t: 'nl' }); i++; continue; }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1]))) {
      const m = src.slice(i).match(/^(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/);
      toks.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_]\w*/)[0];
      i += m.length;
      if (KEYWORDS.has(m)) toks.push({ t: 'kw', v: m });
      else if (BUILTINS.has(m)) toks.push({ t: 'func', v: m });
      else toks.push({ t: 'name', v: m });
      continue;
    }
    if (c === '"') {
      let s = '';
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') {
          const n = src[++i];
          s += { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/', a: '\x07', b: '\b' }[n] ?? '\\' + n;
          i++;
          continue;
        }
        s += src[i++];
      }
      if (i >= src.length) throw new AwkError('non-terminated string');
      i++;
      toks.push({ t: 'str', v: s });
      continue;
    }
    if (c === '/' && !prevIsValue()) {
      let s = '';
      i++;
      while (i < src.length && src[i] !== '/') {
        if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i += 2; continue; }
        if (src[i] === '\\') { s += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === '\n') throw new AwkError('non-terminated regular expression');
        s += src[i++];
      }
      i++;
      toks.push({ t: 're', v: s });
      continue;
    }
    const ops = ['+=', '-=', '*=', '/=', '%=', '^=', '==', '<=', '>=', '!=', '++', '--', '&&', '||', '!~', '>>', '**'];
    const op = ops.find((o) => src.startsWith(o, i));
    if (op) { toks.push({ t: 'op', v: op === '**' ? '^' : op }); i += op.length; continue; }
    if ('{}()[];,+-*/%^!><|?:~$='.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new AwkError(`syntax error at source line 1: unexpected character '${c}'`);
  }
  toks.push({ t: 'eof' });
  return toks;
}

class Parser {
  constructor(toks) { this.toks = toks; this.i = 0; }
  peek(o = 0) { return this.toks[this.i + o]; }
  next() { return this.toks[this.i++]; }
  is(t, v) { const k = this.peek(); return k.t === t && (v === undefined || k.v === v); }
  isOp(v) { return this.is('op', v); }
  eat(t, v) {
    if (!this.is(t, v)) {
      const k = this.peek();
      throw new AwkError(`syntax error at source line 1 near ${k.t === 'eof' ? 'end of program' : `'${k.v ?? k.t}'`}`);
    }
    return this.next();
  }
  nl() { while (this.is('nl') || this.isOp(';')) this.i++; }
  optNl() { while (this.is('nl')) this.i++; }

  program() {
    const items = [];
    this.nl();
    while (!this.is('eof')) {
      let pattern = null;
      let pattern2 = null;
      let kind = 'main';
      if (this.is('kw', 'BEGIN')) { this.next(); kind = 'begin'; }
      else if (this.is('kw', 'END')) { this.next(); kind = 'end'; }
      else if (!this.isOp('{')) {
        pattern = this.expr();
        if (this.isOp(',')) { this.next(); this.optNl(); pattern2 = this.expr(); }
      }
      let action = null;
      if (this.isOp('{')) action = this.block();
      else if (kind !== 'main') throw new AwkError(`syntax error: ${kind.toUpperCase()} needs an action`);
      items.push({ kind, pattern, pattern2, action, inRange: false });
      this.nl();
    }
    return items;
  }

  block() {
    this.eat('op', '{');
    const body = [];
    this.nl();
    while (!this.isOp('}')) {
      body.push(this.stmt());
      this.nl();
    }
    this.eat('op', '}');
    return { type: 'block', body };
  }

  simpleOrBlock() {
    this.optNl();
    if (this.isOp(';')) { this.next(); return { type: 'block', body: [] }; }
    return this.stmt();
  }

  stmt() {
    if (this.isOp('{')) return this.block();
    const k = this.peek();
    if (k.t === 'kw') {
      switch (k.v) {
        case 'if': {
          this.next();
          this.eat('op', '(');
          const c = this.expr();
          this.eat('op', ')');
          const then = this.simpleOrBlock();
          const save = this.i;
          this.nl();
          if (this.is('kw', 'else')) { this.next(); return { type: 'if', c, then, else: this.simpleOrBlock() }; }
          this.i = save;
          return { type: 'if', c, then, else: null };
        }
        case 'while': {
          this.next();
          this.eat('op', '(');
          const c = this.expr();
          this.eat('op', ')');
          return { type: 'while', c, body: this.simpleOrBlock() };
        }
        case 'do': {
          this.next();
          const body = this.simpleOrBlock();
          this.nl();
          this.eat('kw', 'while');
          this.eat('op', '(');
          const c = this.expr();
          this.eat('op', ')');
          return { type: 'do', c, body };
        }
        case 'for': {
          this.next();
          this.eat('op', '(');
          if (this.is('name') && this.peek(1).t === 'kw' && this.peek(1).v === 'in') {
            const v = this.next().v;
            this.next();
            const arr = this.eat('name').v;
            this.eat('op', ')');
            return { type: 'forin', v, arr, body: this.simpleOrBlock() };
          }
          const init = this.isOp(';') ? null : this.expr();
          this.eat('op', ';');
          const c = this.isOp(';') ? null : this.expr();
          this.eat('op', ';');
          const step = this.isOp(')') ? null : this.expr();
          this.eat('op', ')');
          return { type: 'for', init, c, step, body: this.simpleOrBlock() };
        }
        case 'print': case 'printf': {
          this.next();
          const args = [];
          const paren = this.isOp('(') && this.parenList();
          if (paren) args.push(...paren);
          else if (!this.endOfSimple()) {
            args.push(this.expr(true));
            while (this.isOp(',')) { this.next(); this.optNl(); args.push(this.expr(true)); }
          }
          let dest = null;
          if (this.isOp('>') || this.is('op', '>>') || this.isOp('|')) {
            const op = this.next().v;
            dest = { op, e: this.concat(true) };
          }
          return { type: k.v, args, dest };
        }
        case 'next': this.next(); return { type: 'next' };
        case 'break': this.next(); return { type: 'break' };
        case 'continue': this.next(); return { type: 'continue' };
        case 'exit': {
          this.next();
          return { type: 'exit', e: this.endOfSimple() ? null : this.expr() };
        }
        case 'delete': {
          this.next();
          const name = this.eat('name').v;
          let keys = null;
          if (this.isOp('[')) { this.next(); keys = this.exprList(']'); }
          return { type: 'delete', name, keys };
        }
        default: break;
      }
    }
    return { type: 'expr', e: this.expr() };
  }

  // print (a, b) — a parenthesised list only when followed by a statement end or redirection
  parenList() {
    const save = this.i;
    try {
      this.next();
      const list = this.exprList(')');
      if (this.endOfSimple() || this.isOp('>') || this.is('op', '>>') || this.isOp('|')) return list;
    } catch { /* not a list */ }
    this.i = save;
    return null;
  }

  endOfSimple() { return this.is('nl') || this.isOp(';') || this.isOp('}') || this.is('eof'); }

  exprList(close) {
    const list = [];
    this.optNl();
    if (!this.isOp(close)) {
      list.push(this.expr());
      while (this.isOp(',')) { this.next(); this.optNl(); list.push(this.expr()); }
    }
    this.eat('op', close);
    return list;
  }

  expr(noGt = false) { return this.ternary(noGt); }

  ternary(noGt) {
    const c = this.or(noGt);
    if (this.isOp('?')) {
      this.next();
      const a = this.ternary(noGt);
      this.eat('op', ':');
      const b = this.ternary(noGt);
      return { type: 'cond', c, a, b };
    }
    if (this.is('op') && ['=', '+=', '-=', '*=', '/=', '%=', '^='].includes(this.peek().v) && ['var', 'idx', 'field'].includes(c.type)) {
      const op = this.next().v;
      return { type: 'assign', op, target: c, e: this.ternary(noGt) };
    }
    return c;
  }

  or(noGt) {
    let a = this.and(noGt);
    while (this.is('op', '||')) { this.next(); this.optNl(); a = { type: 'bin', op: '||', a, b: this.and(noGt) }; }
    return a;
  }

  and(noGt) {
    let a = this.inExpr(noGt);
    while (this.is('op', '&&')) { this.next(); this.optNl(); a = { type: 'bin', op: '&&', a, b: this.inExpr(noGt) }; }
    return a;
  }

  inExpr(noGt) {
    let a = this.matchExpr(noGt);
    while (this.is('kw', 'in')) { this.next(); a = { type: 'in', key: a, name: this.eat('name').v }; }
    return a;
  }

  matchExpr(noGt) {
    let a = this.compare(noGt);
    while (this.isOp('~') || this.is('op', '!~')) {
      const neg = this.next().v === '!~';
      a = { type: 'match', neg, a, re: this.compare(noGt) };
    }
    return a;
  }

  compare(noGt) {
    let a = this.concat(noGt);
    for (;;) {
      const k = this.peek();
      if (k.t === 'op' && ['<', '<=', '==', '!=', '>=', '>'].includes(k.v) && !(noGt && k.v === '>')) {
        this.next();
        a = { type: 'bin', op: k.v, a, b: this.concat(noGt) };
      } else return a;
    }
  }

  startsValue() {
    const k = this.peek();
    if (['num', 'str', 're', 'name', 'func'].includes(k.t)) return true;
    return k.t === 'op' && ['$', '(', '!', '-', '+', '++', '--'].includes(k.v);
  }

  concat(noGt) {
    let a = this.additive();
    while (this.startsValue() && !(this.isOp('-') || this.isOp('+'))) a = { type: 'concat', a, b: this.additive() };
    void noGt;
    return a;
  }

  additive() {
    let a = this.mult();
    while (this.isOp('+') || this.isOp('-')) { const op = this.next().v; a = { type: 'bin', op, a, b: this.mult() }; }
    return a;
  }

  mult() {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) { const op = this.next().v; a = { type: 'bin', op, a, b: this.unary() }; }
    return a;
  }

  unary() {
    if (this.isOp('!')) { this.next(); return { type: 'un', op: '!', e: this.unary() }; }
    if (this.isOp('-')) { this.next(); return { type: 'un', op: '-', e: this.unary() }; }
    if (this.isOp('+')) { this.next(); return { type: 'un', op: '+', e: this.unary() }; }
    return this.power();
  }

  power() {
    const a = this.postfix();
    if (this.isOp('^')) { this.next(); return { type: 'bin', op: '^', a, b: this.unary() }; }
    return a;
  }

  postfix() {
    if (this.is('op', '++') || this.is('op', '--')) {
      const op = this.next().v;
      return { type: 'incdec', op, prefix: true, target: this.postfix() };
    }
    const p = this.primary();
    if ((this.is('op', '++') || this.is('op', '--')) && ['var', 'idx', 'field'].includes(p.type)) {
      return { type: 'incdec', op: this.next().v, prefix: false, target: p };
    }
    return p;
  }

  primary() {
    const k = this.next();
    switch (k.t) {
      case 'num': return { type: 'num', v: k.v };
      case 'str': return { type: 'str', v: k.v };
      case 're': return { type: 're', src: k.v };
      case 'func': {
        let args = [];
        if (this.isOp('(')) { this.next(); args = this.exprList(')'); }
        return { type: 'call', name: k.v, args };
      }
      case 'name': {
        if (this.isOp('[')) { this.next(); return { type: 'idx', name: k.v, keys: this.exprList(']') }; }
        return { type: 'var', name: k.v };
      }
      case 'op':
        if (k.v === '$') return { type: 'field', e: this.postfixNoIncr() };
        if (k.v === '(') {
          const e = this.expr();
          if (this.isOp(',')) {
            const keys = [e];
            while (this.isOp(',')) { this.next(); keys.push(this.expr()); }
            this.eat('op', ')');
            return { type: 'group', e: keys[0], keys };
          }
          this.eat('op', ')');
          return { type: 'group', e };
        }
        break;
      case 'kw':
        if (k.v === 'getline') return { type: 'num', v: 0 };
        break;
      default: break;
    }
    throw new AwkError(`syntax error at source line 1 near '${k.v ?? (k.t === 'eof' ? 'end of program' : k.t)}'`);
  }

  postfixNoIncr() {
    if (this.isOp('-')) { this.next(); return { type: 'un', op: '-', e: this.primary() }; }
    return this.primary();
  }
}

class Next {}
class Exit { constructor(code) { this.code = code; } }
class Brk {}
class Cont {}

const isNumStr = (s) => /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(s);

function num(v) {
  if (typeof v === 'number') return v;
  const m = String(v).match(/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/);
  return m ? Number(m[0]) : 0;
}

function str(v) {
  if (typeof v === 'string') return v;
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

function fmt(f, args) {
  let ai = 0;
  return f.replace(/%([-+ 0#]*)(\d+|\*)?(?:\.(\d+|\*))?([csdiouxXeEfgG%])/g, (m, flags, w, p, c) => {
    if (c === '%') return '%';
    if (w === '*') w = num(args[ai++]);
    if (p === '*') p = num(args[ai++]);
    const v = args[ai++];
    let s;
    switch (c) {
      case 'c': s = typeof v === 'number' ? String.fromCharCode(v) : str(v ?? '').charAt(0); break;
      case 's': s = str(v ?? ''); if (p !== undefined) s = s.slice(0, Number(p)); break;
      case 'd': case 'i': s = String(Math.trunc(num(v ?? 0))); break;
      case 'o': s = Math.trunc(num(v ?? 0)).toString(8); break;
      case 'x': s = Math.trunc(num(v ?? 0)).toString(16); break;
      case 'X': s = Math.trunc(num(v ?? 0)).toString(16).toUpperCase(); break;
      case 'e': case 'E': s = num(v ?? 0).toExponential(p !== undefined ? Number(p) : 6); break;
      case 'f': s = num(v ?? 0).toFixed(p !== undefined ? Number(p) : 6); break;
      default: s = String(Number(num(v ?? 0).toPrecision(p !== undefined ? Number(p) || 1 : 6)));
    }
    if (flags.includes('+') && /[dieEfgG]/.test(c) && num(v ?? 0) >= 0) s = '+' + s;
    if (w !== undefined) {
      const width = Number(w);
      if (flags.includes('-')) s = s.padEnd(width);
      else s = s.padStart(width, flags.includes('0') && /[dioxXeEfgG]/.test(c) ? '0' : ' ');
    }
    return s;
  });
}

export async function runAwk(src, { fs = null, vars = {}, files = [], read, stdin, writeFile } = {}) {
  const items = new Parser(tokenize(src)).program();
  const V = { NR: 0, NF: 0, FNR: 0, FS: fs ?? ' ', OFS: ' ', ORS: '\n', RS: '\n', FILENAME: '', SUBSEP: '\x1c', RSTART: 0, RLENGTH: -1, OFMT: '%.6g' };
  const arrays = new Map();
  const reCache = new Map();
  const outFiles = new Map();
  for (const [k, v] of Object.entries(vars)) V[k] = isNumStr(v) ? v : v;
  let fields = [''];
  let out = '';
  const re = (s) => {
    if (!reCache.has(s)) reCache.set(s, posixRegex(s, { extended: true }));
    return reCache.get(s);
  };
  const arr = (name) => {
    if (!arrays.has(name)) arrays.set(name, new Map());
    return arrays.get(name);
  };
  const splitRec = (rec) => {
    const f = V.FS;
    let parts;
    if (f === ' ') parts = rec.trim() ? rec.trim().split(/[ \t\n]+/) : [];
    else if (f.length === 1 && f !== '\\') parts = rec === '' ? [] : rec.split(f);
    else parts = rec === '' ? [] : rec.split(re(f));
    fields = [rec, ...parts];
    V.NF = parts.length;
  };
  const getField = (i) => {
    if (i < 0) throw new AwkError(`trying to access out of range field ${i}`);
    return fields[i] ?? '';
  };
  const setField = (i, v) => {
    if (i === 0) { splitRec(str(v)); return; }
    while (fields.length <= i) fields.push('');
    fields[i] = str(v);
    V.NF = Math.max(V.NF, i);
    fields[0] = fields.slice(1, V.NF + 1).join(V.OFS);
  };
  const isStrnum = (node, v) => typeof v === 'number' || ((node.type === 'field' || node.type === 'var' || node.type === 'idx') && isNumStr(v));
  const lval = {
    get: (t) => {
      if (t.type === 'var') return t.name in V ? V[t.name] : '';
      if (t.type === 'field') return getField(Math.trunc(num(ev(t.e))));
      const key = t.keys.map((k) => str(ev(k))).join(V.SUBSEP);
      const a = arr(t.name);
      return a.has(key) ? a.get(key) : (a.set(key, ''), '');
    },
    set: (t, v) => {
      if (t.type === 'var') { V[t.name] = v; if (t.name === 'NF') { fields.length = Math.trunc(num(v)) + 1; fields[0] = fields.slice(1).join(V.OFS); } return; }
      if (t.type === 'field') { setField(Math.trunc(num(ev(t.e))), v); return; }
      arr(t.name).set(t.keys.map((k) => str(ev(k))).join(V.SUBSEP), v);
    },
  };
  const call = (name, args) => {
    const a = (i) => (args[i] ? ev(args[i]) : undefined);
    switch (name) {
      case 'length': return args.length ? (args[0].type === 'var' && arrays.has(args[0].name) ? arrays.get(args[0].name).size : str(a(0)).length) : fields[0].length;
      case 'substr': {
        const s = str(a(0));
        let m = Math.round(num(a(1)));
        let n = args.length > 2 ? Math.round(num(a(2))) : Infinity;
        if (m < 1) { n += m - 1; m = 1; }
        return n <= 0 ? '' : s.substr(m - 1, n === Infinity ? undefined : n);
      }
      case 'index': return str(a(0)).indexOf(str(a(1))) + 1;
      case 'split': {
        const s = str(a(0));
        const target = args[1].name;
        const sep = args.length > 2 ? (args[2].type === 're' ? args[2].src : str(a(2))) : V.FS;
        const parts = sep === ' ' ? (s.trim() ? s.trim().split(/\s+/) : []) : s === '' ? [] : s.split(sep.length === 1 ? sep : re(sep));
        const m = arr(target);
        m.clear();
        parts.forEach((p, i) => m.set(String(i + 1), p));
        return parts.length;
      }
      case 'sub': case 'gsub': {
        const pat = args[0].type === 're' ? args[0].src : str(a(0));
        const rep = str(a(1));
        const target = args[2] || { type: 'field', e: { type: 'num', v: 0 } };
        const cur = str(lval.get(target));
        let count = 0;
        const rx = new RegExp(re(pat).source, name === 'gsub' ? 'g' : '');
        const nv = cur.replace(rx, (m0) => { count++; return rep.replace(/\\&|&/g, (t) => (t === '&' ? m0 : '&')); });
        if (count) lval.set(target, nv);
        return count;
      }
      case 'match': {
        const m = str(a(0)).match(re(args[1].type === 're' ? args[1].src : str(a(1))));
        V.RSTART = m ? m.index + 1 : 0;
        V.RLENGTH = m ? m[0].length : -1;
        return V.RSTART;
      }
      case 'sprintf': return fmt(str(a(0)), args.slice(1).map(ev));
      case 'tolower': return str(a(0)).toLowerCase();
      case 'toupper': return str(a(0)).toUpperCase();
      case 'int': return Math.trunc(num(a(0)));
      case 'sqrt': return Math.sqrt(num(a(0)));
      case 'exp': return Math.exp(num(a(0)));
      case 'log': return Math.log(num(a(0)));
      case 'sin': return Math.sin(num(a(0)));
      case 'cos': return Math.cos(num(a(0)));
      case 'atan2': return Math.atan2(num(a(0)), num(a(1)));
      case 'rand': return Math.random();
      case 'srand': return 0;
      case 'system': return 0;
      default: throw new AwkError(`calling undefined function ${name}`);
    }
  };
  function ev(n) {
    switch (n.type) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 're': return re(n.src).test(fields[0]) ? 1 : 0;
      case 'group': return n.keys ? n.keys.map((k) => str(ev(k))).join(V.SUBSEP) : ev(n.e);
      case 'var': case 'field': case 'idx': return lval.get(n);
      case 'assign': {
        const rhs = ev(n.e);
        let v = rhs;
        if (n.op !== '=') {
          const cur = num(lval.get(n.target));
          const r = num(rhs);
          v = { '+=': cur + r, '-=': cur - r, '*=': cur * r, '/=': cur / r, '%=': cur % r, '^=': cur ** r }[n.op];
        }
        lval.set(n.target, v);
        return v;
      }
      case 'incdec': {
        const cur = num(lval.get(n.target));
        const nv = n.op === '++' ? cur + 1 : cur - 1;
        lval.set(n.target, nv);
        return n.prefix ? nv : cur;
      }
      case 'cond': return truthy(ev(n.c)) ? ev(n.a) : ev(n.b);
      case 'un': {
        const v = ev(n.e);
        if (n.op === '!') return truthy(v) ? 0 : 1;
        return n.op === '-' ? -num(v) : num(v);
      }
      case 'concat': return str(ev(n.a)) + str(ev(n.b));
      case 'in': return arr(n.name).has(str(ev(n.key))) ? 1 : 0;
      case 'match': {
        const s = str(ev(n.a));
        const pat = n.re.type === 're' ? n.re.src : str(ev(n.re));
        const r = re(pat).test(s);
        return (n.neg ? !r : r) ? 1 : 0;
      }
      case 'call': return call(n.name, n.args);
      case 'bin': {
        if (n.op === '&&') return truthy(ev(n.a)) && truthy(ev(n.b)) ? 1 : 0;
        if (n.op === '||') return truthy(ev(n.a)) || truthy(ev(n.b)) ? 1 : 0;
        const a = ev(n.a);
        const b = ev(n.b);
        switch (n.op) {
          case '+': return num(a) + num(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': if (num(b) === 0) throw new AwkError('division by zero'); return num(a) / num(b);
          case '%': if (num(b) === 0) throw new AwkError('division by zero in %'); return num(a) % num(b);
          case '^': return num(a) ** num(b);
          default: {
            const numeric = isStrnum(n.a, a) && isStrnum(n.b, b);
            const x = numeric ? num(a) : str(a);
            const y = numeric ? num(b) : str(b);
            const r = { '<': x < y, '<=': x <= y, '>': x > y, '>=': x >= y, '==': x === y, '!=': x !== y }[n.op];
            return r ? 1 : 0;
          }
        }
      }
      default: throw new AwkError(`cannot evaluate ${n.type}`);
    }
  }
  function truthy(v) {
    if (typeof v === 'number') return v !== 0;
    return isNumStr(v) ? Number(v) !== 0 : v !== '';
  }
  const emit = (text, dest) => {
    if (!dest) { out += text; return; }
    const name = str(ev(dest.e));
    if (dest.op === '|') { out += text; return; }
    if (!outFiles.has(name)) outFiles.set(name, { append: dest.op === '>>', text: '' });
    outFiles.get(name).text += text;
  };
  function exec(s) {
    switch (s.type) {
      case 'block': for (const x of s.body) exec(x); return;
      case 'expr': ev(s.e); return;
      case 'print': {
        const text = s.args.length ? s.args.map((a) => {
          const v = ev(a);
          return typeof v === 'number' && !Number.isInteger(v) ? fmt(V.OFMT, [v]) : str(v);
        }).join(V.OFS) : fields[0];
        emit(text + V.ORS, s.dest);
        return;
      }
      case 'printf': {
        if (!s.args.length) throw new AwkError('printf: no format');
        emit(fmt(str(ev(s.args[0])), s.args.slice(1).map(ev)), s.dest);
        return;
      }
      case 'if': if (truthy(ev(s.c))) exec(s.then); else if (s.else) exec(s.else); return;
      case 'while': {
        let g = 0;
        while (truthy(ev(s.c))) {
          if (++g > 100000) throw new AwkError('loop limit reached');
          try { exec(s.body); } catch (e) { if (e instanceof Brk) break; if (e instanceof Cont) continue; throw e; }
        }
        return;
      }
      case 'do': {
        let g = 0;
        do {
          if (++g > 100000) throw new AwkError('loop limit reached');
          try { exec(s.body); } catch (e) { if (e instanceof Brk) break; if (e instanceof Cont) continue; throw e; }
        } while (truthy(ev(s.c)));
        return;
      }
      case 'for': {
        let g = 0;
        for (s.init && ev(s.init); s.c ? truthy(ev(s.c)) : true; s.step && ev(s.step)) {
          if (++g > 100000) throw new AwkError('loop limit reached');
          try { exec(s.body); } catch (e) { if (e instanceof Brk) break; if (e instanceof Cont) continue; throw e; }
        }
        return;
      }
      case 'forin': {
        for (const k of [...arr(s.arr).keys()]) {
          V[s.v] = k;
          try { exec(s.body); } catch (e) { if (e instanceof Brk) break; if (e instanceof Cont) continue; throw e; }
        }
        return;
      }
      case 'delete': if (s.keys) arr(s.name).delete(s.keys.map((k) => str(ev(k))).join(V.SUBSEP)); else arr(s.name).clear(); return;
      case 'next': throw new Next();
      case 'exit': throw new Exit(s.e ? num(ev(s.e)) : 0);
      case 'break': throw new Brk();
      case 'continue': throw new Cont();
      default: throw new AwkError(`unknown statement ${s.type}`);
    }
  }
  const main = items.filter((it) => it.kind === 'main');
  let exited = false;
  try {
    for (const it of items.filter((x) => x.kind === 'begin')) exec(it.action);
    if (main.length || items.some((x) => x.kind === 'end')) {
      const sources = files.length ? files : ['-'];
      for (const f of sources) {
        if (/^[A-Za-z_]\w*=/.test(f)) { const i = f.indexOf('='); V[f.slice(0, i)] = f.slice(i + 1); continue; }
        const data = f === '-' ? await stdin() : await read(f);
        V.FILENAME = f === '-' ? '' : f;
        V.FNR = 0;
        const recs = data.split('\n');
        if (recs[recs.length - 1] === '') recs.pop();
        for (const rec of recs) {
          V.NR++;
          V.FNR++;
          splitRec(rec);
          try {
            for (const it of main) {
              let hit;
              if (it.pattern2) {
                if (!it.inRange && truthy(ev(it.pattern))) it.inRange = true;
                hit = it.inRange;
                if (it.inRange && truthy(ev(it.pattern2))) it.inRange = false;
              } else hit = it.pattern ? truthy(ev(it.pattern)) : true;
              if (!hit) continue;
              if (it.action) exec(it.action);
              else out += fields[0] + V.ORS;
            }
          } catch (e) {
            if (!(e instanceof Next)) throw e;
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof Exit) exited = true;
    else throw e;
  }
  try {
    for (const it of items.filter((x) => x.kind === 'end')) exec(it.action);
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
  }
  void exited;
  if (writeFile) for (const [name, f] of outFiles) writeFile(name, f.text, f.append);
  else for (const [, f] of outFiles) out += f.text;
  return out;
}
