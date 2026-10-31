// Bash-subset lexer and recursive-descent parser.
// Supports quoting, escapes, $VAR ${VAR} ${VAR:-x} ${#VAR} $(cmd) `cmd` $((math)),
// pipes, && || ; &, redirections, ( subshell ), { group; }, if/elif/else, for, while/until, comments.

export class IncompleteInput extends Error {
  constructor() { super('incomplete input'); }
}

export class ShellSyntaxError extends Error {}

const OPS = ['&>>', '&&', '||', ';;', '>>', '<<<', '<<', '<&', '>&', '&>', '>|', '|', '&', ';', '<', '>', '(', ')', '\n'];
const REDIR = new Set(['>', '>>', '<', '>&', '<&', '&>', '&>>', '>|', '<<<', '<<']);
const WORD_BREAK = ' \t\n|&;<>()';

const syntaxErr = (tok) => new ShellSyntaxError(`syntax error near unexpected token \`${tok === 'nl' ? 'newline' : tok}'`);

export function lex(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ t: 'op', v: op === '\n' ? 'nl' : op });
      i += op.length;
      continue;
    }
    const start = i;
    const parts = [];
    let lit = '';
    let litQ = 0;
    const flush = () => {
      if (lit) parts.push({ k: 'lit', v: lit, q: litQ });
      lit = '';
    };
    const pushLit = (s, q) => {
      if (litQ !== q) flush();
      litQ = q;
      lit += s;
    };
    while (i < n) {
      const ch = src[i];
      if (WORD_BREAK.includes(ch)) break;
      if (ch === '\\') {
        if (i + 1 >= n) throw new IncompleteInput();
        if (src[i + 1] === '\n') { i += 2; continue; }
        pushLit(src[i + 1], 1);
        i += 2;
        continue;
      }
      if (ch === "'") {
        const j = src.indexOf("'", i + 1);
        if (j < 0) throw new IncompleteInput();
        flush();
        parts.push({ k: 'lit', v: src.slice(i + 1, j), q: 1 });
        i = j + 1;
        continue;
      }
      if (ch === '"') {
        flush();
        i = lexDouble(src, i + 1, parts);
        continue;
      }
      if (ch === '$' || ch === '`') {
        const r = lexDollar(src, i, 0);
        if (r) {
          flush();
          parts.push(r.part);
          i = r.end;
          continue;
        }
      }
      pushLit(ch, 0);
      i++;
    }
    flush();
    const raw = src.slice(start, i);
    if (/^\d+$/.test(raw) && (src[i] === '>' || src[i] === '<')) toks.push({ t: 'io', fd: Number(raw) });
    else toks.push({ t: 'word', parts, raw });
  }
  return toks;
}

function lexDouble(src, i, parts) {
  let lit = '';
  let any = false;
  const flush = () => {
    if (lit) { parts.push({ k: 'lit', v: lit, q: 2 }); any = true; }
    lit = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      flush();
      if (!any) parts.push({ k: 'lit', v: '', q: 2 });
      return i + 1;
    }
    if (ch === '\\' && i + 1 < src.length) {
      const nx = src[i + 1];
      if ('"\\$`'.includes(nx)) { lit += nx; i += 2; continue; }
      if (nx === '\n') { i += 2; continue; }
      lit += ch;
      i++;
      continue;
    }
    if (ch === '$' || ch === '`') {
      const r = lexDollar(src, i, 2);
      if (r) {
        flush();
        parts.push(r.part);
        any = true;
        i = r.end;
        continue;
      }
    }
    lit += ch;
    i++;
  }
  throw new IncompleteInput();
}

function matchParen(src, i) {
  // i points just after an opening '('; returns index of the matching ')'
  let depth = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) throw new IncompleteInput();
      i = j + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
      if (i >= src.length) throw new IncompleteInput();
      i++;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  throw new IncompleteInput();
}

function lexDollar(src, i, q) {
  if (src[i] === '`') {
    let j = i + 1;
    while (j < src.length && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
    if (j >= src.length) throw new IncompleteInput();
    return { part: { k: 'cmd', src: src.slice(i + 1, j), q }, end: j + 1 };
  }
  const nx = src[i + 1];
  if (nx === '(' && src[i + 2] === '(') {
    const inner = matchParen(src, i + 3);
    if (src[inner + 1] === ')') return { part: { k: 'arith', src: src.slice(i + 3, inner), q }, end: inner + 2 };
    const close = matchParen(src, i + 2);
    return { part: { k: 'cmd', src: src.slice(i + 2, close), q }, end: close + 1 };
  }
  if (nx === '(') {
    const close = matchParen(src, i + 2);
    return { part: { k: 'cmd', src: src.slice(i + 2, close), q }, end: close + 1 };
  }
  if (nx === '{') {
    const close = src.indexOf('}', i + 2);
    if (close < 0) throw new IncompleteInput();
    const inner = src.slice(i + 2, close);
    let m;
    if ((m = inner.match(/^#([A-Za-z_]\w*|[@*#?$!0-9])$/))) return { part: { k: 'len', name: m[1], q }, end: close + 1 };
    if ((m = inner.match(/^([A-Za-z_]\w*|[@*#?$!0-9])(:?[-=+?])([\s\S]*)$/))) {
      return { part: { k: 'param', name: m[1], op: m[2], arg: m[3], q }, end: close + 1 };
    }
    if ((m = inner.match(/^([A-Za-z_]\w*|[@*#?$!]|\d+)$/))) return { part: { k: 'var', name: m[1], q }, end: close + 1 };
    throw new ShellSyntaxError(`\${${inner}}: bad substitution`);
  }
  if (nx && /[A-Za-z_]/.test(nx)) {
    let j = i + 1;
    while (j < src.length && /\w/.test(src[j])) j++;
    return { part: { k: 'var', name: src.slice(i + 1, j), q }, end: j };
  }
  if (nx && /[?$#@*!0-9-]/.test(nx)) return { part: { k: 'var', name: nx, q }, end: i + 2 };
  return null;
}

const plain = (t) => t && t.t === 'word' && t.parts.length === 1 && t.parts[0].k === 'lit' && t.parts[0].q === 0;
const wordText = (t) => (plain(t) ? t.parts[0].v : null);

function asAssign(t) {
  const first = t.parts[0];
  if (!first || first.k !== 'lit' || first.q !== 0) return null;
  const m = first.v.match(/^([A-Za-z_]\w*)(\+?)=([\s\S]*)$/);
  if (!m) return null;
  const parts = [];
  if (m[3]) parts.push({ k: 'lit', v: m[3], q: 0 });
  parts.push(...t.parts.slice(1));
  return { name: m[1], append: !!m[2], value: { t: 'word', parts } };
}

class Parser {
  constructor(toks) {
    this.toks = toks;
    this.i = 0;
  }

  peek() { return this.toks[this.i]; }
  eof() { return this.i >= this.toks.length; }
  isOp(v) { const t = this.peek(); return !!t && t.t === 'op' && t.v === v; }
  isKw(w) { return wordText(this.peek()) === w; }
  skipNl() { while (this.isOp('nl')) this.i++; }

  expectKw(w) {
    this.skipNl();
    if (this.eof()) throw new IncompleteInput();
    if (!this.isKw(w)) {
      const t = this.peek();
      throw syntaxErr(t.t === 'op' ? t.v : t.raw);
    }
    this.i++;
  }

  atStop(stops) {
    const t = this.peek();
    if (!t) return false;
    if (t.t === 'op') return t.v === ')' && stops.has(')');
    return stops.has(wordText(t));
  }

  list(stops) {
    const items = [];
    this.skipNl();
    while (!this.eof() && !this.atStop(stops)) {
      const node = this.andOr();
      let async = false;
      if (this.isOp('&')) { this.i++; async = true; }
      else if (this.isOp(';') || this.isOp('nl')) this.i++;
      else if (!this.eof() && !this.atStop(stops)) {
        const t = this.peek();
        throw syntaxErr(t.t === 'op' ? t.v : t.raw);
      }
      items.push({ node, async });
      this.skipNl();
    }
    return { type: 'list', items };
  }

  andOr() {
    const first = this.pipeline();
    const rest = [];
    while (this.isOp('&&') || this.isOp('||')) {
      const op = this.toks[this.i++].v;
      this.skipNl();
      if (this.eof()) throw new IncompleteInput();
      rest.push({ op, node: this.pipeline() });
    }
    return { type: 'andor', first, rest };
  }

  pipeline() {
    let negate = false;
    if (this.isKw('!')) { this.i++; negate = true; }
    const cmds = [this.command()];
    while (this.isOp('|')) {
      this.i++;
      this.skipNl();
      if (this.eof()) throw new IncompleteInput();
      cmds.push(this.command());
    }
    return { type: 'pipeline', cmds, negate };
  }

  command() {
    const t = this.peek();
    if (!t) throw new IncompleteInput();
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const body = this.list(new Set([')']));
      if (this.eof()) throw new IncompleteInput();
      this.i++;
      return this.redirs({ type: 'subshell', body });
    }
    if (t.t === 'op' && !REDIR.has(t.v)) throw syntaxErr(t.v);
    const w = wordText(t);
    if (w === 'if') return this.redirs(this.ifCmd());
    if (w === 'for') return this.redirs(this.forCmd());
    if (w === 'while' || w === 'until') return this.redirs(this.whileCmd(w === 'until'));
    if (w === '{') {
      this.i++;
      const body = this.list(new Set(['}']));
      this.expectKw('}');
      return this.redirs({ type: 'group', body });
    }
    if (['then', 'fi', 'do', 'done', 'else', 'elif', '}', 'in'].includes(w)) throw syntaxErr(w);
    return this.simple();
  }

  redirs(node) {
    node.redirs = [];
    while (!this.eof() && (this.peek().t === 'io' || (this.peek().t === 'op' && REDIR.has(this.peek().v)))) {
      node.redirs.push(this.redir());
    }
    return node;
  }

  simple() {
    const assigns = [];
    const words = [];
    const redirs = [];
    while (!this.eof()) {
      const t = this.peek();
      if (t.t === 'io' || (t.t === 'op' && REDIR.has(t.v))) { redirs.push(this.redir()); continue; }
      if (t.t !== 'word') break;
      if (!words.length) {
        const a = asAssign(t);
        if (a) { assigns.push(a); this.i++; continue; }
      }
      words.push(t);
      this.i++;
    }
    if (!assigns.length && !words.length && !redirs.length) {
      const t = this.peek();
      throw syntaxErr(t ? (t.t === 'op' ? t.v : t.raw) : 'nl');
    }
    return { type: 'simple', assigns, words, redirs };
  }

  redir() {
    let fd = null;
    if (this.peek().t === 'io') fd = this.toks[this.i++].fd;
    const op = this.toks[this.i++].v;
    if (op === '<<') throw new ShellSyntaxError('here-documents (<<) are not part of this realm yet. Use echo, printf or nano to write files.');
    const target = this.peek();
    if (!target) throw syntaxErr('nl');
    if (target.t !== 'word') throw syntaxErr(target.t === 'op' ? target.v : 'nl');
    this.i++;
    return { fd, op, target };
  }

  ifCmd() {
    this.i++;
    const clauses = [];
    const cond = this.list(new Set(['then']));
    this.expectKw('then');
    const body = this.list(new Set(['elif', 'else', 'fi']));
    clauses.push({ cond, body });
    let elseBody = null;
    for (;;) {
      this.skipNl();
      if (this.eof()) throw new IncompleteInput();
      if (this.isKw('elif')) {
        this.i++;
        const c = this.list(new Set(['then']));
        this.expectKw('then');
        clauses.push({ cond: c, body: this.list(new Set(['elif', 'else', 'fi'])) });
        continue;
      }
      if (this.isKw('else')) {
        this.i++;
        elseBody = this.list(new Set(['fi']));
      }
      this.expectKw('fi');
      break;
    }
    return { type: 'if', clauses, else: elseBody };
  }

  forCmd() {
    this.i++;
    const nameTok = this.peek();
    if (!nameTok) throw new IncompleteInput();
    const name = wordText(nameTok);
    if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw syntaxErr(nameTok.raw || nameTok.v);
    this.i++;
    let words = null;
    this.skipNl();
    if (this.isKw('in')) {
      this.i++;
      words = [];
      while (!this.eof() && this.peek().t === 'word') words.push(this.toks[this.i++]);
    }
    if (this.isOp(';') || this.isOp('nl')) this.i++;
    this.expectKw('do');
    const body = this.list(new Set(['done']));
    this.expectKw('done');
    return { type: 'for', name, words, body };
  }

  whileCmd(until) {
    this.i++;
    const cond = this.list(new Set(['do']));
    this.expectKw('do');
    const body = this.list(new Set(['done']));
    this.expectKw('done');
    return { type: 'while', until, cond, body };
  }
}

export function parse(src) {
  const p = new Parser(lex(src));
  const prog = p.list(new Set());
  if (!p.eof()) {
    const t = p.peek();
    throw syntaxErr(t.t === 'op' ? t.v : t.raw);
  }
  return prog;
}

// Lex a raw string (e.g. the "word" part of ${VAR:-word}) into a single word token.
export function lexWord(src) {
  const toks = lex(src.replace(/([ \t|&;<>()])/g, '\\$1'));
  if (!toks.length) return { t: 'word', parts: [{ k: 'lit', v: '', q: 1 }] };
  return toks[0];
}

export { REDIR, wordText };
